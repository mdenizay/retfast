package tests

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

type wsMsg struct {
	Type     string          `json:"type"`
	Channel  string          `json:"channel"`
	Cursor   string          `json:"cursor"`
	Code     string          `json:"code"`
	Replayed int             `json:"replayed"`
	Snapshot json.RawMessage `json:"snapshot"`
	Data     json.RawMessage `json:"data"`
	raw      []byte
}

type wsClient struct {
	t    *testing.T
	c    *websocket.Conn
	msgs chan wsMsg
	done chan error
}

func dialWS(t *testing.T, e *Env) *wsClient {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, e.WSURL(), nil)
	if err != nil {
		t.Fatal(err)
	}
	w := &wsClient{t: t, c: c, msgs: make(chan wsMsg, 1000), done: make(chan error, 1)}
	go func() {
		for {
			_, b, err := c.Read(context.Background())
			if err != nil {
				w.done <- err
				close(w.msgs)
				return
			}
			var m wsMsg
			_ = json.Unmarshal(b, &m)
			m.raw = b
			if m.Type == "ping" {
				continue
			}
			w.msgs <- m
		}
	}()
	t.Cleanup(func() { c.CloseNow() })
	return w
}

func (w *wsClient) send(v any) {
	w.t.Helper()
	b, _ := json.Marshal(v)
	if err := w.c.Write(context.Background(), websocket.MessageText, b); err != nil {
		w.t.Fatal(err)
	}
}

// next waits for the first message matching pred.
func (w *wsClient) next(pred func(wsMsg) bool, d time.Duration, what string) wsMsg {
	w.t.Helper()
	timer := time.NewTimer(d)
	defer timer.Stop()
	for {
		select {
		case m, ok := <-w.msgs:
			if !ok {
				w.t.Fatalf("connection closed while waiting for %s", what)
			}
			if pred(m) {
				return m
			}
		case <-timer.C:
			w.t.Fatalf("timed out waiting for %s", what)
		}
	}
}

func (w *wsClient) authAndSubscribe(token, channel, since string) wsMsg {
	w.t.Helper()
	if token != "" {
		w.send(map[string]any{"type": "auth", "access_token": token})
		w.next(func(m wsMsg) bool { return m.Type == "auth_ok" }, 5*time.Second, "auth_ok")
	}
	sub := map[string]any{"type": "subscribe", "channel": channel}
	if since != "" {
		sub["since"] = since
	}
	w.send(sub)
	return w.next(func(m wsMsg) bool { return m.Type == "subscribed" || m.Type == "error" }, 5*time.Second, "subscribed "+channel)
}

func flightOf(m wsMsg) string {
	var d struct {
		FlightID string `json:"flight_id"`
	}
	_ = json.Unmarshal(m.Data, &d)
	return d.FlightID
}

