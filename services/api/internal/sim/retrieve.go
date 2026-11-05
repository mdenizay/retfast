package sim

import (
	"context"
	"errors"
	"math"
	"math/rand/v2"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// Retrieval simulation (--retrievals). After a simulated landing the pilot
// requests a retrieval (is_simulated) and keeps sharing its position;
// simulated retrievers go on duty, accept simulated requests (never a real
// pilot's), drive towards the pilot at road speed along a curved path, mark
// picked up, drive back to their base and mark delivered.

type retCounters struct {
	Created, Accepted, AcceptConflicts, PickedUp, Delivered, CancelledTimeout, PilotPositions, RetrieverFixes atomic.Int64
}

func (r *retCounters) stats() RetrievalStats {
	return RetrievalStats{Created: r.Created.Load(), Accepted: r.Accepted.Load(), AcceptConflicts: r.AcceptConflicts.Load(),
		PickedUp: r.PickedUp.Load(), Delivered: r.Delivered.Load(), CancelledTimeout: r.CancelledTimeout.Load(),
		PilotPositions: r.PilotPositions.Load(), RetrieverFixes: r.RetrieverFixes.Load()}
}

// RetrievalStats are counted in the report.
type RetrievalStats struct {
	Created          int64 `json:"created"`
	Accepted         int64 `json:"accepted"`
	AcceptConflicts  int64 `json:"accept_conflicts"`
	PickedUp         int64 `json:"picked_up"`
	Delivered        int64 `json:"delivered"`
	CancelledTimeout int64 `json:"cancelled_timeout"`
	PilotPositions   int64 `json:"pilot_positions_sent"`
	RetrieverFixes   int64 `json:"retriever_positions_sent"`
}

type retrievalView struct {
	ID          string `json:"id"`
	Status      string `json:"status"`
	IsSimulated bool   `json:"is_simulated"`
	Pilot       struct {
		UserID string `json:"user_id"`
	} `json:"pilot"`
	Pickup struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	} `json:"pickup"`
	PilotPosition *struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	} `json:"pilot_position"`
	Retriever *struct {
		UserID string `json:"user_id"`
	} `json:"retriever"`
	RetrieverPosition *struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	} `json:"retriever_position"`
}

func (r retrievalView) target() (float64, float64) {
	if r.PilotPosition != nil {
		return r.PilotPosition.Lat, r.PilotPosition.Lon
	}
	return r.Pickup.Lat, r.Pickup.Lon
}

func isConflict(err error) bool {
	var ae *APIError
	return errors.As(err, &ae) && (ae.Status == 409 || ae.Status == 404)
}

func sleepOrDone(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}

