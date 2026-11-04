// Package stats computes flight statistics incrementally from telemetry samples.
//
// Rules (documented in docs/architecture/telemetry.md):
//   - Samples are applied in (seq, t) order. A sample with seq <= the highest
//     seq already applied is out of order: it is counted (sample_count,
//     first/last t) but the path-dependent aggregates are only fixed by a full
//     recompute, so Apply reports dirty=true and the flight is queued for it.
//   - Distance (haversine), altitude extremes, ascent/descent and max speed use
//     only samples with h_acc_m <= MaxHAcc (50 m).
//   - Ascent/descent use a dead-band hysteresis of AltHysteresis metres around a
//     reference altitude to suppress GPS altitude jitter.
//   - A gap is counted when consecutive (by seq) samples are > GapThreshold apart.
//   - expected_sample_count assumes a 1 Hz target between the first and last sample.
package stats

import (
	"math"
	"sort"
	"time"
)

// Tunables.
const (
	MaxHAcc       = 50.0
	AltHysteresis = 3.0
	GapThreshold  = 10 * time.Second
	EarthRadiusM  = 6371008.8
	// MaxPlausibleSpeed (m/s) between two good fixes; larger jumps move the
	// anchor without adding distance (GPS glitch).
	MaxPlausibleSpeed = 120.0
)

// Sample is the subset of a position the statistics need.
type Sample struct {
	Seq     int32
	T       time.Time
	Lat     float64
	Lon     float64
	Alt     *float64
	HAcc    float64
	SpeedMS *float64
}

// State is the persisted running state plus aggregates.
type State struct {
	// running state (stored in flight_sessions.stats_state)
	LastSeq   *int32     `json:"last_seq,omitempty"`
	LastT     *time.Time `json:"last_t,omitempty"`
	AnchorLat *float64   `json:"anchor_lat,omitempty"`
	AnchorLon *float64   `json:"anchor_lon,omitempty"`
	AnchorT   *time.Time `json:"anchor_t,omitempty"`
	AltRef    *float64   `json:"alt_ref,omitempty"`

	// aggregates (stored in flight_sessions columns)
	SampleCount int32      `json:"-"`
	DistanceM   float64    `json:"-"`
	MaxAltM     *float64   `json:"-"`
	MinAltM     *float64   `json:"-"`
	MaxSpeedMS  *float64   `json:"-"`
	AscentM     float64    `json:"-"`
	DescentM    float64    `json:"-"`
	GapCount    int32      `json:"-"`
	FirstT      *time.Time `json:"-"`
	LastSampleT *time.Time `json:"-"`
}

// Haversine returns the great-circle distance in metres.
func Haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const rad = math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLon := (lon2 - lon1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * EarthRadiusM * math.Asin(math.Min(1, math.Sqrt(a)))
}

func minp(p *float64, v float64) *float64 {
	if p == nil || v < *p {
		return &v
	}
	return p
}

func maxp(p *float64, v float64) *float64 {
	if p == nil || v > *p {
		return &v
	}
	return p
}

// SortSamples orders by seq then t.
func SortSamples(s []Sample) {
	sort.SliceStable(s, func(i, j int) bool {
		if s[i].Seq != s[j].Seq {
			return s[i].Seq < s[j].Seq
		}
		return s[i].T.Before(s[j].T)
	})
}

// Apply folds new (not previously applied) samples into the state. It returns
// true if any sample arrived out of order and a full recompute is needed.
func (s *State) Apply(samples []Sample) (dirty bool) {
	sorted := append([]Sample(nil), samples...)
	SortSamples(sorted)
	for _, x := range sorted {
		s.SampleCount++
		t := x.T
		if s.FirstT == nil || t.Before(*s.FirstT) {
			s.FirstT = &t
		}
		if s.LastSampleT == nil || t.After(*s.LastSampleT) {
			s.LastSampleT = &t
		}
		if s.LastSeq != nil && x.Seq <= *s.LastSeq {
			dirty = true
			continue
		}
		seq := x.Seq
		if s.LastT != nil && t.Sub(*s.LastT) > GapThreshold {
			s.GapCount++
		}
		s.LastSeq, s.LastT = &seq, &t
		if x.HAcc > MaxHAcc || x.HAcc <= 0 {
			continue
		}
		if s.AnchorLat != nil {
			d := Haversine(*s.AnchorLat, *s.AnchorLon, x.Lat, x.Lon)
			dt := t.Sub(*s.AnchorT).Seconds()
			if dt <= 0 || d/dt <= MaxPlausibleSpeed {
				s.DistanceM += d
			}
		}
		lat, lon := x.Lat, x.Lon
		s.AnchorLat, s.AnchorLon, s.AnchorT = &lat, &lon, &t
		if x.Alt != nil {
			alt := *x.Alt
			s.MaxAltM = maxp(s.MaxAltM, alt)
			s.MinAltM = minp(s.MinAltM, alt)
			switch {
			case s.AltRef == nil:
				s.AltRef = &alt
			case alt-*s.AltRef >= AltHysteresis:
				s.AscentM += alt - *s.AltRef
				s.AltRef = &alt
			case *s.AltRef-alt >= AltHysteresis:
				s.DescentM += *s.AltRef - alt
				s.AltRef = &alt
			}
		}
		if x.SpeedMS != nil && *x.SpeedMS >= 0 {
			s.MaxSpeedMS = maxp(s.MaxSpeedMS, *x.SpeedMS)
		}
	}
	return dirty
}

// Recompute builds a fresh state from every sample of a flight.
func Recompute(all []Sample) State {
	var s State
	s.Apply(all)
	return s
}

// ExpectedSamples is the 1 Hz target count between first and last sample (inclusive).
func ExpectedSamples(first, last *time.Time) int64 {
	if first == nil || last == nil || last.Before(*first) {
		return 0
	}
	return int64(last.Sub(*first).Seconds()) + 1
}
