package tests

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func pickup(lat, lon float64) map[string]any {
	return map[string]any{"lat": lat, "lon": lon, "gps_alt_m": 1250.0, "h_acc_m": 6.0, "t": time.Now().Add(-5 * time.Second).UTC().Format(time.RFC3339Nano)}
}

type retrievalWorld struct {
	e                  *Env
	adm, org           *User
	pilot, pilot2      *User
	ra, rb, obs        *User
	evID               string
	pilotPh, retrPhone string
}

func newRetrievalWorld(t *testing.T) *retrievalWorld {
	e := newEnv(t)
	w := &retrievalWorld{e: e, pilotPh: "+90 555 000 0001", retrPhone: "+90 555 000 0002"}
	w.adm = e.Admin("Admin")
	w.org = e.Register("Organizer")
	ev := e.CreateEvent(w.adm, map[string]any{"organizers": []any{w.org.ID}})
	w.evID = ev["id"].(string)
	w.pilot, w.pilot2 = e.Register("Pilot P"), e.Register("Pilot Q")
	w.ra, w.rb, w.obs = e.Register("Retriever A"), e.Register("Retriever B"), e.Register("Observer O")
	e.AddMember(w.org, w.evID, w.pilot, "pilot")
	e.AddMember(w.org, w.evID, w.pilot2, "pilot")
	e.AddMember(w.org, w.evID, w.ra, "retriever")
	e.AddMember(w.org, w.evID, w.rb, "retriever")
	e.AddMember(w.org, w.evID, w.obs, "observer")
	e.Must(e.Do("PATCH", "/me/pilot", map[string]any{"phone": w.pilotPh}, Req{Token: w.pilot.Token}), 200)
	e.Must(e.Do("PATCH", "/me/pilot", map[string]any{"phone": w.retrPhone}, Req{Token: w.ra.Token}), 200)
	e.Must(e.Do("PATCH", "/me/pilot", map[string]any{"phone": "+90 555 000 0003"}, Req{Token: w.rb.Token}), 200)
	return w
}

func (w *retrievalWorld) get(t *testing.T, id string, u *User) (int, map[string]any) {
	t.Helper()
	r := w.e.Do("GET", "/retrievals/"+id, nil, Req{Token: u.Token})
	return r.Status, r.JSON()
}

func sub(m map[string]any, k string) map[string]any {
	v, _ := m[k].(map[string]any)
	return v
}

