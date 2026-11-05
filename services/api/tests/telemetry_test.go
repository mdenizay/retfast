package tests

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func seqs(from, to int, t0 time.Time) []map[string]any {
	out := []map[string]any{}
	for i := from; i <= to; i++ {
		k := i % 3000 // keep coordinates and timestamps plausible for large seq ranges
		out = append(out, Sample(i, t0.Add(time.Duration(k)*time.Second), 37.07+float64(k)*0.0001, 29.34, 2000+float64(k%500)))
	}
	return out
}

func TestTelemetryIdempotencyAndDedup(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := context.Background()
	u := e.Register("Telemetry Pilot")
	fid := e.CreateFlight(u, nil)
	t0 := time.Now().Add(-5 * time.Minute)

	// same batch twice → identical classification
	b1 := uuid.New()
	s1 := seqs(0, 9, t0)
	r, res1 := e.Batch(u, fid, b1, s1)
	e.Must(r, 200)
	if len(res1.Accepted) != 10 || len(res1.Duplicate) != 0 || *res1.MaxAckedSeq != 9 {
		t.Fatalf("first batch: %+v", res1)
	}
	_, res1b := e.Batch(u, fid, b1, s1)
	if !reflect.DeepEqual(res1.Accepted, res1b.Accepted) || !reflect.DeepEqual(res1.Duplicate, res1b.Duplicate) {
		t.Fatalf("replay differs: %+v vs %+v", res1, res1b)
	}

	// overlapping batch (different batch id, same samples 5..9 plus new 10..14)
	over := append(append([]map[string]any{}, s1[5:]...), seqs(10, 14, t0)...)
	_, res2 := e.Batch(u, fid, uuid.New(), over)
	if !reflect.DeepEqual(res2.Duplicate, []int64{5, 6, 7, 8, 9}) || !reflect.DeepEqual(res2.Accepted, []int64{10, 11, 12, 13, 14}) {
		t.Fatalf("overlap: %+v", res2)
	}

	// out of order / late batch (seq 20..24 first, then 15..19)
	_, r3 := e.Batch(u, fid, uuid.New(), seqs(20, 24, t0))
	_, r4 := e.Batch(u, fid, uuid.New(), seqs(15, 19, t0))
	if len(r3.Accepted) != 5 || len(r4.Accepted) != 5 {
		t.Fatalf("out-of-order: %+v %+v", r3, r4)
	}
	var dirty bool
	_ = e.Pool.QueryRow(ctx, `SELECT stats_dirty FROM flight_sessions WHERE id = $1`, fid).Scan(&dirty)
	if !dirty {
		t.Fatal("late samples must mark stats dirty")
	}
	if n, err := e.App.Maint.RecomputeDirty(ctx, 10); err != nil || n != 1 {
		t.Fatalf("recompute: %d %v", n, err)
	}

	// sample id collision: reuse id of seq 3 for a new seq 100 → sample_conflict
	collide := Sample(100, t0.Add(100*time.Second), 37.08, 29.34, 2100)
	collide["id"] = s1[3]["id"]
	// same seq with a different id → sample_conflict
	sameSeq := Sample(4, t0.Add(4*time.Second), 37.07, 29.34, 2000)
	// in-batch repeat of the same sample → duplicate
	fresh := Sample(101, t0.Add(101*time.Second), 37.08, 29.35, 2100)
	_, r5 := e.Batch(u, fid, uuid.New(), []map[string]any{collide, sameSeq, fresh, fresh})
	reasons := map[int64]string{}
	for _, x := range r5.Rejected {
		reasons[x.Seq] = x.Reason
	}
	if reasons[100] != "sample_conflict" || reasons[4] != "sample_conflict" || !reflect.DeepEqual(r5.Accepted, []int64{101}) ||
		!reflect.DeepEqual(r5.Duplicate, []int64{101}) {
		t.Fatalf("collisions: %+v", r5)
	}

	// another pilot's flight: forbidden; unknown flight: 404
	other := e.Register("Other Pilot")
	if r, _ := e.Batch(other, fid, uuid.New(), seqs(200, 200, t0)); r.Status != 403 {
		t.Fatalf("foreign flight: %d", r.Status)
	}
	if r, _ := e.Batch(u, uuid.New(), uuid.New(), seqs(0, 0, t0)); r.Status != 404 {
		t.Fatalf("unknown flight: %d", r.Status)
	}

	// database: exactly the accepted samples are stored, once
	var stored, keys int
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM flight_positions WHERE flight_id = $1`, fid).Scan(&stored)
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM telemetry_sample_keys WHERE flight_id = $1`, fid).Scan(&keys)
	if stored != 26 || keys != 26 {
		t.Fatalf("stored=%d keys=%d, want 26", stored, keys)
	}
	// stored in a monthly partition, not the default
	var part string
	_ = e.Pool.QueryRow(ctx, `SELECT tableoid::regclass::text FROM flight_positions WHERE flight_id = $1 LIMIT 1`, fid).Scan(&part)
	if !strings.Contains(part, "flight_positions_p") {
		t.Fatalf("partition = %s", part)
	}
	f := e.Must(e.Do("GET", "/flights/"+fid.String(), nil, Req{Token: u.Token}), 200).JSON()
	st := f["stats"].(map[string]any)
	if st["sample_count"].(float64) != 26 || st["distance_m"].(float64) <= 0 || f["last_position"].(map[string]any)["seq"].(float64) != 101 {
		t.Fatalf("flight stats: %v last=%v", st, f["last_position"])
	}
	if f["stats"].(map[string]any)["gap_count"].(float64) != 1 { // 24 → 100 jump in t
		t.Fatalf("gap_count = %v", st["gap_count"])
	}
}

