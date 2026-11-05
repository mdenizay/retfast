package auth

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/audit"
	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/email"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/ratelimit"
	"github.com/mdenizay/retfast/services/api/internal/users"
)

const maxAuthBody = 8 << 10

// Routes mounts /auth/*. The caller mounts this under /api/v1.
func (s *Service) Routes(r chi.Router) {
	r.Post("/auth/register", httpx.H(s.register))
	r.Post("/auth/login", httpx.H(s.login))
	r.Post("/auth/refresh", httpx.H(s.refresh))
	r.Post("/auth/logout", httpx.H(s.logout))
	r.Post("/auth/password/forgot", httpx.H(s.forgot))
	r.Post("/auth/password/reset", httpx.H(s.reset))
	r.Post("/auth/email/verify", httpx.H(s.verifyEmail))
	r.With(s.Middleware(RequiredAllowPCR)).Post("/auth/password/change", httpx.H(s.changePassword))
	r.With(s.Middleware(Required)).Post("/auth/email/verify/resend", httpx.H(s.resendVerification))
}

func normClient(c string) (string, bool) {
	switch c {
	case "", "web":
		return "web", true
	case "ios":
		return "ios", true
	}
	return "", false
}

func (s *Service) register(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	if err := s.limit(ctx, ratelimit.Register, httpx.ClientIP(ctx)); err != nil {
		return err
	}
	var in struct {
		Email      string `json:"email"`
		Password   string `json:"password"`
		FullName   string `json:"full_name"`
		Client     string `json:"client"`
		DeviceName string `json:"device_name"`
	}
	if err := httpx.DecodeJSON(w, r, maxAuthBody, &in); err != nil {
		return err
	}
	d := map[string]string{}
	addr := NormalizeEmail(in.Email)
	if addr == "" {
		d["email"] = "must be a valid email address"
	}
	name := strings.TrimSpace(in.FullName)
	if name == "" || utf8.RuneCountInString(name) > 200 {
		d["full_name"] = "must be 1-200 characters"
	}
	if reason := ValidatePassword(in.Password, addr); reason != "" {
		d["password"] = reason
	}
	client, ok := normClient(in.Client)
	if !ok {
		d["client"] = "must be web or ios"
	}
	if len(d) > 0 {
		return httpx.Validation(d)
	}
	hash, err := HashPassword(in.Password)
	if err != nil {
		return err
	}
	var resp *AuthResponse
	err = s.tx(ctx, func(q *dbq.Queries) error {
		u, err := q.CreateUser(ctx, dbq.CreateUserParams{Email: addr, PasswordHash: hash, FullName: name})
		if db.IsUniqueViolation(err, "") {
			return httpx.Conflict("An account with this email already exists")
		}
		if err != nil {
			return err
		}
		if _, err := users.EnsurePilotProfile(ctx, q, u.ID, name, ""); err != nil {
			return err
		}
		if err := q.EnsurePreferences(ctx, u.ID); err != nil {
			return err
		}
		if err := s.createVerification(ctx, q, u); err != nil {
			return err
		}
		if _, err := email.Enqueue(ctx, q, email.TplWelcome, u.Email, email.Data{Name: u.FullName, AppURL: s.Cfg.AppWebURL}); err != nil {
			return err
		}
		uid := u.ID
		if err := audit.Record(ctx, q, r, audit.Entry{ActorID: &uid, Action: "auth.register", TargetType: "user", TargetID: uid.String()}); err != nil {
			return err
		}
		resp, err = s.issue(ctx, q, u.ID, nil, metaFrom(r, client, in.DeviceName))
		return err
	})
	if err != nil {
		return err
	}
	s.respond(w, http.StatusCreated, client, resp)
	return nil
}

var errBadCredentials = httpx.Unauthorized("Invalid email or password")

