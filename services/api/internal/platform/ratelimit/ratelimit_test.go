package ratelimit

import (
	"context"
	"testing"
	"time"

	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
	"github.com/mdenizay/retfast/services/api/internal/platform/redisx"
)

func TestMemoryFallbackWhenRedisDown(t *testing.T) {
	rdb, _ := redisx.New("redis://127.0.0.1:1/0", "t:") // nothing listens on port 1
	m := metrics.New()
	l := New(rdb, m)
	rule := Rule{"t", 3, time.Minute}
	for i := 0; i < 3; i++ {
		if ok, _ := l.Allow(context.Background(), rule, "k"); !ok {
			t.Fatalf("hit %d refused", i)
		}
	}
	ok, retry := l.Allow(context.Background(), rule, "k")
	if ok || retry < 1 || retry > 61 {
		t.Fatalf("4th hit: ok=%v retry=%d", ok, retry)
	}
	if ok, _ := l.Allow(context.Background(), rule, "other"); !ok {
		t.Fatal("keys must be independent")
	}
}

func TestWindowResets(t *testing.T) {
	l := New(nil, metrics.New())
	now := time.Unix(1_800_000_000, 0)
	l.now = func() time.Time { return now }
	rule := Rule{"w", 1, time.Minute}
	if ok, _ := l.Allow(context.Background(), rule, "k"); !ok {
		t.Fatal("first")
	}
	if ok, _ := l.Allow(context.Background(), rule, "k"); ok {
		t.Fatal("second in window")
	}
	// the previous window still weighs in right after the boundary
	now = now.Add(time.Minute)
	if ok, _ := l.Allow(context.Background(), rule, "k"); ok {
		t.Fatal("hit right after boundary must still count the previous window")
	}
	// two windows later everything has expired
	now = now.Add(2 * time.Minute)
	if ok, _ := l.Allow(context.Background(), rule, "k"); !ok {
		t.Fatal("after two quiet windows")
	}
}

// A fixed window would allow 2x the limit across a boundary; the sliding window must not.
func TestNoBurstAcrossBoundary(t *testing.T) {
	l := New(nil, metrics.New())
	now := time.Unix(1_800_000_000, 0).Add(59 * time.Second) // 1 s before a boundary
	l.now = func() time.Time { return now }
	rule := Rule{"b", 5, time.Minute}
	allowed := 0
	for i := 0; i < 5; i++ {
		if ok, _ := l.Allow(context.Background(), rule, "k"); ok {
			allowed++
		}
	}
	now = now.Add(2 * time.Second) // just past the boundary
	for i := 0; i < 5; i++ {
		if ok, _ := l.Allow(context.Background(), rule, "k"); ok {
			allowed++
		}
	}
	if allowed > 5 {
		t.Fatalf("allowed %d hits within ~2 s for a limit of 5/min", allowed)
	}
}
