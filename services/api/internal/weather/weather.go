// Package weather serves a short paragliding-oriented forecast for an event's
// centre from Open-Meteo (https://open-meteo.com, CC BY 4.0, no API key).
// Responses are cached in Redis for 10 minutes per ~1 km grid cell. The
// flyability verdict is a coarse advisory, never a go/no-go decision.
package weather

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// Attribution must be shown wherever the data is displayed.
const Attribution = "Weather data by Open-Meteo.com (CC BY 4.0)"

// Current conditions.
type Current struct {
	T          time.Time `json:"t"`
	TempC      *float64  `json:"temp_c"`
	WindMS     *float64  `json:"wind_ms"`
	WindDirDeg *float64  `json:"wind_dir_deg"`
	GustMS     *float64  `json:"gust_ms"`
	CloudPct   *float64  `json:"cloud_cover_pct"`
	PrecipMM   *float64  `json:"precip_mm"`
}

// Hour is one forecast hour.
type Hour struct {
	T          time.Time `json:"t"`
	TempC      *float64  `json:"temp_c"`
	DewPointC  *float64  `json:"dew_point_c"`
	WindMS     *float64  `json:"wind_ms"`
	WindDirDeg *float64  `json:"wind_dir_deg"`
	GustMS     *float64  `json:"gust_ms"`
	Wind850MS  *float64  `json:"wind_850_ms"`
	Wind850Dir *float64  `json:"wind_850_dir_deg"`
	CapeJKg    *float64  `json:"cape_jkg"`
	PrecipProb *float64  `json:"precip_prob_pct"`
	CloudPct   *float64  `json:"cloud_cover_pct"`
	CloudBaseM *float64  `json:"cloud_base_m"` // AMSL, spread × 125 m + elevation
	Flyability string    `json:"flyability"`
	FlyReasons []string  `json:"fly_reasons"`
}

// Forecast is the API payload.
type Forecast struct {
	Source      string    `json:"source"`
	Attribution string    `json:"attribution"`
	Lat         float64   `json:"lat"`
	Lon         float64   `json:"lon"`
	ElevationM  *float64  `json:"elevation_m"`
	FetchedAt   time.Time `json:"fetched_at"`
	Current     Current   `json:"current"`
	Hourly      []Hour    `json:"hourly"`
	// Flyability of the current hour: good | marginal | poor | unknown.
	Flyability string   `json:"flyability"`
	FlyReasons []string `json:"fly_reasons"`
}

// Client fetches forecasts.
type Client struct {
	BaseURL string
	HTTP    *http.Client
}

type omResp struct {
	Elevation *float64 `json:"elevation"`
	Current   struct {
		Time  string   `json:"time"`
		Temp  *float64 `json:"temperature_2m"`
		Wind  *float64 `json:"wind_speed_10m"`
		Dir   *float64 `json:"wind_direction_10m"`
		Gust  *float64 `json:"wind_gusts_10m"`
		Cloud *float64 `json:"cloud_cover"`
		Prec  *float64 `json:"precipitation"`
	} `json:"current"`
	Hourly struct {
		Time  []string   `json:"time"`
		Temp  []*float64 `json:"temperature_2m"`
		Dew   []*float64 `json:"dew_point_2m"`
		Wind  []*float64 `json:"wind_speed_10m"`
		Dir   []*float64 `json:"wind_direction_10m"`
		Gust  []*float64 `json:"wind_gusts_10m"`
		W850  []*float64 `json:"wind_speed_850hPa"`
		D850  []*float64 `json:"wind_direction_850hPa"`
		Cape  []*float64 `json:"cape"`
		PProb []*float64 `json:"precipitation_probability"`
		Cloud []*float64 `json:"cloud_cover"`
	} `json:"hourly"`
}

const hourlyVars = "temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m," +
	"wind_speed_850hPa,wind_direction_850hPa,cape,precipitation_probability,cloud_cover"

