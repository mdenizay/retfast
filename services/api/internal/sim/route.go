// Package sim generates deterministic synthetic paragliding flights around
// the Denizli Teleferik upper station and drives them through the public Retfast API (cmd/simulator).
// All data it produces is labelled simulated (is_simulated=true): flights and,
// with --retrievals, retrieval requests and their handling by simulated
// retrievers (never a real pilot's retrieval).
package sim

import (
	"math"
	"math/rand/v2"
	"time"
)

// Launch area: approximate, synthetic. Labelled simulated, never presented as a verified site.
const (
	LaunchLat  = 37.708
	LaunchLon  = 29.135
	LaunchAlt  = 1300.0
	LandingAlt = 400.0
	mPerDegLat = 111320.0
)

// Phase names (also sent as meta.profile).
const (
	PhaseGround   = "ground"
	PhaseTakeoff  = "takeoff"
	PhaseClimb    = "climb"
	PhaseCruise   = "cruise"
	PhaseDescent  = "descent"
	PhaseLanding  = "landing"
	PhaseFinished = "finished"
)

// Point is one generated GPS fix.
type Point struct {
	Offset   time.Duration // since route start
	Lat, Lon float64
	AltM     float64
	HAccM    float64
	VAccM    float64
	SpeedMS  float64
	Course   float64
	VarioMS  float64
	Phase    string
	Battery  float64
	Degraded bool
}

// RouteConfig parameterises a route.
type RouteConfig struct {
	Seed     uint64
	Pilot    int
	Interval time.Duration // sample interval (default 1 s)
	// DegradeProbPerMin is the chance per minute that GPS accuracy degrades for 20–60 s.
	DegradeProbPerMin float64
}

// Route is a deterministic, stateful flight generator.
type Route struct {
	cfg      RouteConfig
	rng      *rand.Rand
	dt       float64
	t        time.Duration
	lat, lon float64
	alt      float64
	heading  float64 // radians, 0 = north, clockwise
	speed    float64
	phase    string
	phaseT   float64 // seconds in phase
	windDir  float64 // direction the wind blows towards (radians)
	windMS   float64
	thermals int
	maxTherm int
	// current thermal
	thLat, thLon float64
	thClimb      float64
	thTop        float64
	turnDir      float64
	// landing zone
	lzLat, lzLon float64
	degradeLeft  float64
	battery      float64
	done         bool
}

// NewRoute creates the route for one pilot. Same (Seed, Pilot) → same route.
func NewRoute(c RouteConfig) *Route {
	if c.Interval <= 0 {
		c.Interval = time.Second
	}
	rng := rand.New(rand.NewPCG(c.Seed, uint64(c.Pilot)*0x9E3779B97F4A7C15+1))
	r := &Route{cfg: c, rng: rng, dt: c.Interval.Seconds(), phase: PhaseGround, battery: 0.95 - rng.Float64()*0.2}
	// launch spread: pilots line up within ~150 m of the launch point
	r.lat = LaunchLat + (rng.Float64()-0.5)*0.0025
	r.lon = LaunchLon + (rng.Float64()-0.5)*0.0025
	r.alt = LaunchAlt + (rng.Float64()-0.5)*20
	r.heading = rad(200 + rng.Float64()*40) // launch faces SSW
	r.windDir = rad(60 + rng.Float64()*40)  // drift towards ENE
	r.windMS = 1.5 + rng.Float64()*2.5
	r.maxTherm = 3 + rng.IntN(4)
	// landing zone ~3-5 km south-east of launch, in the valley
	d := 3000 + rng.Float64()*2000
	b := rad(120 + rng.Float64()*40)
	r.lzLat, r.lzLon = offset(LaunchLat, LaunchLon, d, b)
	r.turnDir = 1
	if rng.IntN(2) == 0 {
		r.turnDir = -1
	}
	return r
}

func rad(d float64) float64 { return d * math.Pi / 180 }
func deg(r float64) float64 { return r * 180 / math.Pi }

// offset moves (lat, lon) by d metres along bearing b (radians).
func offset(lat, lon, d, b float64) (float64, float64) {
	dy := d * math.Cos(b)
	dx := d * math.Sin(b)
	return lat + dy/mPerDegLat, lon + dx/(mPerDegLat*math.Cos(rad(lat)))
}

func bearingTo(lat1, lon1, lat2, lon2 float64) (dist, bearing float64) {
	dy := (lat2 - lat1) * mPerDegLat
	dx := (lon2 - lon1) * mPerDegLat * math.Cos(rad(lat1))
	return math.Hypot(dx, dy), math.Atan2(dx, dy)
}

func (r *Route) nextThermal() {
	d := 900 + r.rng.Float64()*2200
	b := r.windDir + (r.rng.Float64()-0.5)*math.Pi*0.9
	r.thLat, r.thLon = offset(r.lat, r.lon, d, b)
	r.thClimb = 1.5 + r.rng.Float64()*1.5
	r.thTop = 2550 + r.rng.Float64()*500
}

func (r *Route) setPhase(p string) {
	r.phase, r.phaseT = p, 0
}

// Done reports whether the pilot has landed and the route ended.
func (r *Route) Done() bool { return r.done }