func TestRetrievalLifecycle(t *testing.T) {
	t.Parallel()
	w := newRetrievalWorld(t)
	e := w.e
	ctx := context.Background()
	id := uuid.New().String()
	body := map[string]any{"id": id, "pickup": pickup(37.05, 29.36), "note": "Yol kenarındayım, kanat toplandı"}

	// only pilots of the event create retrievals
	if r := e.Do("POST", "/events/"+w.evID+"/retrievals", body, Req{Token: w.ra.Token}); r.Status != 403 {
		t.Fatalf("retriever creating: %d", r.Status)
	}
	created := e.Must(e.Do("POST", "/events/"+w.evID+"/retrievals", body, Req{Token: w.pilot.Token}), 201).JSON()
	if created["status"] != "requested" || sub(created, "pilot")["phone"] != w.pilotPh || created["pilot_position"] == nil {
		t.Fatalf("created: %v", created)
	}
	// idempotent re-send
	again := e.Must(e.Do("POST", "/events/"+w.evID+"/retrievals", body, Req{Token: w.pilot.Token}), 200).JSON()
	if again["id"] != id {
		t.Fatal("idempotent create returned another retrieval")
	}
	if r := e.Do("POST", "/events/"+w.evID+"/retrievals", body, Req{Token: w.pilot2.Token}); r.Status != 409 {
		t.Fatalf("foreign id: %d", r.Status)
	}
	// one open retrieval per pilot per event; the 409 carries the open one
	dup := e.Do("POST", "/events/"+w.evID+"/retrievals", map[string]any{"id": uuid.New(), "pickup": pickup(37.05, 29.36)}, Req{Token: w.pilot.Token})
	if dup.Status != 409 || dup.ErrCode() != "conflict" || sub(dup.JSON(), "retrieval")["id"] != id {
		t.Fatalf("second open retrieval: %d %s", dup.Status, dup.Body)
	}
	// a non-accepting retriever sees the request but neither phone nor live position
	st, rb := w.get(t, id, w.rb)
	if st != 200 || sub(rb, "pilot")["phone"] != "" || rb["pilot_position"] != nil || len(rb["updates"].([]any)) != 0 {
		t.Fatalf("retriever view of a request: %d %v", st, rb)
	}
	if st, _ := w.get(t, id, w.pilot2); st != 404 {
		t.Fatalf("other pilot sees retrieval: %d", st)
	}

	// two retrievers race to accept: exactly one wins
	var wg sync.WaitGroup
	codes := map[uuid.UUID]int{}
	var mu sync.Mutex
	for _, u := range []*User{w.ra, w.rb} {
		wg.Add(1)
		go func(u *User) {
			defer wg.Done()
			r := e.Do("POST", "/retrievals/"+id+"/accept", nil, Req{Token: u.Token})
			mu.Lock()
			codes[u.ID] = r.Status
			mu.Unlock()
		}(u)
	}
	wg.Wait()
	winner, loser := w.ra, w.rb
	if codes[w.rb.ID] == 200 {
		winner, loser = w.rb, w.ra
	}
	if codes[winner.ID] != 200 || codes[loser.ID] != 409 {
		t.Fatalf("race: %v", codes)
	}
	// make Retriever A the holder for the rest of the test (release + accept)
	if winner != w.ra {
		e.Must(e.Do("POST", "/retrievals/"+id+"/release", nil, Req{Token: winner.Token}), 200)
		e.Must(e.Do("POST", "/retrievals/"+id+"/accept", nil, Req{Token: w.ra.Token}), 200)
	} else {
		e.Must(e.Do("POST", "/retrievals/"+id+"/release", nil, Req{Token: w.ra.Token}), 200)
		if st, x := w.get(t, id, w.rb); st != 200 || x["status"] != "requested" || x["retriever"] != nil {
			t.Fatalf("released retrieval: %d %v", st, x)
		}
		e.Must(e.Do("POST", "/retrievals/"+id+"/accept", nil, Req{Token: w.ra.Token}), 200)
	}
	if r := e.Do("POST", "/retrievals/"+id+"/accept", nil, Req{Token: w.rb.Token}); r.Status != 409 {
		t.Fatalf("accept taken retrieval: %d", r.Status)
	}
	e.Must(e.Do("POST", "/retrievals/"+id+"/accept", nil, Req{Token: w.ra.Token}), 200) // idempotent for the holder

	// phones: accepting retriever sees the pilot's; pilot sees the retriever's; observer sees none; others 404
	_, ra := w.get(t, id, w.ra)
	if sub(ra, "pilot")["phone"] != w.pilotPh || ra["pilot_position"] == nil {
		t.Fatalf("accepting retriever view: %v", ra)
	}
	_, pv := w.get(t, id, w.pilot)
	if sub(pv, "retriever")["phone"] != w.retrPhone {
		t.Fatalf("pilot view: %v", pv)
	}
	_, ov := w.get(t, id, w.obs)
	if sub(ov, "pilot")["phone"] != "" || sub(ov, "retriever")["phone"] != "" || ov["pilot_position"] == nil {
		t.Fatalf("observer view: %v", ov)
	}
	if st, _ := w.get(t, id, w.rb); st != 404 {
		t.Fatalf("other retriever sees accepted retrieval: %d", st)
	}
	_, orgv := w.get(t, id, w.org)
	if sub(orgv, "pilot")["phone"] != w.pilotPh || sub(orgv, "retriever")["phone"] != w.retrPhone {
		t.Fatalf("organizer view: %v", orgv)
	}
	var reveals int
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE action = 'privacy.phone_revealed' AND details->>'revealed_to' = $1`, w.ra.ID.String()).Scan(&reveals)
	if reveals < 1 {
		t.Fatal("phone reveal to the accepting retriever not audited")
	}

	// invalid transitions
	if r := e.Do("POST", "/retrievals/"+id+"/delivered", nil, Req{Token: w.ra.Token}); r.Status != 409 {
		t.Fatalf("delivered from accepted: %d", r.Status)
	}
	if r := e.Do("POST", "/retrievals/"+id+"/picked-up", nil, Req{Token: w.rb.Token}); r.Status != 404 && r.Status != 403 {
		t.Fatalf("picked-up by non-holder: %d", r.Status)
	}
	if r := e.Do("POST", "/retrievals/"+id+"/picked-up", nil, Req{Token: w.pilot.Token}); r.Status != 403 {
		t.Fatalf("picked-up by pilot: %d", r.Status)
	}
	if r := e.Do("POST", "/retrievals/"+id+"/cancel", nil, Req{Token: w.ra.Token}); r.Status != 403 {
		t.Fatalf("cancel by retriever: %d", r.Status)
	}
	// assignment by organizers only, to retrievers of the event only
	if r := e.Do("POST", "/retrievals/"+id+"/assign", map[string]any{"retriever_user_id": w.rb.ID}, Req{Token: w.pilot.Token}); r.Status != 403 {
		t.Fatalf("assign by pilot: %d", r.Status)
	}
	if r := e.Do("POST", "/retrievals/"+id+"/assign", map[string]any{"retriever_user_id": w.obs.ID}, Req{Token: w.org.Token}); r.Status != 422 {
		t.Fatalf("assign to observer: %d", r.Status)
	}
	as := e.Must(e.Do("POST", "/retrievals/"+id+"/assign", map[string]any{"retriever_user_id": w.rb.ID}, Req{Token: w.org.Token}), 200).JSON()
	if sub(as, "retriever")["user_id"] != w.rb.ID.String() {
		t.Fatalf("assigned: %v", as)
	}
	if st, _ := w.get(t, id, w.ra); st != 404 {
		t.Fatalf("reassigned-away retriever still sees it: %d", st)
	}
	e.Must(e.Do("POST", "/retrievals/"+id+"/assign", map[string]any{"retriever_user_id": w.ra.ID}, Req{Token: w.org.Token}), 200)

	// pilot positions while open: owner only
	pp := map[string]any{"lat": 37.0505, "lon": 29.3605, "h_acc_m": 8.0, "t": time.Now().UTC().Format(time.RFC3339Nano)}
	if r := e.Do("POST", "/retrievals/"+id+"/position", pp, Req{Token: w.ra.Token}); r.Status != 403 {
		t.Fatalf("position by retriever: %d", r.Status)
	}
	pr := e.Must(e.Do("POST", "/retrievals/"+id+"/position", pp, Req{Token: w.pilot.Token}), 200).JSON()
	if sub(pr, "position")["lat"] != 37.0505 {
		t.Fatalf("position: %v", pr)
	}
	if r := e.Do("POST", "/retrievals/"+id+"/position", map[string]any{"lat": 99.0, "lon": 1.0, "h_acc_m": 5.0, "t": time.Now().UTC().Format(time.RFC3339)}, Req{Token: w.pilot.Token}); r.Status != 422 {
		t.Fatalf("invalid position: %d", r.Status)
	}
	e.Must(e.Do("POST", "/retrievals/"+id+"/notes", map[string]any{"body": "Köprünün yanındayım"}, Req{Token: w.pilot.Token}), 201)
	if r := e.Do("POST", "/retrievals/"+id+"/notes", map[string]any{"body": "x"}, Req{Token: w.obs.Token}); r.Status != 403 {
		t.Fatalf("observer note: %d", r.Status)
	}
	// pick up and deliver
	e.Must(e.Do("POST", "/retrievals/"+id+"/picked-up", nil, Req{Token: w.ra.Token}), 200)
	if r := e.Do("POST", "/retrievals/"+id+"/release", nil, Req{Token: w.ra.Token}); r.Status != 409 {
		t.Fatalf("release after pickup: %d", r.Status)
	}
	d := e.Must(e.Do("POST", "/retrievals/"+id+"/delivered", map[string]any{"note": "Kalkışa bırakıldı"}, Req{Token: w.ra.Token}), 200).JSON()
	if d["status"] != "delivered" || d["delivery_note"] != "Kalkışa bırakıldı" || d["delivered_at"] == nil {
		t.Fatalf("delivered: %v", d)
	}
	if sub(d, "pilot")["phone"] != "" {
		t.Fatal("the retriever must not keep the pilot's phone after delivery")
	}
	e.Must(e.Do("POST", "/retrievals/"+id+"/delivered", nil, Req{Token: w.ra.Token}), 200) // idempotent
	if r := e.Do("POST", "/retrievals/"+id+"/cancel", nil, Req{Token: w.pilot.Token}); r.Status != 409 {
		t.Fatalf("cancel after delivery: %d", r.Status)
	}
	if r := e.Do("POST", "/retrievals/"+id+"/position", pp, Req{Token: w.pilot.Token}); r.Status != 409 {
		t.Fatalf("position after delivery: %d", r.Status)
	}
	kinds := []string{}
	for _, u := range d["updates"].([]any) {
		kinds = append(kinds, u.(map[string]any)["kind"].(string))
	}
	for _, k := range []string{"requested", "accepted", "released", "assigned", "note", "picked_up", "delivered"} {
		found := false
		for _, x := range kinds {
			found = found || x == k
		}
		if !found {
			t.Fatalf("timeline lacks %s: %v", k, kinds)
		}
	}
	// pilot notifications for accepted / picked up / delivered; request notified retrievers + organizers
	ns := e.Must(e.Do("GET", "/notifications", nil, Req{Token: w.pilot.Token}), 200).JSON()["items"].([]any)
	retrievalNs := 0
	for _, n := range ns {
		if n.(map[string]any)["kind"] == "retrieval" {
			retrievalNs++
		}
	}
	if retrievalNs < 3 {
		t.Fatalf("pilot retrieval notifications = %d", retrievalNs)
	}
	for _, u := range []*User{w.rb, w.org} {
		var n int
		_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM notification_records WHERE user_id = $1 AND kind = 'retrieval'`, u.ID).Scan(&n)
		if n < 1 {
			t.Fatalf("%s not notified of the request", u.Name)
		}
	}

	// cancel by pilot and by organizer
	id2 := uuid.New().String()
	e.Must(e.Do("POST", "/events/"+w.evID+"/retrievals", map[string]any{"id": id2, "pickup": pickup(37.06, 29.37)}, Req{Token: w.pilot.Token}), 201)
	c := e.Must(e.Do("POST", "/retrievals/"+id2+"/cancel", map[string]any{"reason": "kendim döndüm"}, Req{Token: w.pilot.Token}), 200).JSON()
	if c["status"] != "cancelled" || c["cancel_reason"] != "kendim döndüm" || sub(c, "cancelled_by")["user_id"] != w.pilot.ID.String() {
		t.Fatalf("cancel: %v", c)
	}
	id3 := uuid.New().String()
	e.Must(e.Do("POST", "/events/"+w.evID+"/retrievals", map[string]any{"id": id3, "pickup": pickup(37.06, 29.37)}, Req{Token: w.pilot.Token}), 201)
	e.Must(e.Do("POST", "/retrievals/"+id3+"/accept", nil, Req{Token: w.rb.Token}), 200)
	e.Must(e.Do("POST", "/retrievals/"+id3+"/cancel", nil, Req{Token: w.org.Token}), 200)
	if r := e.Do("POST", "/retrievals/"+id3+"/accept", nil, Req{Token: w.ra.Token}); r.Status != 409 && r.Status != 404 {
		t.Fatalf("accept cancelled: %d", r.Status)
	}

	// listing per role
	list := func(u *User) int {
		return len(e.Must(e.Do("GET", "/events/"+w.evID+"/retrievals", nil, Req{Token: u.Token}), 200).JSON()["items"].([]any))
	}
	if list(w.org) != 3 || list(w.obs) != 3 || list(w.pilot) != 3 || list(w.pilot2) != 0 || list(w.ra) != 1 || list(w.rb) != 1 {
		t.Fatalf("lists: org %d obs %d pilot %d pilot2 %d ra %d rb %d", list(w.org), list(w.obs), list(w.pilot), list(w.pilot2), list(w.ra), list(w.rb))
	}
	open := e.Must(e.Do("GET", "/events/"+w.evID+"/retrievals?status=requested,accepted,picked_up", nil, Req{Token: w.org.Token}), 200).JSON()["items"].([]any)
	if len(open) != 0 {
		t.Fatalf("open retrievals = %d", len(open))
	}
	// report metrics
	rep := e.Must(e.Do("GET", "/events/"+w.evID+"/report", nil, Req{Token: w.org.Token}), 200).JSON()["retrievals"].(map[string]any)
	if rep["count"].(float64) != 3 || rep["median_request_to_accept_s"] == nil || rep["median_pickup_to_delivery_s"] == nil {
		t.Fatalf("report: %v", rep)
	}
	// every state change is audited
	var audits int
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE action LIKE 'retrieval.%'`).Scan(&audits)
	if audits < 14 {
		t.Fatalf("retrieval audit rows = %d", audits)
	}
	// audit rows never carry coordinates or phone numbers
	var leaks int
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE details::text ~ '37\.0[0-9]|29\.3[0-9]|\+90'`).Scan(&leaks)
	if leaks != 0 {
		t.Fatalf("%d audit rows contain coordinates or phone numbers", leaks)
	}
}

