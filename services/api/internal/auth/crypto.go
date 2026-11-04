// Package auth implements registration, login, refresh-token rotation with reuse
// detection, password management, email verification and request authentication.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"
)

// Argon2id parameters (ADR-003, OWASP baseline).
const (
	argonMemory  = 19456
	argonTime    = 2
	argonThreads = 1
	argonSaltLen = 16
	argonKeyLen  = 32
)

// HashPassword returns a PHC-formatted Argon2id hash.
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads,
		b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// ErrBadHash means a stored hash could not be parsed.
var ErrBadHash = errors.New("unsupported password hash")

// VerifyPassword checks password against a PHC Argon2id hash in constant time.
func VerifyPassword(encoded, password string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, ErrBadHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, ErrBadHash
	}
	var m uint32
	var t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false, ErrBadHash
	}
	if m < 8*1024 || m > 256*1024 || t < 1 || t > 10 || p < 1 || p > 16 {
		return false, ErrBadHash
	}
	b64 := base64.RawStdEncoding
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return false, ErrBadHash
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil || len(want) < 16 {
		return false, ErrBadHash
	}
	got := argon2.IDKey([]byte(password), salt, t, m, p, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// dummyHash is verified against when the user does not exist, so login timing
// does not reveal account existence.
var dummyHash, _ = HashPassword("retfast-timing-equaliser-not-a-password")

// NewOpaqueToken returns a URL-safe random token and its SHA-256 digest.
func NewOpaqueToken() (string, []byte, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, err
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	return tok, HashToken(tok), nil
}

// HashToken returns the SHA-256 digest of an opaque token.
func HashToken(tok string) []byte {
	s := sha256.Sum256([]byte(tok))
	return s[:]
}

// AccessTTL and RefreshTTL per the contract.
const (
	AccessTTL  = 15 * time.Minute
	RefreshTTL = 30 * 24 * time.Hour
)

// Claims are the access-token claims (ADR-003).
type Claims struct {
	Roles []string `json:"roles"`
	PCR   bool     `json:"pcr"`
	SID   string   `json:"sid"`
	jwt.RegisteredClaims
}

// TokenIssuer signs and verifies access tokens.
type TokenIssuer struct {
	secret []byte
	now    func() time.Time
}

// NewTokenIssuer returns an HS256 issuer.
func NewTokenIssuer(secret []byte) *TokenIssuer { return &TokenIssuer{secret: secret, now: time.Now} }

const issuer = "retfast-api"

// Issue creates an access token for a session family.
func (ti *TokenIssuer) Issue(userID, familyID uuid.UUID, roles []string, pcr bool) (string, time.Time, error) {
	now := ti.now()
	exp := now.Add(AccessTTL)
	c := Claims{
		Roles: roles, PCR: pcr, SID: familyID.String(),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: issuer, Subject: userID.String(), Audience: jwt.ClaimStrings{"retfast"},
			IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now.Add(-30 * time.Second)),
			ExpiresAt: jwt.NewNumericDate(exp), ID: uuid.NewString(),
		},
	}
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(ti.secret)
	return s, exp, err
}

// Token verification errors.
var (
	ErrTokenExpired = errors.New("token expired")
	ErrTokenInvalid = errors.New("token invalid")
)

// Verify parses and validates an access token.
func (ti *TokenIssuer) Verify(tok string) (*Claims, error) {
	c := &Claims{}
	_, err := jwt.ParseWithClaims(tok, c, func(t *jwt.Token) (any, error) { return ti.secret, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(issuer), jwt.WithAudience("retfast"),
		jwt.WithTimeFunc(ti.now), jwt.WithExpirationRequired())
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrTokenExpired
		}
		return nil, ErrTokenInvalid
	}
	if _, err := uuid.Parse(c.Subject); err != nil {
		return nil, ErrTokenInvalid
	}
	if _, err := uuid.Parse(c.SID); err != nil {
		return nil, ErrTokenInvalid
	}
	return c, nil
}

// BootstrapPassword is the initial password set by `seed`; it is refused as a new password.
const BootstrapPassword = "password"

var commonPasswords = map[string]bool{}

func init() {
	for _, p := range strings.Fields(`password password1 password12 password123 password1234 1234567890 12345678910
		123456789 qwertyuiop qwerty1234 qwerty12345 1q2w3e4r5t 1qaz2wsx3edc iloveyou12 sunshine12 football12
		baseball12 welcome123 welcome1234 letmein123 admin12345 administrator changeme123 passw0rd123 abc1234567
		retfast123 retfast1234 retfast12345 paragliding paraglider yamacparasutu parasut123 sifre12345 sifre123456
		parola1234 parola12345 trustno1234 dragon1234 monkey1234 master1234 superman12 batman1234 0987654321
		1111111111 0000000000 aaaaaaaaaa abcdefghij asdfghjkl1 zxcvbnm123 princess12 starwars12 whatever12`) {
		commonPasswords[p] = true
	}
}

// ValidatePassword enforces the contract's password policy; it returns a
// human-readable reason or "".
func ValidatePassword(pw, email string) string {
	switch {
	case len([]rune(pw)) < 10:
		return "must be at least 10 characters"
	case len(pw) > 256:
		return "must be at most 256 bytes"
	case strings.EqualFold(pw, email) || (email != "" && strings.EqualFold(pw, strings.SplitN(email, "@", 2)[0])):
		return "must not equal your email"
	case pw == BootstrapPassword:
		return "must not be the initial password"
	case commonPasswords[strings.ToLower(pw)]:
		return "is too common"
	}
	return ""
}