// Next advances one sample interval and returns the fix.
func (r *Route) Next() Point {
	dt := r.dt
	vario := 0.0
	switch r.phase {
	case PhaseGround:
		r.speed = 0
		if r.phaseT >= 5 {
			r.setPhase(PhaseTakeoff)
		}
	case PhaseTakeoff:
		r.speed = math.Min(9.5, r.speed+1.2*dt)
		vario = -0.4 + r.rng.NormFloat64()*0.2
		if r.phaseT >= 15 {
			r.nextThermal()
			r.setPhase(PhaseCruise)
		}
	case PhaseCruise:
		r.speed = 10.5 + r.rng.NormFloat64()*0.4
		vario = -1.1 + r.rng.NormFloat64()*0.25
		dist, b := bearingTo(r.lat, r.lon, r.thLat, r.thLon)
		r.heading = steer(r.heading, b, rad(12)*dt)
		switch {
		case r.alt < LandingAlt+450:
			r.setPhase(PhaseDescent)
		case dist < 60:
			r.thermals++
			r.setPhase(PhaseClimb)
		}
	case PhaseClimb:
		r.speed = 9 + r.rng.NormFloat64()*0.3
		r.heading += r.turnDir * (r.speed / 45) * dt // 45 m radius circles
		vario = r.thClimb + r.rng.NormFloat64()*0.6
		if r.phaseT < 20 { // core centring
			vario *= r.phaseT / 20
		}
		if r.alt >= r.thTop || r.phaseT > 480 {
			if r.thermals >= r.maxTherm {
				r.setPhase(PhaseDescent)
			} else {
				r.nextThermal()
				r.setPhase(PhaseCruise)
			}
		}
	case PhaseDescent:
		r.speed = 11 + r.rng.NormFloat64()*0.5
		_, b := bearingTo(r.lat, r.lon, r.lzLat, r.lzLon)
		r.heading = steer(r.heading, b, rad(10)*dt)
		dist, _ := bearingTo(r.lat, r.lon, r.lzLat, r.lzLon)
		vario = -1.3 + r.rng.NormFloat64()*0.2
		if dist < 400 { // spiral down over the landing zone
			r.heading += r.turnDir * (r.speed / 60) * dt
			vario = -2.6 + r.rng.NormFloat64()*0.3
		}
		if r.alt <= LandingAlt+25 {
			r.setPhase(PhaseLanding)
		}
	case PhaseLanding:
		r.speed = math.Max(0, r.speed-1.5*dt)
		vario = -0.8
		if r.alt <= LandingAlt {
			vario, r.alt = 0, LandingAlt
		}
		if r.speed == 0 && r.phaseT > 25 && r.alt <= LandingAlt {
			r.setPhase(PhaseFinished)
			r.done = true
		}
	case PhaseFinished:
		r.speed, r.done = 0, true
	}
	if r.alt+vario*dt < LandingAlt && r.phase != PhaseGround {
		vario = (LandingAlt - r.alt) / dt
	}
	r.alt += vario * dt
	// ground track = air vector + wind (wind only once airborne)
	vx, vy := r.speed*math.Sin(r.heading), r.speed*math.Cos(r.heading)
	if r.phase != PhaseGround && r.phase != PhaseFinished && !(r.phase == PhaseLanding && r.speed == 0) {
		vx += r.windMS * math.Sin(r.windDir)
		vy += r.windMS * math.Cos(r.windDir)
		if r.phase == PhaseClimb { // thermal drifts with the wind
			r.thLat, r.thLon = offset(r.thLat, r.thLon, r.windMS*dt, r.windDir)
		}
	}
	gs := math.Hypot(vx, vy)
	course := math.Mod(deg(math.Atan2(vx, vy))+360, 360)
	r.lat, r.lon = offset(r.lat, r.lon, gs*dt, math.Atan2(vx, vy))
	// GPS accuracy model
	hacc := 3 + r.rng.Float64()*3
	degraded := false
	if r.degradeLeft <= 0 && r.rng.Float64() < r.cfg.DegradeProbPerMin*dt/60 {
		r.degradeLeft = 20 + r.rng.Float64()*40
	}
	lat, lon := r.lat, r.lon
	if r.degradeLeft > 0 {
		r.degradeLeft -= dt
		degraded = true
		hacc = 25 + r.rng.Float64()*95
		lat, lon = offset(lat, lon, r.rng.Float64()*hacc*0.4, r.rng.Float64()*2*math.Pi)
	}
	r.battery = math.Max(0.05, r.battery-0.00002*dt)
	p := Point{Offset: r.t, Lat: lat, Lon: lon, AltM: r.alt + r.rng.NormFloat64()*0.6, HAccM: round1(hacc), VAccM: round1(hacc * 1.5),
		SpeedMS: round2(gs), Course: round1(course), VarioMS: vario, Phase: r.phase, Battery: round2(r.battery), Degraded: degraded}
	if gs < 0.3 {
		p.Course = -1 // Core Location reports -1 when the course is invalid
	}
	r.t += r.cfg.Interval
	r.phaseT += dt
	return p
}

func steer(cur, target, maxStep float64) float64 {
	d := math.Mod(target-cur+3*math.Pi, 2*math.Pi) - math.Pi
	if d > maxStep {
		d = maxStep
	} else if d < -maxStep {
		d = -maxStep
	}
	return cur + d
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }
func round2(v float64) float64 { return math.Round(v*100) / 100 }

// Generate returns up to max points of a complete route (or until landing).
func Generate(c RouteConfig, max int) []Point {
	r := NewRoute(c)
	out := make([]Point, 0, 1024)
	for !r.Done() && len(out) < max {
		out = append(out, r.Next())
	}
	return out
}
