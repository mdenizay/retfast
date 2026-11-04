package tests

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestIncidentLifecycleResponderAuthzAndAudit(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := context.Background()
	org := e.Register("SAR Organizer")
	e.Grant(org, "event_organizer")
	testing1 := e.CreateEvent(org, map[string]any{"settings": map[string]any{"emergency_testing": true}})
	noTest := e.CreateEvent(org, map[string]any{"name": "No testing"})
	pilot := e.Register("SOS Pilot")
	stranger := e.Register("Stranger")
	rescuer := e.Register("Rescuer")
	e.Grant(rescuer, "rescue_operator")
	for _, ev := range []map[string]any{testing1, noTest} {
		e.Must(e.Do("POST", "/events/"+ev["id"].(string)+"/join", nil, Req{Token: pilot.Token}), 200)
	}
	e.Must(e.Do("PATCH", "/me/pilot", map[string]any{"emergency_contact_name": "Anne", "emergency_contact_phone": "+905551112233", "blood_type": "0+"}, Req{Token: pilot.Token}), 200)
	fTest := e.CreateFlight(pilot, testing1["id"], "private")
	fNoTest := e.CreateFlight(pilot, noTest["id"], "private")
	e.MustBatch(pilot, fTest, uuid.New(), seqs(0, 3, time.Now().Add(-time.Minute)))

	now := time.Now().UTC().Format(time.RFC3339)
	// is_test only in events with emergency_testing
	if r := e.Do("POST", "/incidents", map[string]any{"id": uuid.New(), "kind": "sos", "is_test": true, "flight_id": fNoTest, "created_at_device": now}, Req{Token: pilot.Token}); r.Status != 422 {
		t.Fatalf("is_test outside testing event: %d %s", r.Status, r.Body)
	}
	if r := e.Do("POST", "/incidents", map[string]any{"id": uuid.New(), "kind": "sos", "is_test": true, "created_at_device": now}, Req{Token: pilot.Token}); r.Status != 422 {
		t.Fatalf("is_test without event: %d", r.Status)
	}
	id := uuid.New()
	body := map[string]any{"id": id, "kind": "sos", "is_test": true, "flight_id": fTest, "message": "Ağaca indim",
		"position": map[string]any{"lat": 37.08, "lon": 29.35, "gps_alt_m": 1500, "h_acc_m": 8, "t": now}, "created_at_device": now}
	inc := e.Must(e.Do("POST", "/incidents", body, Req{Token: pilot.Token}), 201).JSON()
	if inc["status"] != "open" || inc["event_id"] != testing1["id"] || inc["last_known_position"] == nil {
		t.Fatalf("created: %v", inc)
	}
	// idempotent re-send
	e.Must(e.Do("POST", "/incidents", body, Req{Token: pilot.Token}), 200)
	var n int
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM emergency_incidents WHERE id = $1`, id).Scan(&n)
	if n != 1 {
		t.Fatal("duplicate incident")
	}
	// the id cannot be hijacked by someone else
	if r := e.Do("POST", "/incidents", body, Req{Token: stranger.Token}); r.Status != 409 {
		t.Fatalf("foreign id: %d", r.Status)
	}
	// responders were notified
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM notification_records WHERE kind = 'emergency_alert' AND user_id IN ($1, $2)`, org.ID, rescuer.ID).Scan(&n)
	if n != 2 {
		t.Fatalf("alerts = %d", n)
	}

	// stranger: no access at all
	if r := e.Do("GET", "/incidents/"+id.String(), nil, Req{Token: stranger.Token}); r.Status != 404 {
		t.Fatalf("stranger get: %d", r.Status)
	}
	if r := e.Do("POST", "/incidents/"+id.String()+"/acknowledge", nil, Req{Token: stranger.Token}); r.Status != 404 {
		t.Fatalf("stranger ack: %d", r.Status)
	}
	// the pilot cannot acknowledge their own incident
	if r := e.Do("POST", "/incidents/"+id.String()+"/acknowledge", nil, Req{Token: pilot.Token}); r.Status != 403 {
		t.Fatalf("pilot ack: %d", r.Status)
	}
	// organizer of the event is a responder: sees contact data (audited)
	got := e.Must(e.Do("GET", "/incidents/"+id.String(), nil, Req{Token: org.Token}), 200).JSON()
	if got["pilot"].(map[string]any)["emergency_contact_phone"] != "+905551112233" {
		t.Fatalf("responder should see contact: %v", got["pilot"])
	}
	// organizer sees the private flight while the incident is open
	e.Must(e.Do("GET", "/flights/"+fTest.String(), nil, Req{Token: org.Token}), 200)
	ack := e.Must(e.Do("POST", "/incidents/"+id.String()+"/acknowledge", nil, Req{Token: org.Token}), 200).JSON()
	if ack["status"] != "acknowledged" || ack["acknowledged_by"].(map[string]any)["user_id"] != org.ID.String() {
		t.Fatalf("ack: %v", ack)
	}
	// pilot was told (rescue_ack)
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM notification_records WHERE kind = 'rescue_ack' AND user_id = $1`, pilot.ID).Scan(&n)
	if n != 1 {
		t.Fatalf("rescue_ack = %d", n)
	}
	// rescue operator assigns themselves, moves the assignment forward
	as := e.Must(e.Do("POST", "/incidents/"+id.String()+"/assignments", map[string]any{"responder_user_id": rescuer.ID}, Req{Token: rescuer.Token}), 201).JSON()
	asgs := as["assignments"].([]any)
	if len(asgs) != 1 {
		t.Fatalf("assignments: %v", asgs)
	}
	aid := asgs[0].(map[string]any)["id"].(string)
	if r := e.Do("POST", "/incidents/"+id.String()+"/assignments", map[string]any{"responder_user_id": stranger.ID}, Req{Token: rescuer.Token}); r.Status != 422 {
		t.Fatalf("assigning a non-responder: %d", r.Status)
	}
	e.Must(e.Do("POST", "/rescue/assignments/"+aid+"/status", map[string]any{"status": "en_route"}, Req{Token: rescuer.Token}), 200)
	if r := e.Do("POST", "/rescue/assignments/"+aid+"/status", map[string]any{"status": "assigned"}, Req{Token: rescuer.Token}); r.Status != 409 {
		t.Fatalf("backwards assignment status: %d", r.Status)
	}
	if r := e.Do("POST", "/rescue/assignments/"+aid+"/status", map[string]any{"status": "on_scene"}, Req{Token: org.Token}); r.Status != 403 {
		t.Fatalf("non-assignee status: %d", r.Status)
	}
	mine := e.Must(e.Do("GET", "/rescue/assignments", nil, Req{Token: rescuer.Token}), 200).JSON()["items"].([]any)
	if len(mine) != 1 {
		t.Fatalf("my assignments: %d", len(mine))
	}
	e.Must(e.Do("PUT", "/rescue/me/status", map[string]any{"availability": "available"}, Req{Token: rescuer.Token}), 200)
	e.Must(e.Do("POST", "/rescue/me/position", map[string]any{"lat": 37.07, "lon": 29.34, "h_acc_m": 5, "t": now}, Req{Token: rescuer.Token}), 204)
	team := e.Must(e.Do("GET", "/rescue/team", nil, Req{Token: org.Token}), 200).JSON()["items"].([]any)
	if len(team) != 1 || team[0].(map[string]any)["availability"] != "available" || team[0].(map[string]any)["active_assignment"] == nil {
		t.Fatalf("team: %v", team)
	}
	if r := e.Do("GET", "/rescue/team", nil, Req{Token: stranger.Token}); r.Status != 403 {
		t.Fatalf("stranger team: %d", r.Status)
	}
	e.Must(e.Do("POST", "/incidents/"+id.String()+"/notes", map[string]any{"body": "Ekip yola çıktı"}, Req{Token: rescuer.Token}), 201)
	e.Must(e.Do("POST", "/incidents/"+id.String()+"/status", map[string]any{"status": "responding"}, Req{Token: rescuer.Token}), 200)
	res := e.Must(e.Do("POST", "/incidents/"+id.String()+"/status", map[string]any{"status": "resolved", "note": "Pilot sağlam"}, Req{Token: rescuer.Token}), 200).JSON()
	if res["status"] != "resolved" || res["resolved_at"] == nil {
		t.Fatalf("resolved: %v", res)
	}
	// terminal: no further transitions; owner cannot cancel a resolved incident
	if r := e.Do("POST", "/incidents/"+id.String()+"/status", map[string]any{"status": "responding"}, Req{Token: rescuer.Token}); r.Status != 409 {
		t.Fatalf("reopen: %d", r.Status)
	}
	if r := e.Do("POST", "/incidents/"+id.String()+"/cancel", nil, Req{Token: pilot.Token}); r.Status != 409 {
		t.Fatalf("cancel resolved: %d", r.Status)
	}
	// once closed, the organizer no longer sees the private flight
	if r := e.Do("GET", "/flights/"+fTest.String(), nil, Req{Token: org.Token}); r.Status != 404 {
		t.Fatalf("private flight after resolve: %d", r.Status)
	}
	updates := res["updates"].([]any)
	if len(updates) < 6 {
		t.Fatalf("updates = %d", len(updates))
	}

	// audit: every responder action + contact access
	for _, action := range []string{"incident.created", "incident.contact_viewed", "incident.acknowledged", "incident.assigned",
		"rescue.assignment_status", "rescue.availability", "rescue.position_updated", "rescue.team_viewed", "incident.note_added",
		"incident.status_responding", "incident.status_resolved"} {
		_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE action = $1`, action).Scan(&n)
		if n == 0 {
			t.Errorf("missing audit row %s", action)
		}
	}
	// audit details never carry coordinates
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE details::text LIKE '%37.0%'`).Scan(&n)
	if n != 0 {
		t.Fatal("audit log contains coordinates")
	}

	// owner cancels a fresh (real) incident; listing is scoped
	id2 := uuid.New()
	e.Must(e.Do("POST", "/incidents", map[string]any{"id": id2, "kind": "sos", "created_at_device": now}, Req{Token: pilot.Token}), 201)
	if r := e.Do("POST", "/incidents/"+id2.String()+"/cancel", map[string]any{"reason": "yanlışlıkla"}, Req{Token: rescuer.Token}); r.Status != 403 {
		t.Fatalf("non-owner cancel: %d", r.Status)
	}
	c := e.Must(e.Do("POST", "/incidents/"+id2.String()+"/cancel", map[string]any{"reason": "yanlışlıkla"}, Req{Token: pilot.Token}), 200).JSON()
	if c["status"] != "cancelled" {
		t.Fatal("not cancelled")
	}
	own := e.Must(e.Do("GET", "/incidents", nil, Req{Token: pilot.Token}), 200).JSON()["items"].([]any)
	if len(own) != 2 {
		t.Fatalf("own incidents: %d", len(own))
	}
	if items := e.Must(e.Do("GET", "/incidents", nil, Req{Token: stranger.Token}), 200).JSON()["items"].([]any); len(items) != 0 {
		t.Fatalf("stranger sees %d incidents", len(items))
	}
	// the organizer only sees the incident linked to their event (id2 has no event)
	if items := e.Must(e.Do("GET", "/incidents", nil, Req{Token: org.Token}), 200).JSON()["items"].([]any); len(items) != 1 {
		t.Fatalf("organizer scope: %d", len(items))
	}
	if items := e.Must(e.Do("GET", "/incidents", nil, Req{Token: rescuer.Token}), 200).JSON()["items"].([]any); len(items) != 2 {
		t.Fatalf("rescue scope: %d", len(items))
	}
}

func TestIncidentRealtimeForResponders(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	rescuer := e.Register("RT Rescuer")
	e.Grant(rescuer, "rescue_operator")
	pilot := e.Register("RT Pilot")
	w := dialWS(t, e)
	sub := w.authAndSubscribe(rescuer.Token, "incidents", "")
	if sub.Type != "subscribed" {
		t.Fatalf("subscribe incidents: %s", sub.raw)
	}
	id := uuid.New()
	e.Must(e.Do("POST", "/incidents", map[string]any{"id": id, "kind": "sos", "created_at_device": time.Now().UTC().Format(time.RFC3339)}, Req{Token: pilot.Token}), 201)
	m := w.next(func(m wsMsg) bool { return m.Type == "incident" }, 10*time.Second, "incident message")
	if m.Channel != "incidents" || len(m.Data) == 0 {
		t.Fatalf("incident msg: %s", m.raw)
	}
}
