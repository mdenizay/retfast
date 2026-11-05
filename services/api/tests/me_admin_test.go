package tests

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/auth"
	"github.com/mdenizay/retfast/services/api/internal/tracking"
	"github.com/mdenizay/retfast/services/api/internal/users"
)

func TestMeDevicesExportDeletion(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := context.Background()
	u := e.Register("Privacy Pilot")
	me := e.Must(e.Do("PATCH", "/me", map[string]any{"full_name": "Privacy Pilot 2", "preferences": map[string]any{"units": "imperial", "public_profile": true}}, Req{Token: u.Token}), 200).JSON()
	if me["full_name"] != "Privacy Pilot 2" || me["preferences"].(map[string]any)["units"] != "imperial" {
		t.Fatalf("patch me: %v", me)
	}
	if r := e.Do("PATCH", "/me", map[string]any{"preferences": map[string]any{"units": "furlongs"}}, Req{Token: u.Token}); r.Status != 422 {
		t.Fatalf("bad units: %d", r.Status)
	}
	pilot := e.Must(e.Do("PATCH", "/me/pilot", map[string]any{"wing": "Ozone Rush 6", "license_no": "TR-123", "emergency_contact_phone": "+90 555", "phone": "+90 532 000 0000", "nationality": "tr"}, Req{Token: u.Token}), 200).JSON()["pilot"].(map[string]any)
	if pilot["wing"] != "Ozone Rush 6" || pilot["nationality"] != "TR" || pilot["phone"] != "+90 532 000 0000" {
		t.Fatalf("pilot: %v", pilot)
	}
	if r := e.Do("PATCH", "/me/pilot", map[string]any{"public_id": "hacker"}, Req{Token: u.Token}); r.Status != 422 {
		t.Fatalf("public_id change: %d", r.Status)
	}
	// public profile never exposes licence / emergency data
	pub := e.Must(e.Do("GET", "/pilots/"+pilot["public_id"].(string), nil, Req{}), 200)
	if strings.Contains(string(pub.Body), "TR-123") || strings.Contains(string(pub.Body), "+90") {
		t.Fatalf("public profile leaks: %s", pub.Body)
	}
	e.Must(e.Do("PATCH", "/me", map[string]any{"preferences": map[string]any{"public_profile": false}}, Req{Token: u.Token}), 200)
	if r := e.Do("GET", "/pilots/"+pilot["public_id"].(string), nil, Req{}); r.Status != 404 {
		t.Fatalf("private profile visible: %d", r.Status)
	}
	// devices upsert
	for i := 0; i < 2; i++ {
		e.Must(e.Do("POST", "/me/devices", map[string]any{"device_id": "dev-1", "platform": "ios", "apns_token": "abc", "app_version": "1.0", "os_version": "18.1"}, Req{Token: u.Token}), 204)
	}
	var n int
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM devices WHERE user_id = $1`, u.ID).Scan(&n)
	if n != 1 {
		t.Fatalf("devices = %d", n)
	}
	// export includes flights and positions, never the push token
	fid := e.CreateFlight(u, nil)
	e.MustBatch(u, fid, uuid.New(), seqs(0, 2, time.Now().Add(-time.Minute)))
	ex := e.Must(e.Do("GET", "/me/export", nil, Req{Token: u.Token}), 200)
	var doc struct {
		Me      map[string]any   `json:"me"`
		Devices []map[string]any `json:"devices"`
		Flights []struct {
			Positions []any `json:"positions"`
		} `json:"flights"`
	}
	if err := json.Unmarshal(ex.Body, &doc); err != nil {
		t.Fatalf("export is not JSON: %v %s", err, ex.Body)
	}
	if len(doc.Flights) != 1 || len(doc.Flights[0].Positions) != 3 || len(doc.Devices) != 1 || strings.Contains(string(ex.Body), `"abc"`) {
		t.Fatalf("export: %s", ex.Body)
	}

	// deletion request, cancel, request again, worker completes after grace
	dr := e.Must(e.Do("POST", "/me/deletion-request", map[string]any{"reason": "test"}, Req{Token: u.Token}), 202).JSON()
	if dr["status"] != "pending" {
		t.Fatal(dr)
	}
	e.Must(e.Do("DELETE", "/me/deletion-request", nil, Req{Token: u.Token}), 200)
	e.Must(e.Do("POST", "/me/deletion-request", nil, Req{Token: u.Token}), 202)
	w := &users.DeletionWorker{Pool: e.Pool, Hash: auth.HashPassword, Log: e.App.Log}
	if done, _ := w.ProcessOnce(ctx); done != 0 {
		t.Fatal("deleted before the grace period")
	}
	_, _ = e.Pool.Exec(ctx, `UPDATE account_deletion_requests SET scheduled_for = now() - interval '1 second' WHERE user_id = $1`, u.ID)
	if done, err := w.ProcessOnce(ctx); err != nil || done != 1 {
		t.Fatalf("deletion: %d %v", done, err)
	}
	var email, name string
	var flights, positions, devices int
	_ = e.Pool.QueryRow(ctx, `SELECT email, full_name FROM users WHERE id = $1`, u.ID).Scan(&email, &name)
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM flight_sessions WHERE pilot_id = $1`, u.ID).Scan(&flights)
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM flight_positions WHERE flight_id = $1`, fid).Scan(&positions)
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM devices WHERE user_id = $1`, u.ID).Scan(&devices)
	if !strings.HasSuffix(email, "@deleted.invalid") || name == "Privacy Pilot 2" || flights+positions+devices != 0 {
		t.Fatalf("not anonymised: %s %s %d %d %d", email, name, flights, positions, devices)
	}
	e.App.Auth.Invalidate(u.ID)
	if r := e.Do("GET", "/me", nil, Req{Token: u.Token}); r.Status != 401 {
		t.Fatalf("deleted account still authenticated: %d", r.Status)
	}
}

