// Package app wires the modular monolith: router, background workers and
// graceful shutdown.
package app

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/admin"
	"github.com/mdenizay/retfast/services/api/internal/auth"
	"github.com/mdenizay/retfast/services/api/internal/email"
	"github.com/mdenizay/retfast/services/api/internal/events"
	"github.com/mdenizay/retfast/services/api/internal/flights"
	"github.com/mdenizay/retfast/services/api/internal/live"
	"github.com/mdenizay/retfast/services/api/internal/notifications"
	"github.com/mdenizay/retfast/services/api/internal/platform/config"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
	"github.com/mdenizay/retfast/services/api/internal/platform/ratelimit"
	"github.com/mdenizay/retfast/services/api/internal/platform/redisx"
	"github.com/mdenizay/retfast/services/api/internal/realtime"
	"github.com/mdenizay/retfast/services/api/internal/retrievals"
	"github.com/mdenizay/retfast/services/api/internal/tracking"
	"github.com/mdenizay/retfast/services/api/internal/users"
	"github.com/mdenizay/retfast/services/api/internal/weather"
)

// Version is set at build time (-ldflags "-X .../internal/app.Version=...").
var Version = "dev"

// App is one API instance.
type App struct {
	Cfg      *config.Config
	Log      *slog.Logger
	Pool     *pgxpool.Pool
	Redis    *redisx.Client
	Metrics  *metrics.Metrics
	Auth     *auth.Service
	WS       *realtime.Server
	Hub      *realtime.Hub
	Relay    *realtime.Relay
	Ingestor *tracking.Ingestor
	Handler  http.Handler
	Maint    *tracking.Maintenance
	Email    *email.Worker
	// SkipEmailWorker leaves queued emails untouched (tests that inspect bodies).
	SkipEmailWorker bool

	draining atomic.Bool
	wg       sync.WaitGroup
	stop     context.CancelFunc
}

// New builds an instance on an existing pool.
func New(ctx context.Context, cfg *config.Config, log *slog.Logger, pool *pgxpool.Pool) (*App, error) {
	rdb, err := redisx.New(cfg.RedisURL, cfg.RedisPrefix)
	if err != nil {
		return nil, err
	}
	m := metrics.New()
	lim := ratelimit.New(rdb, m)
	q := dbq.New(pool)
	a := &App{Cfg: cfg, Log: log, Pool: pool, Redis: rdb, Metrics: m}
	a.Auth = auth.NewService(pool, cfg, lim, m, log)
	a.Hub = realtime.NewHub(m, log)
	liveSvc := &live.Service{Q: q, Cursor: func(ctx context.Context) string {
		id, err := realtime.LatestID(ctx, rdb)
		if err != nil {
			return "0-0"
		}
		return id
	}}
	a.WS = &realtime.Server{Hub: a.Hub, Auth: a.Auth, Q: q, Live: liveSvc, Redis: rdb,
		Metrics: m, Log: log, OriginPatterns: realtime.OriginPatternsFrom(cfg.CORSOrigins)}
	a.Relay = &realtime.Relay{Pool: pool, Redis: rdb, Metrics: m, Log: log}
	a.Ingestor = &tracking.Ingestor{Pool: pool, Metrics: m, Log: log}
	a.Maint = &tracking.Maintenance{Pool: pool, Metrics: m, Log: log}
	a.Email = &email.Worker{Pool: pool, Metrics: m, Log: log,
		Sender: &email.Resend{APIKey: cfg.ResendAPIKey, From: cfg.MailFrom, BaseURL: cfg.ResendBaseURL}}

	if created, err := tracking.EnsurePartitions(ctx, pool, time.Now(), 3); err != nil {
		m.PartitionErrors.Inc()
		log.Error("startup partition maintenance failed", "err", err.Error())
	} else if len(created) > 0 {
		log.Info("partitions created", "partitions", created)
	}

	usersH := &users.Handler{Pool: pool, Q: q, DeletionGrace: cfg.DeletionGraceDur, Hash: auth.HashPassword}
	eventsH := &events.Handler{Pool: pool, Q: q, AppWebURL: cfg.AppWebURL}
	flightsH := &flights.Handler{Pool: pool, Q: q}
	liveH := &live.Handler{Live: liveSvc}
	telemetryH := &tracking.Handler{Ingestor: a.Ingestor, Limiter: lim}
	retrievalsH := &retrievals.Handler{Pool: pool, Q: q, Limiter: lim, Metrics: m}
	notifH := &notifications.Handler{Q: q}
	weatherH := &weather.Handler{Q: q, Redis: rdb, Client: &weather.Client{BaseURL: cfg.OpenMeteoURL}, Log: log}
	adminH := &admin.Handler{Pool: pool, Q: q, Redis: rdb, Auth: a.Auth, Status: a.checks}

	r := chi.NewRouter()
	r.Use(httpx.Base(log, httpx.ClientIPResolver{Trusted: cfg.TrustedProxies}, m.HTTPDuration))
	r.Use(httpx.CORS(cfg.CORSOrigins))
	r.NotFound(func(w http.ResponseWriter, r *http.Request) { httpx.WriteError(w, r, httpx.NotFound("")) })
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusMethodNotAllowed, Code: "not_found", Message: "Method not allowed"})
	})
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health/live", func(w http.ResponseWriter, _ *http.Request) {
			httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": Version})
		})
		r.Get("/health/ready", a.ready)
		r.Get("/meta", func(w http.ResponseWriter, _ *http.Request) {
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"environment": cfg.Env, "version": Version, "email_configured": cfg.ResendAPIKey != "",
				"push_configured": false})
		})
		r.Handle("/realtime", a.WS)
		r.Group(func(r chi.Router) {
			r.Use(httpx.Timeout(30 * time.Second))
			a.Auth.Routes(r)
			r.Group(func(r chi.Router) {
				r.Use(a.Auth.Middleware(auth.Optional))
				eventsH.PublicRoutes(r)
				flightsH.PublicRoutes(r)
				liveH.Routes(r)
				usersH.PublicRoutes(r)
				weatherH.Routes(r)
			})
			r.Group(func(r chi.Router) {
				r.Use(a.Auth.Middleware(auth.RequiredAllowPCR))
				usersH.RoutesPCR(r)
			})
			r.Group(func(r chi.Router) {
				r.Use(a.Auth.Middleware(auth.Required))
				usersH.Routes(r)
				eventsH.Routes(r)
				flightsH.Routes(r)
				telemetryH.Routes(r)
				retrievalsH.Routes(r)
				notifH.Routes(r)
				r.Group(adminH.Routes)
			})
		})
	})
	a.Handler = r
	return a, nil
}

