// Package config loads runtime configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Environment names.
const (
	EnvDevelopment = "development"
	EnvStaging     = "staging"
	EnvProduction  = "production"
)

// devJWTSecret is used only when APP_ENV=development and JWT_SECRET is unset.
const devJWTSecret = "retfast-development-only-secret-do-not-use-in-production"

// Config is the full runtime configuration. Secrets are never printed (see Redacted).
type Config struct {
	Env              string
	DatabaseURL      string
	RedisURL         string
	RedisPrefix      string
	JWTSecret        []byte
	HTTPAddr         string
	MetricsAddr      string
	PublicWebURL     string
	AppWebURL        string
	CORSOrigins      []string
	ResendAPIKey     string
	MailFrom         string
	CookieDomain     string
	TrustedProxies   []netip.Prefix
	ShutdownTimeout  time.Duration
	DBMaxConns       int32
	LogLevel         string
	DisableWorkers   bool // tests: run only the HTTP surface
	ResendBaseURL    string
	DeletionGraceDur time.Duration
}

// IsProduction reports whether APP_ENV=production.
func (c *Config) IsProduction() bool { return c.Env == EnvProduction }

// SecureCookies reports whether cookies must carry the Secure attribute.
func (c *Config) SecureCookies() bool { return c.Env != EnvDevelopment }

// Load reads configuration from the process environment.
func Load() (*Config, error) { return LoadFrom(os.Getenv) }

// LoadFrom reads configuration using getenv (testable).
func LoadFrom(getenv func(string) string) (*Config, error) {
	get := func(k, def string) string {
		if v := strings.TrimSpace(getenv(k)); v != "" {
			return v
		}
		return def
	}
	c := &Config{
		Env:           get("APP_ENV", EnvDevelopment),
		DatabaseURL:   get("DATABASE_URL", ""),
		RedisURL:      get("REDIS_URL", "redis://localhost:6379/0"),
		RedisPrefix:   get("REDIS_PREFIX", "rf:"),
		HTTPAddr:      get("HTTP_ADDR", ":8080"),
		MetricsAddr:   get("METRICS_ADDR", ":9090"),
		PublicWebURL:  strings.TrimRight(get("PUBLIC_WEB_URL", "https://retfast.com"), "/"),
		AppWebURL:     strings.TrimRight(get("APP_WEB_URL", "https://app.retfast.com"), "/"),
		ResendAPIKey:  get("RESEND_API_KEY", ""),
		MailFrom:      get("MAIL_FROM", "Retfast <noreply@retfast.com>"),
		CookieDomain:  get("COOKIE_DOMAIN", ""),
		LogLevel:      get("LOG_LEVEL", "info"),
		ResendBaseURL: strings.TrimRight(get("RESEND_BASE_URL", "https://api.resend.com"), "/"),
	}
	switch c.Env {
	case EnvDevelopment, EnvStaging, EnvProduction:
	default:
		return nil, fmt.Errorf("APP_ENV must be development, staging or production (got %q)", c.Env)
	}
	if c.DatabaseURL == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	secret := getenv("JWT_SECRET")
	switch {
	case len(secret) >= 32:
		c.JWTSecret = []byte(secret)
	case secret == "" && c.Env == EnvDevelopment:
		c.JWTSecret = []byte(devJWTSecret)
	default:
		return nil, errors.New("JWT_SECRET must be at least 32 bytes (required outside development)")
	}
	if c.Env != EnvDevelopment && string(c.JWTSecret) == devJWTSecret {
		return nil, errors.New("JWT_SECRET must not be the development secret")
	}
	origins := get("CORS_ORIGINS", "")
	if origins == "" {
		origins = c.PublicWebURL + "," + c.AppWebURL
		if c.Env == EnvDevelopment {
			origins += ",http://localhost:5173,http://127.0.0.1:5173"
		}
	}
	for _, o := range strings.Split(origins, ",") {
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if o == "" {
			continue
		}
		if u, err := url.Parse(o); err != nil || u.Scheme == "" || u.Host == "" {
			return nil, fmt.Errorf("CORS_ORIGINS entry %q is not an origin", o)
		}
		c.CORSOrigins = append(c.CORSOrigins, o)
	}
	for _, p := range strings.Split(get("TRUSTED_PROXIES", ""), ",") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if !strings.Contains(p, "/") {
			addr, err := netip.ParseAddr(p)
			if err != nil {
				return nil, fmt.Errorf("TRUSTED_PROXIES entry %q: %w", p, err)
			}
			p = addr.String() + "/" + strconv.Itoa(addr.BitLen())
		}
		pfx, err := netip.ParsePrefix(p)
		if err != nil {
			return nil, fmt.Errorf("TRUSTED_PROXIES entry %q: %w", p, err)
		}
		c.TrustedProxies = append(c.TrustedProxies, pfx.Masked())
	}
	var err error
	if c.ShutdownTimeout, err = time.ParseDuration(get("SHUTDOWN_TIMEOUT", "15s")); err != nil {
		return nil, fmt.Errorf("SHUTDOWN_TIMEOUT: %w", err)
	}
	if c.DeletionGraceDur, err = time.ParseDuration(get("ACCOUNT_DELETION_GRACE", "336h")); err != nil {
		return nil, fmt.Errorf("ACCOUNT_DELETION_GRACE: %w", err)
	}
	n, err := strconv.Atoi(get("DB_MAX_CONNS", "20"))
	if err != nil || n < 2 || n > 500 {
		return nil, errors.New("DB_MAX_CONNS must be an integer between 2 and 500")
	}
	c.DBMaxConns = int32(n)
	return c, nil
}

// Redacted returns a log-safe summary.
func (c *Config) Redacted() map[string]any {
	return map[string]any{
		"env": c.Env, "http_addr": c.HTTPAddr, "metrics_addr": c.MetricsAddr,
		"public_web_url": c.PublicWebURL, "app_web_url": c.AppWebURL, "cors_origins": c.CORSOrigins,
		"email_configured": c.ResendAPIKey != "", "trusted_proxies": len(c.TrustedProxies),
		"cookie_domain": c.CookieDomain, "db_max_conns": c.DBMaxConns,
	}
}
