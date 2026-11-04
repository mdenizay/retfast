package httpx

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
)

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{8,64}$`)

func newID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// ClientIPResolver resolves the client address, trusting X-Forwarded-For only
// when the direct peer is a configured trusted proxy (Traefik).
type ClientIPResolver struct{ Trusted []netip.Prefix }

func (c ClientIPResolver) trusted(a netip.Addr) bool {
	for _, p := range c.Trusted {
		if p.Contains(a.Unmap()) {
			return true
		}
	}
	return false
}

// Resolve returns the client IP for r.
func (c ClientIPResolver) Resolve(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	peer = peer.Unmap()
	if !c.trusted(peer) {
		return peer.String()
	}
	xff := r.Header.Values("X-Forwarded-For")
	parts := []string{}
	for _, v := range xff {
		for _, p := range strings.Split(v, ",") {
			if p = strings.TrimSpace(p); p != "" {
				parts = append(parts, p)
			}
		}
	}
	// Walk right-to-left, skipping trusted hops; the first untrusted is the client.
	for i := len(parts) - 1; i >= 0; i-- {
		a, err := netip.ParseAddr(parts[i])
		if err != nil {
			return peer.String()
		}
		a = a.Unmap()
		if !c.trusted(a) {
			return a.String()
		}
	}
	return peer.String()
}

// statusWriter records the status code and supports hijacking (WebSocket).
type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += n
	return n, err
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijack not supported")
	}
	w.status = http.StatusSwitchingProtocols
	return hj.Hijack()
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// Base installs request id, client ip, request logger, panic recovery,
// security headers, access logging and latency metrics.
func Base(logger *slog.Logger, ips ClientIPResolver, latency *prometheus.HistogramVec) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rid := r.Header.Get("X-Request-Id")
			if !validRequestID.MatchString(rid) {
				rid = newID()
			}
			ip := ips.Resolve(r)
			l := logger.With("request_id", rid)
			ctx := context.WithValue(r.Context(), ctxRequestID, rid)
			ctx = context.WithValue(ctx, ctxClientIP, ip)
			ctx = context.WithValue(ctx, ctxLogger, l)
			r = r.WithContext(ctx)
			h := w.Header()
			h.Set("X-Request-Id", rid)
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Cache-Control", "no-store")
			sw := &statusWriter{ResponseWriter: w}
			defer func() {
				if rec := recover(); rec != nil {
					if rec == http.ErrAbortHandler {
						panic(rec)
					}
					l.Error("panic", "panic", rec, "stack", string(debug.Stack()))
					if sw.status == 0 {
						WriteError(sw, r, errors.New("panic"))
					}
				}
				status := sw.status
				if status == 0 {
					status = http.StatusOK
				}
				route := "unmatched"
				if rc := chi.RouteContext(r.Context()); rc != nil && rc.RoutePattern() != "" {
					route = rc.RoutePattern()
				}
				dur := time.Since(start)
				if latency != nil {
					latency.WithLabelValues(r.Method, route, strconv.Itoa(status)).Observe(dur.Seconds())
				}
				lvl := slog.LevelInfo
				if status >= 500 {
					lvl = slog.LevelError
				} else if route == "/api/v1/health/live" || route == "/api/v1/health/ready" {
					lvl = slog.LevelDebug
				}
				// Query strings are not logged: they may carry tokens or coordinates.
				l.Log(r.Context(), lvl, "http_request", "method", r.Method, "route", route, "status", status,
					"duration_ms", float64(dur.Microseconds())/1000, "bytes", sw.bytes, "ip", ip)
			}()
			next.ServeHTTP(sw, r)
		})
	}
}

// CORS allows credentialed requests from the configured origins only.
func CORS(origins []string) func(http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range origins {
		allowed[o] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && allowed[origin] {
				h := w.Header()
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Access-Control-Allow-Credentials", "true")
				h.Add("Vary", "Origin")
				h.Set("Access-Control-Expose-Headers", "X-Request-Id, Retry-After")
				if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
					h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
					h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Content-Encoding, X-Request-Id")
					h.Set("Access-Control-Max-Age", "600")
					w.WriteHeader(http.StatusNoContent)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// OriginAllowed reports whether a browser Origin header (if any) is allowed.
func OriginAllowed(r *http.Request, origins []string) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	for _, a := range origins {
		if a == o {
			return true
		}
	}
	return false
}

// Timeout bounds handler run time via the request context (not for WebSocket routes).
func Timeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