func TestNotificationsAndAdmin(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := context.Background()
	adm := e.Admin("Admin")
	u := e.Register("Plain")
	org := e.Register("Org")
	ev := e.CreateEvent(adm, nil)
	e.AssignOrganizer(adm, ev["id"], org)
	e.AddMember(org, ev["id"], u, "pilot")
	// notification produced by being added
	ns := e.Must(e.Do("GET", "/notifications", nil, Req{Token: u.Token}), 200).JSON()["items"].([]any)
	if len(ns) != 1 || ns[0].(map[string]any)["kind"] != "event_update" {
		t.Fatalf("notifications: %v", ns)
	}
	nid := ns[0].(map[string]any)["id"].(string)
	if r := e.Do("POST", "/notifications/"+nid+"/read", nil, Req{Token: org.Token}); r.Status != 404 {
		t.Fatalf("reading someone else's notification: %d", r.Status)
	}
	e.Must(e.Do("POST", "/notifications/"+nid+"/read", nil, Req{Token: u.Token}), 204)
	e.Must(e.Do("POST", "/notifications/read-all", nil, Req{Token: u.Token}), 204)
	// push records: no device → no_device; with device → unconfigured (APNs not configured)
	Eventually(t, 10*time.Second, func() bool {
		var s string
		_ = e.Pool.QueryRow(ctx, `SELECT push_status FROM notification_records WHERE id = $1`, nid).Scan(&s)
		return s == "no_device"
	}, "push status no_device")

	// admin endpoints
	if r := e.Do("GET", "/admin/users", nil, Req{Token: u.Token}); r.Status != 403 {
		t.Fatalf("non-admin: %d", r.Status)
	}
	list := e.Must(e.Do("GET", "/admin/users?q=Plain", nil, Req{Token: adm.Token}), 200).JSON()["items"].([]any)
	if len(list) != 1 {
		t.Fatalf("admin users: %v", list)
	}
	up := e.Must(e.Do("PATCH", "/admin/users/"+u.ID.String(), map[string]any{"is_platform_admin": true}, Req{Token: adm.Token}), 200).JSON()
	if up["is_platform_admin"] != true || len(up["roles"].([]any)) != 1 {
		t.Fatalf("roles: %v", up)
	}
	if r := e.Do("PATCH", "/admin/users/"+adm.ID.String(), map[string]any{"is_platform_admin": false}, Req{Token: adm.Token}); r.Status != 422 {
		t.Fatalf("self-demotion: %d", r.Status)
	}
	// role change takes effect: the user can now use admin endpoints
	e.Must(e.Do("GET", "/admin/stats", nil, Req{Token: u.Token}), 200)
	e.Must(e.Do("PATCH", "/admin/users/"+u.ID.String(), map[string]any{"is_platform_admin": false}, Req{Token: adm.Token}), 200)
	if r := e.Do("GET", "/admin/stats", nil, Req{Token: u.Token}); r.Status != 403 {
		t.Fatalf("demoted admin: %d", r.Status)
	}
	e.Must(e.Do("PATCH", "/admin/users/"+u.ID.String(), map[string]any{"disabled": true}, Req{Token: adm.Token}), 200)
	if r := e.Do("GET", "/me", nil, Req{Token: u.Token}); r.Status != 401 {
		t.Fatalf("disabled user: %d", r.Status)
	}
	if r := e.Do("POST", "/auth/login", map[string]any{"email": u.Email, "password": u.Password, "client": "ios"}, Req{}); r.Status != 401 {
		t.Fatalf("disabled login: %d", r.Status)
	}
	e.Must(e.Do("POST", "/admin/users/"+u.ID.String()+"/reset-password", nil, Req{Token: adm.Token}), 202)
	audit := e.Must(e.Do("GET", "/admin/audit?action=admin", nil, Req{Token: adm.Token}), 200).JSON()["items"].([]any)
	if len(audit) < 3 {
		t.Fatalf("admin audit entries: %d", len(audit))
	}
	stats := e.Must(e.Do("GET", "/admin/stats", nil, Req{Token: adm.Token}), 200).JSON()
	if stats["active_events"].(float64) != 1 || stats["system_status"] == nil || stats["open_retrievals"] == nil || stats["pending_applications"] == nil {
		t.Fatalf("stats: %v", stats)
	}
	// /users/search for organizers and admins only
	found := e.Must(e.Do("GET", "/users/search?q=Org", nil, Req{Token: org.Token}), 200).JSON()["items"].([]any)
	if len(found) != 1 || found[0].(map[string]any)["email"] != org.Email {
		t.Fatalf("search: %v", found)
	}
	e.Must(e.Do("GET", "/users/search?q=Plain", nil, Req{Token: adm.Token}), 200)
	plain := e.Register("Plain 2")
	if r := e.Do("GET", "/users/search?q=a", nil, Req{Token: plain.Token}); r.Status != 403 {
		t.Fatalf("user search for a plain user: %d", r.Status)
	}
}

