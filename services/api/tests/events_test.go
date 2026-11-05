package tests

import (
	"context"
	"sync"
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
	if r1.UsersCreated != 5 || r1.EventsCreated != 1 || r1.SitesCreated != 1 || r1.OrganizersCreated != 2 || r1.MembershipsCreated != 5 {
		t.Fatalf("first run: %+v", r1)
	}
	var startsBefore string
	_ = e.Pool.QueryRow(ctx, `SELECT starts_at::text FROM events`).Scan(&startsBefore)
	// a role changed in the app must survive re-seeding
	if _, err := e.Pool.Exec(ctx, `UPDATE event_members SET role = 'observer' FROM users u WHERE u.id = user_id AND u.email = 'emre@retfast.com'`); err != nil {
		t.Fatal(err)
	}
	r2, err := seed.Run(ctx, e.Pool, seed.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if r2.UsersCreated != 0 || r2.EventsCreated != 0 || r2.SitesCreated != 0 || r2.ScheduleUpdated != 0 || r2.OrganizersCreated != 0 ||
		r2.MembershipsCreated != 0 || r2.Memberships != 5 || r2.Organizers != 2 {
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
	if n := count(`SELECT count(*) FROM user_roles r JOIN users u ON u.id = r.user_id
		WHERE r.role = 'platform_admin' AND u.email IN ('deniz@retfast.com', 'altay@retfast.com')`); n != 2 {
		t.Fatalf("admins = %d", n)
	}
	if n := count(`SELECT count(*) FROM user_roles`); n != 2 {
		t.Fatalf("global roles = %d", n)
	}
	if n := count(`SELECT count(*) FROM event_organizers o JOIN users u ON u.id = o.user_id
		WHERE u.email IN ('deniz@retfast.com', 'altay@retfast.com')`); n != 2 {
		t.Fatalf("organizers = %d", n)
	}
	want := map[string]string{"deniz@retfast.com": "pilot", "altay@retfast.com": "observer", "tecelli@retfast.com": "pilot",
		"emre@retfast.com": "observer" /* changed above, kept */, "kubra@retfast.com": "retriever"}
	rows, err := e.Pool.Query(ctx, `SELECT u.email, m.role FROM event_members m JOIN users u ON u.id = m.user_id WHERE m.status = 'active'`)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for rows.Next() {
		var em, role string
		_ = rows.Scan(&em, &role)
		got[em] = role
	}
	rows.Close()
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("membership %s = %q, want %q (all %v)", k, got[k], v, got)
		}
	}
	if n := count(`SELECT count(*) FROM users WHERE must_change_password AND email_verified_at IS NOT NULL
		AND password_expires_at BETWEEN now() + interval '6 days 23 hours' AND now() + interval '7 days 1 minute'`); n != 5 {
		t.Fatalf("bootstrap flags = %d", n)
	}
	if n := count(`SELECT count(*) FROM pilot_profiles p JOIN users u ON u.id = p.user_id WHERE p.display_name = u.full_name`); n != 5 {
		t.Fatalf("profiles = %d", n)
	}
	var startsAfter string
	_ = e.Pool.QueryRow(ctx, `SELECT starts_at::text FROM events`).Scan(&startsAfter)
	if startsBefore != startsAfter {
		t.Fatal("re-seed changed the demo window without flags")
	}
	// the API view of the demo event
	ev := e.Must(e.Do("GET", "/events/"+seed.DemoSlug, nil, Req{}), 200).JSON()
	if ev["description"] != seed.DemoDescription || ev["is_demo"] != true || ev["status"] != "active" || ev["center_is_approximate"] != true ||
		ev["visibility"] != "public" || ev["name"] != seed.DemoName {
		t.Fatalf("demo event: %v", ev)
	}
	settings := ev["settings"].(map[string]any)
	for k, v := range map[string]bool{"applications_open": true, "live_tracking": true, "public_live_map": false,
		"pilots_see_each_other": true, "landing_prompt": true} {
		if settings[k] != v {
			t.Fatalf("setting %s = %v", k, settings[k])
		}
	}
	counts := ev["counts"].(map[string]any)
	if counts["pilots"].(float64) != 2 || counts["observers"].(float64) != 2 || counts["retrievers"].(float64) != 1 || counts["pending_applications"] != nil {
		t.Fatalf("counts = %v", counts)
	}
	if len(ev["organizers"].([]any)) != 2 {
		t.Fatalf("organizers = %v", ev["organizers"])
	}
	sites := e.Must(e.Do("GET", "/events/"+seed.DemoSlug+"/launch-sites", nil, Req{}), 200).JSON()["items"].([]any)
	if len(sites) != 1 || sites[0].(map[string]any)["position"] != nil {
		t.Fatalf("sites = %v", sites)
	}
}

