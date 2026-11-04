package realtime

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
	"github.com/mdenizay/retfast/services/api/internal/platform/redisx"
	"github.com/mdenizay/retfast/services/api/internal/realtime/bus"

	"log/slog"
)

// QueueSize bounds each connection's outbound queue (contract: 256).
const QueueSize = 256

// Close codes per the contract.
const (
	CloseUnauthorized = 4001
	CloseSlowConsumer = 4008
	CloseRestart      = 1012
)

// Client is one WebSocket connection's outbound side.
type Client struct {
	send      chan []byte
	closeOnce sync.Once
	kill      func(code int, reason string)
	done      chan struct{}
}

// NewClient returns a client whose kill func closes the transport.
func NewClient(kill func(code int, reason string)) *Client {
	return &Client{send: make(chan []byte, QueueSize), kill: kill, done: make(chan struct{})}
}

// Close terminates the client once.
func (c *Client) Close(code int, reason string) {
	c.closeOnce.Do(func() {
		close(c.done)
		if c.kill != nil {
			c.kill(code, reason)
		}
	})
}

// Done is closed when the client is closed.
func (c *Client) Done() <-chan struct{} { return c.done }

// Send returns the outbound queue.
func (c *Client) Send() <-chan []byte { return c.send }

// Enqueue queues b without blocking; it reports false if the queue is full.
func (c *Client) Enqueue(b []byte) bool {
	select {
	case <-c.done:
		return false
	default:
	}
	select {
	case c.send <- b:
		return true
	default:
		return false
	}
}

// Channel kinds.
const (
	KindEvent = iota
	KindFlight
	KindIncidents
)

// Subscription is one client's subscription with the authorization facts
// captured at subscribe time; each message is re-checked against them plus the
// message's own (current) flight facts.
type Subscription struct {
	Channel string
	Kind    int
	Client  *Client
	Actor   *authz.Actor

	Event     authz.Event
	Member    string
	GuestView bool

	FlightID      uuid.UUID
	FlightEventID *uuid.UUID
	FlightMember  string

	IncidentAll    bool
	IncidentEvents map[uuid.UUID]bool

	mu      sync.Mutex
	ready   bool
	pending []pendingMsg
	lastID  StreamID
}

type pendingMsg struct {
	id StreamID
	b  []byte
}

// StreamID is a parsed Redis stream id.
type StreamID struct{ MS, Seq uint64 }

// ParseStreamID parses "ms-seq".
func ParseStreamID(s string) (StreamID, bool) {
	a, b, ok := strings.Cut(s, "-")
	if !ok {
		return StreamID{}, false
	}
	ms, err1 := strconv.ParseUint(a, 10, 64)
	seq, err2 := strconv.ParseUint(b, 10, 64)
	if err1 != nil || err2 != nil {
		return StreamID{}, false
	}
	return StreamID{ms, seq}, true
}

// Less orders ids.
func (a StreamID) Less(b StreamID) bool { return a.MS < b.MS || (a.MS == b.MS && a.Seq < b.Seq) }

func (a StreamID) String() string {
	return strconv.FormatUint(a.MS, 10) + "-" + strconv.FormatUint(a.Seq, 10)
}

// Delivery variants.
const (
	deliverNone = iota
	deliverData
	deliverPublic
	deliverRemoved
)