// pilotRetrieval runs the pilot side after landing at (lat, lon).
func pilotRetrieval(ctx context.Context, cfg Config, idx int, c *Client, eventID string, flightID uuid.UUID, lat, lon, alt float64, col *collector) {
	rng := rand.New(rand.NewPCG(cfg.Seed^0x5EED, uint64(idx)+101))
	id := uuid.New()
	now := time.Now().UTC()
	notes := []string{"SIM: yol kenarındayım, kanat toplandı", "SIM: tarlaya indim, yola yürüyorum", "SIM: köy girişindeyim"}
	body := map[string]any{"id": id, "flight_id": flightID, "is_simulated": true, "note": notes[rng.IntN(len(notes))],
		"pickup": map[string]any{"lat": round6(lat), "lon": round6(lon), "gps_alt_m": round1(alt), "h_acc_m": 6.0, "t": now.Format(tsFormat)}}
	if err := c.Call(ctx, "POST", "/events/"+eventID+"/retrievals", body, nil); err != nil {
		col.err("create retrieval: " + short(err))
		return
	}
	col.ret.Created.Add(1)
	cfg.Logf("pilot %d: landed, retrieval %s requested", idx, id)
	// the pilot walks up to ~300 m towards a road, then waits
	walkBearing := rng.Float64() * 2 * math.Pi
	walked := 0.0
	deadline := time.Now().Add(cfg.RetrievalTimeout)
	for {
		if !sleepOrDone(ctx, cfg.PilotPositionInterval) {
			return
		}
		var r retrievalView
		if err := c.Call(ctx, "GET", "/retrievals/"+id.String(), nil, &r); err != nil {
			col.err("get retrieval: " + short(err))
			continue
		}
		switch r.Status {
		case "delivered", "cancelled":
			cfg.Logf("pilot %d: retrieval %s %s", idx, id, r.Status)
			return
		case "picked_up":
			if r.RetrieverPosition != nil { // riding in the car
				lat, lon = r.RetrieverPosition.Lat, r.RetrieverPosition.Lon
			}
		default:
			if walked < 300 {
				step := 1.2 * cfg.PilotPositionInterval.Seconds()
				lat, lon = offset(lat, lon, step, walkBearing)
				walked += step
			}
		}
		if time.Now().After(deadline) {
			_ = c.Call(ctx, "POST", "/retrievals/"+id.String()+"/cancel", map[string]any{"reason": "SIM: zaman aşımı"}, nil)
			col.ret.CancelledTimeout.Add(1)
			return
		}
		pos := map[string]any{"lat": round6(lat), "lon": round6(lon), "h_acc_m": round1(4 + rng.Float64()*6), "t": time.Now().UTC().Format(tsFormat)}
		if err := c.Call(ctx, "POST", "/retrievals/"+id.String()+"/position", pos, nil); err != nil {
			if !isConflict(err) {
				col.err("pilot position: " + short(err))
			}
			continue
		}
		col.ret.PilotPositions.Add(1)
	}
}

// runRetriever drives one simulated retriever until ctx ends.
func runRetriever(ctx context.Context, cfg Config, idx int, c *Client, eventID string, simPilots map[string]bool, col *collector) {
	rng := rand.New(rand.NewPCG(cfg.Seed^0xD21E, uint64(idx)+11))
	// base: on the valley road 3.5–5 km south-east of launch
	baseLat, baseLon := offset(LaunchLat, LaunchLon, 3500+rng.Float64()*1500, rad(125+rng.Float64()*30))
	lat, lon := baseLat, baseLon
	course := 0.0
	dt := cfg.RetrieverInterval
	if err := c.Call(ctx, "PUT", "/events/"+eventID+"/retrievers/me/duty", map[string]any{"on_duty": true}, nil); err != nil {
		col.err("duty: " + short(err))
		return
	}
	defer func() {
		off, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = c.Call(off, "PUT", "/events/"+eventID+"/retrievers/me/duty", map[string]any{"on_duty": false}, nil)
	}()
	send := func(speed float64) {
		pos := map[string]any{"lat": round6(lat), "lon": round6(lon), "h_acc_m": round1(5 + rng.Float64()*5), "t": time.Now().UTC().Format(tsFormat),
			"course_deg": round1(math.Mod(deg(course)+360, 360)), "speed_ms": round1(speed)}
		if err := c.Call(ctx, "POST", "/events/"+eventID+"/retrievers/me/position", pos, nil); err != nil {
			if ctx.Err() == nil {
				col.err("retriever position: " + short(err))
			}
			return
		}
		col.ret.RetrieverFixes.Add(1)
	}
	// drive moves towards (tLat, tLon) along a gently curving road; it reports arrival.
	curve := (rng.Float64() - 0.5) * rad(50)
	drive := func(tLat, tLon float64, startDist float64) bool {
		dist, b := bearingTo(lat, lon, tLat, tLon)
		step := cfg.DriveSpeed * dt.Seconds()
		if dist <= step || dist < 25 {
			lat, lon = tLat, tLon
			return true
		}
		progress := 1.0
		if startDist > 0 {
			progress = math.Min(1, dist/startDist)
		}
		heading := b + curve*progress // curvature fades out near the target
		lat, lon = offset(lat, lon, step, heading)
		course = heading
		return false
	}
	for ctx.Err() == nil {
		send(0)
		if !sleepOrDone(ctx, dt) {
			return
		}
		var list struct {
			Items []retrievalView `json:"items"`
		}
		if err := c.Call(ctx, "GET", "/events/"+eventID+"/retrievals?status=requested", nil, &list); err != nil {
			col.err("list retrievals: " + short(err))
			continue
		}
		var pick *retrievalView
		best := math.MaxFloat64
		for i := range list.Items {
			r := list.Items[i]
			// never act on a real pilot's retrieval
			if !r.IsSimulated || (len(simPilots) > 0 && !simPilots[r.Pilot.UserID]) {
				continue
			}
			tl, tn := r.target()
			if d, _ := bearingTo(lat, lon, tl, tn); d < best {
				best, pick = d, &list.Items[i]
			}
		}
		if pick == nil {
			continue
		}
		if err := c.Call(ctx, "POST", "/retrievals/"+pick.ID+"/accept", nil, nil); err != nil {
			if isConflict(err) {
				col.ret.AcceptConflicts.Add(1)
			} else {
				col.err("accept: " + short(err))
			}
			continue
		}
		col.ret.Accepted.Add(1)
		cfg.Logf("retriever %d: accepted %s (%.0f m away)", idx, pick.ID, best)
		if !serve(ctx, cfg, c, pick.ID, &lat, &lon, baseLat, baseLon, drive, send, col) {
			continue
		}
	}
}

