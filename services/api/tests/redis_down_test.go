package tests

import (
	"context"
	"fmt"
	"net"
	"os/exec"
	"testing"
	"time"

	"github.com/google/uuid"
)

type redisProc struct {
	port int
	cmd  *exec.Cmd
	t    *testing.T
}

func freePort(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func startRedis(t *testing.T, port int) *redisProc {
	t.Helper()
	bin, err := exec.LookPath("redis-server")
	if err != nil {
		t.Skip("redis-server not installed")
	}
	cmd := exec.Command(bin, "--port", fmt.Sprint(port), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	Eventually(t, 5*time.Second, func() bool {
		c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			c.Close()
		}
		return err == nil
	}, "redis-server start")
	return &redisProc{port: port, cmd: cmd, t: t}
}

func (r *redisProc) kill() {
	_ = r.cmd.Process.Kill()
	_, _ = r.cmd.Process.Wait()
}

func TestRedisDownIngestionSucceedsAndOutboxDrainsLater(t *testing.T) {
	t.Parallel()
	port := freePort(t)
	rp := startRedis(t, port)
	t.Cleanup(func() { rp.kill() })
	url := fmt.Sprintf("redis://127.0.0.1:%d/0", port)
	e := newEnvWith(t, envOpts{redisURL: url})
	ctx := context.Background()
	u := e.Register("Redis Down Pilot")
	fid := e.CreateFlight(u, nil, "public")
	// baseline: relay works
	Eventually(t, 10*time.Second, func() bool {
		var n int
		_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM realtime_outbox`).Scan(&n)
		return n == 0
	}, "outbox drained while redis is up")

	rp.kill() // Redis goes away
	t0 := time.Now().Add(-2 * time.Minute)
	for b := 0; b < 5; b++ {
		r, res := e.Batch(u, fid, uuid.New(), seqs(b*10, b*10+9, t0))
		e.Must(r, 200) // ingestion is unaffected
		if len(res.Accepted) != 10 {
			t.Fatalf("batch %d accepted %d", b, len(res.Accepted))
		}
	}
	var depth int
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM realtime_outbox`).Scan(&depth)
	if depth < 5 {
		t.Fatalf("outbox should hold the undelivered messages, depth=%d", depth)
	}
	// readiness stays 200 but reports degraded redis
	ready := e.Do("GET", "/health/ready", nil, Req{})
	if ready.Status != 200 || ready.JSON()["status"] != "degraded" {
		t.Fatalf("ready while redis down: %d %s", ready.Status, ready.Body)
	}
	// auth rate limiting falls back to memory while Redis is down
	ip := randomIP()
	var last Resp
	for i := 0; i < 6; i++ {
		last = e.Do("POST", "/auth/login", map[string]any{"email": u.Email, "password": "wrong-password-x", "client": "ios"}, Req{IP: ip})
	}
	if last.Status != 429 {
		t.Fatalf("memory fallback rate limit: %d", last.Status)
	}
	var stored int
	_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM flight_positions WHERE flight_id = $1`, fid).Scan(&stored)
	if stored != 50 {
		t.Fatalf("stored = %d", stored)
	}

	rp = startRedis(t, port) // Redis comes back (empty: no persistence)
	Eventually(t, 30*time.Second, func() bool {
		var n int
		_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM realtime_outbox`).Scan(&n)
		return n == 0
	}, "outbox drained after redis recovery")
	c, err := newRedis(url)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	n, err := c.XLen(ctx, e.Prefix+"rt").Result()
	if err != nil || n < int64(depth) {
		t.Fatalf("stream length %d (err %v), want >= %d", n, err, depth)
	}
	if e.Do("GET", "/health/ready", nil, Req{}).JSON()["status"] != "ok" {
		t.Fatal("ready should be ok again")
	}
}
