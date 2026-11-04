package tests

import (
	"context"
	"testing"

	"github.com/mdenizay/retfast/services/api/internal/seed"
)

func TestSeedIdempotent(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := context.Background()
	r1, err := seed.Run(ctx, e.Pool, seed.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if r1.UsersCreated != 5 || r1.EventsCreated != 1 || r1.SitesCreated != 1 {
		t.Fatalf("first run: %+v", r1)
	}
	var startsBefore string
	_ = e.Pool.QueryRow(ctx, `SELECT starts_at::text FROM events`).Scan(&startsBefore)
	r2, err := seed.Run(ctx, e.Pool, seed.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if r2.UsersCreated != 0 || r2.EventsCreated != 0 || r2.SitesCreated != 0 || r2.ScheduleUpdated != 0 {
		t.Fatalf("second run created something: %+v", r2)
	}
	count := func(sql string) int {
		var n int
		if err := e.Pool.QueryRow(ctx, sql).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT count(*) FROM users`); n != 5 {
		t.Fatalf("users = %d", n)
	}
	if n := count(`SELECT count(*) FROM events`); n != 1 {
		t.Fatalf("events = %d", n)
	}
	if n := count(`SELECT count(*) FROM launch_sites WHERE lat IS NULL AND elevation_m IS NULL AND NOT is_verified`); n != 1 {
		t.Fatalf("launch sites = %d", n)
	}
	if n := count(`SELECT count(*) FROM event_participants WHERE role = 'organizer'`); n != 2 {
		t.Fatalf("organizers = %d", n)
	}
	if n := count(`SELECT count(*) FROM event_participants WHERE role = 'participant'`); n != 3 {
		t.Fatalf("participants = %d", n)
	}
	if n := count(`SELECT count(*) FROM user_roles WHERE role = 'platform_admin'`); n != 2 {
		t.Fatalf("admins = %d", n)
	}
	if n := count(`SELECT count(*) FROM users WHERE must_change_password AND email_verified_at IS NOT NULL
		AND password_expires_at BETWEEN now() + interval '6 days 23 hours' AND now() + interval '7 days 1 minute'`); n != 5 {
		t.Fatalf("bootstrap flags = %d", n)
	}
	if n := count(`SELECT count(*) FROM pilot_profiles p JOIN users u ON u.id = p.user_id WHERE p.display_name = u.full_name`); n != 5 {
		t.Fatalf("profiles = %d", n)
	}
	if n := count(`SELECT count(*) FROM user_preferences WHERE default_flight_visibility = 'event' AND NOT public_profile`); n != 5 {
		t.Fatalf("preferences = %d", n)
	}
	var startsAfter string
	_ = e.Pool.QueryRow(ctx, `SELECT starts_at::text FROM events`).Scan(&startsAfter)
	if startsBefore != startsAfter {
		t.Fatal("re-seed changed the demo window without flags")
	}
	// the API view of the demo event
	ev := e.Must(e.Do("GET", "/events/"+seed.DemoSlug, nil, Req{}), 200).JSON()
	if ev["description"] != seed.DemoDescription || ev["is_demo"] != true || ev["status"] != "active" || ev["center_is_approximate"] != true {
		t.Fatalf("demo event: %v", ev)
	}
	settings := ev["settings"].(map[string]any)
	for _, k := range []string{"registration_open", "live_tracking", "flight_recording", "observers_allowed", "emergency_testing", "public_live_map"} {
		if settings[k] != true {
			t.Fatalf("setting %s = %v", k, settings[k])
		}
	}
	if ev["participant_count"].(float64) != 3 {
		t.Fatalf("participant_count = %v", ev["participant_count"])
	}
	sites := e.Must(e.Do("GET", "/events/"+seed.DemoSlug+"/launch-sites", nil, Req{}), 200).JSON()["items"].([]any)
	if len(sites) != 1 || sites[0].(map[string]any)["position"] != nil {
		t.Fatalf("sites = %v", sites)
	}
}

func TestEventLifecycleAndAuthorization(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	org := e.Register("Organizer One")
	pilot := e.Register("Pilot One")
	other := e.Register("Outsider")

	// a plain pilot cannot create events
	if r := e.Do("POST", "/events", map[string]any{"name": "x", "starts_at": "2026-11-04T10:00:00Z", "ends_at": "2026-11-05T10:00:00Z"}, Req{Token: pilot.Token}); r.Status != 403 {
		t.Fatalf("pilot create event: %d", r.Status)
	}
	e.Grant(org, "event_organizer")
	pub := e.CreateEvent(org, map[string]any{"name": "Açık Kupa 2026", "settings": map[string]any{"public_live_map": true}})
	if pub["slug"] != "acik-kupa-2026" || pub["my_role"] != "organizer" {
		t.Fatalf("created: %v", pub)
	}
	pubID := pub["id"].(string)
	restricted := e.CreateEvent(org, map[string]any{"name": "Kapalı Kamp", "visibility": "restricted"})
	resID := restricted["id"].(string)
	draft := e.CreateEvent(org, map[string]any{"name": "Taslak", "status": "draft"})

	// visibility
	e.Must(e.Do("GET", "/events/"+pubID, nil, Req{}), 200)
	if r := e.Do("GET", "/events/"+resID, nil, Req{Token: other.Token}); r.Status != 404 {
		t.Fatalf("restricted for outsider: %d", r.Status)
	}
	if r := e.Do("GET", "/events/"+draft["id"].(string), nil, Req{}); r.Status != 404 {
		t.Fatalf("draft for guest: %d", r.Status)
	}
	list := e.Must(e.Do("GET", "/events", nil, Req{}), 200).JSON()["items"].([]any)
	for _, it := range list {
		if id := it.(map[string]any)["id"]; id == resID || id == draft["id"] {
			t.Fatal("guest list leaks restricted/draft event")
		}
	}

	// join / leave public event
	j := e.Must(e.Do("POST", "/events/"+pubID+"/join", nil, Req{Token: pilot.Token}), 200).JSON()
	if j["my_role"] != "participant" || j["participant_count"].(float64) != 1 {
		t.Fatalf("join: %v", j)
	}
	e.Must(e.Do("POST", "/events/"+pubID+"/join", nil, Req{Token: pilot.Token}), 200) // idempotent
	// restricted: self-join refused, organizer add allowed
	if r := e.Do("POST", "/events/"+resID+"/join", nil, Req{Token: pilot.Token}); r.Status != 404 && r.Status != 403 {
		t.Fatalf("restricted self-join: %d", r.Status)
	}
	e.Must(e.Do("POST", "/events/"+resID+"/participants", map[string]any{"user_id": pilot.ID, "role": "participant"}, Req{Token: org.Token}), 201)
	e.Must(e.Do("GET", "/events/"+resID, nil, Req{Token: pilot.Token}), 200)

	// participants: members only; outsiders forbidden
	parts := e.Must(e.Do("GET", "/events/"+pubID+"/participants", nil, Req{Token: pilot.Token}), 200).JSON()["items"].([]any)
	if len(parts) != 2 {
		t.Fatalf("participants = %d", len(parts))
	}
	if r := e.Do("GET", "/events/"+pubID+"/participants", nil, Req{Token: other.Token}); r.Status != 403 {
		t.Fatalf("outsider participants: %d", r.Status)
	}
	// non-organizer cannot patch; organizer can
	if r := e.Do("PATCH", "/events/"+pubID, map[string]any{"name": "Hack"}, Req{Token: pilot.Token}); r.Status != 403 {
		t.Fatalf("participant patch: %d", r.Status)
	}
	p := e.Must(e.Do("PATCH", "/events/"+pubID, map[string]any{"settings": map[string]any{"registration_open": false}}, Req{Token: org.Token}), 200).JSON()
	if p["settings"].(map[string]any)["registration_open"] != false {
		t.Fatal("patch did not apply")
	}
	// registration closed
	if r := e.Do("POST", "/events/"+pubID+"/join", nil, Req{Token: other.Token}); r.Status != 403 {
		t.Fatalf("join closed event: %d", r.Status)
	}
	// last organizer cannot leave
	if r := e.Do("POST", "/events/"+pubID+"/leave", nil, Req{Token: org.Token}); r.Status != 409 {
		t.Fatalf("last organizer leave: %d", r.Status)
	}
	e.Must(e.Do("POST", "/events/"+pubID+"/leave", nil, Req{Token: pilot.Token}), 204)
	// organizers see removed members, participants do not
	all := e.Must(e.Do("GET", "/events/"+pubID+"/participants", nil, Req{Token: org.Token}), 200).JSON()["items"].([]any)
	if len(all) != 2 {
		t.Fatalf("organizer should see removed participant, got %d", len(all))
	}
	// launch sites: organizer writes, anyone with access reads
	site := e.Must(e.Do("POST", "/events/"+pubID+"/launch-sites", map[string]any{"name": "Kalkış", "position": map[string]any{"lat": 37.1, "lon": 29.3}, "elevation_m": 1800}, Req{Token: org.Token}), 201).JSON()
	if r := e.Do("POST", "/events/"+pubID+"/launch-sites", map[string]any{"name": "Y"}, Req{Token: other.Token}); r.Status != 403 {
		t.Fatalf("outsider site create: %d", r.Status)
	}
	if r := e.Do("PATCH", "/events/"+pubID+"/launch-sites/"+site["id"].(string), map[string]any{"position": nil, "is_verified": true}, Req{Token: org.Token}); r.Status != 422 {
		t.Fatalf("verified site without position must be rejected: %d", r.Status)
	}
	// report
	rep := e.Must(e.Do("GET", "/events/"+pubID+"/report", nil, Req{Token: org.Token}), 200).JSON()
	if rep["participation"] == nil {
		t.Fatal("report missing participation")
	}
	if r := e.Do("GET", "/events/"+pubID+"/report", nil, Req{Token: pilot.Token}); r.Status != 403 && r.Status != 404 {
		t.Fatalf("report for non-organizer: %d", r.Status)
	}
	// archive
	a := e.Must(e.Do("POST", "/events/"+pubID+"/archive", nil, Req{Token: org.Token}), 200).JSON()
	if a["status"] != "archived" {
		t.Fatal("not archived")
	}
	// audit trail exists
	var n int
	_ = e.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_logs WHERE action LIKE 'event.%'`).Scan(&n)
	if n < 6 {
		t.Fatalf("event audit rows = %d", n)
	}
}
