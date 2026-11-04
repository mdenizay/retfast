// Command retfast-api is the Retfast API server and its operational tools.
//
//	retfast-api serve
//	retfast-api migrate up | down N | status
//	retfast-api seed [--demo-starts-at RFC3339] [--demo-window-days N] [--renew-bootstrap]
//	retfast-api healthcheck
//	retfast-api reset-link --email ADDRESS
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/mdenizay/retfast/services/api/internal/app"
	"github.com/mdenizay/retfast/services/api/internal/audit"
	"github.com/mdenizay/retfast/services/api/internal/auth"
	"github.com/mdenizay/retfast/services/api/internal/platform/config"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	rlog "github.com/mdenizay/retfast/services/api/internal/platform/log"
	"github.com/mdenizay/retfast/services/api/internal/seed"
	"github.com/mdenizay/retfast/services/api/migrations"
)

func usage() {
	fmt.Fprintln(os.Stderr, `usage: retfast-api <command>

commands:
  serve                         run the HTTP API, WebSocket hub and workers
  migrate up|down N|status      apply / revert / list schema migrations
  seed [flags]                  create bootstrap users and the Çameli demo event (idempotent)
  healthcheck                   GET /api/v1/health/ready on localhost; exit 0 if ready
  reset-link --email ADDRESS    print a one-hour password reset link (operator use when email is not configured)`)
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "serve":
		err = serve()
	case "migrate":
		err = migrate(os.Args[2:])
	case "seed":
		err = runSeed(os.Args[2:])
	case "healthcheck":
		err = healthcheck()
	case "reset-link":
		err = resetLink(os.Args[2:])
	case "version":
		fmt.Println(app.Version)
	case "-h", "--help", "help":
		usage()
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func loadConfig() (*config.Config, error) {
	return config.Load()
}

func serve() error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	log := rlog.New(os.Stdout, cfg.LogLevel)
	log.Info("starting", "config", cfg.Redacted())
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	pool, err := app.OpenPool(ctx, cfg)
	if err != nil {
		return err
	}
	defer pool.Close()
	a, err := app.New(ctx, cfg, log, pool)
	if err != nil {
		return err
	}
	return a.Serve(ctx)
}

func migrate(args []string) error {
	if len(args) < 1 {
		return errors.New("migrate needs up, down N or status")
	}
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	pool, err := app.OpenPool(ctx, cfg)
	if err != nil {
		return err
	}
	defer pool.Close()
	migs, err := db.LoadMigrations(migrations.FS)
	if err != nil {
		return err
	}
	log := rlog.New(os.Stdout, cfg.LogLevel)
	m := &db.Migrator{Pool: pool, Migrations: migs, Log: func(msg string, a ...any) { log.Info(msg, a...) }}
	switch args[0] {
	case "up":
		n, err := m.Up(ctx)
		if err != nil {
			return err
		}
		fmt.Printf("migrations applied: %d\n", n)
	case "down":
		if len(args) < 2 {
			return errors.New("migrate down needs N (number of migrations to revert)")
		}
		n, err := strconv.Atoi(args[1])
		if err != nil || n < 1 {
			return errors.New("N must be a positive integer")
		}
		done, err := m.Down(ctx, n)
		if err != nil {
			return err
		}
		fmt.Printf("migrations reverted: %d\n", done)
	case "status":
		st, err := m.Status(ctx)
		if err != nil {
			return err
		}
		for _, s := range st {
			applied := "pending"
			if s.AppliedAt != nil {
				applied = "applied " + s.AppliedAt.UTC().Format(time.RFC3339)
			}
			fmt.Printf("%04d_%s\t%s\n", s.Version, s.Name, applied)
		}
	default:
		return fmt.Errorf("unknown migrate command %q", args[0])
	}
	return nil
}

func runSeed(args []string) error {
	fs := flag.NewFlagSet("seed", flag.ContinueOnError)
	startsAt := fs.String("demo-starts-at", "", "demo window start (RFC 3339); default: today 00:00 Europe/Istanbul on first seed")
	days := fs.Int("demo-window-days", 0, "demo window length in days (default 90 on first seed)")
	renew := fs.Bool("renew-bootstrap", false, "re-issue the initial password (+7 days) for accounts that never changed it")
	if err := fs.Parse(args); err != nil {
		return err
	}
	o := seed.Options{WindowDays: *days, RenewBootstrap: *renew}
	if *startsAt != "" {
		t, err := time.Parse(time.RFC3339, *startsAt)
		if err != nil {
			return fmt.Errorf("--demo-starts-at: %w", err)
		}
		o.StartsAt = &t
	}
	if *days < 0 || *days > 3650 {
		return errors.New("--demo-window-days must be between 1 and 3650")
	}
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	pool, err := app.OpenPool(ctx, cfg)
	if err != nil {
		return err
	}
	defer pool.Close()
	res, err := seed.Run(ctx, pool, o)
	if err != nil {
		return err
	}
	res.Print(os.Stdout)
	return nil
}

func healthcheck() error {
	port := os.Getenv("HTTP_PORT")
	if port == "" {
		if addr := os.Getenv("HTTP_ADDR"); addr != "" {
			if _, p, err := net.SplitHostPort(addr); err == nil && p != "" {
				port = p
			}
		}
	}
	if port == "" {
		port = "8080"
	}
	c := &http.Client{Timeout: 4 * time.Second}
	resp, err := c.Get("http://127.0.0.1:" + port + "/api/v1/health/ready")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("not ready: http %d", resp.StatusCode)
	}
	return nil
}

func resetLink(args []string) error {
	fs := flag.NewFlagSet("reset-link", flag.ContinueOnError)
	addr := fs.String("email", "", "account email")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*addr) == "" {
		return errors.New("--email is required")
	}
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := app.OpenPool(ctx, cfg)
	if err != nil {
		return err
	}
	defer pool.Close()
	svc := auth.NewService(pool, cfg, nil, nil, rlog.Discard())
	var link string
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		u, err := q.GetUserByEmail(ctx, strings.ToLower(strings.TrimSpace(*addr)))
		if err != nil {
			return fmt.Errorf("user not found")
		}
		if link, err = svc.CreateResetLink(ctx, q, u); err != nil {
			return err
		}
		uid := u.ID
		return audit.Record(ctx, q, nil, audit.Entry{Action: "operator.reset_link_issued", TargetType: "user", TargetID: uid.String(),
			Details: map[string]any{"via": "cli"}})
	})
	if err != nil {
		return err
	}
	// Printed to stdout for the operator only; never logged.
	fmt.Println(link)
	return nil
}
