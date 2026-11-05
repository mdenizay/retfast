// Package ratelimit implements sliding-window rate limiting in Redis with an
// in-memory fallback so auth endpoints stay protected when Redis is down.
package ratelimit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
	"github.com/mdenizay/retfast/services/api/internal/platform/redisx"
)

// Rule is a named limit of Limit requests per Window.
type Rule struct {
	Name   string
	Limit  int
	Window time.Duration
}

// Common rules from the API contract.
var (
	LoginIPEmail = Rule{"login_ip_email", 5, time.Minute}
	LoginIP      = Rule{"login_ip", 20, time.Minute}
	Register     = Rule{"register_ip", 5, time.Minute}
	Forgot       = Rule{"forgot_ip", 5, time.Minute}
	Reset        = Rule{"reset_ip", 10, time.Minute}
	Refresh      = Rule{"refresh_ip", 60, time.Minute}
	VerifyResend = Rule{"verify_resend_user", 3, 10 * time.Minute}
	PasswordChg  = Rule{"password_change_user", 10, time.Minute}
	Telemetry    = Rule{"telemetry_user", 600, time.Minute}
	Retrieval    = Rule{"retrieval_user", 60, time.Minute} // state changes, notes, creation
	Position     = Rule{"position_user", 240, time.Minute} // retrieval pilot positions + retriever positions
)

// Limiter checks rules.
type Limiter struct {
	rdb     *redisx.Client
	metrics *metrics.Metrics
	now     func() time.Time

	mu    sync.Mutex
	mem   map[string]memEntry
	sweep time.Time
}

type memEntry struct {
	window int64
	count  int
	prev   int
}

// New returns a limiter; rdb may be nil (memory only).
func New(rdb *redisx.Client, m *metrics.Metrics) *Limiter {
	return &Limiter{rdb: rdb, metrics: m, now: time.Now, mem: map[string]memEntry{}}
}

func hashKey(k string) string {
	s := sha256.Sum256([]byte(k))
	return hex.EncodeToString(s[:12])
}

// Allow records one hit for (rule, key) and reports whether it is within the
// limit and, if not, how many seconds until the caller should retry.
//
// It uses a sliding-window counter: the previous window's count is weighted by
// how much of it still overlaps the sliding window. Unlike a plain fixed
// window this does not allow a 2x burst across a window boundary.
func (l *Limiter) Allow(ctx context.Context, rule Rule, key string) (bool, int) {
	now := l.now()
	w := int64(rule.Window)
	win := now.UnixNano() / w
	elapsed := float64(now.UnixNano()-win*w) / float64(w) // 0..1 into the current window
	retry := int(time.Duration(w-(now.UnixNano()-win*w)).Seconds()) + 1
	if retry < 1 {
		retry = 1
	}
	base := rule.Name + ":" + hashKey(key)
	if l.rdb != nil {
		cur := l.rdb.Key("rl", base+":"+strconv.FormatInt(win, 10))
		prev := l.rdb.Key("rl", base+":"+strconv.FormatInt(win-1, 10))
		rctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
		pipe := l.rdb.TxPipeline()
		incr := pipe.Incr(rctx, cur)
		pipe.Expire(rctx, cur, 2*rule.Window+time.Second)
		prevGet := pipe.Get(rctx, prev)
		_, err := pipe.Exec(rctx)
		cancel()
		if err == nil || isNil(err) {
			pc, _ := prevGet.Int64()
			ok := estimate(pc, incr.Val(), elapsed) <= float64(rule.Limit)
			if !ok && l.metrics != nil {
				l.metrics.RateLimited.WithLabelValues(rule.Name).Inc()
			}
			return ok, retry
		}
		if l.metrics != nil {
			l.metrics.RateLimitFallback.Inc()
		}
	}
	ok := l.memAllow(rule, base, win, elapsed, now)
	if !ok && l.metrics != nil {
		l.metrics.RateLimited.WithLabelValues(rule.Name).Inc()
	}
	return ok, retry
}

func estimate(prev, cur int64, elapsed float64) float64 {
	return float64(prev)*(1-elapsed) + float64(cur)
}

func isNil(err error) bool { return errors.Is(err, redis.Nil) }

func (l *Limiter) memAllow(rule Rule, k string, win int64, elapsed float64, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.sweep) > time.Minute || len(l.mem) > 100_000 {
		for key, e := range l.mem {
			if e.window < win-1 {
				delete(l.mem, key)
			}
		}
		l.sweep = now
	}
	e := l.mem[k]
	switch {
	case e.window == win:
	case e.window == win-1:
		e = memEntry{window: win, prev: e.count}
	default:
		e = memEntry{window: win}
	}
	e.count++
	l.mem[k] = e
	return estimate(int64(e.prev), int64(e.count), elapsed) <= float64(rule.Limit)
}