func TestEventCreationAndOrganizers(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	adm := e.Admin("Platform Admin")
	org := e.Register("Organizer One")
	plain := e.Register("Plain User")

	// only platform admins create events (organizers of other events cannot either)
	if r := e.Do("POST", "/events", map[string]any{"name": "x", "starts_at": "2026-11-04T10:00:00Z", "ends_at": "2026-11-05T10:00:00Z"}, Req{Token: plain.Token}); r.Status != 403 {
		t.Fatalf("plain user create event: %d", r.Status)
	}
	pub := e.CreateEvent(adm, map[string]any{"name": "Açık Kupa 2026", "organizers": []any{org.ID}})
	if pub["slug"] != "acik-kupa-2026" {
		t.Fatalf("created: %v", pub)
	}
	st := pub["settings"].(map[string]any)
	if st["public_live_map"] != false || st["pilots_see_each_other"] != true || st["landing_prompt"] != true || st["applications_open"] != true {
		t.Fatalf("default settings: %v", st)
	}
	if orgs := pub["organizers"].([]any); len(orgs) != 1 || orgs[0].(map[string]any)["user_id"] != org.ID.String() {
		t.Fatalf("organizers: %v", pub["organizers"])
	}
	id := pub["id"].(string)
	if r := e.Do("POST", "/events", map[string]any{"name": "y", "starts_at": "2026-11-04T10:00:00Z", "ends_at": "2026-11-05T10:00:00Z"}, Req{Token: org.Token}); r.Status != 403 {
		t.Fatalf("organizer create event: %d", r.Status)
	}
	me := e.Must(e.Do("GET", "/events/"+id, nil, Req{Token: org.Token}), 200).JSON()["me"].(map[string]any)
	if me["is_organizer"] != true || me["role"] != nil {
		t.Fatalf("me: %v", me)
	}
	// organizer assignment is admin-only
	other := e.Register("Second Org")
	if r := e.Do("POST", "/events/"+id+"/organizers", map[string]any{"user_id": other.ID}, Req{Token: org.Token}); r.Status != 403 {
		t.Fatalf("organizer assigning organizers: %d", r.Status)
	}
	e.AssignOrganizer(adm, id, other)
	e.Must(e.Do("POST", "/events/"+id+"/organizers", map[string]any{"user_id": other.ID}, Req{Token: adm.Token}), 200) // idempotent
	if l := e.Must(e.Do("GET", "/events/"+id+"/organizers", nil, Req{Token: org.Token}), 200).JSON()["items"].([]any); len(l) != 2 {
		t.Fatalf("organizers list: %v", l)
	}
	if r := e.Do("GET", "/events/"+id+"/organizers", nil, Req{Token: plain.Token}); r.Status != 403 {
		t.Fatalf("outsider organizers: %d", r.Status)
	}
	if r := e.Do("DELETE", "/events/"+id+"/organizers/"+other.ID.String(), nil, Req{Token: org.Token}); r.Status != 403 {
		t.Fatalf("organizer removing organizer: %d", r.Status)
	}
	e.Must(e.Do("DELETE", "/events/"+id+"/organizers/"+other.ID.String(), nil, Req{Token: adm.Token}), 204)
	// the organizer manages the event
	p := e.Must(e.Do("PATCH", "/events/"+id, map[string]any{"settings": map[string]any{"public_live_map": true}}, Req{Token: org.Token}), 200).JSON()
	if p["settings"].(map[string]any)["public_live_map"] != true {
		t.Fatal("patch did not apply")
	}
	if r := e.Do("PATCH", "/events/"+id, map[string]any{"name": "Hack"}, Req{Token: plain.Token}); r.Status != 403 {
		t.Fatalf("plain patch: %d", r.Status)
	}
	// restricted and draft events are hidden from outsiders
	restricted := e.CreateEvent(adm, map[string]any{"name": "Kapalı Kamp", "visibility": "restricted"})
	draft := e.CreateEvent(adm, map[string]any{"name": "Taslak", "status": "draft", "organizers": []any{org.ID}})
	if r := e.Do("GET", "/events/"+restricted["id"].(string), nil, Req{Token: plain.Token}); r.Status != 404 {
		t.Fatalf("restricted for outsider: %d", r.Status)
	}
	if r := e.Do("GET", "/events/"+draft["id"].(string), nil, Req{}); r.Status != 404 {
		t.Fatalf("draft for guest: %d", r.Status)
	}
	e.Must(e.Do("GET", "/events/"+draft["id"].(string), nil, Req{Token: org.Token}), 200)
	for _, it := range e.Must(e.Do("GET", "/events", nil, Req{}), 200).JSON()["items"].([]any) {
		if x := it.(map[string]any)["id"]; x == restricted["id"] || x == draft["id"] {
			t.Fatal("guest list leaks restricted/draft event")
		}
	}
	mine := e.Must(e.Do("GET", "/events?mine=true", nil, Req{Token: org.Token}), 200).JSON()["items"].([]any)
	if len(mine) != 2 { // the public event and the draft they organize (restricted one is not theirs)
		t.Fatalf("mine = %d", len(mine))
	}
	// launch sites: organizer writes
	site := e.Must(e.Do("POST", "/events/"+id+"/launch-sites", map[string]any{"name": "Kalkış", "position": map[string]any{"lat": 37.1, "lon": 29.3}, "elevation_m": 1800}, Req{Token: org.Token}), 201).JSON()
	if r := e.Do("POST", "/events/"+id+"/launch-sites", map[string]any{"name": "Y"}, Req{Token: plain.Token}); r.Status != 403 {
		t.Fatalf("outsider site create: %d", r.Status)
	}
	if r := e.Do("PATCH", "/events/"+id+"/launch-sites/"+site["id"].(string), map[string]any{"position": nil, "is_verified": true}, Req{Token: org.Token}); r.Status != 422 {
		t.Fatalf("verified site without position must be rejected: %d", r.Status)
	}
	rep := e.Must(e.Do("GET", "/events/"+id+"/report", nil, Req{Token: org.Token}), 200).JSON()
	if rep["members"] == nil || rep["retrievals"] == nil {
		t.Fatalf("report: %v", rep)
	}
	if r := e.Do("GET", "/events/"+id+"/report", nil, Req{Token: plain.Token}); r.Status != 403 {
		t.Fatalf("report for outsider: %d", r.Status)
	}
	a := e.Must(e.Do("POST", "/events/"+id+"/archive", nil, Req{Token: org.Token}), 200).JSON()
	if a["status"] != "archived" {
		t.Fatal("not archived")
	}
	var n int
	_ = e.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_logs WHERE action LIKE 'event.%'`).Scan(&n)
	if n < 8 {
		t.Fatalf("event audit rows = %d", n)
	}
}

func TestApplicationsAndMembers(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	adm := e.Admin("Admin")
	org := e.Register("Org")
	ev := e.CreateEvent(adm, map[string]any{"organizers": []any{org.ID}})
	id := ev["id"].(string)
	alice := e.Register("Alice")
	bob := e.Register("Bob")
	carol := e.Register("Carol")

	// apply
	app := e.Must(e.Do("POST", "/events/"+id+"/applications", map[string]any{"message": "Merhaba"}, Req{Token: alice.Token}), 201).JSON()
	if _, has := app["requested_role"]; has {
		t.Fatal("applications carry no role")
	}
	if app["status"] != "pending" || app["message"] != "Merhaba" || app["granted_role"] != nil || app["user"].(map[string]any)["user_id"] != alice.ID.String() {
		t.Fatalf("application: %v", app)
	}
	if r := e.Do("POST", "/events/"+id+"/applications", nil, Req{Token: alice.Token}); r.Status != 409 {
		t.Fatalf("duplicate pending: %d", r.Status)
	}
	// concurrent duplicate applications: exactly one wins (partial unique index)
	var wg sync.WaitGroup
	codes := make([]int, 4)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i] = e.Do("POST", "/events/"+id+"/applications", nil, Req{Token: bob.Token}).Status
		}(i)
	}
	wg.Wait()
	created := 0
	for _, c := range codes {
		switch c {
		case 201:
			created++
		case 409:
		default:
			t.Fatalf("concurrent apply status %d", c)
		}
	}
	if created != 1 {
		t.Fatalf("concurrent applications created %d", created)
	}
	me := e.Must(e.Do("GET", "/events/"+id, nil, Req{Token: alice.Token}), 200).JSON()["me"].(map[string]any)
	if me["application"].(map[string]any)["status"] != "pending" || me["role"] != nil {
		t.Fatalf("me before approval: %v", me)
	}
	// only organizers/admins list and decide
	if r := e.Do("GET", "/events/"+id+"/applications", nil, Req{Token: alice.Token}); r.Status != 403 {
		t.Fatalf("applicant listing: %d", r.Status)
	}
	pend := e.Must(e.Do("GET", "/events/"+id+"/applications?status=pending", nil, Req{Token: org.Token}), 200).JSON()["items"].([]any)
	if len(pend) != 2 {
		t.Fatalf("pending = %d", len(pend))
	}
	cnt := e.Must(e.Do("GET", "/events/"+id, nil, Req{Token: org.Token}), 200).JSON()["counts"].(map[string]any)
	if cnt["pending_applications"].(float64) != 2 {
		t.Fatalf("organizer counts: %v", cnt)
	}
	appID := app["id"].(string)
	if r := e.Do("POST", "/events/"+id+"/applications/"+appID+"/approve", map[string]any{"role": "retriever"}, Req{Token: bob.Token}); r.Status != 403 {
		t.Fatalf("non-organizer approve: %d", r.Status)
	}
	// approve requires the organizer to choose the role
	if r := e.Do("POST", "/events/"+id+"/applications/"+appID+"/approve", map[string]any{"note": "x"}, Req{Token: org.Token}); r.Status != 422 {
		t.Fatalf("approve without role: %d", r.Status)
	}
	if r := e.Do("POST", "/events/"+id+"/applications/"+appID+"/approve", map[string]any{"role": "captain"}, Req{Token: org.Token}); r.Status != 422 {
		t.Fatalf("approve with bad role: %d", r.Status)
	}
	ap := e.Must(e.Do("POST", "/events/"+id+"/applications/"+appID+"/approve", map[string]any{"role": "retriever", "note": "Toplayıcı lazım"}, Req{Token: org.Token}), 200).JSON()
	if ap["status"] != "approved" || ap["granted_role"] != "retriever" || ap["decided_by"].(map[string]any)["user_id"] != org.ID.String() {
		t.Fatalf("approved: %v", ap)
	}
	if r := e.Do("POST", "/events/"+id+"/applications/"+appID+"/reject", nil, Req{Token: org.Token}); r.Status != 409 {
		t.Fatalf("re-deciding: %d", r.Status)
	}
	me = e.Must(e.Do("GET", "/events/"+id, nil, Req{Token: alice.Token}), 200).JSON()["me"].(map[string]any)
	if me["role"] != "retriever" || me["application"] != nil {
		t.Fatalf("me after approval: %v", me)
	}
	ns := e.Must(e.Do("GET", "/notifications", nil, Req{Token: alice.Token}), 200).JSON()["items"].([]any)
	if len(ns) == 0 || ns[0].(map[string]any)["kind"] != "application" {
		t.Fatalf("applicant notification: %v", ns)
	}
	if r := e.Do("POST", "/events/"+id+"/applications", nil, Req{Token: alice.Token}); r.Status != 409 {
		t.Fatalf("member applying again: %d", r.Status)
	}
	// reject
	bobApp := ""
	for _, x := range pend {
		if m := x.(map[string]any); m["user"].(map[string]any)["user_id"] == bob.ID.String() {
			bobApp = m["id"].(string)
		}
	}
	rj := e.Must(e.Do("POST", "/events/"+id+"/applications/"+bobApp+"/reject", map[string]any{"note": "Kontenjan dolu"}, Req{Token: org.Token}), 200).JSON()
	if rj["status"] != "rejected" || rj["decision_note"] != "Kontenjan dolu" {
		t.Fatalf("rejected: %v", rj)
	}
	me = e.Must(e.Do("GET", "/events/"+id, nil, Req{Token: bob.Token}), 200).JSON()["me"].(map[string]any)
	if me["application"].(map[string]any)["status"] != "rejected" {
		t.Fatalf("bob me: %v", me)
	}
	// withdraw: only the applicant
	ca := e.Must(e.Do("POST", "/events/"+id+"/applications", nil, Req{Token: carol.Token}), 201).JSON()
	if r := e.Do("POST", "/events/"+id+"/applications/"+ca["id"].(string)+"/withdraw", nil, Req{Token: bob.Token}); r.Status != 404 {
		t.Fatalf("withdraw by other: %d", r.Status)
	}
	wd := e.Must(e.Do("POST", "/events/"+id+"/applications/"+ca["id"].(string)+"/withdraw", nil, Req{Token: carol.Token}), 200).JSON()
	if wd["status"] != "withdrawn" {
		t.Fatalf("withdrawn: %v", wd)
	}
	// closed applications
	e.Must(e.Do("PATCH", "/events/"+id, map[string]any{"settings": map[string]any{"applications_open": false}}, Req{Token: org.Token}), 200)
	if r := e.Do("POST", "/events/"+id+"/applications", nil, Req{Token: carol.Token}); r.Status != 403 {
		t.Fatalf("closed applications: %d", r.Status)
	}

	// members: direct add, role change, phones only for organizers, removal, leave
	e.Must(e.Do("PATCH", "/me/pilot", map[string]any{"phone": "+90 555 111 2233"}, Req{Token: alice.Token}), 200)
	e.AddMember(org, id, carol, "pilot")
	if r := e.Do("POST", "/events/"+id+"/members", map[string]any{"user_id": bob.ID, "role": "pilot"}, Req{Token: alice.Token}); r.Status != 403 {
		t.Fatalf("member adding members: %d", r.Status)
	}
	orgView := e.Must(e.Do("GET", "/events/"+id+"/members", nil, Req{Token: org.Token}), 200)
	found := false
	for _, x := range orgView.JSON()["items"].([]any) {
		m := x.(map[string]any)
		if m["user_id"] == alice.ID.String() {
			found = m["phone"] == "+90 555 111 2233" && m["role"] == "retriever"
		}
	}
	if !found {
		t.Fatalf("organizer member view: %s", orgView.Body)
	}
	memView := e.Must(e.Do("GET", "/events/"+id+"/members", nil, Req{Token: carol.Token}), 200)
	for _, x := range memView.JSON()["items"].([]any) {
		if _, has := x.(map[string]any)["phone"]; has {
			t.Fatalf("member sees phones: %s", memView.Body)
		}
	}
	if r := e.Do("GET", "/events/"+id+"/members", nil, Req{Token: bob.Token}); r.Status != 403 {
		t.Fatalf("outsider members: %d", r.Status)
	}
	var reveals int
	_ = e.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_logs WHERE action = 'privacy.phone_revealed' AND actor_id = $1`, org.ID).Scan(&reveals)
	if reveals != 1 {
		t.Fatalf("phone reveal audits = %d", reveals)
	}
	ch := e.Must(e.Do("PATCH", "/events/"+id+"/members/"+carol.ID.String(), map[string]any{"role": "observer"}, Req{Token: org.Token}), 200).JSON()
	if ch["role"] != "observer" {
		t.Fatalf("role change: %v", ch)
	}
	if r := e.Do("PATCH", "/events/"+id+"/members/"+bob.ID.String(), map[string]any{"role": "observer"}, Req{Token: org.Token}); r.Status != 404 {
		t.Fatalf("patch non-member: %d", r.Status)
	}
	var auditRole int
	_ = e.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_logs WHERE action = 'event.member_role_changed' AND details->>'to' = 'observer'`).Scan(&auditRole)
	if auditRole != 1 {
		t.Fatal("role change not audited")
	}
	e.Must(e.Do("POST", "/events/"+id+"/leave", nil, Req{Token: carol.Token}), 204)
	if r := e.Do("POST", "/events/"+id+"/leave", nil, Req{Token: carol.Token}); r.Status != 404 {
		t.Fatalf("leave twice: %d", r.Status)
	}
	e.Must(e.Do("DELETE", "/events/"+id+"/members/"+alice.ID.String(), nil, Req{Token: org.Token}), 204)
	me = e.Must(e.Do("GET", "/events/"+id, nil, Req{Token: alice.Token}), 200).JSON()["me"].(map[string]any)
	if me["role"] != nil {
		t.Fatalf("removed member still has a role: %v", me)
	}
	all := e.Must(e.Do("GET", "/events/"+id+"/members", nil, Req{Token: org.Token}), 200).JSON()["items"].([]any)
	removed := 0
	for _, x := range all {
		if x.(map[string]any)["status"] == "removed" {
			removed++
		}
	}
	if removed != 2 {
		t.Fatalf("organizer sees removed members: %d", removed)
	}
}
