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
	now = now.Add(time.Minute)
	if ok, _ := l.Allow(context.Background(), rule, "k"); !ok {
		t.Fatal("next window")
	}
}