func (a *App) checks(ctx context.Context) map[string]string {
	out := map[string]string{"postgres": "ok", "redis": "ok"}
	pctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := a.Pool.Ping(pctx); err != nil {
		out["postgres"] = "error"
	}
	if err := a.Redis.Healthy(ctx); err != nil {
		out["redis"] = "error"
	}
	return out
}

// ready is 503 when draining or PostgreSQL is down. Redis being down only
// degrades realtime fan-out (ingestion keeps working), so it reports
// "degraded" with 200 to keep the instance in rotation.
func (a *App) ready(w http.ResponseWriter, r *http.Request) {
	c := a.checks(r.Context())
	switch {
	case a.draining.Load():
		httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "draining", "checks": c})
	case c["postgres"] != "ok":
		httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "unavailable", "checks": c})
	case c["redis"] != "ok":
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"status": "degraded", "checks": c})
	default:
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"status": "ok", "checks": c})
	}
}

// StartWorkers launches background goroutines; StopWorkers cancels and waits.
func (a *App) StartWorkers(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	a.stop = cancel
	push := &notifications.PushWorker{Pool: a.Pool, Sender: notifications.UnconfiguredAPNs{Log: a.Log, Metrics: a.Metrics}, Log: a.Log}
	del := &users.DeletionWorker{Pool: a.Pool, Hash: auth.HashPassword, Log: a.Log}
	tail := &realtime.Tailer{Redis: a.Redis, Hub: a.Hub, Log: a.Log}
	runs := []func(context.Context){a.Relay.Run, tail.Run, push.Run, del.Run,
		a.Maint.RunPartitions, a.Maint.RunHousekeeping, a.Maint.RunStatsRecompute}
	if !a.SkipEmailWorker {
		runs = append(runs, a.Email.Run)
	}
	for _, run := range runs {
		a.wg.Add(1)
		go func(f func(context.Context)) {
			defer a.wg.Done()
			f(ctx)
		}(run)
	}
}

// StopWorkers cancels workers and waits up to d.
func (a *App) StopWorkers(d time.Duration) {
	if a.stop != nil {
		a.stop()
	}
	done := make(chan struct{})
	go func() { a.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(d):
		a.Log.Warn("workers did not stop in time")
	}
}

// BeginDrain marks the instance not ready and closes WebSockets with 1012.
func (a *App) BeginDrain() {
	a.draining.Store(true)
	a.WS.Drain()
}

// Close releases Redis (the pool is owned by the caller).
func (a *App) Close() { _ = a.Redis.Close() }

// Serve listens on cfg addresses until ctx is cancelled, then shuts down
// gracefully within cfg.ShutdownTimeout: stop accepting, close WS with 1012,
// drain in-flight requests (committed telemetry is acknowledged only after
// commit), stop workers, flush.
func (a *App) Serve(ctx context.Context) error {
	srv := &http.Server{Addr: a.Cfg.HTTPAddr, Handler: a.Handler, ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout: 120 * time.Second, BaseContext: func(net.Listener) context.Context { return context.WithoutCancel(ctx) }}
	msrv := &http.Server{Addr: a.Cfg.MetricsAddr, Handler: a.metricsMux(), ReadHeaderTimeout: 5 * time.Second}
	a.StartWorkers(context.WithoutCancel(ctx))
	errc := make(chan error, 2)
	go func() { errc <- srv.ListenAndServe() }()
	go func() {
		if err := msrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			a.Log.Error("metrics server failed", "err", err.Error())
		}
	}()
	a.Log.Info("retfast-api listening", "addr", a.Cfg.HTTPAddr, "metrics_addr", a.Cfg.MetricsAddr, "version", Version)
	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			a.StopWorkers(5 * time.Second)
			return err
		}
	case <-ctx.Done():
	}
	start := time.Now()
	a.Log.Info("shutdown: draining", "timeout", a.Cfg.ShutdownTimeout.String())
	a.BeginDrain()
	sctx, cancel := context.WithTimeout(context.Background(), a.Cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil {
		a.Log.Warn("shutdown: http drain incomplete", "err", err.Error())
	}
	remaining := a.Cfg.ShutdownTimeout - time.Since(start)
	if remaining < time.Second {
		remaining = time.Second
	}
	a.StopWorkers(remaining)
	_ = msrv.Shutdown(context.Background())
	a.Close()
	a.Log.Info("shutdown complete", "ms", time.Since(start).Milliseconds())
	return nil
}

func (a *App) metricsMux() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/metrics", a.Metrics.Handler())
	return mux
}

// OpenPool connects using cfg.
func OpenPool(ctx context.Context, cfg *config.Config) (*pgxpool.Pool, error) {
	return db.Connect(ctx, cfg.DatabaseURL, db.Options{MaxConns: cfg.DBMaxConns})
}
