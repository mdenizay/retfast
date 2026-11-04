package config

import "testing"

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestProductionRequiresStrongSecret(t *testing.T) {
	if _, err := LoadFrom(env(map[string]string{"APP_ENV": "production", "DATABASE_URL": "postgres://x"})); err == nil {
		t.Fatal("production without JWT_SECRET accepted")
	}
	if _, err := LoadFrom(env(map[string]string{"APP_ENV": "production", "DATABASE_URL": "postgres://x", "JWT_SECRET": "short"})); err == nil {
		t.Fatal("short secret accepted")
	}
	c, err := LoadFrom(env(map[string]string{"APP_ENV": "production", "DATABASE_URL": "postgres://x",
		"JWT_SECRET": "0123456789abcdef0123456789abcdef", "TRUSTED_PROXIES": "10.0.0.0/8, 172.18.0.2"}))
	if err != nil {
		t.Fatal(err)
	}
	if !c.SecureCookies() || len(c.TrustedProxies) != 2 || c.CORSOrigins[0] != "https://retfast.com" || len(c.CORSOrigins) != 2 {
		t.Fatalf("%+v", c)
	}
	if _, err := LoadFrom(env(map[string]string{"DATABASE_URL": "x", "APP_ENV": "prod"})); err == nil {
		t.Fatal("bad APP_ENV accepted")
	}
}

func TestDevelopmentDefaults(t *testing.T) {
	c, err := LoadFrom(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil {
		t.Fatal(err)
	}
	if c.SecureCookies() || c.HTTPAddr != ":8080" || c.MetricsAddr != ":9090" || c.MailFrom != "Retfast <noreply@retfast.com>" {
		t.Fatalf("%+v", c)
	}
	if len(c.CORSOrigins) != 4 {
		t.Fatalf("dev origins %v", c.CORSOrigins)
	}
	if _, err := LoadFrom(env(map[string]string{})); err == nil {
		t.Fatal("missing DATABASE_URL accepted")
	}
}