func (s *Service) login(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	var in struct {
		Email      string `json:"email"`
		Password   string `json:"password"`
		Client     string `json:"client"`
		DeviceName string `json:"device_name"`
	}
	if err := httpx.DecodeJSON(w, r, maxAuthBody, &in); err != nil {
		return err
	}
	ip := httpx.ClientIP(ctx)
	addr := strings.ToLower(strings.TrimSpace(in.Email))
	if err := s.limit(ctx, ratelimit.LoginIP, ip); err != nil {
		return err
	}
	if err := s.limit(ctx, ratelimit.LoginIPEmail, ip+"|"+addr); err != nil {
		return err
	}
	client, ok := normClient(in.Client)
	if !ok {
		return httpx.Validation(map[string]string{"client": "must be web or ios"})
	}
	if addr == "" || in.Password == "" || len(in.Password) > 256 {
		return errBadCredentials
	}
	u, err := s.Q.GetUserByEmail(ctx, addr)
	if err != nil && !db.NotFound(err) {
		return err
	}
	if db.NotFound(err) {
		_, _ = VerifyPassword(dummyHash, in.Password)
		_ = audit.Record(ctx, s.Q, r, audit.Entry{Action: "auth.login_failed", Details: map[string]any{"reason": "unknown_email"}})
		return errBadCredentials
	}
	ok, err = VerifyPassword(u.PasswordHash, in.Password)
	if err != nil && !errors.Is(err, ErrBadHash) {
		return err
	}
	uid := u.ID
	if !ok {
		_ = audit.Record(ctx, s.Q, r, audit.Entry{ActorID: &uid, Action: "auth.login_failed", TargetType: "user", TargetID: uid.String(),
			Details: map[string]any{"reason": "bad_password"}})
		return errBadCredentials
	}
	if u.DisabledAt != nil || u.DeletedAt != nil {
		_ = audit.Record(ctx, s.Q, r, audit.Entry{ActorID: &uid, Action: "auth.login_failed", TargetType: "user", TargetID: uid.String(),
			Details: map[string]any{"reason": "disabled"}})
		return errBadCredentials
	}
	if u.MustChangePassword && u.PasswordExpiresAt != nil && time.Now().After(*u.PasswordExpiresAt) {
		_ = audit.Record(ctx, s.Q, r, audit.Entry{ActorID: &uid, Action: "auth.login_failed", TargetType: "user", TargetID: uid.String(),
			Details: map[string]any{"reason": "bootstrap_password_expired"}})
		return &httpx.Error{Status: http.StatusUnauthorized, Code: "unauthorized",
			Message: "The initial password has expired. Ask an administrator for a password reset.",
			Details: map[string]string{"reason": "password_expired"}}
	}
	var resp *AuthResponse
	err = s.tx(ctx, func(q *dbq.Queries) error {
		var err error
		if resp, err = s.issue(ctx, q, u.ID, nil, metaFrom(r, client, in.DeviceName)); err != nil {
			return err
		}
		return audit.Record(ctx, q, r, audit.Entry{ActorID: &uid, Action: "auth.login", TargetType: "user", TargetID: uid.String(),
			Details: map[string]any{"client": client}})
	})
	if err != nil {
		return err
	}
	s.respond(w, http.StatusOK, client, resp)
	return nil
}

func (s *Service) presentedRefresh(w http.ResponseWriter, r *http.Request) (string, error) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := httpx.DecodeOptionalJSON(w, r, maxAuthBody, &in); err != nil {
		return "", err
	}
	if in.RefreshToken != "" {
		return in.RefreshToken, nil
	}
	if c, err := r.Cookie(CookieName); err == nil && c.Value != "" {
		// Cookie-authenticated requests must come from an allowed origin (CSRF defence in depth).
		if !httpx.OriginAllowed(r, s.Cfg.CORSOrigins) {
			return "", httpx.Forbidden("Origin not allowed")
		}
		return c.Value, nil
	}
	return "", nil
}

var errRefreshInvalid = httpx.Unauthorized("Invalid or expired refresh token")

