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
	KindRetrievals
)

// Subscription is one client's subscription with the authorization facts
// captured at subscribe time. Facts are refreshed on every instance when a
// member_changed / event_changed envelope arrives, and each message is checked
// against them plus the message's own facts.
type Subscription struct {
	Channel string
	Kind    int
	Client  *Client
	Actor   *authz.Actor
	EventID uuid.UUID // event of the channel (or of the flight; Nil if none)

	FlightID uuid.UUID

	factsMu sync.RWMutex
	event   *authz.Event
	access  authz.Access

	mu      sync.Mutex
	ready   bool
	pending []pendingMsg
	lastID  StreamID
}

// SetFacts sets the event facts and the actor's access (nil event: none).
func (s *Subscription) SetFacts(e *authz.Event, acc authz.Access) {
	s.factsMu.Lock()
	s.event, s.access = e, acc
	s.factsMu.Unlock()
}

func (s *Subscription) facts() (*authz.Event, authz.Access) {
	s.factsMu.RLock()
	defer s.factsMu.RUnlock()
	return s.event, s.access
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

// Delivery variants. Values >= deliverRedacted carry strip bits for
// retrieval payloads.
const (
	deliverNone = iota
	deliverData
	deliverPublic
	deliverRemoved
	deliverRedacted = 16
)

// strip bits for deliverRedacted
const (
	stripPilotPhone     = 1
	stripRetrieverPhone = 2
	stripPilotPosition  = 4
	stripPrivate        = 8 // retriever_position and timeline (other retrievers)
)

// Decide applies the policy to one envelope.
func (s *Subscription) Decide(env *bus.Envelope) int {
	ev, acc := s.facts()
	a := s.Actor
	switch s.Kind {
	case KindEvent:
		if (env.Type != bus.TypePosition && env.Type != bus.TypeFlight) || env.OwnerID == nil || ev == nil {
			return deliverNone
		}
		if env.EventID == nil || *env.EventID != ev.ID || !authz.CanSeeLiveFlight(a, *ev, acc, *env.OwnerID) {
			if env.Type == bus.TypeFlight {
				return deliverRemoved
			}
			return deliverNone
		}
		return guestOr(a, *env.OwnerID, env, authz.GuestView(a, *ev, acc))
	case KindFlight:
		if (env.Type != bus.TypePosition && env.Type != bus.TypeFlight) || env.OwnerID == nil {
			return deliverNone
		}
		var fe *authz.Event
		if ev != nil && env.EventID != nil && *env.EventID == ev.ID {
			fe = ev // the flight may have moved to another event: be conservative
		}
		if !authz.CanViewFlight(a, authz.Flight{OwnerID: *env.OwnerID, EventID: env.EventID}, fe, acc) {
			if env.Type == bus.TypeFlight {
				return deliverRemoved
			}
			return deliverNone
		}
		guest := fe != nil && !a.IsAdmin() && authz.GuestView(a, *fe, acc)
		return guestOr(a, *env.OwnerID, env, guest)
	case KindRetrievals:
		if env.EventID == nil || *env.EventID != s.EventID {
			return deliverNone
		}
		switch env.Type {
		case bus.TypeRetrieval:
			if env.PilotID == nil {
				return deliverNone
			}
			f := authz.Retrieval{EventID: *env.EventID, PilotID: *env.PilotID, RetrieverID: env.RetrieverID, Status: env.Status}
			if !authz.CanViewRetrieval(a, acc, f) {
				// retrievers (and a retriever who just lost it) learn it left their list
				if acc.Role == authz.MemberRetriever || a.IsPtr(env.PrevRetrieverID) {
					return deliverRemoved
				}
				return deliverNone
			}
			bits := 0
			if !authz.CanSeePilotPhone(a, acc, f) {
				bits |= stripPilotPhone
			}
			if !authz.CanSeeRetrieverPhone(a, acc, f) {
				bits |= stripRetrieverPhone
			}
			if !authz.CanSeeRetrievalPilotPosition(a, acc, f) {
				bits |= stripPilotPosition
			}
			if !authz.SeesAllRetrievals(a, acc) && !a.Is(f.PilotID) && !a.IsPtr(f.RetrieverID) {
				bits |= stripPrivate
			}
			if bits == 0 {
				return deliverData
			}
			return deliverRedacted + bits
		case bus.TypePilotPosition:
			if env.PilotID == nil {
				return deliverNone
			}
			f := authz.Retrieval{EventID: *env.EventID, PilotID: *env.PilotID, RetrieverID: env.RetrieverID, Status: env.Status}
			if authz.CanSeePilotPositionMessage(a, acc, f) {
				return deliverData
			}
		case bus.TypeRetrieverPosition:
			if env.UserID != nil && authz.CanSeeRetriever(a, acc, *env.UserID, env.PilotIDs) {
				return deliverData
			}
		}
	}
	return deliverNone
}

func guestOr(a *authz.Actor, owner uuid.UUID, env *bus.Envelope, guest bool) int {
	if guest && !a.Is(owner) {
		if len(env.PublicData) == 0 {
			return deliverNone
		}
		return deliverPublic
	}
	return deliverData
}

// redact removes fields from a retrieval payload according to bits.
func redact(raw json.RawMessage, bits int) json.RawMessage {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	if p, ok := m["pilot"].(map[string]any); ok && bits&stripPilotPhone != 0 {
		p["phone"] = ""
	}
	if r, ok := m["retriever"].(map[string]any); ok && bits&stripRetrieverPhone != 0 {
		r["phone"] = ""
	}
	if bits&stripPilotPosition != 0 {
		m["pilot_position"] = nil
	}
	if bits&stripPrivate != 0 {
		m["retriever_position"] = nil
		m["updates"] = []any{}
	}
	b, _ := json.Marshal(m)
	return b
}

// Render builds the wire message for a variant.
func Render(env *bus.Envelope, channel, cursor string, variant int) []byte {
	var data json.RawMessage
	switch {
	case variant == deliverData:
		data = env.Data
	case variant == deliverPublic:
		data = env.PublicData
	case variant == deliverRemoved && env.Type == bus.TypeRetrieval:
		data, _ = json.Marshal(map[string]any{"id": env.RetrievalID, "event_id": env.EventID, "status": env.Status, "removed": true})
	case variant == deliverRemoved:
		data, _ = json.Marshal(map[string]any{"id": env.FlightID, "event_id": env.EventID, "removed": true})
	case variant >= deliverRedacted:
		data = redact(env.Data, variant-deliverRedacted)
	default:
		return nil
	}
	if data == nil {
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
	case bus.TypeRetrieval, bus.TypePilotPosition, bus.TypeRetrieverPosition:
		if env.EventID == nil {
			return nil
		}
		return []string{"retrievals:" + env.EventID.String()}
	case bus.TypePosition, bus.TypeFlight:
		var out []string
		if env.EventID != nil {
			out = append(out, "event:"+env.EventID.String())
		}
		if env.FlightID != nil {
			out = append(out, "flight:"+env.FlightID.String())
		}
		return out
	}
	return nil
}

// applyFactChange updates subscriptions after a membership or event change.
func (h *Hub) applyFactChange(env *bus.Envelope) {
	if env.EventID == nil {
		return
	}
	h.mu.RLock()
	var subs []*Subscription
	for _, m := range h.subs {
		for _, s := range m {
			if s.EventID == *env.EventID {
				subs = append(subs, s)
			}
		}
	}
	h.mu.RUnlock()
	for _, s := range subs {
		ev, acc := s.facts()
		switch env.Type {
		case bus.TypeMemberChanged:
			if env.UserID != nil && env.Access != nil && s.Actor.Is(*env.UserID) {
				s.SetFacts(ev, *env.Access)
			}
		case bus.TypeEventChanged:
			if env.Event != nil {
				e := *env.Event
				s.SetFacts(&e, acc)
			}
		}
	}
}

// Dispatch fans one stream entry out to local subscribers.
func (h *Hub) Dispatch(streamID string, env *bus.Envelope) {
	id, ok := ParseStreamID(streamID)
	if !ok {
		return
	}
	if env.Type == bus.TypeMemberChanged || env.Type == bus.TypeEventChanged {
		h.applyFactChange(env)
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
		cache := map[int][]byte{}
		for _, s := range subs {
			v := s.Decide(env)
			if v == deliverNone {
				continue
			}
			b, ok := cache[v]
			if !ok {
				b = Render(env, ch, streamID, v)
				cache[v] = b
			}
			if b == nil {
				continue
			}
			s.deliver(id, b, h.SlowConsumer)
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
