package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/app"
	"github.com/mdenizay/retfast/services/api/internal/platform/config"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	rlog "github.com/mdenizay/retfast/services/api/internal/platform/log"
	"github.com/mdenizay/retfast/services/api/migrations"
)

type served struct {
	base string
	pool *pgxpool.Pool
	stop context.CancelFunc
	done chan error
}

// serveReal runs App.Serve (the production code path) on a real port.
func serveReal(t *testing.T, schema string) *served {
	t.Helper()
	ctx := context.Background()
	pool, err := db.Connect(ctx, dbURL, db.Options{MaxConns: 30, SearchPath: schema + ",public"})
	if err != nil {
		t.Fatal(err)
	}
	migs, _ := db.LoadMigrations(migrations.FS)
	if _, err := (&db.Migrator{Pool: pool, Migrations: migs}).Up(ctx); err != nil {
		t.Fatal(err)
	}
	port, mport := freePort(t), freePort(t)
	cfg, err := config.LoadFrom(func(k string) string {
		switch k {
		case "DATABASE_URL":
			return dbURL
		case "REDIS_URL":
			return redisURL
		case "REDIS_PREFIX":
			return schema + ":"
		case "JWT_SECRET":
			return "integration-test-secret-0123456789abcdef"
		case "HTTP_ADDR":
			return fmt.Sprintf("127.0.0.1:%d", port)
		case "METRICS_ADDR":
			return fmt.Sprintf("127.0.0.1:%d", mport)
		case "TRUSTED_PROXIES":
			return "127.0.0.1"
		case "SHUTDOWN_TIMEOUT":
			return "15s"
		case "LOG_LEVEL":
			return envOr("RETFAST_TEST_LOG_LEVEL", "error")
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	a, err := app.New(ctx, cfg, rlog.New(os.Stderr, cfg.LogLevel), pool)
	if err != nil {
		t.Fatal(err)
	}
	sctx, cancel := context.WithCancel(ctx)
	s := &served{base: fmt.Sprintf("http://127.0.0.1:%d/api/v1", port), pool: pool, stop: cancel, done: make(chan error, 1)}
	go func() { s.done <- a.Serve(sctx) }()
	Eventually(t, 5*time.Second, func() bool {
		r, err := http.Get(s.base + "/health/ready")
		if err == nil {
			r.Body.Close()
		}
		return err == nil && r.StatusCode == 200
	}, "server ready")
	return s
}

func post(base, path, token string, body any) (int, []byte, error) {
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", base+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-For", randomIP())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	c := &http.Client{Timeout: 20 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out, nil
}

func TestGracefulRestartKeepsCommittedTelemetry(t *testing.T) {
	if dbURL == "" {
		t.Skip("RETFAST_TEST_DATABASE_URL not set")
	}
	t.Parallel()
	ctx := context.Background()
	schema := "t_" + randHex(6)
	adm, err := db.Connect(ctx, dbURL, db.Options{MaxConns: 2})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := adm.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = adm.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE"); adm.Close() })

	s1 := serveReal(t, schema)
	email := "g" + randHex(4) + "@example.com"
	st, body, err := post(s1.base, "/auth/register", "", map[string]any{"email": email, "password": "Graceful-Pass-123", "full_name": "Graceful", "client": "ios"})
	if err != nil || st != 201 {
		t.Fatalf("register: %d %s %v", st, body, err)
	}
	var auth struct {
		AccessToken string `json:"access_token"`
	}
	_ = json.Unmarshal(body, &auth)
	fid := uuid.New()
	if st, b, _ := post(s1.base, "/flights", auth.AccessToken, map[string]any{"id": fid, "started_at": time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)}); st != 201 {
		t.Fatalf("flight: %d %s", st, b)
	}

	// 4 concurrent senders, each with its own seq range, 25 samples per batch.
	type batch struct {
		id      uuid.UUID
		samples []map[string]any
	}
	var mu sync.Mutex
	acked := map[int64]bool{}
	var all []batch
	t0 := time.Now().Add(-50 * time.Minute)
	stopSending := make(chan struct{})
	var wg sync.WaitGroup
	for w := 0; w < 4; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; ; i++ {
				select { // paced so that sending + resending stays under the 600 batches/min/user limit
				case <-stopSending:
					return
				case <-time.After(25 * time.Millisecond):
				}
				base := w*1_000_000 + i*25
				b := batch{id: uuid.New(), samples: seqs(base, base+24, t0)}
				mu.Lock()
				all = append(all, b)
				mu.Unlock()
				st, body, err := post(s1.base, "/telemetry/batches", auth.AccessToken, map[string]any{"batch_id": b.id, "flight_id": fid, "samples": b.samples})
				if err != nil || st != 200 {
					if err != nil {
						return // server gone
					}
					continue
				}
				var r BatchResult
				_ = json.Unmarshal(body, &r)
				mu.Lock()
				for _, s := range append(r.Accepted, r.Duplicate...) {
					acked[s] = true
				}
				mu.Unlock()
			}
		}(w)
	}
	time.Sleep(1500 * time.Millisecond)
	shutdownStart := time.Now()
	s1.stop() // SIGTERM equivalent: Serve drains and returns
	select {
	case err := <-s1.done:
		if err != nil {
			t.Fatalf("serve returned %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("shutdown exceeded 20 s")
	}
	shutdownDur := time.Since(shutdownStart)
	close(stopSending)
	wg.Wait()
	s1.pool.Close()

	// every acknowledged sample is durable
	mu.Lock()
	nAcked := len(acked)
	mu.Unlock()
	if nAcked == 0 {
		t.Fatal("no batches acknowledged before shutdown")
	}
	p2, _ := db.Connect(ctx, dbURL, db.Options{MaxConns: 2, SearchPath: schema + ",public"})
	defer p2.Close()
	rows, err := p2.Query(ctx, `SELECT seq FROM flight_positions WHERE flight_id = $1`, fid)
	if err != nil {
		t.Fatal(err)
	}
	stored := map[int64]bool{}
	for rows.Next() {
		var s int32
		_ = rows.Scan(&s)
		stored[int64(s)] = true
	}
	rows.Close()
	for s := range acked {
		if !stored[s] {
			t.Fatalf("acknowledged seq %d lost", s)
		}
	}

	// restart on the same database; the client resends everything it has
	s2 := serveReal(t, schema)
	defer func() { s2.stop(); <-s2.done; s2.pool.Close() }()
	total := 0
	for _, b := range all {
		st, body, err := post(s2.base, "/telemetry/batches", auth.AccessToken, map[string]any{"batch_id": b.id, "flight_id": fid, "samples": b.samples})
		if err != nil || st != 200 {
			t.Fatalf("resend: %d %s %v", st, body, err)
		}
		var r BatchResult
		_ = json.Unmarshal(body, &r)
		if len(r.Accepted)+len(r.Duplicate) != len(b.samples) || len(r.Rejected) != 0 {
			t.Fatalf("resend classification: %+v", r)
		}
		total += len(b.samples)
	}
	var n int
	_ = p2.QueryRow(ctx, `SELECT count(*) FROM flight_positions WHERE flight_id = $1`, fid).Scan(&n)
	if n != total {
		t.Fatalf("stored %d, sent %d", n, total)
	}
	t.Logf("acked before shutdown: %d samples; shutdown took %s; after resend: %d stored = %d sent", nAcked, shutdownDur.Round(time.Millisecond), n, total)
}
