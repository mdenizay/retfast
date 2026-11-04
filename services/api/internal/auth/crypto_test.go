package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func TestArgon2idRoundTripAndParams(t *testing.T) {
	h, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("unexpected params: %s", h)
	}
	if ok, err := VerifyPassword(h, "correct horse battery staple"); !ok || err != nil {
		t.Fatal("valid password rejected", err)
	}
	if ok, _ := VerifyPassword(h, "correct horse battery stapl"); ok {
		t.Fatal("wrong password accepted")
	}
	h2, _ := HashPassword("correct horse battery staple")
	if h == h2 {
		t.Fatal("salt not random")
	}
	for _, bad := range []string{"", "$2a$10$abc", "$argon2id$v=19$m=1,t=1,p=1$AAAA$AAAA", "$argon2i$v=19$m=19456,t=2,p=1$AAAA$AAAA"} {
		if ok, err := VerifyPassword(bad, "x"); ok || err == nil {
			t.Fatalf("bad hash %q accepted", bad)
		}
	}
}

func TestJWTIssueVerify(t *testing.T) {
	ti := NewTokenIssuer([]byte("0123456789abcdef0123456789abcdef"))
	uid, sid := uuid.New(), uuid.New()
	tok, exp, err := ti.Issue(uid, sid, []string{"pilot"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if d := time.Until(exp); d < 14*time.Minute || d > 15*time.Minute {
		t.Fatalf("ttl %s", d)
	}
	c, err := ti.Verify(tok)
	if err != nil || c.Subject != uid.String() || c.SID != sid.String() || !c.PCR || c.Roles[0] != "pilot" {
		t.Fatalf("claims %+v err %v", c, err)
	}
	// wrong key
	if _, err := NewTokenIssuer([]byte("another-secret-another-secret-xx")).Verify(tok); err != ErrTokenInvalid {
		t.Fatalf("wrong key: %v", err)
	}
	// expired
	past := NewTokenIssuer([]byte("0123456789abcdef0123456789abcdef"))
	past.now = func() time.Time { return time.Now().Add(-time.Hour) }
	old, _, _ := past.Issue(uid, sid, nil, false)
	if _, err := ti.Verify(old); err != ErrTokenExpired {
		t.Fatalf("expired: %v", err)
	}
	// alg=none / other algorithms are refused
	none := jwt.NewWithClaims(jwt.SigningMethodNone, Claims{SID: sid.String(), RegisteredClaims: jwt.RegisteredClaims{
		Subject: uid.String(), Issuer: issuer, Audience: jwt.ClaimStrings{"retfast"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}})
	s, _ := none.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if _, err := ti.Verify(s); err != ErrTokenInvalid {
		t.Fatalf("alg none accepted: %v", err)
	}
	if _, err := ti.Verify(tok + "x"); err != ErrTokenInvalid {
		t.Fatal("tampered token accepted")
	}
}

func TestPasswordPolicy(t *testing.T) {
	cases := map[string]bool{
		"short":                 false,
		"password":              false,
		"password1234":          false,
		"1234567890":            false,
		"pilot@example.com":     false,
		"PILOT":                 false,
		"Gökyüzü-Uçuş-2026":     true,
		"a perfectly fine pass": true,
	}
	for pw, ok := range cases {
		if got := ValidatePassword(pw, "pilot@example.com") == ""; got != ok {
			t.Errorf("%q: valid=%v want %v (%s)", pw, got, ok, ValidatePassword(pw, "pilot@example.com"))
		}
	}
	if ValidatePassword("pilotpilot", "pilotpilot@example.com") == "" {
		t.Error("local part of email accepted")
	}
}

func TestNormalizeEmail(t *testing.T) {
	if NormalizeEmail("  Deniz@Retfast.COM ") != "deniz@retfast.com" {
		t.Fatal("normalize")
	}
	for _, bad := range []string{"", "a@b", "no-at.com", "x y@z.com", "Name <a@b.com>"} {
		if NormalizeEmail(bad) != "" {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestOpaqueTokens(t *testing.T) {
	a, ha, _ := NewOpaqueToken()
	b, _, _ := NewOpaqueToken()
	if a == b || len(a) < 40 || string(HashToken(a)) != string(ha) {
		t.Fatal("opaque tokens")
	}
}
