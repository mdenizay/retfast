package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/events"
	"github.com/mdenizay/retfast/services/api/internal/flights"
	"github.com/mdenizay/retfast/services/api/internal/live"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
	"github.com/mdenizay/retfast/services/api/internal/platform/redisx"
	"github.com/mdenizay/retfast/services/api/internal/realtime/bus"
)

// Timings per the contract.
const (
	AuthWindow   = 10 * time.Second
	IdleTimeout  = 60 * time.Second
	PingInterval = 25 * time.Second
	writeTimeout = 10 * time.Second
	maxReplay    = 10000
)

// TokenResolver validates access tokens (auth.Service).
type TokenResolver interface {
	ResolveToken(ctx context.Context, token string) (*authz.Actor, error)
}

// Server is the /realtime WebSocket endpoint.
type Server struct {
	Hub            *Hub
	Auth           TokenResolver
	Q              *dbq.Queries
	Live           *live.Service
	Redis          *redisx.Client
	Metrics        *metrics.Metrics
	Log            *slog.Logger
	OriginPatterns []string

	mu       sync.Mutex
	clients  map[*Client]struct{}
	draining atomic.Bool
}

// OriginPatternsFrom converts CORS origins to host patterns for the handshake check.
func OriginPatternsFrom(origins []string) []string {
	out := []string{}
	for _, o := range origins {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			out = append(out, u.Host)
		}
	}
	return out
}

type inMsg struct {
	Type        string `json:"type"`
	AccessToken string `json:"access_token"`
	Channel     string `json:"channel"`
	Since       string `json:"since"`
}

type conn struct {
	s      *Server
	ws     *websocket.Conn
	client *Client
	actor  *authz.Actor
	subs   map[string]*Subscription
	log    *slog.Logger
}

func (c *conn) sendJSON(v any) {
	b, _ := json.Marshal(v)
	if !c.client.Enqueue(b) {
		c.s.Hub.SlowConsumer(c.client)
	}
}

func (c *conn) sendError(code, channel string) {
	m := map[string]string{"type": "error", "code": code}
	if channel != "" {
		m["channel"] = channel
	}
	c.sendJSON(m)
}

// ServeHTTP upgrades and runs one connection.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.draining.Load() {
		httpx.WriteError(w, r, httpx.Unavailable("Server restarting"))
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.OriginPatterns})
	if err != nil {
		return
	}
	ws.SetReadLimit(64 << 10)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	closed := make(chan struct{})
	client := NewClient(func(code int, reason string) {
		go func() {
			// Give the writer a moment to flush a final error message.
			time.Sleep(50 * time.Millisecond)
			_ = ws.Close(websocket.StatusCode(code), reason)
			close(closed)
			cancel()
		}()
	})
	s.mu.Lock()
	if s.clients == nil {
		s.clients = map[*Client]struct{}{}
	}
	s.clients[client] = struct{}{}
	s.mu.Unlock()
	s.Metrics.WSConnections.Inc()
	c := &conn{s: s, ws: ws, client: client, subs: map[string]*Subscription{}, log: httpx.Logger(r.Context())}
	defer func() {
		chans := make([]string, 0, len(c.subs))
		for ch := range c.subs {
			chans = append(chans, ch)
		}
		s.Hub.RemoveClient(client, chans)
		s.mu.Lock()
		delete(s.clients, client)
		s.mu.Unlock()
		s.Metrics.WSConnections.Dec()
		client.Close(int(websocket.StatusNormalClosure), "")
		select { // let the close handshake (with our status code) finish
		case <-closed:
		case <-time.After(6 * time.Second):
		}
		ws.CloseNow()
	}()
	go c.writeLoop(ctx)
	c.readLoop(ctx)
}

func (c *conn) writeLoop(ctx context.Context) {
	ping := time.NewTicker(PingInterval)
	defer ping.Stop()
	pingMsg := []byte(`{"type":"ping"}`)
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.client.Done():
			return
		case b := <-c.client.Send():
			wctx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := c.ws.Write(wctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				c.client.Close(int(websocket.StatusGoingAway), "write failed")
				return
			}
		case <-ping.C:
			if !c.client.Enqueue(pingMsg) {
				c.s.Hub.SlowConsumer(c.client)
			}
		}
	}
}

