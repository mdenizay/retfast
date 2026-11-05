// Package tests holds integration tests against a real PostgreSQL (PostGIS)
// and Redis. They run only when RETFAST_TEST_DATABASE_URL is set, e.g.
//
//	RETFAST_TEST_DATABASE_URL='postgres:///retfast_test?host=/tmp' \
//	RETFAST_TEST_REDIS_URL='redis://localhost:6379/15' go test ./tests/...
//
// Every test gets its own PostgreSQL schema and Redis key prefix, so tests run
// in parallel without interfering and leave nothing behind.
package tests

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/mdenizay/retfast/services/api/internal/app"
	"github.com/mdenizay/retfast/services/api/internal/platform/config"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	rlog "github.com/mdenizay/retfast/services/api/internal/platform/log"
	"github.com/mdenizay/retfast/services/api/migrations"
)

var (
	dbURL    = os.Getenv("RETFAST_TEST_DATABASE_URL")
	redisURL = envOr("RETFAST_TEST_REDIS_URL", "redis://localhost:6379/15")
)

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func TestMain(m *testing.M) {
	if dbURL != "" {
		ctx := context.Background()
		pool, err := db.Connect(ctx, dbURL, db.Options{MaxConns: 2})
		if err != nil {
			fmt.Fprintln(os.Stderr, "connect:", err)
			os.Exit(1)
		}
		for _, ext := range []string{"postgis", "pgcrypto", "citext"} {
			if _, err := pool.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS "+ext+" SCHEMA public"); err != nil {
				fmt.Fprintln(os.Stderr, "extension:", err)
				os.Exit(1)
			}
		}
		pool.Close()
	}
	os.Exit(m.Run())
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Env is one isolated API instance.
type Env struct {
	T        *testing.T
	Schema   string
	Prefix   string
	Cfg      *config.Config
	Pool     *pgxpool.Pool
	App      *app.App
	Server   *httptest.Server
	Q        *dbq.Queries
	ctx      context.Context
	cancel   context.CancelFunc
	stopOnce sync.Once
}

type envOpts struct {
	redisURL string
	schema   string // reuse an existing schema (restart tests)
	noClean  bool
	noEmail  bool
}

func newEnv(t *testing.T) *Env { return newEnvWith(t, envOpts{}) }

func newEnvWith(t *testing.T, o envOpts) *Env {
	t.Helper()
	if dbURL == "" {
		t.Skip("RETFAST_TEST_DATABASE_URL not set; skipping integration test")
	}
	schema := o.schema
	fresh := schema == ""
	if fresh {
		schema = "t_" + randHex(6)
	}
	ctx, cancel := context.WithCancel(context.Background())
	admin, err := db.Connect(ctx, dbURL, db.Options{MaxConns: 2})
	if err != nil {
		t.Fatal(err)
	}
	if fresh {
		if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
			t.Fatal(err)
		}
	}
	admin.Close()
	pool, err := db.Connect(ctx, dbURL, db.Options{MaxConns: 20, SearchPath: schema + ",public"})
	if err != nil {
		t.Fatal(err)
	}
	migs, err := db.LoadMigrations(migrations.FS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (&db.Migrator{Pool: pool, Migrations: migs}).Up(ctx); err != nil {
		t.Fatal(err)
	}
	ru := redisURL
	if o.redisURL != "" {
		ru = o.redisURL
	}
	getenv := func(k string) string {
		switch k {
		case "DATABASE_URL":
			return dbURL
		case "REDIS_URL":
			return ru
		case "REDIS_PREFIX":
			return schema + ":"
		case "APP_ENV":
			return "development"
		case "JWT_SECRET":
			return "integration-test-secret-0123456789abcdef"
		case "TRUSTED_PROXIES":
			return "127.0.0.1,::1"
		case "SHUTDOWN_TIMEOUT":
			return "10s"
		case "LOG_LEVEL":
			return envOr("RETFAST_TEST_LOG_LEVEL", "error")
		}
		return ""
	}
	cfg, err := config.LoadFrom(getenv)
	if err != nil {
		t.Fatal(err)
	}
	log := rlog.New(os.Stderr, cfg.LogLevel)
	a, err := app.New(ctx, cfg, log, pool)
	if err != nil {
		t.Fatal(err)
	}
	a.SkipEmailWorker = o.noEmail
	a.StartWorkers(ctx)
	srv := httptest.NewServer(a.Handler)
	e := &Env{T: t, Schema: schema, Prefix: schema + ":", Cfg: cfg, Pool: pool, App: a, Server: srv, Q: dbq.New(pool), ctx: ctx, cancel: cancel}
	t.Cleanup(func() {
		e.Stop()
		if !o.noClean {
			e.Drop()
		}
	})
	return e
}