func TestTelemetryValidationAndEndedFlight(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	u := e.Register("Validation Pilot")
	fid := e.CreateFlight(u, nil)
	now := time.Now()
	bad := func(mod func(m map[string]any)) map[string]any {
		s := Sample(0, now.Add(-time.Minute), 37.07, 29.34, 2000)
		mod(s)
		return s
	}
	samples := []map[string]any{
		bad(func(m map[string]any) { m["seq"] = 1; m["lat"] = 91.0 }),
		bad(func(m map[string]any) { m["seq"] = 2; m["h_acc_m"] = 0.0 }),
		bad(func(m map[string]any) { m["seq"] = 3; m["h_acc_m"] = 20000.0 }),
		bad(func(m map[string]any) { m["seq"] = 4; m["t"] = now.Add(time.Hour).UTC().Format(time.RFC3339) }),
		bad(func(m map[string]any) { m["seq"] = 5; m["t"] = now.Add(-3 * time.Hour).UTC().Format(time.RFC3339) }),
		bad(func(m map[string]any) { m["seq"] = 6; m["speed_ms"] = 400.0 }),
		bad(func(m map[string]any) { m["seq"] = 7; m["speed_ms"] = -1.0; m["course_deg"] = -1.0 }), // Core Location sentinels → stored as null
		bad(func(m map[string]any) { m["seq"] = 8; m["lat"] = 0.0; m["lon"] = 0.0 }),
	}
	r, res := e.Batch(u, fid, uuid.New(), samples)
	e.Must(r, 200)
	want := map[int64]string{1: "invalid_coordinates", 2: "invalid_accuracy", 3: "invalid_accuracy", 4: "timestamp_out_of_range",
		5: "timestamp_out_of_range", 6: "invalid_speed", 8: "invalid_coordinates"}
	got := map[int64]string{}
	for _, x := range res.Rejected {
		got[x.Seq] = x.Reason
	}
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(res.Accepted, []int64{7}) {
		t.Fatalf("got rejected=%v accepted=%v", got, res.Accepted)
	}
	pos := e.Must(e.Do("GET", "/flights/"+fid.String()+"/positions", nil, Req{Token: u.Token}), 200).JSON()["items"].([]any)
	if len(pos) != 1 || pos[0].(map[string]any)["speed_ms"] != nil {
		t.Fatalf("positions = %v", pos)
	}
	// structural errors → 422 for the whole batch
	if r := e.Do("POST", "/telemetry/batches", map[string]any{"batch_id": uuid.New(), "flight_id": fid, "samples": []any{}}, Req{Token: u.Token}); r.Status != 422 {
		t.Fatalf("empty batch: %d", r.Status)
	}
	noID := Sample(9, now, 37, 29, 1)
	delete(noID, "id")
	if r := e.Do("POST", "/telemetry/batches", map[string]any{"batch_id": uuid.New(), "flight_id": fid, "samples": []any{noID}}, Req{Token: u.Token}); r.Status != 422 {
		t.Fatalf("sample without id: %d", r.Status)
	}
	big := make([]map[string]any, 501)
	for i := range big {
		big[i] = Sample(1000+i, now, 37, 29, 1)
	}
	if r := e.Do("POST", "/telemetry/batches", map[string]any{"batch_id": uuid.New(), "flight_id": fid, "samples": big}, Req{Token: u.Token}); r.Status != 422 {
		t.Fatalf("501 samples: %d", r.Status)
	}
	// gzip body accepted
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	_ = json.NewEncoder(zw).Encode(map[string]any{"batch_id": uuid.New(), "flight_id": fid, "samples": []any{Sample(10, now.Add(-30*time.Second), 37.07, 29.34, 2000)}})
	_ = zw.Close()
	gz := e.Do("POST", "/telemetry/batches", buf.Bytes(), Req{Token: u.Token, Header: map[string]string{"Content-Encoding": "gzip"}})
	e.Must(gz, 200)
	if !strings.Contains(string(gz.Body), `"accepted":[10]`) {
		t.Fatalf("gzip: %s", gz.Body)
	}

	// end the flight (idempotent); late samples beyond ended_at+10min are rejected
	ended := now.Add(-20 * time.Minute)
	_ = ended
	end := e.Must(e.Do("POST", "/flights/"+fid.String()+"/end", map[string]any{"ended_at": now.Add(-15 * time.Minute).UTC().Format(time.RFC3339)}, Req{Token: u.Token}), 200).JSON()
	if end["status"] != "ended" {
		t.Fatal("not ended")
	}
	e.Must(e.Do("POST", "/flights/"+fid.String()+"/end", nil, Req{Token: u.Token}), 200)
	_, late := e.Batch(u, fid, uuid.New(), []map[string]any{Sample(11, now.Add(-time.Minute), 37.07, 29.34, 2000),
		Sample(12, now.Add(-14*time.Minute), 37.07, 29.34, 2000)})
	if len(late.Rejected) != 1 || late.Rejected[0].Reason != "flight_ended" || !reflect.DeepEqual(late.Accepted, []int64{12}) {
		t.Fatalf("late: %+v", late)
	}
	// GPX export
	g := e.Do("GET", "/flights/"+fid.String()+"/track.gpx", nil, Req{Token: u.Token})
	e.Must(g, 200)
	if !strings.Contains(string(g.Body), "<gpx version=\"1.1\"") || strings.Count(string(g.Body), "<trkpt") != 3 {
		t.Fatalf("gpx: %s", g.Body)
	}
	if g.Header.Get("Content-Type") != "application/gpx+xml; charset=utf-8" {
		t.Fatal(g.Header.Get("Content-Type"))
	}
}