func (c *conn) readLoop(ctx context.Context) {
	first := true
	for {
		timeout := IdleTimeout
		if first {
			timeout = AuthWindow
		}
		rctx, cancel := context.WithTimeout(ctx, timeout)
		typ, data, err := c.ws.Read(rctx)
		expired := rctx.Err() != nil && ctx.Err() == nil
		cancel()
		if err != nil {
			if expired {
				if first {
					c.s.Metrics.WSDropped.WithLabelValues("no_first_message").Inc()
					c.client.Close(CloseUnauthorized, "no message within 10s")
				} else {
					c.s.Metrics.WSDropped.WithLabelValues("idle").Inc()
					c.client.Close(int(websocket.StatusPolicyViolation), "idle timeout")
				}
			}
			return
		}
		if typ != websocket.MessageText {
			continue
		}
		var m inMsg
		if json.Unmarshal(data, &m) != nil {
			c.sendError("bad_request", "")
			continue
		}
		wasFirst := first
		first = false
		switch m.Type {
		case "auth":
			a, err := c.s.Auth.ResolveToken(ctx, m.AccessToken)
			if err != nil || a.PCR {
				code := "unauthorized"
				var he *httpx.Error
				if errors.As(err, &he) && he.Code == "token_expired" {
					code = "token_expired"
				}
				if a != nil && a.PCR {
					code = "password_change_required"
				}
				c.sendError(code, "")
				if wasFirst || c.actor == nil {
					c.s.Metrics.WSDropped.WithLabelValues("unauthorized").Inc()
					c.client.Close(CloseUnauthorized, code)
					return
				}
				continue
			}
			c.actor = a
			c.sendJSON(map[string]any{"type": "auth_ok", "user_id": a.UserID})
		case "subscribe":
			c.subscribe(ctx, m.Channel, m.Since)
		case "unsubscribe":
			if _, ok := c.subs[m.Channel]; ok {
				c.s.Hub.Remove(m.Channel, c.client)
				delete(c.subs, m.Channel)
			}
			c.sendJSON(map[string]any{"type": "unsubscribed", "channel": m.Channel})
		case "ping":
			c.sendJSON(map[string]string{"type": "pong"})
		case "pong":
		default:
			c.sendError("bad_request", "")
		}
	}
}

