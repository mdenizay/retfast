// Package db owns the PostgreSQL pool, the embedded migration runner and helpers.
package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Options tune the pool.
type Options struct {
	MaxConns   int32
	SearchPath string // optional; tests use isolated schemas
}

// Connect opens a pgx pool and verifies connectivity.
func Connect(ctx context.Context, url string, o Options) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	if o.MaxConns > 0 {
		cfg.MaxConns = o.MaxConns
	}
	cfg.MinConns = 1
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second
	if cfg.ConnConfig.RuntimeParams == nil {
		cfg.ConnConfig.RuntimeParams = map[string]string{}
	}
	cfg.ConnConfig.RuntimeParams["application_name"] = "retfast-api"
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	if o.SearchPath != "" {
		cfg.ConnConfig.RuntimeParams["search_path"] = o.SearchPath
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return pool, nil
}

// IsUniqueViolation reports a 23505 error, optionally on the given constraint.
func IsUniqueViolation(err error, constraint string) bool {
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return constraint == "" || pe.ConstraintName == constraint
	}
	return false
}

// IsCheckViolation reports a 23514 (check) or 23502 (not null) error.
func IsCheckViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && (pe.Code == "23514" || pe.Code == "23502" || pe.Code == "22P02")
}

// IsForeignKeyViolation reports a 23503 error.
func IsForeignKeyViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23503"
}

// NotFound reports pgx.ErrNoRows.
func NotFound(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// Tx runs fn in a transaction, committing on nil error.
func Tx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
