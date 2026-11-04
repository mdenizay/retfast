package httpx

import (
	"encoding/json"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"
)

func TestClientIPTrustsOnlyConfiguredProxies(t *testing.T) {
	res := ClientIPResolver{Trusted: []netip.Prefix{netip.MustParsePrefix("172.18.0.0/16")}}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "203.0.113.9:5555"
	r.Header.Set("X-Forwarded-For", "1.2.3.4")
	if ip := res.Resolve(r); ip != "203.0.113.9" {
		t.Fatalf("untrusted peer: %s", ip)
	}
	r.RemoteAddr = "172.18.0.5:443"
	r.Header.Set("X-Forwarded-For", "9.9.9.9, 198.51.100.7, 172.18.0.9")
	if ip := res.Resolve(r); ip != "198.51.100.7" {
		t.Fatalf("via proxy: %s", ip)
	}
}

func TestTimeAndNullable(t *testing.T) {
	b, _ := json.Marshal(T(time.Date(2026, 11, 4, 12, 0, 0, 123456789, time.FixedZone("x", 3*3600))))
	if string(b) != `"2026-11-04T09:00:00.123Z"` {
		t.Fatalf("time format %s", b)
	}
	var v struct {
		A Nullable[float64] `json:"a"`
		B Nullable[float64] `json:"b"`
		C Nullable[float64] `json:"c"`
	}
	_ = json.Unmarshal([]byte(`{"a":null,"b":2.5}`), &v)
	if !v.A.Set || !v.A.Null || !v.B.Set || v.B.V != 2.5 || v.C.Set {
		t.Fatalf("%+v", v)
	}
}