func (c *conn) subscribe(ctx context.Context, channel, since string) {
	sctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	a := c.actor
	kind, rest, _ := strings.Cut(channel, ":")
	sub := &Subscription{Channel: channel, Client: c.client, Actor: a}
	var snapshot any
	var cursor string
	register := func() {
		if old, ok := c.subs[channel]; ok {
			c.s.Hub.Remove(channel, old.Client)
		}
		c.subs[channel] = sub
		c.s.Hub.Add(sub)
		// The cursor is read after registering so nothing between it and the
		// snapshot is missed; duplicates are filtered by stream id.
		id, err := LatestID(sctx, c.s.Redis)
		if err != nil {
			id = "0-0"
		}
		cursor = id
	}
	loadEvent := func() (events.Row, authz.Access, bool) {
		id, err := uuid.Parse(rest)
		if err != nil {
			c.sendError("unknown_channel", channel)
			return events.Row{}, authz.Access{}, false
		}
		e, err := events.Load(sctx, c.s.Q, id.String())
		if err != nil {
			c.sendError("unknown_channel", channel)
			return events.Row{}, authz.Access{}, false
		}
		acc, err := events.AccessOf(sctx, c.s.Q, e.ID, a)
		if err != nil {
			c.sendError("internal", channel)
			return events.Row{}, authz.Access{}, false
		}
		if !authz.CanViewEvent(a, events.Facts(e), acc) {
			c.sendError(errCode(a), channel)
			return events.Row{}, authz.Access{}, false
		}
		return e, acc, true
	}
	switch {
	case kind == "event" && rest != "":
		e, acc, ok := loadEvent()
		if !ok {
			return
		}
		facts := events.Facts(e)
		if !authz.CanViewEventLive(a, facts, acc) {
			c.sendError(errCode(a), channel)
			return
		}
		sub.Kind, sub.EventID = KindEvent, e.ID
		sub.SetFacts(&facts, acc)
		register()
		snap, err := c.s.Live.Build(sctx, nil, a, e, acc, true)
		if err != nil {
			c.sendError("internal", channel)
			return
		}
		snap.Cursor = cursor
		snapshot = snap
	case kind == "retrievals" && rest != "":
		e, acc, ok := loadEvent()
		if !ok {
			return
		}
		if !authz.CanListRetrievals(a, acc) {
			c.sendError(errCode(a), channel)
			return
		}
		facts := events.Facts(e)
		sub.Kind, sub.EventID = KindRetrievals, e.ID
		sub.SetFacts(&facts, acc)
		register()
		snap, err := c.s.Live.Build(sctx, nil, a, e, acc, false)
		if err != nil {
			c.sendError("internal", channel)
			return
		}
		snap.Cursor = cursor
		snapshot = snap.ForRetrievals()
	case kind == "flight" && rest != "":
		row, guest, err := flights.LoadVisible(sctx, c.s.Q, rest, a)
		if err != nil {
			c.sendError(errCode(a), channel)
			return
		}
		ev, acc, err := flights.Policy(sctx, c.s.Q, row.FlightSession, a)
		if err != nil {
			c.sendError("internal", channel)
			return
		}
		sub.Kind, sub.FlightID = KindFlight, row.ID
		if ev != nil {
			sub.EventID = ev.ID
		}
		sub.SetFacts(ev, acc)
		if channel != "flight:"+row.ID.String() {
			channel = "flight:" + row.ID.String()
			sub.Channel = channel
		}
		register()
		if guest {
			snapshot = flights.PublicDTO(sctx, c.s.Q, row)
		} else {
			snapshot = flights.DTO(row)
		}
	default:
		c.sendError("unknown_channel", channel)
		return
	}
	replayed := 0
	replay := [][]byte{}
	if since != "" {
		if sid, ok := ParseStreamID(since); ok {
			replay, replayed = c.replay(sctx, sub, sid)
		}
	}
	c.sendJSON(map[string]any{"type": "subscribed", "channel": channel, "snapshot": snapshot, "cursor": cursor, "replayed": replayed})
	for _, b := range replay {
		if !c.client.Enqueue(b) {
			c.s.Hub.SlowConsumer(c.client)
			return
		}
	}
	sub.Activate(c.s.Hub.SlowConsumer)
}

func errCode(a *authz.Actor) string {
	if !a.Authenticated() {
		return "unauthorized"
	}
	return "forbidden"
}

// replay returns messages after since if since is inside the stream window.
func (c *conn) replay(ctx context.Context, sub *Subscription, since StreamID) ([][]byte, int) {
	rdb := c.s.Redis
	first, err := rdb.XRangeN(ctx, rdb.StreamKey(), "-", "+", 1).Result()
	if err != nil || len(first) == 0 {
		return nil, 0
	}
	firstID, ok := ParseStreamID(first[0].ID)
	if !ok || since.Less(firstID) {
		return nil, 0 // outside the replay window: the snapshot is authoritative
	}
	msgs, err := rdb.XRangeN(ctx, rdb.StreamKey(), "("+since.String(), "+", maxReplay).Result()
	if err != nil {
		return nil, 0
	}
	out := [][]byte{}
	var last StreamID
	for _, m := range msgs {
		raw, _ := m.Values["e"].(string)
		var env bus.Envelope
		if json.Unmarshal([]byte(raw), &env) != nil {
			continue
		}
		match := false
		for _, ch := range ChannelsFor(&env) {
			if ch == sub.Channel {
				match = true
			}
		}
		id, ok := ParseStreamID(m.ID)
		if !ok {
			continue
		}
		last = id
		if !match {
			continue
		}
		if v := sub.Decide(&env); v != deliverNone {
			out = append(out, Render(&env, sub.Channel, m.ID, v))
		}
	}
	if last != (StreamID{}) {
		sub.MarkReplayed(last)
	}
	return out, len(out)
}

// Drain stops accepting connections and closes existing ones with 1012.
func (s *Server) Drain() {
	s.draining.Store(true)
	s.mu.Lock()
	cs := make([]*Client, 0, len(s.clients))
	for c := range s.clients {
		cs = append(cs, c)
	}
	s.mu.Unlock()
	for _, c := range cs {
		s.Metrics.WSDropped.WithLabelValues("shutdown").Inc()
		c.Close(CloseRestart, "server restart")
	}
}

// ConnectionCount returns the number of open connections.
func (s *Server) ConnectionCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.clients)
}