func TestFlightCreateIdempotencyAndVisibility(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	u := e.Register("Owner")
	other := e.Register("Other")
	id := uuid.New()
	body := map[string]any{"id": id, "started_at": time.Now().UTC().Format(time.RFC3339)}
	first := e.Must(e.Do("POST", "/flights", body, Req{Token: u.Token}), 201).JSON()
	second := e.Must(e.Do("POST", "/flights", body, Req{Token: u.Token}), 200).JSON()
	if first["public_id"] != second["public_id"] {
		t.Fatal("idempotent create returned a different flight")
	}
	if _, has := first["visibility"]; has {
		t.Fatal("flights no longer carry a visibility")
	}
	if r := e.Do("POST", "/flights", body, Req{Token: other.Token}); r.Status != 409 {
		t.Fatalf("foreign id: %d", r.Status)
	}
	// a flight outside events is private to its pilot (404 for others and guests)
	if r := e.Do("GET", "/flights/"+id.String(), nil, Req{Token: other.Token}); r.Status != 404 {
		t.Fatalf("private flight for other: %d", r.Status)
	}
	if r := e.Do("GET", "/flights/"+first["public_id"].(string), nil, Req{}); r.Status != 404 {
		t.Fatalf("private flight for guest: %d", r.Status)
	}
	if r := e.Do("PATCH", "/flights/"+id.String(), map[string]any{"event_id": nil}, Req{Token: other.Token}); r.Status != 404 && r.Status != 403 {
		t.Fatalf("non-owner patch: %d", r.Status)
	}
	// event linking requires the pilot role in the event
	adm := e.Admin("Admin")
	ev := e.CreateEvent(adm, nil)
	if r := e.Do("PATCH", "/flights/"+id.String(), map[string]any{"event_id": ev["id"]}, Req{Token: u.Token}); r.Status != 403 {
		t.Fatalf("link without membership: %d", r.Status)
	}
	e.AddMember(adm, ev["id"], u, "observer")
	if r := e.Do("PATCH", "/flights/"+id.String(), map[string]any{"event_id": ev["id"]}, Req{Token: u.Token}); r.Status != 403 {
		t.Fatalf("observers cannot record flights: %d", r.Status)
	}
	e.Must(e.Do("PATCH", "/events/"+ev["id"].(string)+"/members/"+u.ID.String(), map[string]any{"role": "pilot"}, Req{Token: adm.Token}), 200)
	e.Must(e.Do("PATCH", "/flights/"+id.String(), map[string]any{"event_id": ev["id"]}, Req{Token: u.Token}), 200)
	list := e.Must(e.Do("GET", "/flights?event_id="+ev["id"].(string), nil, Req{Token: adm.Token}), 200).JSON()["items"].([]any)
	if len(list) != 1 {
		t.Fatalf("admin event flight list = %d", len(list))
	}
	if r := e.Do("GET", "/flights?event_id="+ev["id"].(string), nil, Req{Token: other.Token}); r.Status != http.StatusForbidden {
		t.Fatalf("outsider event flights: %d", r.Status)
	}
	// ending the flight freezes its event
	e.Must(e.Do("POST", "/flights/"+id.String()+"/end", map[string]any{}, Req{Token: u.Token}), 200)
	if r := e.Do("PATCH", "/flights/"+id.String(), map[string]any{"event_id": nil}, Req{Token: u.Token}); r.Status != 409 {
		t.Fatalf("event change after end: %d", r.Status)
	}
}
