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

// IncidentProvider supplies scope and snapshots for the incidents channel.
type IncidentProvider interface {
	// Scope reports whether a sees all incidents, or the event ids it may see.
	Scope(ctx context.Context, a *authz.Actor) (all bool, events []uuid.UUID, err error)
	// Snapshot returns the open incidents in scope.
	Snapshot(ctx context.Context, a *authz.Actor) (any, error)
}

// Server is the /realtime WebSocket endpoint.
type Server struct {
	Hub            *Hub
	Auth           TokenResolver
	Q              *dbq.Queries
	Live           *flights.LiveService
	Redis          *redisx.Client
	Incidents      IncidentProvider
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
	switch {
	case kind == "event" && rest != "":
		id, err := uuid.Parse(rest)
		if err != nil {
			c.sendError("unknown_channel", channel)
			return
		}
		e, err := events.Load(sctx, c.s.Q, id.String())
		if err != nil {
			c.sendError("unknown_channel", channel)
			return
		}
		member, err := events.MemberRole(sctx, c.s.Q, e.ID, a)
		if err != nil {
			c.sendError("internal", channel)
			return
		}
		if !authz.CanViewEventLive(a, events.Facts(e), member) {
			c.sendError(errCode(a), channel)
			return
		}
		sub.Kind, sub.Event, sub.Member = KindEvent, events.Facts(e), member
		sub.GuestView = member == "" && !a.IsGlobalResponder()
		register()
		live, err := c.s.Live.Snapshot(sctx, a, e, member)
		if err != nil {
			c.sendError("internal", channel)
			return
		}
		live.Cursor = cursor
		snapshot = live
	case kind == "flight" && rest != "":
		row, err := flights.LoadVisible(sctx, c.s.Q, rest, a)
		if err != nil {
			c.sendError(errCode(a), channel)
			return
		}
		member := ""
		if row.EventID != nil {
			member, _ = events.MemberRole(sctx, c.s.Q, *row.EventID, a)
		}
		sub.Kind, sub.FlightID, sub.FlightEventID, sub.FlightMember = KindFlight, row.ID, row.EventID, member
		if channel != "flight:"+row.ID.String() {
			channel = "flight:" + row.ID.String()
			sub.Channel = channel
		}
		register()
		dto := flights.DTO(row)
		if member == "" && !a.IsGlobalResponder() && !a.Is(row.PilotID) {
			if p, err := c.s.Q.GetPilotProfile(sctx, row.PilotID); err == nil {
				dto.Pilot.FullName = p.DisplayName
			}
		}
		snapshot = dto
	case channel == "incidents":
		if !a.Authenticated() || c.s.Incidents == nil {
			c.sendError(errCode(a), channel)
			return
		}
		all, evs, err := c.s.Incidents.Scope(sctx, a)
		if err != nil {
			c.sendError("internal", channel)
			return
		}
		if !authz.CanSubscribeIncidents(a, len(evs) > 0) {
			c.sendError("forbidden", channel)
			return
		}
		sub.Kind, sub.IncidentAll = KindIncidents, all
		sub.IncidentEvents = map[uuid.UUID]bool{}
		for _, e := range evs {
			sub.IncidentEvents[e] = true
		}
		register()
		if snapshot, err = c.s.Incidents.Snapshot(sctx, a); err != nil {
			c.sendError("internal", channel)
			return
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
