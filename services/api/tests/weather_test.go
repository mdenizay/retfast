package tests

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

var (
	wxOnce sync.Once
	wxSrv  *httptest.Server
	wxHits atomic.Int64
)

// wxStubURL is a shared fake Open-Meteo so integration tests never call out.
func wxStubURL() string {
	wxOnce.Do(func() {
		wxSrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			wxHits.Add(1)
			_, _ = w.Write([]byte(`{"elevation":1250,"current":{"time":"2026-11-05T10:00","temperature_2m":14,"wind_speed_10m":3,"wind_direction_10m":250,"wind_gusts_10m":4},
"hourly":{"time":["2026-11-05T10:00"],"temperature_2m":[14],"dew_point_2m":[6],"wind_speed_10m":[3],"wind_gusts_10m":[4]}}`))
		}))
	})
	return wxSrv.URL
}

func TestEventWeather(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	adm := e.Admin("Admin")
	// unique centre so the cache entry is this test's own
	ev := e.CreateEvent(adm, map[string]any{"center": map[string]any{"lat": 36.1234, "lon": 31.4321}})
	id := ev["id"].(string)
	before := wxHits.Load()
	wx := e.Must(e.Do("GET", "/events/"+id+"/weather", nil, Req{}), 200).JSON()
	if wx["flyability"] != "good" || wx["attribution"] == "" {
		t.Fatalf("weather: %v", wx)
	}
	hourly := wx["hourly"].([]any)
	if len(hourly) != 1 || hourly[0].(map[string]any)["cloud_base_m"] != 2250.0 {
		t.Fatalf("hourly: %v", hourly)
	}
	e.Must(e.Do("GET", "/events/"+id+"/weather", nil, Req{}), 200)
	if n := wxHits.Load() - before; n != 1 {
		t.Fatalf("upstream hits = %d, want 1 (cached)", n)
	}
	noCenter := e.CreateEvent(adm, map[string]any{})
	e.Must(e.Do("GET", "/events/"+noCenter["id"].(string)+"/weather", nil, Req{}), 404)
	restricted := e.CreateEvent(adm, map[string]any{"visibility": "restricted", "center": map[string]any{"lat": 36.2, "lon": 31.5}})
	e.Must(e.Do("GET", "/events/"+restricted["id"].(string)+"/weather", nil, Req{}), 404)
}
