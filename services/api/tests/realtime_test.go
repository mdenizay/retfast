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

type liveDoc struct {
	Pilots []struct {
		FlightID  string  `json:"flight_id"`
		Freshness string  `json:"freshness"`
		Trail     [][]any `json:"trail"`
		Pilot     struct {
			FullName string `json:"full_name"`
		} `json:"pilot"`
	} `json:"pilots"`
	Retrievals []map[string]any `json:"retrievals"`
	Retrievers []map[string]any `json:"retrievers"`
}

func (e *Env) live(t *testing.T, evID string, token string) (int, liveDoc) {
	t.Helper()
	r := e.Do("GET", "/events/"+evID+"/live", nil, Req{Token: token})
	var d liveDoc
	if r.Status == 200 {
		r.Into(t, &d)
	}
	return r.Status, d
}

func flightSet(d liveDoc) map[string]bool {
	m := map[string]bool{}
	for _, p := range d.Pilots {
		m[p.FlightID] = true
	}
	return m
}

func TestLiveVisibilityMatrix(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	adm := e.Admin("Admin")
	org := e.Register("Organizer")
	ev := e.CreateEvent(adm, map[string]any{"organizers": []any{org.ID}})
	evID := ev["id"].(string)
	pa, pb := e.Register("Pilot A"), e.Register("Pilot B")
	obs, ret, outsider := e.Register("Observer"), e.Register("Retriever"), e.Register("Outsider")
	e.AddMember(org, evID, pa, "pilot")
	e.AddMember(org, evID, pb, "pilot")
	e.AddMember(org, evID, obs, "observer")
	e.AddMember(org, evID, ret, "retriever")
	fa, fb := e.CreateFlight(pa, evID), e.CreateFlight(pb, evID)
	t0 := time.Now().Add(-time.Minute)
	e.MustBatch(pa, fa, uuid.New(), seqs(0, 3, t0))
	e.MustBatch(pb, fb, uuid.New(), seqs(0, 3, t0))
	// a retrieval request so retrievers have something to see
	e.Must(e.Do("POST", "/events/"+evID+"/retrievals", map[string]any{"id": uuid.New(), "pickup": pickup(37.05, 29.36), "note": "yol kenarı"}, Req{Token: pb.Token}), 201)

	both := map[string]bool{fa.String(): true, fb.String(): true}
	check := func(name string, token string, wantStatus int, want map[string]bool) liveDoc {
		t.Helper()
		st, d := e.live(t, evID, token)
		if st != wantStatus {
			t.Fatalf("%s: status %d want %d", name, st, wantStatus)
		}
		if st == 200 {
			got := flightSet(d)
			if len(got) != len(want) {
				t.Fatalf("%s: flights %v want %v", name, got, want)
			}
			for k := range want {
				if !got[k] {
					t.Fatalf("%s: missing %s", name, k)
				}
			}
		}
		return d
	}
	d := check("organizer", org.Token, 200, both)
	if len(d.Retrievals) != 1 || len(d.Retrievers) != 1 || d.Retrievals[0]["pilot"].(map[string]any)["full_name"] != "Pilot B" {
		t.Fatalf("organizer retrievals/retrievers: %+v", d)
	}
	check("admin", adm.Token, 200, both)
	d = check("observer", obs.Token, 200, both)
	if len(d.Retrievers) != 1 {
		t.Fatal("observers see retrievers")
	}
	d = check("pilot (pilots_see_each_other)", pa.Token, 200, both)
	if len(d.Retrievals) != 0 || len(d.Retrievers) != 0 {
		t.Fatalf("pilot A sees others' retrievals/retrievers: %+v", d)
	}
	d = check("retriever", ret.Token, 200, map[string]bool{})
	if len(d.Retrievals) != 1 || d.Retrievals[0]["status"] != "requested" || d.Retrievals[0]["pilot_position"] != nil {
		t.Fatalf("retriever must see the open request (pickup only): %+v", d.Retrievals)
	}
	check("outsider (no public map)", outsider.Token, 403, nil)
	check("guest (no public map)", "", 401, nil)
	// retrievers cannot list or open event flights
	if r := e.Do("GET", "/flights?event_id="+evID, nil, Req{Token: ret.Token}); r.Status != 403 {
		t.Fatalf("retriever flight list: %d", r.Status)
	}
	if r := e.Do("GET", "/flights/"+fa.String(), nil, Req{Token: ret.Token}); r.Status != 404 {
		t.Fatalf("retriever flight: %d", r.Status)
	}

	// pilots_see_each_other off: pilots see only their own flight
	e.Must(e.Do("PATCH", "/events/"+evID, map[string]any{"settings": map[string]any{"pilots_see_each_other": false}}, Req{Token: org.Token}), 200)
	check("pilot alone", pa.Token, 200, map[string]bool{fa.String(): true})
	if r := e.Do("GET", "/flights/"+fb.String(), nil, Req{Token: pa.Token}); r.Status != 404 {
		t.Fatalf("pilot reading another pilot's flight: %d", r.Status)
	}
	check("observer unaffected", obs.Token, 200, both)

	// public_live_map on: guests and outsiders see positions with display names only
	e.Must(e.Do("PATCH", "/me/pilot", map[string]any{"display_name": "Kartal"}, Req{Token: pa.Token}), 200)
	e.Must(e.Do("PATCH", "/events/"+evID, map[string]any{"settings": map[string]any{"public_live_map": true}}, Req{Token: org.Token}), 200)
	d = check("guest (public map)", "", 200, both)
	for _, p := range d.Pilots {
		if p.FlightID == fa.String() && p.Pilot.FullName != "Kartal" {
			t.Fatalf("guest sees full name: %+v", p)
		}
	}
	if len(d.Retrievals) != 0 || len(d.Retrievers) != 0 {
		t.Fatal("guests never see retrievals")
	}
	check("outsider (public map)", outsider.Token, 200, both)
	g := e.Must(e.Do("GET", "/flights/"+fa.String(), nil, Req{}), 200).JSON()
	if g["pilot"].(map[string]any)["full_name"] != "Kartal" {
		t.Fatalf("guest flight view: %v", g["pilot"])
	}
	check("retriever still no map", ret.Token, 200, map[string]bool{})
}