func TestRetrieverDutyAndPositions(t *testing.T) {
	t.Parallel()
	w := newRetrievalWorld(t)
	e := w.e
	pos := map[string]any{"lat": 37.04, "lon": 29.35, "h_acc_m": 10.0, "t": time.Now().UTC().Format(time.RFC3339Nano), "course_deg": 90.0, "speed_ms": 12.0}
	if r := e.Do("POST", "/events/"+w.evID+"/retrievers/me/position", pos, Req{Token: w.ra.Token}); r.Status != 409 {
		t.Fatalf("position while off duty: %d", r.Status)
	}
	if r := e.Do("PUT", "/events/"+w.evID+"/retrievers/me/duty", map[string]any{"on_duty": true}, Req{Token: w.pilot.Token}); r.Status != 403 {
		t.Fatalf("pilot duty: %d", r.Status)
	}
	d := e.Must(e.Do("PUT", "/events/"+w.evID+"/retrievers/me/duty", map[string]any{"on_duty": true}, Req{Token: w.ra.Token}), 200).JSON()
	if d["on_duty"] != true {
		t.Fatalf("duty: %v", d)
	}
	st := e.Must(e.Do("POST", "/events/"+w.evID+"/retrievers/me/position", pos, Req{Token: w.ra.Token}), 200).JSON()
	if sub(st, "position")["lat"] != 37.04 {
		t.Fatalf("state: %v", st)
	}
	// organizers/observers see retrievers; pilots only the one serving them
	_, live := e.live(t, w.evID, w.obs.Token)
	if len(live.Retrievers) != 2 {
		t.Fatalf("observer retrievers = %d", len(live.Retrievers))
	}
	_, live = e.live(t, w.evID, w.pilot.Token)
	if len(live.Retrievers) != 0 {
		t.Fatal("pilot sees retrievers without a retrieval")
	}
	id := uuid.New().String()
	e.Must(e.Do("POST", "/events/"+w.evID+"/retrievals", map[string]any{"id": id, "pickup": pickup(37.05, 29.36)}, Req{Token: w.pilot.Token}), 201)
	e.Must(e.Do("POST", "/retrievals/"+id+"/accept", nil, Req{Token: w.ra.Token}), 200)
	_, live = e.live(t, w.evID, w.pilot.Token)
	if len(live.Retrievers) != 1 || live.Retrievers[0]["user_id"] != w.ra.ID.String() {
		t.Fatalf("pilot retrievers: %v", live.Retrievers)
	}
	if len(live.Retrievals) != 1 || sub(live.Retrievals[0], "retriever_position") == nil {
		t.Fatalf("pilot sees the approaching retriever: %v", live.Retrievals)
	}
	_, live = e.live(t, w.evID, w.pilot2.Token)
	if len(live.Retrievers) != 0 || len(live.Retrievals) != 0 {
		t.Fatal("unrelated pilot sees retrievers/retrievals")
	}
	_, live = e.live(t, w.evID, w.rb.Token)
	if len(live.Retrievers) != 1 || live.Retrievers[0]["user_id"] != w.rb.ID.String() {
		t.Fatalf("retriever sees only self: %v", live.Retrievers)
	}
	var n int
	_ = e.Pool.QueryRow(context.Background(), `SELECT count(*) FROM retriever_positions`).Scan(&n)
	if n != 1 {
		t.Fatalf("retriever position history = %d", n)
	}
}