// Fetch returns the next `hours` hours for (lat, lon).
func (c *Client) Fetch(ctx context.Context, lat, lon float64, hours int) (*Forecast, error) {
	q := url.Values{}
	q.Set("latitude", strconv.FormatFloat(lat, 'f', 4, 64))
	q.Set("longitude", strconv.FormatFloat(lon, 'f', 4, 64))
	q.Set("current", "temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation")
	q.Set("hourly", hourlyVars)
	q.Set("wind_speed_unit", "ms")
	q.Set("timezone", "UTC")
	q.Set("forecast_hours", strconv.Itoa(hours))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/v1/forecast?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Retfast/1 (+https://retfast.com)")
	hc := c.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 8 * time.Second}
	}
	res, err := hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("open-meteo: status %d", res.StatusCode)
	}
	var om omResp
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&om); err != nil {
		return nil, fmt.Errorf("open-meteo: %w", err)
	}
	f := &Forecast{Source: "open-meteo", Attribution: Attribution, Lat: lat, Lon: lon, ElevationM: om.Elevation,
		FetchedAt: time.Now().UTC(), Hourly: []Hour{}}
	f.Current = Current{T: parseT(om.Current.Time), TempC: om.Current.Temp, WindMS: om.Current.Wind,
		WindDirDeg: om.Current.Dir, GustMS: om.Current.Gust, CloudPct: om.Current.Cloud, PrecipMM: om.Current.Prec}
	h := om.Hourly
	at := func(s []*float64, i int) *float64 {
		if i < len(s) {
			return s[i]
		}
		return nil
	}
	for i, ts := range h.Time {
		hr := Hour{T: parseT(ts), TempC: at(h.Temp, i), DewPointC: at(h.Dew, i), WindMS: at(h.Wind, i), WindDirDeg: at(h.Dir, i),
			GustMS: at(h.Gust, i), Wind850MS: at(h.W850, i), Wind850Dir: at(h.D850, i), CapeJKg: at(h.Cape, i),
			PrecipProb: at(h.PProb, i), CloudPct: at(h.Cloud, i)}
		if hr.TempC != nil && hr.DewPointC != nil {
			base := math.Max(0, *hr.TempC-*hr.DewPointC)*125 + deref(om.Elevation)
			base = math.Round(base/10) * 10
			hr.CloudBaseM = &base
		}
		hr.Flyability, hr.FlyReasons = Assess(hr)
		f.Hourly = append(f.Hourly, hr)
	}
	f.Flyability, f.FlyReasons = "unknown", []string{}
	if len(f.Hourly) > 0 {
		now := f.Hourly[0]
		// current observations override the model hour for wind
		if f.Current.WindMS != nil {
			now.WindMS, now.GustMS = f.Current.WindMS, f.Current.GustMS
		}
		f.Flyability, f.FlyReasons = Assess(now)
	}
	return f, nil
}

func parseT(s string) time.Time {
	t, err := time.Parse("2006-01-02T15:04", s)
	if err != nil {
		return time.Time{}
	}
	return t.UTC()
}

func deref(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// Assess is a deliberately conservative, coarse paragliding verdict.
// Reasons: strong_wind, gusty, wind_aloft, rain, overdevelopment.
func Assess(h Hour) (string, []string) {
	level := 0
	reasons := []string{}
	flag := func(lv int, r string) {
		reasons = append(reasons, r)
		level = max(level, lv)
	}
	w, g := deref(h.WindMS), deref(h.GustMS)
	switch {
	case w > 8:
		flag(2, "strong_wind")
	case w > 5.5:
		flag(1, "strong_wind")
	}
	switch spread := g - w; {
	case g > 11 || spread > 5:
		flag(2, "gusty")
	case g > 8 || spread > 3:
		flag(1, "gusty")
	}
	if a := deref(h.Wind850MS); a > 12 {
		flag(2, "wind_aloft")
	} else if a > 8 {
		flag(1, "wind_aloft")
	}
	if p := deref(h.PrecipProb); p >= 60 {
		flag(2, "rain")
	} else if p >= 30 {
		flag(1, "rain")
	}
	if c := deref(h.CapeJKg); c > 1500 {
		flag(2, "overdevelopment")
	} else if c > 800 {
		flag(1, "overdevelopment")
	}
	if h.WindMS == nil {
		return "unknown", reasons
	}
	return [...]string{"good", "marginal", "poor"}[level], reasons
}