// Stop shuts the instance down (idempotent).
func (e *Env) Stop() { e.stopOnce.Do(e.stop) }

func (e *Env) stop() {
	e.App.BeginDrain()
	e.Server.CloseClientConnections()
	e.Server.Close()
	e.App.StopWorkers(5 * time.Second)
	e.cancel()
	e.App.Close()
	e.Pool.Close()
}

// Drop removes the schema and Redis keys.
func (e *Env) Drop() {
	ctx := context.Background()
	p, err := db.Connect(ctx, dbURL, db.Options{MaxConns: 2})
	if err == nil {
		_, _ = p.Exec(ctx, "DROP SCHEMA IF EXISTS "+e.Schema+" CASCADE")
		p.Close()
	}
	{
		// The app's Redis client is closed in Stop; open a short-lived one.
		if c, err := newRedis(redisURL); err == nil {
			iter := c.Scan(ctx, 0, e.Prefix+"*", 1000).Iterator()
			for iter.Next(ctx) {
				c.Del(ctx, iter.Val())
			}
			_ = c.Close()
		}
	}
}

// URL returns the API base URL.
func (e *Env) URL(path string) string { return e.Server.URL + "/api/v1" + path }

// WSURL returns the realtime URL.
func (e *Env) WSURL() string {
	return "ws" + strings.TrimPrefix(e.Server.URL, "http") + "/api/v1/realtime"
}

// Resp is a decoded response.
type Resp struct {
	Status int
	Header http.Header
	Body   []byte
}

// JSON decodes the body into a map.
func (r Resp) JSON() map[string]any {
	var m map[string]any
	_ = json.Unmarshal(r.Body, &m)
	return m
}

// Into decodes into v.
func (r Resp) Into(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		t.Fatalf("decode %s: %v", string(r.Body), err)
	}
}

// ErrCode returns error.code.
func (r Resp) ErrCode() string {
	m := r.JSON()
	if e, ok := m["error"].(map[string]any); ok {
		s, _ := e["code"].(string)
		return s
	}
	return ""
}

func randomIP() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(1<<24))
	v := n.Int64()
	a := netip.AddrFrom4([4]byte{10, byte(v >> 16), byte(v >> 8), byte(v)})
	return a.String()
}

// Req options.
type Req struct {
	Token   string
	IP      string
	Cookies []*http.Cookie
	Header  map[string]string
}

// Do performs a request with a random client IP unless set.
func (e *Env) Do(method, path string, body any, o Req) Resp {
	e.T.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case []byte:
		rd = bytes.NewReader(b)
	default:
		buf, _ := json.Marshal(b)
		rd = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, e.URL(path), rd)
	if err != nil {
		e.T.Fatal(err)
	}
	if rd != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if o.Token != "" {
		req.Header.Set("Authorization", "Bearer "+o.Token)
	}
	ip := o.IP
	if ip == "" {
		ip = randomIP()
	}
	req.Header.Set("X-Forwarded-For", ip)
	for _, c := range o.Cookies {
		req.AddCookie(c)
	}
	for k, v := range o.Header {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.T.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return Resp{Status: resp.StatusCode, Header: resp.Header, Body: b}
}

// Must asserts the status.
func (e *Env) Must(r Resp, status int) Resp {
	e.T.Helper()
	if r.Status != status {
		e.T.Fatalf("want HTTP %d, got %d: %s", status, r.Status, string(r.Body))
	}
	return r
}

// User is a registered test user.
type User struct {
	ID       uuid.UUID
	Email    string
	Name     string
	Password string
	Token    string
	Refresh  string
}

// Register creates a pilot account (client ios so the refresh token is in the body).
func (e *Env) Register(name string) *User {
	e.T.Helper()
	u := &User{Email: "u" + randHex(5) + "@example.com", Name: name, Password: "Correct-Horse-" + randHex(3)}
	r := e.Must(e.Do("POST", "/auth/register", map[string]any{"email": u.Email, "password": u.Password, "full_name": name, "client": "ios"}, Req{}), 201)
	var ar struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		User         struct {
			ID uuid.UUID `json:"id"`
		} `json:"user"`
	}
	r.Into(e.T, &ar)
	u.ID, u.Token, u.Refresh = ar.User.ID, ar.AccessToken, ar.RefreshToken
	return u
}

// Grant adds global roles directly in the database (as an admin would) and
// waits out the auth state cache by re-logging in.
func (e *Env) Grant(u *User, roles ...string) {
	e.T.Helper()
	for _, r := range roles {
		if err := e.Q.AddUserRole(context.Background(), dbq.AddUserRoleParams{UserID: u.ID, Role: r}); err != nil {
			e.T.Fatal(err)
		}
	}
	e.App.Auth.Invalidate(u.ID)
	e.Login(u)
}