func TestPartitionMaintenanceMovesDefaultRows(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := context.Background()
	u := e.Register("Partition Pilot")
	fid := e.CreateFlight(u, nil)
	future := time.Now().UTC().AddDate(0, 6, 0)
	month := time.Date(future.Year(), future.Month(), 15, 0, 0, 0, 0, time.UTC)
	// a row that landed in the default partition because its month had no partition yet
	if _, err := e.Pool.Exec(ctx, `INSERT INTO flight_positions (flight_id, seq, sample_id, t, received_at, lat, lon, h_acc_m)
		VALUES ($1, 1, $2, now(), $3, 37.07, 29.34, 5)`, fid, uuid.New(), month); err != nil {
		t.Fatal(err)
	}
	created, err := tracking.EnsurePartitions(ctx, e.Pool, month, 1)
	if err != nil {
		t.Fatal(err)
	}
	want := tracking.PartitionName(month)
	found := false
	for _, c := range created {
		found = found || c == want
	}
	if !found {
		t.Fatalf("partition %s not created: %v", want, created)
	}
	var part string
	_ = e.Pool.QueryRow(ctx, `SELECT tableoid::regclass::text FROM flight_positions WHERE flight_id = $1`, fid).Scan(&part)
	if !strings.HasSuffix(part, want) {
		t.Fatalf("row is in %s, want %s", part, want)
	}
	var gist int
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM pg_indexes WHERE tablename = $1 AND indexdef ILIKE '%gist%'`, want).Scan(&gist)
	if gist != 1 {
		t.Fatalf("moved partition has %d GIST indexes", gist)
	}
	// idempotent
	if again, err := tracking.EnsurePartitions(ctx, e.Pool, month, 1); err != nil || len(again) != 0 {
		t.Fatalf("second run: %v %v", again, err)
	}
}
