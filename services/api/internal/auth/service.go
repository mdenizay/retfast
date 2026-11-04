package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/email"
	"github.com/mdenizay/retfast/services/api/internal/platform/config"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
	"github.com/mdenizay/retfast/services/api/internal/platform/ratelimit"
	"github.com/mdenizay/retfast/services/api/internal/users"
)

// Token lifetimes for single-use tokens.
const (
	ResetTTL  = time.Hour
	VerifyTTL = 48 * time.Hour
)

// CookieName is the web refresh cookie.
const CookieName = "rf_refresh"

// CookiePath scopes the refresh cookie to the auth endpoints.
const CookiePath = "/api/v1/auth"

// Service implements authentication.
type Service struct {
	Pool    *pgxpool.Pool
	Q       *dbq.Queries
	Tokens  *TokenIssuer
	Cfg     *config.Config
	Limiter *ratelimit.Limiter
	Metrics *metrics.Metrics
	Log     *slog.Logger

	cacheMu sync.Mutex
	cache   map[string]cachedState
}

type cachedState struct {
	actor   authz.Actor
	expires time.Time
}

// stateTTL bounds how long role changes, disabling or session revocation can
// take to reach other API instances.
const stateTTL = 10 * time.Second

// NewService builds the auth service.
func NewService(pool *pgxpool.Pool, cfg *config.Config, lim *ratelimit.Limiter, m *metrics.Metrics, log *slog.Logger) *Service {
	return &Service{Pool: pool, Q: dbq.New(pool), Tokens: NewTokenIssuer(cfg.JWTSecret), Cfg: cfg, Limiter: lim,
		Metrics: m, Log: log, cache: map[string]cachedState{}}
}

// AuthResponse per the contract.
type AuthResponse struct {
	AccessToken      string     `json:"access_token"`
	AccessExpiresAt  httpx.Time `json:"access_expires_at"`
	RefreshToken     string     `json:"refresh_token,omitempty"`
	RefreshExpiresAt httpx.Time `json:"refresh_expires_at"`
	User             *users.Me  `json:"user"`
}

// NormalizeEmail trims and lowercases; it returns "" if invalid.
func NormalizeEmail(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if len(s) < 3 || len(s) > 320 {
		return ""
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s || !strings.Contains(s[strings.LastIndex(s, "@")+1:], ".") {
		return ""
	}
	return s
}

// ---------------------------------------------------------------- sessions

type sessionMeta struct {
	Client     string
	DeviceName string
	IP         string
	UserAgent  string
}

func metaFrom(r *http.Request, client, device string) sessionMeta {
	ua := r.UserAgent()
	if len(ua) > 300 {
		ua = ua[:300]
	}
	if len(device) > 100 {
		device = device[:100]
	}
	return sessionMeta{Client: client, DeviceName: device, IP: httpx.ClientIP(r.Context()), UserAgent: ua}
}

// issue creates a refresh token row in family (new family if nil) and an access token.
func (s *Service) issue(ctx context.Context, q *dbq.Queries, userID uuid.UUID, family *uuid.UUID, m sessionMeta) (*AuthResponse, error) {
	fam := uuid.New()
	if family != nil {
		fam = *family
	}
	tok, hash, err := NewOpaqueToken()
	if err != nil {
		return nil, err
	}
	refreshExp := time.Now().Add(RefreshTTL)
	if err := q.CreateSession(ctx, dbq.CreateSessionParams{ID: uuid.New(), FamilyID: fam, UserID: userID, TokenHash: hash,
		Client: m.Client, DeviceName: m.DeviceName, Ip: m.IP, UserAgent: m.UserAgent, ExpiresAt: refreshExp}); err != nil {
		return nil, err
	}
	me, err := users.LoadMe(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	access, accessExp, err := s.Tokens.Issue(userID, fam, me.Roles, me.MustChangePassword)
	if err != nil {
		return nil, err
	}
	return &AuthResponse{AccessToken: access, AccessExpiresAt: httpx.T(accessExp), RefreshToken: tok,
		RefreshExpiresAt: httpx.T(refreshExp), User: me}, nil
}

func (s *Service) setCookie(w http.ResponseWriter, token string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: token, Path: CookiePath, Domain: s.Cfg.CookieDomain,
		Expires: exp, MaxAge: int(time.Until(exp).Seconds()), HttpOnly: true, Secure: s.Cfg.SecureCookies(),
		SameSite: http.SameSiteStrictMode})
}

func (s *Service) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: "", Path: CookiePath, Domain: s.Cfg.CookieDomain,
		MaxAge: -1, Expires: time.Unix(0, 0), HttpOnly: true, Secure: s.Cfg.SecureCookies(), SameSite: http.SameSiteStrictMode})
}

// respond writes an AuthResponse, moving the refresh token to the cookie for web clients.
func (s *Service) respond(w http.ResponseWriter, status int, client string, resp *AuthResponse) {
	if client == "web" {
		s.setCookie(w, resp.RefreshToken, resp.RefreshExpiresAt.Time)
		resp.RefreshToken = ""
	}
	httpx.WriteJSON(w, status, resp)
}

func (s *Service) limit(ctx context.Context, rule ratelimit.Rule, key string) error {
	if ok, retry := s.Limiter.Allow(ctx, rule, key); !ok {
		return httpx.RateLimited(retry)
	}
	return nil
}

// ---------------------------------------------------------------- actor resolution

