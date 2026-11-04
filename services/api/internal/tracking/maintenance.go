package tracking

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/flights"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
)

// positionColumns are the non-generated columns of flight_positions.
const positionColumns = `flight_id, seq, sample_id, batch_id, t, device_t, received_at, lat, lon, gps_alt_m, h_acc_m, v_acc_m, speed_ms, course_deg, meta`

// PartitionName returns the monthly partition name for month m.
func PartitionName(m time.Time) string {
	return fmt.Sprintf("flight_positions_p%04d%02d", m.Year(), int(m.Month()))
}

func monthStart(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// EnsurePartitions creates monthly partitions from the previous month through
// monthsAhead months after now. If rows for a new month already sit in the
// default partition (maintenance did not run in time), they are moved into the
// new partition inside one transaction before it is attached.
func EnsurePartitions(ctx context.Context, pool *pgxpool.Pool, now time.Time, monthsAhead int) (created []string, err error) {
	start := monthStart(now).AddDate(0, -1, 0)
	for i := 0; i <= monthsAhead+1; i++ {
		from := start.AddDate(0, i, 0)
		to := from.AddDate(0, 1, 0)
		name := PartitionName(from)
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT to_regclass(quote_ident(current_schema()) || '.' || $1) IS NOT NULL`, name).Scan(&exists); err != nil {
			return created, err
		}
		if exists {
			continue
		}
		bounds := fmt.Sprintf("FROM ('%s') TO ('%s')", from.Format(time.RFC3339), to.Format(time.RFC3339))
		_, err := pool.Exec(ctx, fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s PARTITION OF flight_positions FOR VALUES %s`, pgx.Identifier{name}.Sanitize(), bounds))
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23514" {
			err = movePartitionFromDefault(ctx, pool, name, from, to, bounds)
		}
		if err != nil {
			return created, fmt.Errorf("create partition %s: %w", name, err)
		}
		created = append(created, name)
	}
	return created, nil
}

func movePartitionFromDefault(ctx context.Context, pool *pgxpool.Pool, name string, from, to time.Time, bounds string) error {
	ident := pgx.Identifier{name}.Sanitize()
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		stmts := []string{
			`LOCK TABLE flight_positions_default IN ACCESS EXCLUSIVE MODE`,
			fmt.Sprintf(`CREATE TABLE %s (LIKE flight_positions INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED)`, ident),
		}
		for _, s := range stmts {
			if _, err := tx.Exec(ctx, s); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (%s) SELECT %s FROM flight_positions_default WHERE received_at >= $1 AND received_at < $2`,
			ident, positionColumns, positionColumns), from, to); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM flight_positions_default WHERE received_at >= $1 AND received_at < $2`, from, to); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, fmt.Sprintf(`ALTER TABLE flight_positions ATTACH PARTITION %s FOR VALUES %s`, ident, bounds))
		return err
	})
}

// Maintenance runs periodic housekeeping: partitions (startup + every 6 h),
// retention pruning, abandoning silent flights, and recomputing dirty stats.
type Maintenance struct {
	Pool    *pgxpool.Pool
	Metrics *metrics.Metrics
	Log     *slog.Logger
	// AbandonAfter marks recording flights with no data for this long as abandoned.
	AbandonAfter time.Duration
}

// RunPartitions ensures partitions now and every 6 hours.
func (m *Maintenance) RunPartitions(ctx context.Context) {
	run := func() {
		created, err := EnsurePartitions(ctx, m.Pool, time.Now(), 3)
		if err != nil {
			if ctx.Err() == nil {
				m.Metrics.PartitionErrors.Inc()
				m.Log.Error("partition maintenance failed", "err", err.Error())
			}
			return
		}
		if len(created) > 0 {
			m.Log.Info("partitions created", "partitions", created)
		}
	}
	run()
	t := time.NewTicker(6 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}

// RunHousekeeping prunes retention-limited tables hourly and abandons silent flights.
func (m *Maintenance) RunHousekeeping(ctx context.Context) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		m.HousekeepOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// HousekeepOnce runs one housekeeping pass.
func (m *Maintenance) HousekeepOnce(ctx context.Context) {
	q := dbq.New(m.Pool)
	report := map[string]int64{}
	run := func(name string, f func() (int64, error)) {
		n, err := f()
		if err != nil {
			if ctx.Err() == nil {
				m.Log.Error("housekeeping step failed", "step", name, "err", err.Error())
			}
			return
		}
		if n > 0 {
			report[name] = n
		}
	}
	run("telemetry_batches", func() (int64, error) { return q.PruneBatches(ctx, time.Now().Add(-7*24*time.Hour)) })
	run("user_sessions", func() (int64, error) { return q.PruneExpiredSessions(ctx) })
	run("password_reset_tokens", func() (int64, error) { return q.PruneResetTokens(ctx) })
	run("email_verification_tokens", func() (int64, error) { return q.PruneVerificationTokens(ctx) })
	run("email_outbox", func() (int64, error) { return q.PruneEmailOutbox(ctx) })
	run("notification_records", func() (int64, error) { return q.PruneReadNotifications(ctx) })
	run("audit_logs", func() (int64, error) { return q.PruneAuditLogs(ctx) })
	abandon := m.AbandonAfter
	if abandon == 0 {
		abandon = 12 * time.Hour
	}
	run("abandoned_flights", func() (int64, error) {
		var n int64
		err := pgx.BeginFunc(ctx, m.Pool, func(tx pgx.Tx) error {
			tq := dbq.New(tx)
			rows, err := tq.AbandonStaleFlights(ctx, time.Now().Add(-abandon))
			if err != nil {
				return err
			}
			for _, r := range rows {
				if err := flights.PublishFlight(ctx, tq, r.ID); err != nil {
					return err
				}
			}
			n = int64(len(rows))
			return nil
		})
		return n, err
	})
	if len(report) > 0 {
		m.Log.Info("housekeeping", "pruned", report)
	}
}

// RunStatsRecompute rebuilds statistics for flights that received out-of-order samples.
func (m *Maintenance) RunStatsRecompute(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		if _, err := m.RecomputeDirty(ctx, 50); err != nil && ctx.Err() == nil {
			m.Log.Error("stats recompute failed", "err", err.Error())
		}
	}
}

// RecomputeDirty recomputes up to limit dirty flights and returns how many.
func (m *Maintenance) RecomputeDirty(ctx context.Context, limit int32) (int, error) {
	ids, err := dbq.New(m.Pool).ListDirtyFlights(ctx, limit)
	if err != nil {
		return 0, err
	}
	for _, id := range ids {
		err := pgx.BeginFunc(ctx, m.Pool, func(tx pgx.Tx) error {
			q := dbq.New(tx)
			if _, err := q.LockFlight(ctx, id); err != nil {
				return err
			}
			return flights.RecomputeStats(ctx, q, id)
		})
		if err != nil {
			return 0, err
		}
	}
	return len(ids), nil
}
