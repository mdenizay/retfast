package weather

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const sample = `{"elevation":1250,"current":{"time":"2026-11-05T10:00","temperature_2m":14.2,"wind_speed_10m":3.1,"wind_direction_10m":250,"wind_gusts_10m":5.2,"cloud_cover":20,"precipitation":0},
"hourly":{"time":["2026-11-05T10:00","2026-11-05T11:00"],"temperature_2m":[14,16],"dew_point_2m":[6,4],"wind_speed_10m":[3,9],
"wind_direction_10m":[250,260],"wind_gusts_10m":[5,15],"wind_speed_850hPa":[6,7],"wind_direction_850hPa":[240,250],"cape":[100,200],
"precipitation_probability":[0,10],"cloud_cover":[20,30]}}`

func TestFetch(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		_, _ = w.Write([]byte(sample))
	}))
	defer srv.Close()
	f, err := (&Client{BaseURL: srv.URL}).Fetch(context.Background(), 37.7, 29.13, 12)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gotQuery, "wind_speed_unit=ms") || !strings.Contains(gotQuery, "forecast_hours=12") {
		t.Fatalf("query: %s", gotQuery)
	}
	if len(f.Hourly) != 2 || *f.Hourly[0].CloudBaseM != 2250 || f.Hourly[0].T.Hour() != 10 {
		t.Fatalf("hourly: %+v", f.Hourly[0])
	}
	if f.Flyability != "good" || f.Hourly[1].Flyability != "poor" {
		t.Fatalf("flyability: now %s, +1h %s %v", f.Flyability, f.Hourly[1].Flyability, f.Hourly[1].FlyReasons)
	}
	if f.Attribution == "" {
		t.Fatal("attribution missing")
	}
}

func TestFetchUpstreamError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(502) }))
	defer srv.Close()
	if _, err := (&Client{BaseURL: srv.URL}).Fetch(context.Background(), 0, 0, 1); err == nil {
		t.Fatal("expected error")
	}
}

func TestAssess(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	cases := []struct {
		h    Hour
		want string
	}{
		{Hour{WindMS: f(3), GustMS: f(4)}, "good"},
		{Hour{WindMS: f(6), GustMS: f(7)}, "marginal"},
		{Hour{WindMS: f(4), GustMS: f(10)}, "poor"},
		{Hour{WindMS: f(2), GustMS: f(3), PrecipProb: f(40)}, "marginal"},
		{Hour{WindMS: f(2), GustMS: f(3), CapeJKg: f(2000)}, "poor"},
		{Hour{}, "unknown"},
	}
	for i, c := range cases {
		if got, r := Assess(c.h); got != c.want {
			t.Errorf("case %d: %s %v, want %s", i, got, r, c.want)
		}
	}
}