func (s *Service) refresh(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	if err := s.limit(ctx, ratelimit.Refresh, httpx.ClientIP(ctx)); err != nil {
		return err
	}
	tok, err := s.presentedRefresh(w, r)
	if err != nil {
		return err
	}
	if tok == "" || len(tok) > 200 {
		return errRefreshInvalid
	}
	var resp *AuthResponse
	var client string
	var reuse *dbq.UserSession
	err = s.tx(ctx, func(q *dbq.Queries) error {
		sess, err := q.GetSessionByHashForUpdate(ctx, HashToken(tok))
		if db.NotFound(err) {
			return errRefreshInvalid
		}
		if err != nil {
			return err
		}
		if sess.RevokedAt != nil {
			return errRefreshInvalid
		}
		if sess.RotatedAt != nil {
			// Reuse of a rotated token: revoke the whole family and commit that.
			if _, err := q.RevokeFamily(ctx, dbq.RevokeFamilyParams{FamilyID: sess.FamilyID, Reason: "refresh_reuse_detected"}); err != nil {
				return err
			}
			uid := sess.UserID
			if err := audit.Record(ctx, q, r, audit.Entry{ActorID: &uid, Action: "auth.refresh_reuse_detected", TargetType: "session",
				TargetID: sess.FamilyID.String(), Details: map[string]any{"client": sess.Client}}); err != nil {
				return err
			}
			reuse = &sess
			return nil
		}
		if time.Now().After(sess.ExpiresAt) {
			return errRefreshInvalid
		}
		u, err := q.GetUserByID(ctx, sess.UserID)
		if err != nil {
			return err
		}
		if u.DisabledAt != nil || u.DeletedAt != nil {
			_, _ = q.RevokeFamily(ctx, dbq.RevokeFamilyParams{FamilyID: sess.FamilyID, Reason: "account_disabled"})
			return nil
		}
		if err := q.MarkSessionRotated(ctx, sess.ID); err != nil {
			return err
		}
		client = sess.Client
		fam := sess.FamilyID
		resp, err = s.issue(ctx, q, sess.UserID, &fam, sessionMeta{Client: sess.Client, DeviceName: sess.DeviceName,
			IP: httpx.ClientIP(ctx), UserAgent: truncate(r.UserAgent(), 300)})
		return err
	})
	if err != nil {
		if errors.Is(err, errRefreshInvalid) {
			s.clearCookie(w)
		}
		return err
	}
	if reuse != nil {
		s.Invalidate(reuse.UserID)
		s.Log.Warn("refresh token reuse detected; session family revoked", "user_id", reuse.UserID.String())
		s.clearCookie(w)
		return httpx.Unauthorized("Refresh token reuse detected; please sign in again")
	}
	if resp == nil {
		s.clearCookie(w)
		return errRefreshInvalid
	}
	s.respond(w, http.StatusOK, client, resp)
	return nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func (s *Service) logout(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	tok, err := s.presentedRefresh(w, r)
	if err != nil {
		return err
	}
	var fam *uuid.UUID
	var uid *uuid.UUID
	if tok != "" {
		err := s.tx(ctx, func(q *dbq.Queries) error {
			sess, err := q.GetSessionByHashForUpdate(ctx, HashToken(tok))
			if err != nil {
				return err
			}
			fam, uid = &sess.FamilyID, &sess.UserID
			return nil
		})
		if err != nil && !db.NotFound(err) {
			return err
		}
	}
	if fam == nil {
		// Fall back to the access token's session id.
		if h, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
			if c, err := s.Tokens.Verify(strings.TrimSpace(h)); err == nil {
				f, _ := uuid.Parse(c.SID)
				u, _ := uuid.Parse(c.Subject)
				fam, uid = &f, &u
			}
		}
	}
	if fam != nil {
		if _, err := s.Q.RevokeFamily(ctx, dbq.RevokeFamilyParams{FamilyID: *fam, Reason: "logout"}); err != nil {
			return err
		}
		s.Invalidate(*uid)
		_ = audit.Record(ctx, s.Q, r, audit.Entry{ActorID: uid, Action: "auth.logout", TargetType: "session", TargetID: fam.String()})
	}
	s.clearCookie(w)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Service) changePassword(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	if err := s.limit(ctx, ratelimit.PasswordChg, a.UserID.String()); err != nil {
		return err
	}
	var in struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := httpx.DecodeJSON(w, r, maxAuthBody, &in); err != nil {
		return err
	}
	u, err := s.Q.GetUserByID(ctx, a.UserID)
	if err != nil {
		return err
	}
	ok, _ := VerifyPassword(u.PasswordHash, in.CurrentPassword)
	if !ok {
		return httpx.Validation(map[string]string{"current_password": "is incorrect"})
	}
	if reason := ValidatePassword(in.NewPassword, u.Email); reason != "" {
		return httpx.Validation(map[string]string{"new_password": reason})
	}
	if in.NewPassword == in.CurrentPassword {
		return httpx.Validation(map[string]string{"new_password": "must differ from the current password"})
	}
	hash, err := HashPassword(in.NewPassword)
	if err != nil {
		return err
	}
	var resp *AuthResponse
	var client string
	err = s.tx(ctx, func(q *dbq.Queries) error {
		now := time.Now()
		if err := q.UpdateUserPassword(ctx, dbq.UpdateUserPasswordParams{ID: u.ID, PasswordHash: hash, MustChangePassword: false,
			PasswordChangedAt: &now}); err != nil {
			return err
		}
		// All sessions (including this one) are revoked; a fresh session is issued below.
		if err := q.RevokeAllUserSessions(ctx, dbq.RevokeAllUserSessionsParams{UserID: u.ID, Reason: "password_changed"}); err != nil {
			return err
		}
		if err := q.MarkPasswordResetTokensUsed(ctx, u.ID); err != nil {
			return err
		}
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "auth.password_changed", TargetType: "user", TargetID: u.ID.String(),
			Details: map[string]any{"was_required": u.MustChangePassword}}); err != nil {
			return err
		}
		if err := s.securityEmail(ctx, q, u, "Retfast şifreniz değiştirildi. Diğer tüm oturumlar kapatıldı."); err != nil {
			return err
		}
		var err error
		// Keep the client type of the session that made the change.
		if client, err = q.GetFamilyClient(ctx, a.SessionID); err != nil {
			return err
		}
		resp, err = s.issue(ctx, q, u.ID, nil, metaFrom(r, client, ""))
		return err
	})
	if err != nil {
		return err
	}
	s.Invalidate(u.ID)
	s.respond(w, http.StatusOK, client, resp)
	return nil
}