func TestRealtimeSubscribeFilterAndReplay(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	adm := e.Admin("RT Admin")
	org := e.Register("RT Organizer")
	ev := e.CreateEvent(adm, map[string]any{"organizers": []any{org.ID}, "settings": map[string]any{"pilots_see_each_other": false}})
	evID := ev["id"].(string)
	a := e.Register("Pilot A")
	b := e.Register("Pilot B")
	watcher := e.Register("Watcher")
	e.AddMember(org, evID, a, "pilot")
	e.AddMember(org, evID, b, "pilot")
	e.AddMember(org, evID, watcher, "observer")
	fa := e.CreateFlight(a, evID)
	fb := e.CreateFlight(b, evID)
	t0 := time.Now().Add(-time.Minute)
	e.MustBatch(a, fa, uuid.New(), seqs(0, 4, t0))

	// observer subscribes: snapshot contains A
	w := dialWS(t, e)
	sub := w.authAndSubscribe(watcher.Token, "event:"+evID, "")
	if sub.Type != "subscribed" {
		t.Fatalf("subscribe: %s", sub.raw)
	}
	var snap liveDoc
	_ = json.Unmarshal(sub.Snapshot, &snap)
	okA := false
	for _, p := range snap.Pilots {
		okA = okA || (p.FlightID == fa.String() && p.Freshness == "live" && len(p.Trail) > 0)
	}
	if len(snap.Pilots) != 2 || !okA { // B is recording without positions yet ("lost")
		t.Fatalf("snapshot: %s", sub.Snapshot)
	}
	// pilot B (pilots_see_each_other off) gets B's own positions but not A's
	wb := dialWS(t, e)
	if r := wb.authAndSubscribe(b.Token, "event:"+evID, ""); r.Type != "subscribed" {
		t.Fatalf("pilot subscribe: %s", r.raw)
	}
	e.MustBatch(a, fa, uuid.New(), seqs(5, 5, t0))
	e.MustBatch(b, fb, uuid.New(), seqs(0, 2, t0))
	m := wb.next(func(m wsMsg) bool { return m.Type == "position" }, 10*time.Second, "position for B")
	if flightOf(m) != fb.String() {
		t.Fatalf("pilot B received another pilot's position: %s", m.raw)
	}
	seenA := false
	for !seenA {
		m := w.next(func(m wsMsg) bool { return m.Type == "position" }, 10*time.Second, "positions for observer")
		seenA = flightOf(m) == fa.String()
	}
	// settings change mid-subscription: pilots now see each other (re-checked per message)
	e.Must(e.Do("PATCH", "/events/"+evID, map[string]any{"settings": map[string]any{"pilots_see_each_other": true}}, Req{Token: org.Token}), 200)
	time.Sleep(300 * time.Millisecond)
	e.MustBatch(a, fa, uuid.New(), seqs(6, 6, t0))
	m = wb.next(func(m wsMsg) bool { return m.Type == "position" && flightOf(m) == fa.String() }, 10*time.Second, "A's position after the settings change")
	lastCursor := ""
	for lastCursor == "" {
		m := w.next(func(m wsMsg) bool { return m.Type == "position" }, 10*time.Second, "observer position 6")
		var d struct {
			Position struct {
				Seq float64 `json:"seq"`
			} `json:"position"`
		}
		_ = json.Unmarshal(m.Data, &d)
		if flightOf(m) == fa.String() && d.Position.Seq == 6 {
			lastCursor = m.Cursor
		}
	}

	// guests: forbidden without public_live_map
	g := dialWS(t, e)
	if r := g.authAndSubscribe("", "event:"+evID, ""); r.Type != "error" || r.Code != "unauthorized" {
		t.Fatalf("guest without public map: %s", r.raw)
	}
	// unauthorized subscriptions
	out := e.Register("Outsider")
	restricted := e.CreateEvent(adm, map[string]any{"visibility": "restricted"})
	w2 := dialWS(t, e)
	if r := w2.authAndSubscribe(out.Token, "event:"+restricted["id"].(string), ""); r.Type != "error" || r.Code != "forbidden" {
		t.Fatalf("restricted event: %s", r.raw)
	}
	w2.send(map[string]any{"type": "subscribe", "channel": "flight:" + fb.String()})
	if r := w2.next(func(m wsMsg) bool { return m.Type == "error" || m.Type == "subscribed" }, 5*time.Second, "flight sub"); r.Type != "error" {
		t.Fatalf("outsider flight subscription allowed: %s", r.raw)
	}
	w2.send(map[string]any{"type": "subscribe", "channel": "retrievals:" + evID})
	if r := w2.next(func(m wsMsg) bool { return m.Type == "error" || m.Type == "subscribed" }, 5*time.Second, "retrievals sub"); r.Code != "forbidden" {
		t.Fatalf("retrievals for outsider: %s", r.raw)
	}
	w2.send(map[string]any{"type": "subscribe", "channel": "incidents"})
	if r := w2.next(func(m wsMsg) bool { return m.Type == "error" || m.Type == "subscribed" }, 5*time.Second, "incidents sub"); r.Code != "unknown_channel" {
		t.Fatalf("incidents channel must be gone: %s", r.raw)
	}

	// since-replay: disconnect, miss two batches, resubscribe with the last cursor
	_ = w.c.Close(websocket.StatusNormalClosure, "")
	e.MustBatch(a, fa, uuid.New(), seqs(9, 9, t0))
	e.MustBatch(a, fa, uuid.New(), seqs(10, 10, t0))
	time.Sleep(1500 * time.Millisecond) // let the relay publish both
	w3 := dialWS(t, e)
	rs := w3.authAndSubscribe(watcher.Token, "event:"+evID, lastCursor)
	if rs.Type != "subscribed" || rs.Replayed < 2 {
		t.Fatalf("replay: %s", rs.raw)
	}
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