func TestRetrievalRealtimeDelivery(t *testing.T) {
	t.Parallel()
	w := newRetrievalWorld(t)
	e := w.e
	ch := "retrievals:" + w.evID
	subscribe := func(u *User) *wsClient {
		c := dialWS(t, e)
		if r := c.authAndSubscribe(u.Token, ch, ""); r.Type != "subscribed" {
			t.Fatalf("%s subscribe: %s", u.Name, r.raw)
		}
		return c
	}
	wa, wb, wo, wp, wq := subscribe(w.ra), subscribe(w.rb), subscribe(w.obs), subscribe(w.pilot), subscribe(w.pilot2)
	if r := dialWS(t, e).authAndSubscribe("", ch, ""); r.Type != "error" {
		t.Fatalf("guest retrievals subscription: %s", r.raw)
	}
	type retMsg struct {
		ID      string `json:"id"`
		Status  string `json:"status"`
		Removed bool   `json:"removed"`
		Pilot   struct {
			Phone string `json:"phone"`
		} `json:"pilot"`
		PilotPosition map[string]any `json:"pilot_position"`
	}
	decode := func(m wsMsg) retMsg {
		var r retMsg
		_ = json.Unmarshal(m.Data, &r)
		return r
	}
	id := uuid.New().String()
	e.Must(e.Do("POST", "/events/"+w.evID+"/retrievals", map[string]any{"id": id, "pickup": pickup(37.05, 29.36)}, Req{Token: w.pilot.Token}), 201)
	for _, c := range []*wsClient{wa, wb} {
		m := c.next(func(m wsMsg) bool { return m.Type == "retrieval" }, 10*time.Second, "request to retrievers")
		if r := decode(m); r.ID != id || r.Status != "requested" || r.Pilot.Phone != "" || r.PilotPosition != nil {
			t.Fatalf("request as seen by a retriever: %s", m.raw)
		}
	}
	e.Must(e.Do("POST", "/retrievals/"+id+"/accept", nil, Req{Token: w.ra.Token}), 200)
	m := wa.next(func(m wsMsg) bool { return m.Type == "retrieval" && decode(m).Status == "accepted" }, 10*time.Second, "accepted to A")
	if r := decode(m); r.Pilot.Phone != w.pilotPh || r.PilotPosition == nil {
		t.Fatalf("accepting retriever message: %s", m.raw)
	}
	m = wb.next(func(m wsMsg) bool { return m.Type == "retrieval" }, 10*time.Second, "removal to B")
	if r := decode(m); !r.Removed || r.Pilot.Phone != "" {
		t.Fatalf("other retriever message: %s", m.raw)
	}
	m = wo.next(func(m wsMsg) bool { return m.Type == "retrieval" && decode(m).Status == "accepted" }, 10*time.Second, "accepted to observer")
	if decode(m).Pilot.Phone != "" {
		t.Fatalf("observer got a phone: %s", m.raw)
	}

	// pilot position: accepting retriever, observer, pilot; not the other retriever
	pp := map[string]any{"lat": 37.0506, "lon": 29.3606, "h_acc_m": 7.0, "t": time.Now().UTC().Format(time.RFC3339Nano)}
	e.Must(e.Do("POST", "/retrievals/"+id+"/position", pp, Req{Token: w.pilot.Token}), 200)
	for _, c := range []*wsClient{wa, wo, wp} {
		m := c.next(func(m wsMsg) bool { return m.Type == "pilot_position" }, 10*time.Second, "pilot_position")
		var d struct {
			RetrievalID string `json:"retrieval_id"`
			Position    struct {
				Lat float64 `json:"lat"`
			} `json:"position"`
		}
		_ = json.Unmarshal(m.Data, &d)
		if d.RetrievalID != id || d.Position.Lat != 37.0506 {
			t.Fatalf("pilot_position: %s", m.raw)
		}
	}
	// retriever position: observer and the served pilot; not B nor the unrelated pilot
	e.Must(e.Do("PUT", "/events/"+w.evID+"/retrievers/me/duty", map[string]any{"on_duty": true}, Req{Token: w.ra.Token}), 200)
	rp := map[string]any{"lat": 37.045, "lon": 29.355, "h_acc_m": 9.0, "t": time.Now().UTC().Format(time.RFC3339Nano), "speed_ms": 14.0}
	e.Must(e.Do("POST", "/events/"+w.evID+"/retrievers/me/position", rp, Req{Token: w.ra.Token}), 200)
	for _, c := range []*wsClient{wo, wp, wa} {
		m := c.next(func(m wsMsg) bool {
			if m.Type != "retriever_position" {
				return false
			}
			var d struct {
				Position *struct {
					Lat float64 `json:"lat"`
				} `json:"position"`
			}
			_ = json.Unmarshal(m.Data, &d)
			return d.Position != nil
		}, 10*time.Second, "retriever_position")
		var d struct {
			UserID string `json:"user_id"`
		}
		_ = json.Unmarshal(m.Data, &d)
		if d.UserID != w.ra.ID.String() {
			t.Fatalf("retriever_position: %s", m.raw)
		}
	}
	// marker: a new request by the unrelated pilot reaches B and Q; nothing forbidden may precede it
	id2 := uuid.New().String()
	e.Must(e.Do("POST", "/events/"+w.evID+"/retrievals", map[string]any{"id": id2, "pickup": pickup(37.07, 29.38)}, Req{Token: w.pilot2.Token}), 201)
	for name, c := range map[string]*wsClient{"retriever B": wb, "pilot Q": wq} {
		for {
			m := c.next(func(wsMsg) bool { return true }, 10*time.Second, "marker for "+name)
			if m.Type == "pilot_position" || m.Type == "retriever_position" {
				t.Fatalf("%s received %s: %s", name, m.Type, m.raw)
			}
			if m.Type == "retrieval" && decode(m).ID == id2 {
				break
			}
			if m.Type == "retrieval" && name == "pilot Q" {
				t.Fatalf("pilot Q received someone else's retrieval: %s", m.raw)
			}
		}
	}
	// the subscribed snapshot of a retriever contains the open requests only
	snap := dialWS(t, e).authAndSubscribe(w.rb.Token, ch, "")
	var s struct {
		Retrievals []retMsg `json:"retrievals"`
		Pilots     any      `json:"pilots"`
	}
	_ = json.Unmarshal(snap.Snapshot, &s)
	if len(s.Retrievals) != 1 || s.Retrievals[0].ID != id2 || s.Pilots != nil {
		t.Fatalf("retriever snapshot: %s", snap.Snapshot)
	}
	// role change during the subscription: B becomes an observer and now gets pilot positions
	e.Must(e.Do("PATCH", "/events/"+w.evID+"/members/"+w.rb.ID.String(), map[string]any{"role": "observer"}, Req{Token: w.org.Token}), 200)
	time.Sleep(300 * time.Millisecond)
	e.Must(e.Do("POST", "/retrievals/"+id+"/position", pp, Req{Token: w.pilot.Token}), 200)
	wb.next(func(m wsMsg) bool { return m.Type == "pilot_position" }, 10*time.Second, "pilot_position after role change")
}