// ResolveToken validates an access token and returns the current actor. Role,
// disabled and revocation state come from the database (cached for stateTTL).
func (s *Service) ResolveToken(ctx context.Context, token string) (*authz.Actor, error) {
	c, err := s.Tokens.Verify(token)
	if errors.Is(err, ErrTokenExpired) {
		return nil, httpx.TokenExpired()
	}
	if err != nil {
		return nil, httpx.Unauthorized("Invalid access token")
	}
	key := c.Subject + "/" + c.SID
	s.cacheMu.Lock()
	cs, ok := s.cache[key]
	s.cacheMu.Unlock()
	if ok && time.Now().Before(cs.expires) {
		a := cs.actor
		return &a, nil
	}
	uid, _ := uuid.Parse(c.Subject)
	sid, _ := uuid.Parse(c.SID)
	u, err := s.Q.GetUserByID(ctx, uid)
	if db.NotFound(err) {
		return nil, httpx.Unauthorized("Unknown user")
	}
	if err != nil {
		return nil, err
	}
	if u.DisabledAt != nil || u.DeletedAt != nil {
		return nil, httpx.Unauthorized("Account disabled")
	}
	active, err := s.Q.FamilyActive(ctx, sid)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, httpx.Unauthorized("Session revoked")
	}
	roles, err := s.Q.ListUserRoles(ctx, uid)
	if err != nil {
		return nil, err
	}
	a := authz.Actor{UserID: uid, SessionID: sid, Roles: roles, PCR: u.MustChangePassword, FullName: u.FullName}
	s.cacheMu.Lock()
	if len(s.cache) > 50_000 {
		s.cache = map[string]cachedState{}
	}
	s.cache[key] = cachedState{actor: a, expires: time.Now().Add(stateTTL)}
	s.cacheMu.Unlock()
	return &a, nil
}

// Invalidate drops cached state for a user (all sessions) on this instance.
func (s *Service) Invalidate(userID uuid.UUID) {
	prefix := userID.String() + "/"
	s.cacheMu.Lock()
	for k := range s.cache {
		if strings.HasPrefix(k, prefix) {
			delete(s.cache, k)
		}
	}
	s.cacheMu.Unlock()
}

// Auth modes for Middleware.
const (
	Optional = iota
	Required
	RequiredAllowPCR
)

// Middleware authenticates the Bearer token. Optional routes accept guests but
// still reject invalid/expired tokens so clients refresh.
func (s *Service) Middleware(mode int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			if h == "" {
				if mode != Optional {
					httpx.WriteError(w, r, httpx.Unauthorized("Authentication required"))
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			tok, ok := strings.CutPrefix(h, "Bearer ")
			if !ok || tok == "" {
				httpx.WriteError(w, r, httpx.Unauthorized("Malformed Authorization header"))
				return
			}
			a, err := s.ResolveToken(r.Context(), strings.TrimSpace(tok))
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			if a.PCR && mode != RequiredAllowPCR {
				httpx.WriteError(w, r, httpx.PasswordChangeRequired())
				return
			}
			next.ServeHTTP(w, r.WithContext(authz.WithActor(r.Context(), a)))
		})
	}
}

// ---------------------------------------------------------------- password reset helpers

// StartPasswordReset creates a reset token and queues the email. Used by
// /auth/password/forgot and the admin reset endpoint.
func (s *Service) StartPasswordReset(ctx context.Context, q *dbq.Queries, u dbq.User) error {
	link, err := s.CreateResetLink(ctx, q, u)
	if err != nil {
		return err
	}
	_, err = email.Enqueue(ctx, q, email.TplPasswordReset, u.Email, email.Data{Name: u.FullName, Link: link, AppURL: s.Cfg.AppWebURL})
	return err
}

// CreateResetLink creates a reset token and returns the web link containing it.
func (s *Service) CreateResetLink(ctx context.Context, q *dbq.Queries, u dbq.User) (string, error) {
	tok, hash, err := NewOpaqueToken()
	if err != nil {
		return "", err
	}
	if err := q.CreatePasswordResetToken(ctx, dbq.CreatePasswordResetTokenParams{UserID: u.ID, TokenHash: hash, ExpiresAt: time.Now().Add(ResetTTL)}); err != nil {
		return "", err
	}
	return s.Cfg.AppWebURL + "/reset-password?token=" + tok, nil
}

func (s *Service) createVerification(ctx context.Context, q *dbq.Queries, u dbq.User) error {
	tok, hash, err := NewOpaqueToken()
	if err != nil {
		return err
	}
	if err := q.CreateEmailVerificationToken(ctx, dbq.CreateEmailVerificationTokenParams{UserID: u.ID, Email: u.Email,
		TokenHash: hash, ExpiresAt: time.Now().Add(VerifyTTL)}); err != nil {
		return err
	}
	_, err = email.Enqueue(ctx, q, email.TplEmailVerification, u.Email, email.Data{Name: u.FullName,
		Link: s.Cfg.AppWebURL + "/verify-email?token=" + tok, AppURL: s.Cfg.AppWebURL})
	return err
}

func (s *Service) securityEmail(ctx context.Context, q *dbq.Queries, u dbq.User, detail string) error {
	_, err := email.Enqueue(ctx, q, email.TplSecurity, u.Email, email.Data{Name: u.FullName, Detail: detail, AppURL: s.Cfg.AppWebURL})
	return err
}

// tx runs fn in a transaction with a tx-bound Queries.
func (s *Service) tx(ctx context.Context, fn func(q *dbq.Queries) error) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error { return fn(dbq.New(tx)) })
}
