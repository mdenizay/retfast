package db

import (
	"context"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Migration is one numbered schema step.
type Migration struct {
	Version int
	Name    string
	Up      string
	Down    string
}

// MigrationStatus describes one migration and whether it has been applied.
type MigrationStatus struct {
	Version   int
	Name      string
	AppliedAt *time.Time
}

var migrationFile = regexp.MustCompile(`^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$`)

// LoadMigrations parses NNNN_name.up.sql / .down.sql files from fsys.
func LoadMigrations(fsys fs.FS) ([]Migration, error) {
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return nil, err
	}
	byVersion := map[int]*Migration{}
	for _, e := range entries {
		m := migrationFile.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		v, _ := strconv.Atoi(m[1])
		body, err := fs.ReadFile(fsys, e.Name())
		if err != nil {
			return nil, err
		}
		mig := byVersion[v]
		if mig == nil {
			mig = &Migration{Version: v, Name: m[2]}
			byVersion[v] = mig
		} else if mig.Name != m[2] {
			return nil, fmt.Errorf("migration %04d has two names: %s, %s", v, mig.Name, m[2])
		}
		if m[3] == "up" {
			mig.Up = string(body)
		} else {
			mig.Down = string(body)
		}
	}
	out := make([]Migration, 0, len(byVersion))
	for _, m := range byVersion {
		if m.Up == "" || m.Down == "" {
			return nil, fmt.Errorf("migration %04d_%s needs both up and down files", m.Version, m.Name)
		}
		out = append(out, *m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	for i, m := range out {
		if m.Version != i+1 {
			return nil, fmt.Errorf("migration versions must be contiguous from 0001; missing %04d", i+1)
		}
	}
	return out, nil
}

// Migrator applies migrations under a session advisory lock so concurrent
// `migrate` runs (e.g. two containers starting) serialise safely.
type Migrator struct {
	Pool       *pgxpool.Pool
	Migrations []Migration
	Log        func(msg string, args ...any)
}

const migrateLockSQL = `SELECT pg_advisory_lock(hashtextextended('retfast-migrate:' || current_schema(), 0))`
const migrateUnlockSQL = `SELECT pg_advisory_unlock(hashtextextended('retfast-migrate:' || current_schema(), 0))`

func (m *Migrator) withLock(ctx context.Context, fn func(conn *pgx.Conn) error) error {
	c, err := m.Pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer c.Release()
	conn := c.Conn()
	if _, err := conn.Exec(ctx, migrateLockSQL); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), migrateUnlockSQL) }()
	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	return fn(conn)
}

func applied(ctx context.Context, conn *pgx.Conn) (map[int]time.Time, error) {
	rows, err := conn.Query(ctx, `SELECT version, applied_at FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int]time.Time{}
	for rows.Next() {
		var v int
		var t time.Time
		if err := rows.Scan(&v, &t); err != nil {
			return nil, err
		}
		out[v] = t
	}
	return out, rows.Err()
}

func (m *Migrator) logf(msg string, args ...any) {
	if m.Log != nil {
		m.Log(msg, args...)
	}
}

// Up applies all pending migrations and returns how many ran. Zero is success.
func (m *Migrator) Up(ctx context.Context) (int, error) {
	n := 0
	err := m.withLock(ctx, func(conn *pgx.Conn) error {
		done, err := applied(ctx, conn)
		if err != nil {
			return err
		}
		for _, mig := range m.Migrations {
			if _, ok := done[mig.Version]; ok {
				continue
			}
			start := time.Now()
			if err := pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, mig.Up); err != nil {
					return err
				}
				_, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`, mig.Version, mig.Name)
				return err
			}); err != nil {
				return fmt.Errorf("migration %04d_%s up: %w", mig.Version, mig.Name, err)
			}
			n++
			m.logf("migration applied", "version", mig.Version, "name", mig.Name, "ms", time.Since(start).Milliseconds())
		}
		return nil
	})
	return n, err
}

// Down reverts the most recent `steps` applied migrations.
func (m *Migrator) Down(ctx context.Context, steps int) (int, error) {
	if steps < 1 {
		return 0, fmt.Errorf("down needs N >= 1")
	}
	n := 0
	err := m.withLock(ctx, func(conn *pgx.Conn) error {
		done, err := applied(ctx, conn)
		if err != nil {
			return err
		}
		for i := len(m.Migrations) - 1; i >= 0 && n < steps; i-- {
			mig := m.Migrations[i]
			if _, ok := done[mig.Version]; !ok {
				continue
			}
			if err := pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, mig.Down); err != nil {
					return err
				}
				_, err := tx.Exec(ctx, `DELETE FROM schema_migrations WHERE version = $1`, mig.Version)
				return err
			}); err != nil {
				return fmt.Errorf("migration %04d_%s down: %w", mig.Version, mig.Name, err)
			}
			n++
			m.logf("migration reverted", "version", mig.Version, "name", mig.Name)
		}
		return nil
	})
	return n, err
}

// Status lists every known migration with its applied time.
func (m *Migrator) Status(ctx context.Context) ([]MigrationStatus, error) {
	var out []MigrationStatus
	err := m.withLock(ctx, func(conn *pgx.Conn) error {
		done, err := applied(ctx, conn)
		if err != nil {
			return err
		}
		for _, mig := range m.Migrations {
			s := MigrationStatus{Version: mig.Version, Name: mig.Name}
			if t, ok := done[mig.Version]; ok {
				s.AppliedAt = &t
			}
			out = append(out, s)
		}
		return nil
	})
	return out, err
}
