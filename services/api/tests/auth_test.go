package tests

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/mdenizay/retfast/services/api/internal/seed"
)

func TestRegisterLoginRefreshRotationAndReuse(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	u := e.Register("Ayşe Pilot")
	if u.Refresh == "" || u.Token == "" {
		t.Fatal("ios register must return access and refresh tokens")
	}
	me := e.Must(e.Do("GET", "/me", nil, Req{Token: u.Token}), 200).JSON()
	if me["email"] != u.Email || me["must_change_password"] != false {
		t.Fatalf("unexpected me: %v", me)
	}
	roles := me["roles"].([]any)
	if len(roles) != 0 {
		t.Fatalf("roles = %v", roles)
	}
	if me["pilot"] == nil {
		t.Fatal("pilot profile missing")
	}
	// duplicate email
	r := e.Do("POST", "/auth/register", map[string]any{"email": strings.ToUpper(u.Email), "password": "Another-Pass-123", "full_name": "x"}, Req{})
	if r.Status != 409 {
		t.Fatalf("duplicate email: %d", r.Status)
	}
	// rotation
	r1 := e.Must(e.Do("POST", "/auth/refresh", map[string]any{"refresh_token": u.Refresh}, Req{}), 200).JSON()
	rt1 := r1["refresh_token"].(string)
	if rt1 == u.Refresh {
		t.Fatal("refresh token not rotated")
	}
	r2 := e.Must(e.Do("POST", "/auth/refresh", map[string]any{"refresh_token": rt1}, Req{}), 200).JSON()
	rt2 := r2["refresh_token"].(string)
	// reuse of the first (rotated) token revokes the whole family
	reuse := e.Do("POST", "/auth/refresh", map[string]any{"refresh_token": u.Refresh}, Req{})
	if reuse.Status != 401 {
		t.Fatalf("reuse should be 401, got %d", reuse.Status)
	}
	if r := e.Do("POST", "/auth/refresh", map[string]any{"refresh_token": rt2}, Req{}); r.Status != 401 {
		t.Fatalf("family should be revoked after reuse, got %d", r.Status)
	}
	// the access token of the revoked family stops working (after the state cache)
	e.App.Auth.Invalidate(u.ID)
	if r := e.Do("GET", "/me", nil, Req{Token: r2["access_token"].(string)}); r.Status != 401 {
		t.Fatalf("access token of revoked family should be 401, got %d", r.Status)
	}
	var n int
	if err := e.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_logs WHERE action = 'auth.refresh_reuse_detected' AND actor_id = $1`, u.ID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("reuse audit rows = %d err=%v", n, err)
	}
	// a fresh login works; logout revokes it
	e.Login(u)
	e.Must(e.Do("POST", "/auth/logout", map[string]any{"refresh_token": u.Refresh}, Req{}), 204)
	if r := e.Do("POST", "/auth/refresh", map[string]any{"refresh_token": u.Refresh}, Req{}); r.Status != 401 {
		t.Fatalf("refresh after logout: %d", r.Status)
	}
	// wrong password
	if r := e.Do("POST", "/auth/login", map[string]any{"email": u.Email, "password": "nope-nope-nope", "client": "ios"}, Req{}); r.Status != 401 || r.ErrCode() != "unauthorized" {
		t.Fatalf("bad password: %d %s", r.Status, r.Body)
	}
}

func TestWebCookieFlow(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	u := e.Register("Web User")
	r := e.Must(e.Do("POST", "/auth/login", map[string]any{"email": u.Email, "password": u.Password, "client": "web"}, Req{}), 200)
	if _, ok := r.JSON()["refresh_token"]; ok {
		t.Fatal("web login must not return refresh_token in the body")
	}
	var cookie *http.Cookie
	for _, c := range (&http.Response{Header: r.Header}).Cookies() {
		if c.Name == "rf_refresh" {
			cookie = c
		}
	}
	if cookie == nil || !cookie.HttpOnly || cookie.Path != "/api/v1/auth" || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("bad cookie: %+v", cookie)
	}
	setCookie := r.Header.Get("Set-Cookie")
	if strings.Contains(setCookie, "Secure") {
		t.Fatal("Secure must be off in development")
	}
	// refresh with the cookie from an allowed origin
	rr := e.Must(e.Do("POST", "/auth/refresh", nil, Req{Cookies: []*http.Cookie{{Name: "rf_refresh", Value: cookie.Value}},
		Header: map[string]string{"Origin": "http://localhost:5173"}}), 200)
	if rr.Header.Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatal("missing CORS header")
	}
	// a foreign origin cannot use the cookie
	var newCookie string
	for _, c := range (&http.Response{Header: rr.Header}).Cookies() {
		if c.Name == "rf_refresh" {
			newCookie = c.Value
		}
	}
	bad := e.Do("POST", "/auth/refresh", nil, Req{Cookies: []*http.Cookie{{Name: "rf_refresh", Value: newCookie}},
		Header: map[string]string{"Origin": "https://evil.example"}})
	if bad.Status != 403 {
		t.Fatalf("foreign origin refresh: %d", bad.Status)
	}
}

func TestPasswordChangeGateAndBootstrapExpiry(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := context.Background()
	if _, err := seed.Run(ctx, e.Pool, seed.Options{}); err != nil {
		t.Fatal(err)
	}
	login := func(email, pw string) Resp {
		return e.Do("POST", "/auth/login", map[string]any{"email": email, "password": pw, "client": "ios"}, Req{})
	}
	r := e.Must(login("tecelli@retfast.com", "password"), 200).JSON()
	tok := r["access_token"].(string)
	if r["user"].(map[string]any)["must_change_password"] != true {
		t.Fatal("seed user must have must_change_password")
	}
	// allowed: GET /me ; blocked: everything else
	e.Must(e.Do("GET", "/me", nil, Req{Token: tok}), 200)
	for _, p := range []struct{ m, path string }{{"GET", "/events"}, {"PATCH", "/me"}, {"GET", "/flights"}, {"GET", "/notifications"}} {
		res := e.Do(p.m, p.path, map[string]any{}, Req{Token: tok})
		if res.Status != 403 || res.ErrCode() != "password_change_required" {
			t.Fatalf("%s %s: want 403 password_change_required, got %d %s", p.m, p.path, res.Status, res.Body)
		}
	}
	// policy: the bootstrap password and short/common passwords are refused
	for _, bad := range []string{"password", "short", "password123", "tecelli@retfast.com"} {
		res := e.Do("POST", "/auth/password/change", map[string]any{"current_password": "password", "new_password": bad}, Req{Token: tok})
		if res.Status != 422 || !strings.Contains(string(res.Body), "new_password") {
			t.Fatalf("new_password %q accepted: %d %s", bad, res.Status, res.Body)
		}
	}
	ch := e.Must(e.Do("POST", "/auth/password/change", map[string]any{"current_password": "password", "new_password": "Tecelli-Yeni-Sifre-1"}, Req{Token: tok}), 200).JSON()
	if ch["user"].(map[string]any)["must_change_password"] != false {
		t.Fatal("must_change_password not cleared")
	}
	tok2 := ch["access_token"].(string)
	e.Must(e.Do("GET", "/events", nil, Req{Token: tok2}), 200)
	// old session revoked
	e.App.Auth.Invalidate(uuidOf(t, ch["user"]))
	if res := e.Do("GET", "/me", nil, Req{Token: tok}); res.Status != 401 {
		t.Fatalf("old session should be revoked, got %d", res.Status)
	}
	// re-seed never resets a user who changed the password
	if _, err := seed.Run(ctx, e.Pool, seed.Options{RenewBootstrap: true}); err != nil {
		t.Fatal(err)
	}
	if res := login("tecelli@retfast.com", "password"); res.Status != 401 {
		t.Fatalf("bootstrap password must not work after change+reseed: %d", res.Status)
	}
	e.Must(login("tecelli@retfast.com", "Tecelli-Yeni-Sifre-1"), 200)

	// bootstrap expiry: expired initial password is refused
	if _, err := e.Pool.Exec(ctx, `UPDATE users SET password_expires_at = now() - interval '1 minute' WHERE email = 'emre@retfast.com'`); err != nil {
		t.Fatal(err)
	}
	res := login("emre@retfast.com", "password")
	if res.Status != 401 || !strings.Contains(string(res.Body), "password_expired") {
		t.Fatalf("expired bootstrap: %d %s", res.Status, res.Body)
	}
	// --renew-bootstrap re-issues it for users who never changed it
	out, err := seed.Run(ctx, e.Pool, seed.Options{RenewBootstrap: true})
	if err != nil {
		t.Fatal(err)
	}
	if out.UsersRenewed != 4 {
		t.Fatalf("renewed = %d, want 4", out.UsersRenewed)
	}
	e.Must(login("emre@retfast.com", "password"), 200)
}

var tokenRe = regexp.MustCompile(`token=([A-Za-z0-9_-]+)`)

func TestForgotResetAndEmailVerification(t *testing.T) {
	t.Parallel()
	e := newEnvWith(t, envOpts{noEmail: true})
	ctx := context.Background()
	u := e.Register("Reset User")
	// unknown email: still 202 (no enumeration)
	e.Must(e.Do("POST", "/auth/password/forgot", map[string]any{"email": "nobody@example.com"}, Req{}), 202)
	e.Must(e.Do("POST", "/auth/password/forgot", map[string]any{"email": u.Email}, Req{}), 202)
	var body string
	if err := e.Pool.QueryRow(ctx, `SELECT text_body FROM email_outbox WHERE to_email = $1 AND template = 'password_reset' ORDER BY created_at DESC LIMIT 1`, u.Email).Scan(&body); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(body, u.Password) {
		t.Fatal("email must never contain a password")
	}
	m := tokenRe.FindStringSubmatch(body)
	if m == nil {
		t.Fatalf("no token link in email: %s", body)
	}
	e.Must(e.Do("POST", "/auth/password/reset", map[string]any{"token": m[1], "new_password": "Brand-New-Password-9"}, Req{}), 204)
	if r := e.Do("POST", "/auth/password/reset", map[string]any{"token": m[1], "new_password": "Brand-New-Password-10"}, Req{}); r.Status != 422 {
		t.Fatalf("reset token reuse: %d", r.Status)
	}
	// all sessions revoked; new password works
	if r := e.Do("POST", "/auth/refresh", map[string]any{"refresh_token": u.Refresh}, Req{}); r.Status != 401 {
		t.Fatalf("sessions should be revoked after reset: %d", r.Status)
	}
	u.Password = "Brand-New-Password-9"
	e.Login(u)

	// email verification token from the registration email
	v := tokenRe.FindStringSubmatch(func() string {
		var b string
		_ = e.Pool.QueryRow(ctx, `SELECT text_body FROM email_outbox WHERE to_email = $1 AND template = 'email_verification' ORDER BY created_at LIMIT 1`, u.Email).Scan(&b)
		return b
	}())
	if v == nil {
		t.Fatal("no verification link in email")
	}
	e.Must(e.Do("POST", "/auth/email/verify", map[string]any{"token": v[1]}, Req{}), 204)
	if me := e.Must(e.Do("GET", "/me", nil, Req{Token: u.Token}), 200).JSON(); me["email_verified"] != true {
		t.Fatal("email not verified")
	}
}

func TestLoginRateLimit(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	u := e.Register("Limit User")
	ip := randomIP()
	var last Resp
	for i := 0; i < 6; i++ {
		last = e.Do("POST", "/auth/login", map[string]any{"email": u.Email, "password": "wrong-password-x", "client": "ios"}, Req{IP: ip})
	}
	if last.Status != 429 || last.Header.Get("Retry-After") == "" || last.ErrCode() != "rate_limited" {
		t.Fatalf("6th login: %d %s retry=%q", last.Status, last.Body, last.Header.Get("Retry-After"))
	}
	// a different IP is not affected (use a fresh IP: the default test IP is shared by parallel tests)
	e.Must(e.Do("POST", "/auth/login", map[string]any{"email": u.Email, "password": u.Password, "client": "ios"}, Req{IP: randomIP()}), 200)
}

func TestEmailWorkerMarksUnconfiguredFailed(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	u := e.Register("Mail User")
	ctx := context.Background()
	Eventually(t, 10*time.Second, func() bool {
		var n int
		_ = e.Pool.QueryRow(ctx, `SELECT count(*) FROM email_outbox WHERE to_email = $1 AND status = 'failed' AND last_error = 'provider_unconfigured' AND text_body = ''`, u.Email).Scan(&n)
		return n >= 2
	}, "welcome+verification emails marked failed: provider_unconfigured with bodies purged")
}