// Login refreshes u.Token via password login.
func (e *Env) Login(u *User) {
	e.T.Helper()
	r := e.Must(e.Do("POST", "/auth/login", map[string]any{"email": u.Email, "password": u.Password, "client": "ios"}, Req{}), 200)
	m := r.JSON()
	u.Token, _ = m["access_token"].(string)
	u.Refresh, _ = m["refresh_token"].(string)
}

// Admin registers a user and makes them platform_admin.
func (e *Env) Admin(name string) *User {
	e.T.Helper()
	u := e.Register(name)
	e.Grant(u, "platform_admin")
	return u
}

// AssignOrganizer makes u an organizer of the event (as admin adm).
func (e *Env) AssignOrganizer(adm *User, eventID any, u *User) {
	e.T.Helper()
	e.Must(e.Do("POST", fmt.Sprintf("/events/%v/organizers", eventID), map[string]any{"user_id": u.ID}, Req{Token: adm.Token}), 201)
}

// AddMember adds u to the event with role (as organizer/admin by).
func (e *Env) AddMember(by *User, eventID any, u *User, role string) {
	e.T.Helper()
	e.Must(e.Do("POST", fmt.Sprintf("/events/%v/members", eventID), map[string]any{"user_id": u.ID, "role": role}, Req{Token: by.Token}), 201)
}

// CreateEvent creates an event as platform admin u.
func (e *Env) CreateEvent(u *User, body map[string]any) map[string]any {
	e.T.Helper()
	base := map[string]any{"name": "Test Event " + randHex(3), "starts_at": time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
		"ends_at": time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339), "status": "active", "visibility": "public"}
	for k, v := range body {
		base[k] = v
	}
	return e.Must(e.Do("POST", "/events", base, Req{Token: u.Token}), 201).JSON()
}

// CreateFlight creates a flight for u.
func (e *Env) CreateFlight(u *User, eventID any) uuid.UUID {
	e.T.Helper()
	id := uuid.New()
	body := map[string]any{"id": id, "started_at": time.Now().Add(-10 * time.Minute).UTC().Format(time.RFC3339Nano),
		"device": map[string]any{"platform": "ios", "app_version": "test"}}
	if eventID != nil {
		body["event_id"] = eventID
	}
	e.Must(e.Do("POST", "/flights", body, Req{Token: u.Token}), 201)
	return id
}

// Sample builds one telemetry sample.
func Sample(seq int, t time.Time, lat, lon, alt float64) map[string]any {
	return map[string]any{"id": uuid.New(), "seq": seq, "t": t.UTC().Format("2006-01-02T15:04:05.000Z"), "lat": lat, "lon": lon,
		"gps_alt_m": alt, "h_acc_m": 5.0, "v_acc_m": 3.0, "speed_ms": 9.5, "course_deg": 180.0}
}

// Batch posts a batch and returns the decoded result.
func (e *Env) Batch(u *User, flightID uuid.UUID, batchID uuid.UUID, samples []map[string]any) (Resp, BatchResult) {
	e.T.Helper()
	r := e.Do("POST", "/telemetry/batches", map[string]any{"batch_id": batchID, "flight_id": flightID, "samples": samples}, Req{Token: u.Token})
	var br BatchResult
	if r.Status == 200 {
		r.Into(e.T, &br)
	}
	return r, br
}

// BatchResult mirrors the API response.
type BatchResult struct {
	BatchID   uuid.UUID `json:"batch_id"`
	Accepted  []int64   `json:"accepted"`
	Duplicate []int64   `json:"duplicate"`
	Rejected  []struct {
		Seq    int64  `json:"seq"`
		Reason string `json:"reason"`
	} `json:"rejected"`
	MaxAckedSeq *int64 `json:"max_acked_seq"`
}

// Eventually polls cond until true or timeout.
func Eventually(t *testing.T, d time.Duration, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out: %s", msg)
}

func newRedis(url string) (*redis.Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return redis.NewClient(opt), nil
}

func uuidOf(t *testing.T, user any) uuid.UUID {
	t.Helper()
	m, _ := user.(map[string]any)
	id, err := uuid.Parse(m["id"].(string))
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// MustBatch posts a batch and requires HTTP 200.
func (e *Env) MustBatch(u *User, flightID uuid.UUID, batchID uuid.UUID, samples []map[string]any) BatchResult {
	e.T.Helper()
	r, br := e.Batch(u, flightID, batchID, samples)
	e.Must(r, 200)
	return br
}
