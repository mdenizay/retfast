package stats

import (
	"math"
	"testing"
	"time"
)

func f(v float64) *float64 { return &v }

func line(n int, t0 time.Time, alt func(i int) float64, hacc float64) []Sample {
	out := make([]Sample, n)
	for i := range out {
		out[i] = Sample{Seq: int32(i), T: t0.Add(time.Duration(i) * time.Second), Lat: 37 + float64(i)*0.0001, Lon: 29,
			Alt: f(alt(i)), HAcc: hacc, SpeedMS: f(float64(i % 15))}
	}
	return out
}

func TestHaversine(t *testing.T) {
	// 0.001 deg latitude ≈ 111.2 m
	if d := Haversine(37, 29, 37.001, 29); math.Abs(d-111.19) > 0.2 {
		t.Fatalf("haversine = %f", d)
	}
	if Haversine(37, 29, 37, 29) != 0 {
		t.Fatal("zero distance")
	}
}

func TestIncrementalEqualsRecompute(t *testing.T) {
	t0 := time.Unix(1_800_000_000, 0)
	all := line(300, t0, func(i int) float64 { return 2000 + 50*math.Sin(float64(i)/20) }, 5)
	var inc State
	for i := 0; i < len(all); i += 37 {
		end := i + 37
		if end > len(all) {
			end = len(all)
		}
		if inc.Apply(all[i:end]) {
			t.Fatal("in-order batches must not be dirty")
		}
	}
	full := Recompute(all)
	if math.Abs(inc.DistanceM-full.DistanceM) > 1e-6 || inc.AscentM != full.AscentM || inc.DescentM != full.DescentM ||
		inc.SampleCount != 300 || *inc.MaxAltM != *full.MaxAltM || *inc.MaxSpeedMS != 14 || inc.GapCount != 0 {
		t.Fatalf("incremental %+v vs full %+v", inc, full)
	}
	if math.Abs(full.DistanceM-299*11.119) > 3 {
		t.Fatalf("distance = %f", full.DistanceM)
	}
}

func TestOutOfOrderMarksDirtyAndRecomputeFixes(t *testing.T) {
	t0 := time.Unix(1_800_000_000, 0)
	all := line(20, t0, func(i int) float64 { return 2000 + float64(i)*5 }, 5)
	var st State
	st.Apply(all[10:])
	if !st.Apply(all[:10]) {
		t.Fatal("late samples must report dirty")
	}
	if st.SampleCount != 20 || !st.FirstT.Equal(t0) {
		t.Fatal("count/first t must still be maintained")
	}
	full := Recompute(all)
	if full.AscentM != 95 || full.DescentM != 0 {
		t.Fatalf("ascent %f descent %f", full.AscentM, full.DescentM)
	}
}

func TestHysteresisSuppressesJitter(t *testing.T) {
	t0 := time.Unix(1_800_000_000, 0)
	// ±1 m jitter around 2000 m: below the 3 m dead band
	jitter := line(200, t0, func(i int) float64 { return 2000 + float64(i%2)*2 - 1 }, 5)
	st := Recompute(jitter)
	if st.AscentM != 0 || st.DescentM != 0 {
		t.Fatalf("jitter produced ascent %f descent %f", st.AscentM, st.DescentM)
	}
	// a real 100 m climb then 60 m sink
	prof := line(161, t0, func(i int) float64 {
		if i <= 100 {
			return 2000 + float64(i)
		}
		return 2100 - float64(i-100)
	}, 5)
	st = Recompute(prof)
	if st.AscentM < 99 || st.AscentM > 100 || st.DescentM < 57 || st.DescentM > 60 {
		t.Fatalf("ascent %f descent %f", st.AscentM, st.DescentM)
	}
}

func TestPoorAccuracySkippedAndGaps(t *testing.T) {
	t0 := time.Unix(1_800_000_000, 0)
	s := line(10, t0, func(int) float64 { return 2000 }, 5)
	s[5].HAcc = 80 // excluded from distance/alt/speed
	s[5].Alt = f(9000)
	s[5].SpeedMS = f(99)
	s[6].T = s[5].T.Add(30 * time.Second) // gap > 10 s
	for i := 7; i < 10; i++ {
		s[i].T = s[6].T.Add(time.Duration(i-6) * time.Second)
	}
	st := Recompute(s)
	if *st.MaxAltM != 2000 || *st.MaxSpeedMS == 99 || st.GapCount != 1 || st.SampleCount != 10 {
		t.Fatalf("%+v", st)
	}
	if ExpectedSamples(st.FirstT, st.LastSampleT) != int64(st.LastSampleT.Sub(*st.FirstT).Seconds())+1 {
		t.Fatal("expected samples")
	}
	if ExpectedSamples(nil, nil) != 0 {
		t.Fatal("nil expected")
	}
}

func TestImplausibleJumpNotCounted(t *testing.T) {
	t0 := time.Unix(1_800_000_000, 0)
	s := []Sample{
		{Seq: 0, T: t0, Lat: 37, Lon: 29, HAcc: 5},
		{Seq: 1, T: t0.Add(time.Second), Lat: 38, Lon: 29, HAcc: 5}, // 111 km in 1 s
		{Seq: 2, T: t0.Add(2 * time.Second), Lat: 38.0001, Lon: 29, HAcc: 5},
	}
	st := Recompute(s)
	if st.DistanceM > 20 {
		t.Fatalf("glitch counted: %f", st.DistanceM)
	}
}