func (s *Service) forgot(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	if err := s.limit(ctx, ratelimit.Forgot, httpx.ClientIP(ctx)); err != nil {
		return err
	}
	var in struct {
		Email string `json:"email"`
	}
	if err := httpx.DecodeJSON(w, r, maxAuthBody, &in); err != nil {
		return err
	}
	addr := NormalizeEmail(in.Email)
	if addr != "" {
		u, err := s.Q.GetUserByEmail(ctx, addr)
		if err == nil && u.DisabledAt == nil && u.DeletedAt == nil {
			n, err := s.Q.CountRecentResetTokens(ctx, u.ID)
			if err != nil {
				return err
			}
			if n < 5 {
				if err := s.tx(ctx, func(q *dbq.Queries) error {
					uid := u.ID
					if err := s.StartPasswordReset(ctx, q, u); err != nil {
						return err
					}
					return audit.Record(ctx, q, r, audit.Entry{ActorID: &uid, Action: "auth.password_reset_requested", TargetType: "user", TargetID: uid.String()})
				}); err != nil {
					return err
				}
			}
		} else if err != nil && !db.NotFound(err) {
			return err
		}
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
	return nil
}

var errTokenInvalid = httpx.Validation(map[string]string{"token": "invalid or expired"})

func (s *Service) reset(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	if err := s.limit(ctx, ratelimit.Reset, httpx.ClientIP(ctx)); err != nil {
		return err
	}
	var in struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if err := httpx.DecodeJSON(w, r, maxAuthBody, &in); err != nil {
		return err
	}
	if in.Token == "" || len(in.Token) > 200 {
		return errTokenInvalid
	}
	var uid uuid.UUID
	err := s.tx(ctx, func(q *dbq.Queries) error {
		t, err := q.GetPasswordResetTokenForUpdate(ctx, HashToken(in.Token))
		if db.NotFound(err) {
			return errTokenInvalid
		}
		if err != nil {
			return err
		}
		if t.UsedAt != nil || time.Now().After(t.ExpiresAt) {
			return errTokenInvalid
		}
		u, err := q.GetUserByID(ctx, t.UserID)
		if err != nil {
			return err
		}
		if u.DisabledAt != nil || u.DeletedAt != nil {
			return errTokenInvalid
		}
		if reason := ValidatePassword(in.NewPassword, u.Email); reason != "" {
			return httpx.Validation(map[string]string{"new_password": reason})
		}
		hash, err := HashPassword(in.NewPassword)
		if err != nil {
			return err
		}
		now := time.Now()
		if err := q.UpdateUserPassword(ctx, dbq.UpdateUserPasswordParams{ID: u.ID, PasswordHash: hash, PasswordChangedAt: &now}); err != nil {
			return err
		}
		if err := q.MarkPasswordResetTokensUsed(ctx, u.ID); err != nil {
			return err
		}
		if err := q.RevokeAllUserSessions(ctx, dbq.RevokeAllUserSessionsParams{UserID: u.ID, Reason: "password_reset"}); err != nil {
			return err
		}
		// A working reset link proves control of the mailbox.
		if err := q.SetEmailVerified(ctx, u.ID); err != nil {
			return err
		}
		uid = u.ID
		if err := audit.Record(ctx, q, r, audit.Entry{ActorID: &uid, Action: "auth.password_reset", TargetType: "user", TargetID: uid.String()}); err != nil {
			return err
		}
		return s.securityEmail(ctx, q, u, "Retfast şifreniz sıfırlama bağlantısı ile değiştirildi. Tüm oturumlar kapatıldı.")
	})
	if err != nil {
		return err
	}
	s.Invalidate(uid)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Service) verifyEmail(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	if err := s.limit(ctx, ratelimit.Reset, httpx.ClientIP(ctx)); err != nil {
		return err
	}
	var in struct {
		Token string `json:"token"`
	}
	if err := httpx.DecodeJSON(w, r, maxAuthBody, &in); err != nil {
		return err
	}
	if in.Token == "" || len(in.Token) > 200 {
		return errTokenInvalid
	}
	err := s.tx(ctx, func(q *dbq.Queries) error {
		t, err := q.GetEmailVerificationTokenForUpdate(ctx, HashToken(in.Token))
		if db.NotFound(err) {
			return errTokenInvalid
		}
		if err != nil {
			return err
		}
		if t.UsedAt != nil || time.Now().After(t.ExpiresAt) {
			return errTokenInvalid
		}
		u, err := q.GetUserByID(ctx, t.UserID)
		if err != nil {
			return err
		}
		if !strings.EqualFold(u.Email, t.Email) {
			return errTokenInvalid
		}
		if err := q.SetEmailVerified(ctx, u.ID); err != nil {
			return err
		}
		if err := q.MarkEmailVerificationTokenUsed(ctx, t.ID); err != nil {
			return err
		}
		uid := u.ID
		return audit.Record(ctx, q, r, audit.Entry{ActorID: &uid, Action: "auth.email_verified", TargetType: "user", TargetID: uid.String()})
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Service) resendVerification(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	if err := s.limit(ctx, ratelimit.VerifyResend, a.UserID.String()); err != nil {
		return err
	}
	u, err := s.Q.GetUserByID(ctx, a.UserID)
	if err != nil {
		return err
	}
	if u.EmailVerifiedAt == nil {
		if err := s.tx(ctx, func(q *dbq.Queries) error { return s.createVerification(ctx, q, u) }); err != nil {
			return err
		}
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
	return nil
}