func TestRealtimeSubscribeFilterAndReplay(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	org := e.Register("RT Organizer")
	e.Grant(org, "event_organizer")
	ev := e.CreateEvent(org, map[string]any{"settings": map[string]any{"public_live_map": true}})
	evID := ev["id"].(string)
	a := e.Register("Pilot A")
	b := e.Register("Pilot B")
	watcher := e.Register("Watcher")
	for _, u := range []*User{a, b} {
		e.Must(e.Do("POST", "/events/"+evID+"/join", nil, Req{Token: u.Token}), 200)
	}
	e.Must(e.Do("POST", "/events/"+evID+"/join", map[string]any{"role": "observer"}, Req{Token: watcher.Token}), 200)
	fa := e.CreateFlight(a, evID, "event")
	fb := e.CreateFlight(b, evID, "private")
	t0 := time.Now().Add(-time.Minute)
	e.MustBatch(a, fa, uuid.New(), seqs(0, 4, t0))

	// member subscribes: snapshot contains A (event) but not B (private)
	w := dialWS(t, e)
	sub := w.authAndSubscribe(watcher.Token, "event:"+evID, "")
	if sub.Type != "subscribed" {
		t.Fatalf("subscribe: %s", sub.raw)
	}
	var snap struct {
		Pilots []struct {
			FlightID  string  `json:"flight_id"`
			Freshness string  `json:"freshness"`
			Trail     [][]any `json:"trail"`
		} `json:"pilots"`
	}
	_ = json.Unmarshal(sub.Snapshot, &snap)
	if len(snap.Pilots) != 1 || snap.Pilots[0].FlightID != fa.String() || snap.Pilots[0].Freshness != "live" || len(snap.Pilots[0].Trail) == 0 {
		t.Fatalf("snapshot: %s", sub.Snapshot)
	}

	// private B position first, then A as a marker: only A must arrive
	e.MustBatch(b, fb, uuid.New(), seqs(0, 2, t0))
	e.MustBatch(a, fa, uuid.New(), seqs(5, 7, t0))
	m := w.next(func(m wsMsg) bool { return m.Type == "position" }, 10*time.Second, "position for A")
	if flightOf(m) != fa.String() {
		t.Fatalf("private flight B was delivered to a member: %s", m.raw)
	}
	lastCursor := m.Cursor

	// guest on a public_live_map event sees only public flights
	g := dialWS(t, e)
	gsub := g.authAndSubscribe("", "event:"+evID, "")
	_ = json.Unmarshal(gsub.Snapshot, &snap)
	if gsub.Type != "subscribed" || len(snap.Pilots) != 0 {
		t.Fatalf("guest snapshot: %s", gsub.raw)
	}
	e.Must(e.Do("PATCH", "/flights/"+fa.String(), map[string]any{"visibility": "public"}, Req{Token: a.Token}), 200)
	e.MustBatch(a, fa, uuid.New(), seqs(8, 8, t0))
	gm := g.next(func(m wsMsg) bool { return m.Type == "position" }, 10*time.Second, "guest position")
	if flightOf(gm) != fa.String() {
		t.Fatalf("guest got %s", gm.raw)
	}
	var gp struct {
		Pilot struct {
			FullName string `json:"full_name"`
		} `json:"pilot"`
	}
	_ = json.Unmarshal(gm.Data, &gp)
	if gp.Pilot.FullName != "Pilot A" { // display_name defaults to the registered name
		t.Fatalf("guest pilot name: %s", gm.Data)
	}

	// unauthorized subscriptions
	out := e.Register("Outsider")
	restricted := e.CreateEvent(org, map[string]any{"visibility": "restricted"})
	w2 := dialWS(t, e)
	if r := w2.authAndSubscribe(out.Token, "event:"+restricted["id"].(string), ""); r.Type != "error" || r.Code != "forbidden" {
		t.Fatalf("restricted event: %s", r.raw)
	}
	w2.send(map[string]any{"type": "subscribe", "channel": "flight:" + fb.String()})
	if r := w2.next(func(m wsMsg) bool { return m.Type == "error" || m.Type == "subscribed" }, 5*time.Second, "flight sub"); r.Type != "error" {
		t.Fatalf("private flight subscription allowed: %s", r.raw)
	}
	w2.send(map[string]any{"type": "subscribe", "channel": "incidents"})
	if r := w2.next(func(m wsMsg) bool { return m.Type == "error" || m.Type == "subscribed" }, 5*time.Second, "incidents sub"); r.Code != "forbidden" {
		t.Fatalf("incidents for plain pilot: %s", r.raw)
	}

	// since-replay: disconnect, miss two batches, resubscribe with the last cursor
	_ = w.c.Close(websocket.StatusNormalClosure, "")
	e.MustBatch(a, fa, uuid.New(), seqs(9, 9, t0))
	e.MustBatch(a, fa, uuid.New(), seqs(10, 10, t0))
	time.Sleep(1500 * time.Millisecond) // let the relay publish both
	w3 := dialWS(t, e)
	rs := w3.authAndSubscribe(watcher.Token, "event:"+evID, lastCursor)
	if rs.Type != "subscribed" || rs.Replayed < 3 {
		t.Fatalf("replay: %s", rs.raw)
	}
	// everything after lastCursor is replayed: seq 8 (never read), 9 and 10
	seen := map[float64]bool{}
	for !(seen[9] && seen[10]) {
		m := w3.next(func(m wsMsg) bool { return m.Type == "position" }, 5*time.Second, "replayed positions")
		var d struct {
			Position struct {
				Seq float64 `json:"seq"`
			} `json:"position"`
		}
		_ = json.Unmarshal(m.Data, &d)
		seen[d.Position.Seq] = true
	}
	if !seen[8] {
		t.Fatalf("replayed seqs: %v", seen)
	}

	// invalid token closes with 4001
	w4 := dialWS(t, e)
	w4.send(map[string]any{"type": "auth", "access_token": "garbage"})
	select {
	case err := <-w4.done:
		if websocket.CloseStatus(err) != 4001 {
			t.Fatalf("close status = %d (%v)", websocket.CloseStatus(err), err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no close after bad token")
	}
}

func TestRealtimePingAndShutdownCloseCode(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	w := dialWS(t, e)
	w.send(map[string]any{"type": "ping"})
	w.next(func(m wsMsg) bool { return m.Type == "pong" }, 5*time.Second, "pong")
	// shutdown closes with 1012
	e.App.BeginDrain()
	select {
	case err := <-w.done:
		if websocket.CloseStatus(err) != 1012 {
			t.Fatalf("close status = %d (%v)", websocket.CloseStatus(err), err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no close on drain")
	}
}