// serve drives to the pilot, picks them up and delivers them at the base.
func serve(ctx context.Context, cfg Config, c *Client, id string, lat, lon *float64, baseLat, baseLon float64,
	drive func(tLat, tLon, startDist float64) bool, send func(speed float64), col *collector) bool {
	dt := cfg.RetrieverInterval
	var r retrievalView
	refresh := func() bool {
		if err := c.Call(ctx, "GET", "/retrievals/"+id, nil, &r); err != nil {
			return false
		}
		return r.Status == "accepted" || r.Status == "picked_up"
	}
	if !refresh() {
		return false
	}
	tl, tn := r.target()
	start, _ := bearingTo(*lat, *lon, tl, tn)
	for i := 0; ; i++ {
		if i%5 == 0 { // the pilot may have walked
			if !refresh() {
				return false
			}
			tl, tn = r.target()
		}
		arrived := drive(tl, tn, start)
		send(cfg.DriveSpeed)
		if !sleepOrDone(ctx, dt) {
			return false
		}
		if arrived {
			break
		}
	}
	if !sleepOrDone(ctx, cfg.PickupDelay) {
		return false
	}
	if err := c.Call(ctx, "POST", "/retrievals/"+id+"/picked-up", nil, nil); err != nil {
		col.err("picked-up: " + short(err))
		return false
	}
	col.ret.PickedUp.Add(1)
	start, _ = bearingTo(*lat, *lon, baseLat, baseLon)
	for deadline := time.Now().Add(cfg.DeliveryDriveMax); time.Now().Before(deadline); {
		arrived := drive(baseLat, baseLon, start)
		send(cfg.DriveSpeed)
		if !sleepOrDone(ctx, dt) {
			return false
		}
		if arrived {
			break
		}
	}
	if err := c.Call(ctx, "POST", "/retrievals/"+id+"/delivered", map[string]any{"note": "SIM: teslim edildi"}, nil); err != nil {
		col.err("delivered: " + short(err))
		return false
	}
	col.ret.Delivered.Add(1)
	return true
}

// skipForLanding returns how many samples to skip so the route lands within d.
func skipForLanding(rc RouteConfig, rng *rand.Rand, d time.Duration) int {
	total := len(Generate(rc, int(8*time.Hour/rc.Interval)))
	want := int((0.3 + 0.7*rng.Float64()) * float64(d) / float64(rc.Interval))
	if want >= total {
		return 0
	}
	return total - want
}
