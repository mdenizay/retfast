package flights

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/events"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/geo"
	"github.com/mdenizay/retfast/services/api/internal/tracking/stats"
	"github.com/mdenizay/retfast/services/api/internal/users"
)

// Freshness thresholds per the contract.
const (
	LiveWithin  = 30 * time.Second
	StaleWithin = 5 * time.Minute
	TrailWindow = 15 * time.Minute
	TrailMax    = 300
)

// LivePilot is one entry of the live snapshot.
type LivePilot struct {
	FlightID    uuid.UUID      `json:"flight_id"`
	Pilot       users.PilotRef `json:"pilot"`
	IsSimulated bool           `json:"is_simulated"`
	Status      string         `json:"status"`
	Position    *Position      `json:"position"`
	AgeS        *float64       `json:"age_s"`
	Freshness   string         `json:"freshness"`
	Trail       [][]any        `json:"trail"`
}

// Freshness classifies the age of the last received position.
func Freshness(age time.Duration) string {
	switch {
	case age < LiveWithin:
		return "live"
	case age <= StaleWithin:
		return "stale"
	}
	return "lost"
}

// LivePilots returns the event's live flights filtered for the actor
// (PostgreSQL is the source of truth; Redis is only a cache, ADR-005).
func LivePilots(ctx context.Context, q *dbq.Queries, a *authz.Actor, e events.Row, acc authz.Access, now time.Time) ([]LivePilot, error) {
	out := []LivePilot{}
	ef := events.Facts(e)
	if authz.LiveScopeFor(a, ef, acc) == authz.LiveRetriever && !acc.Organizer {
		return out, nil // retrievers never get the general live map
	}
	rows, err := q.LiveFlightsForEvent(ctx, &e.ID)
	if err != nil {
		return nil, err
	}
	guestView := authz.GuestView(a, ef, acc)
	ids := []uuid.UUID{}
	idx := map[uuid.UUID]int{}
	for _, r := range rows {
		f := r.FlightSession
		if !authz.CanSeeLiveFlight(a, ef, acc, f.PilotID) {
			continue
		}
		name := r.PilotName
		if guestView && !a.Is(f.PilotID) {
			name = r.PilotDisplayName
		}
		lp := LivePilot{FlightID: f.ID, Pilot: users.PilotRef{UserID: f.PilotID, FullName: name, PublicID: r.PilotPublicID},
			IsSimulated: f.IsSimulated, Status: f.Status, Position: LastPosition(f), Freshness: "lost", Trail: [][]any{}}
		recv := f.LastPositionReceivedAt
		if recv == nil {
			recv = f.LastReceivedAt
		}
		if recv != nil {
			age := now.Sub(*recv)
			sec := age.Seconds()
			lp.AgeS = &sec
			lp.Freshness = Freshness(age)
		}
		idx[f.ID] = len(out)
		out = append(out, lp)
		ids = append(ids, f.ID)
	}
	if len(ids) > 0 {
		// received_at bound enables partition pruning; t bound defines the trail window.
		pos, err := q.RecentPositionsForFlights(ctx, dbq.RecentPositionsForFlightsParams{FlightIds: ids,
			Since: now.Add(-TrailWindow - 5*time.Minute), SinceT: now.Add(-TrailWindow)})
		if err != nil {
			return nil, err
		}
		byFlight := map[uuid.UUID][]dbq.RecentPositionsForFlightsRow{}
		for _, p := range pos {
			if p.HAccM <= stats.MaxHAcc {
				byFlight[p.FlightID] = append(byFlight[p.FlightID], p)
			}
		}
		for fid, ps := range byFlight {
			pts := make([]geo.Point, len(ps))
			for i, p := range ps {
				pts[i] = geo.Point{Lat: p.Lat, Lon: p.Lon}
			}
			keep := geo.SimplifyMax(pts, 3, TrailMax)
			trail := make([][]any, 0, len(keep))
			for _, k := range keep {
				p := ps[k]
				var alt any
				if p.GpsAltM != nil {
					alt = *p.GpsAltM
				}
				trail = append(trail, []any{p.Lon, p.Lat, alt, p.T.UnixMilli()})
			}
			out[idx[fid]].Trail = trail
		}
	}
	return out, nil
}
