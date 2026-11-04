package sim

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"testing"

	"github.com/mdenizay/retfast/services/api/internal/tracking/stats"
)

var update = flag.Bool("update", false, "rewrite testdata fixtures")

func summarize(pts []Point) map[string]float64 {
	s := map[string]float64{}
	for _, p := range pts {
		s["n_"+p.Phase]++
	}
	return s
}

func TestRoutePhysicallyPlausible(t *testing.T) {
	for pilot := 0; pilot < 20; pilot++ {
		pts := Generate(RouteConfig{Seed: 42, Pilot: pilot, DegradeProbPerMin: 0.2}, 4*3600)
		if len(pts) < 600 || len(pts) >= 4*3600 {
			t.Fatalf("pilot %d: %d samples (should land within 4 h)", pilot, len(pts))
		}
		ph := summarize(pts)
		for _, want := range []string{PhaseGround, PhaseTakeoff, PhaseClimb, PhaseCruise, PhaseDescent, PhaseLanding} {
			if ph["n_"+want] == 0 {
				t.Fatalf("pilot %d: phase %s missing (%v)", pilot, want, ph)
			}
		}
		maxAlt, maxSpeed, maxClimb := 0.0, 0.0, 0.0
		for i, p := range pts {
			maxAlt = math.Max(maxAlt, p.AltM)
			maxSpeed = math.Max(maxSpeed, p.SpeedMS)
			if p.Phase == PhaseClimb {
				maxClimb = math.Max(maxClimb, p.VarioMS)
			}
			if d := stats.Haversine(LaunchLat, LaunchLon, p.Lat, p.Lon); d > 40000 {
				t.Fatalf("pilot %d sample %d is %0.f m from launch", pilot, i, d)
			}
			if p.HAccM <= 0 || p.HAccM > 200 {
				t.Fatalf("h_acc %f", p.HAccM)
			}
		}
		if maxAlt < 2400 || maxAlt > 3200 || maxSpeed > 25 || maxClimb < 1.5 || maxClimb > 6 {
			t.Fatalf("pilot %d: maxAlt %.0f maxSpeed %.1f maxClimb %.1f", pilot, maxAlt, maxSpeed, maxClimb)
		}
		last := pts[len(pts)-1]
		if last.Phase != PhaseFinished || last.SpeedMS > 0.01 || math.Abs(last.AltM-LandingAlt) > 3 {
			t.Fatalf("pilot %d did not land: %+v", pilot, last)
		}
	}
}

func TestRouteDeterministic(t *testing.T) {
	a := Generate(RouteConfig{Seed: 7, Pilot: 3, DegradeProbPerMin: 0.1}, 2000)
	b := Generate(RouteConfig{Seed: 7, Pilot: 3, DegradeProbPerMin: 0.1}, 2000)
	c := Generate(RouteConfig{Seed: 7, Pilot: 4, DegradeProbPerMin: 0.1}, 2000)
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	jc, _ := json.Marshal(c)
	if string(ja) != string(jb) {
		t.Fatal("same seed produced different routes")
	}
	if string(ja) == string(jc) {
		t.Fatal("different pilots produced identical routes")
	}
}

// FixtureCSV renders a route compactly: offset_s,lat,lon,alt_m,h_acc_m,speed_ms,course_deg,phase.
func FixtureCSV(pts []Point) []byte {
	var b []byte
	b = append(b, "offset_s,lat,lon,gps_alt_m,h_acc_m,speed_ms,course_deg,phase\n"...)
	for _, p := range pts {
		b = fmt.Appendf(b, "%d,%.6f,%.6f,%.1f,%.1f,%.2f,%.1f,%s\n", int(p.Offset.Seconds()), p.Lat, p.Lon, p.AltM, p.HAccM, p.SpeedMS, p.Course, p.Phase)
	}
	return b
}

// TestRouteFixtures pins the generator output: the committed CSV fixtures are
// the deterministic sample routes for tests and client development. Regenerate
// with `go test ./internal/sim -run Fixtures -update` after an intentional change.
func TestRouteFixtures(t *testing.T) {
	for _, fx := range []struct {
		seed  uint64
		pilot int
	}{{42, 0}, {2026, 1}} {
		name := fmt.Sprintf("testdata/route_seed%d_pilot%d.csv", fx.seed, fx.pilot)
		got := FixtureCSV(Generate(RouteConfig{Seed: fx.seed, Pilot: fx.pilot, DegradeProbPerMin: 0.2}, 4*3600))
		if *update {
			if err := os.WriteFile(name, got, 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("missing fixture %s (run with -update): %v", name, err)
		}
		if a, b := sha256.Sum256(want), sha256.Sum256(got); hex.EncodeToString(a[:]) != hex.EncodeToString(b[:]) {
			t.Fatalf("%s changed: the generator is no longer deterministic or was modified", name)
		}
	}
}
