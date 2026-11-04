// Package realtime moves committed outbox rows to the Redis stream (Relay),
// tails the stream on every instance (Tailer) and fans out to WebSocket
// subscribers (Hub, Server) with per-message authorization.
package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
	"github.com/mdenizay/retfast/services/api/internal/platform/redisx"
	"github.com/mdenizay/retfast/services/api/internal/realtime/bus"
)

// StreamMaxLen approximately caps the stream (ADR-005, MAXLEN ~).
const StreamMaxLen = 100000

// Relay publishes realtime_outbox rows to Redis. Exactly one instance is the
// active relay at a time (session advisory lock); the others stand by.
type Relay struct {
	Pool    *pgxpool.Pool
	Redis   *redisx.Client
	Metrics *metrics.Metrics
	Log     *slog.Logger
	// Poll is the fallback poll interval when no NOTIFY arrives (default 1 s).
	Poll time.Duration
}

const relayLockSQL = `SELECT pg_try_advisory_lock(hashtextextended('retfast-relay:' || current_schema(), 0))`
const relayUnlockSQL = `SELECT pg_advisory_unlock(hashtextextended('retfast-relay:' || current_schema(), 0))`

// Run blocks until ctx is cancelled.
func (r *Relay) Run(ctx context.Context) {
	if r.Poll == 0 {
		r.Poll = time.Second
	}
	go r.depthLoop(ctx)
	for ctx.Err() == nil {
		if err := r.lead(ctx); err != nil && ctx.Err() == nil {
			r.Log.Warn("outbox relay leadership loop error", "err", err.Error())
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func (r *Relay) depthLoop(ctx context.Context) {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	q := dbq.New(r.Pool)
	for {
		if n, err := q.CountOutbox(ctx); err == nil {
			r.Metrics.OutboxDepth.Set(float64(n))
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// lead tries to become the relay and, if successful, drains until ctx ends or
// the connection fails.
func (r *Relay) lead(ctx context.Context) error {
	c, err := r.Pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer c.Release()
	var got bool
	if err := c.QueryRow(ctx, relayLockSQL).Scan(&got); err != nil {
		return err
	}
	if !got {
		return nil // another instance leads; retry later
	}
	defer func() {
		uctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		defer cancel()
		_, _ = c.Exec(uctx, relayUnlockSQL)
		_, _ = c.Exec(uctx, `UNLISTEN rf_outbox`)
	}()
	if _, err := c.Exec(ctx, `LISTEN rf_outbox`); err != nil {
		return err
	}
	r.Log.Info("outbox relay is leader")
	backoff := time.Duration(0)
	lastErrLog := time.Time{}
	for ctx.Err() == nil {
		n, err := r.DrainOnce(ctx)
		switch {
		case err != nil:
			r.Metrics.OutboxRelayErrors.Inc()
			if time.Since(lastErrLog) > 30*time.Second {
				r.Log.Warn("outbox relay cannot publish; rows stay queued", "err", err.Error())
				lastErrLog = time.Now()
			}
			if backoff == 0 {
				backoff = 500 * time.Millisecond
			} else if backoff < 10*time.Second {
				backoff *= 2
			}
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(backoff):
			}
			continue
		case n > 0:
			backoff = 0
			continue // more may be waiting
		}
		backoff = 0
		wctx, cancel := context.WithTimeout(ctx, r.Poll)
		_, werr := c.Conn().WaitForNotification(wctx)
		cancel()
		if werr != nil && ctx.Err() == nil && wctx.Err() == nil {
			return werr // connection problem; give up leadership and retry
		}
	}
	return nil
}

// DrainOnce publishes up to 500 rows and deletes them. It returns the number
// published. Delivery is at-least-once: a crash between XADD and DELETE
// re-publishes rows, which clients tolerate (they dedupe by seq / id).
func (r *Relay) DrainOnce(ctx context.Context) (int, error) {
	q := dbq.New(r.Pool)
	rows, err := q.FetchOutbox(ctx, 500)
	if err != nil || len(rows) == 0 {
		return 0, err
	}
	pipe := r.Redis.Pipeline()
	stream := r.Redis.StreamKey()
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
		var env bus.Envelope
		if err := json.Unmarshal(row.Payload, &env); err != nil {
			r.Log.Error("dropping undecodable outbox row", "id", row.ID)
			continue
		}
		if env.Type == bus.TypePosition && env.EventID != nil && env.FlightID != nil {
			k := r.Redis.LatestKey(env.EventID.String())
			pipe.HSet(ctx, k, env.FlightID.String(), string(row.Payload))
			pipe.Expire(ctx, k, 24*time.Hour)
		}
		pipe.XAdd(ctx, &redis.XAddArgs{Stream: stream, MaxLen: StreamMaxLen, Approx: true, ID: "*",
			Values: map[string]any{"e": string(row.Payload)}})
	}
	pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if _, err := pipe.Exec(pctx); err != nil {
		return 0, err
	}
	if err := q.DeleteOutbox(ctx, ids); err != nil {
		return 0, err
	}
	r.Metrics.OutboxRelayed.Add(float64(len(rows)))
	return len(rows), nil
}
