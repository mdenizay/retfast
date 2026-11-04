// Package ratelimit implements fixed-window rate limiting in Redis with an
// in-memory fallback so auth endpoints stay protected when Redis is down.
package ratelimit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"sync"
	"time"

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
	Incident     = Rule{"incident_user", 30, time.Minute}
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
// limit and, if not, how many seconds until the window resets.
func (l *Limiter) Allow(ctx context.Context, rule Rule, key string) (bool, int) {
	now := l.now()
	win := now.UnixNano() / int64(rule.Window)
	reset := time.Unix(0, (win+1)*int64(rule.Window))
	retry := int(time.Until(reset).Seconds()) + 1
	if retry < 1 {
		retry = 1
	}
	k := rule.Name + ":" + hashKey(key) + ":" + strconv.FormatInt(win, 10)
	if l.rdb != nil {
		rctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
		pipe := l.rdb.TxPipeline()
		incr := pipe.Incr(rctx, l.rdb.Key("rl", k))
		pipe.Expire(rctx, l.rdb.Key("rl", k), rule.Window+time.Second)
		_, err := pipe.Exec(rctx)
		cancel()
		if err == nil {
			ok := incr.Val() <= int64(rule.Limit)
			if !ok && l.metrics != nil {
				l.metrics.RateLimited.WithLabelValues(rule.Name).Inc()
			}
			return ok, retry
		}
		if l.metrics != nil {
			l.metrics.RateLimitFallback.Inc()
		}
	}
	ok := l.memAllow(rule, k, win, now)
	if !ok && l.metrics != nil {
		l.metrics.RateLimited.WithLabelValues(rule.Name).Inc()
	}
	return ok, retry
}

func (l *Limiter) memAllow(rule Rule, k string, win int64, now time.Time) bool {
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
	if e.window != win {
		e = memEntry{window: win}
	}
	e.count++
	l.mem[k] = e
	return e.count <= rule.Limit
}