// Decide applies the policy to one envelope.
func (s *Subscription) Decide(env *bus.Envelope) int {
	switch s.Kind {
	case KindIncidents:
		if env.Type != bus.TypeIncident {
			return deliverNone
		}
		if s.IncidentAll || (env.EventID != nil && s.IncidentEvents[*env.EventID]) {
			return deliverData
		}
		return deliverNone
	case KindEvent, KindFlight:
		if env.Type == bus.TypeIncident || env.OwnerID == nil {
			return deliverNone
		}
		facts := authz.Flight{OwnerID: *env.OwnerID, EventID: env.EventID, Visibility: env.Visibility, IncidentOpen: env.IncidentOpen}
		var ok, guest bool
		if s.Kind == KindEvent {
			if env.EventID == nil || *env.EventID != s.Event.ID {
				ok = false
			} else {
				ok = authz.CanSeeLiveFlight(s.Actor, s.Event, s.Member, facts)
			}
			guest = s.GuestView
		} else {
			member := s.FlightMember
			if !sameEvent(env.EventID, s.FlightEventID) {
				member = "" // flight moved to another event; be conservative
			}
			ok = authz.CanViewFlight(s.Actor, facts, member)
			guest = member == "" && !s.Actor.IsGlobalResponder()
		}
		if !ok {
			if env.Type == bus.TypeFlight {
				return deliverRemoved
			}
			return deliverNone
		}
		if guest && !s.Actor.Is(*env.OwnerID) {
			if len(env.PublicData) == 0 {
				return deliverNone
			}
			return deliverPublic
		}
		return deliverData
	}
	return deliverNone
}

func sameEvent(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// Render builds the wire message for a variant.
func Render(env *bus.Envelope, channel, cursor string, variant int) []byte {
	var data json.RawMessage
	switch variant {
	case deliverData:
		data = env.Data
	case deliverPublic:
		data = env.PublicData
	case deliverRemoved:
		data, _ = json.Marshal(map[string]any{"id": env.FlightID, "visibility": env.Visibility, "removed": true})
	default:
		return nil
	}
	b, _ := json.Marshal(struct {
		Type    string          `json:"type"`
		Channel string          `json:"channel"`
		Cursor  string          `json:"cursor"`
		Data    json.RawMessage `json:"data"`
		SrvMS   int64           `json:"server_received_ms,omitempty"`
	}{env.Type, channel, cursor, data, env.ServerReceivedMS})
	return b
}

// deliver queues a live message, buffering it until the subscription is ready.
func (s *Subscription) deliver(id StreamID, b []byte, onSlow func(*Client)) {
	s.mu.Lock()
	if !s.ready {
		if len(s.pending) < QueueSize {
			s.pending = append(s.pending, pendingMsg{id, b})
		}
		s.mu.Unlock()
		return
	}
	if !s.lastID.Less(id) && s.lastID != (StreamID{}) {
		s.mu.Unlock()
		return // already sent during replay
	}
	s.lastID = id
	s.mu.Unlock()
	if !s.Client.Enqueue(b) {
		onSlow(s.Client)
	}
}

// Activate sends queued messages newer than the last replayed id and marks the
// subscription live. Callers enqueue `subscribed` and replay first.
func (s *Subscription) Activate(onSlow func(*Client)) {
	s.mu.Lock()
	pend := s.pending
	s.pending = nil
	s.ready = true
	last := s.lastID
	var send [][]byte
	for _, p := range pend {
		if last == (StreamID{}) || last.Less(p.id) {
			send = append(send, p.b)
			last = p.id
		}
	}
	s.lastID = last
	s.mu.Unlock()
	for _, b := range send {
		if !s.Client.Enqueue(b) {
			onSlow(s.Client)
			return
		}
	}
}

// MarkReplayed records the last id sent during replay.
func (s *Subscription) MarkReplayed(id StreamID) {
	s.mu.Lock()
	if s.lastID.Less(id) {
		s.lastID = id
	}
	s.mu.Unlock()
}

// Hub routes stream messages to subscriptions on this instance.
type Hub struct {
	Metrics *metrics.Metrics
	Log     *slog.Logger

	mu   sync.RWMutex
	subs map[string]map[*Client]*Subscription
}

// NewHub returns an empty hub.
func NewHub(m *metrics.Metrics, log *slog.Logger) *Hub {
	return &Hub{Metrics: m, Log: log, subs: map[string]map[*Client]*Subscription{}}
}

// Add registers (or replaces) a subscription.
func (h *Hub) Add(s *Subscription) {
	h.mu.Lock()
	m := h.subs[s.Channel]
	if m == nil {
		m = map[*Client]*Subscription{}
		h.subs[s.Channel] = m
	}
	m[s.Client] = s
	h.mu.Unlock()
}

// Remove drops one subscription.
func (h *Hub) Remove(channel string, c *Client) {
	h.mu.Lock()
	if m := h.subs[channel]; m != nil {
		delete(m, c)
		if len(m) == 0 {
			delete(h.subs, channel)
		}
	}
	h.mu.Unlock()
}

// RemoveClient drops all subscriptions of c.
func (h *Hub) RemoveClient(c *Client, channels []string) {
	for _, ch := range channels {
		h.Remove(ch, c)
	}
}

// SlowConsumer closes a client whose queue overflowed.
func (h *Hub) SlowConsumer(c *Client) {
	h.Metrics.WSDropped.WithLabelValues("slow_consumer").Inc()
	c.Close(CloseSlowConsumer, "slow consumer")
}

// ChannelsFor lists the channels an envelope is published on.
func ChannelsFor(env *bus.Envelope) []string {
	switch env.Type {
	case bus.TypeIncident:
		return []string{"incidents"}
	default:
		var out []string
		if env.EventID != nil {
			out = append(out, "event:"+env.EventID.String())
		}
		if env.FlightID != nil {
			out = append(out, "flight:"+env.FlightID.String())
		}
		return out
	}
}

// Dispatch fans one stream entry out to local subscribers.
func (h *Hub) Dispatch(streamID string, env *bus.Envelope) {
	id, ok := ParseStreamID(streamID)
	if !ok {
		return
	}
	for _, ch := range ChannelsFor(env) {
		h.mu.RLock()
		m := h.subs[ch]
		subs := make([]*Subscription, 0, len(m))
		for _, s := range m {
			subs = append(subs, s)
		}
		h.mu.RUnlock()
		if len(subs) == 0 {
			continue
		}
		var cache [4][]byte
		for _, s := range subs {
			v := s.Decide(env)
			if v == deliverNone {
				continue
			}
			if cache[v] == nil {
				cache[v] = Render(env, ch, streamID, v)
			}
			s.deliver(id, cache[v], h.SlowConsumer)
			h.Metrics.WSMessages.Inc()
		}
	}
}

// Tailer reads the Redis stream and dispatches entries to the hub. Every API
// instance runs one.
type Tailer struct {
	Redis *redisx.Client
	Hub   *Hub
	Log   *slog.Logger
}

// LatestID returns the newest stream id, or "0-0" if the stream is empty.
func LatestID(ctx context.Context, rdb *redisx.Client) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	msgs, err := rdb.XRevRangeN(ctx, rdb.StreamKey(), "+", "-", 1).Result()
	if err != nil {
		return "", err
	}
	if len(msgs) == 0 {
		return "0-0", nil
	}
	return msgs[0].ID, nil
}

// Run blocks until ctx is cancelled.
func (t *Tailer) Run(ctx context.Context) {
	last := ""
	lastErr := time.Time{}
	for ctx.Err() == nil {
		if last == "" {
			id, err := LatestID(ctx, t.Redis)
			if err != nil {
				if time.Since(lastErr) > 30*time.Second {
					t.Log.Warn("realtime tailer: redis unavailable", "err", err.Error())
					lastErr = time.Now()
				}
				sleepCtx(ctx, time.Second)
				continue
			}
			last = id
		}
		res, err := t.Redis.XRead(ctx, &redis.XReadArgs{Streams: []string{t.Redis.StreamKey(), last}, Count: 1000, Block: time.Second}).Result()
		if err == redis.Nil {
			continue
		}
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			if time.Since(lastErr) > 30*time.Second {
				t.Log.Warn("realtime tailer: read failed", "err", err.Error())
				lastErr = time.Now()
			}
			sleepCtx(ctx, time.Second)
			continue
		}
		for _, st := range res {
			for _, m := range st.Messages {
				last = m.ID
				raw, _ := m.Values["e"].(string)
				var env bus.Envelope
				if json.Unmarshal([]byte(raw), &env) != nil {
					continue
				}
				t.Hub.Dispatch(m.ID, &env)
			}
		}
	}
}

func sleepCtx(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
