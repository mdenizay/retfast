package flights

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/events"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/geo"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
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
	Visibility  string         `json:"visibility"`
	Position    *Position      `json:"position"`
	AgeS        *float64       `json:"age_s"`
	Freshness   string         `json:"freshness"`
	Trail       [][]any        `json:"trail"`
}

// Live is the GET /events/{id}/live document.
type Live struct {
	EventID    uuid.UUID   `json:"event_id"`
	ServerTime httpx.Time  `json:"server_time"`
	Cursor     string      `json:"cursor"`
	Pilots     []LivePilot `json:"pilots"`
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

// LiveService builds snapshots from PostgreSQL (Redis is only a cache, ADR-005).
type LiveService struct {
	Q      *dbq.Queries
	Cursor func(ctx context.Context) string // latest realtime stream id
}

// Snapshot returns the live view of an event filtered for the actor.
func (s *LiveService) Snapshot(ctx context.Context, a *authz.Actor, e events.Row, member string) (*Live, error) {
	cursor := "0-0"
	if s.Cursor != nil {
		cursor = s.Cursor(ctx)
	}
	now := time.Now()
	rows, err := s.Q.LiveFlightsForEvent(ctx, &e.ID)
	if err != nil {
		return nil, err
	}
	ef := events.Facts(e)
	guestView := member == "" && !a.IsGlobalResponder()
	out := &Live{EventID: e.ID, ServerTime: httpx.T(now), Cursor: cursor, Pilots: []LivePilot{}}
	ids := []uuid.UUID{}
	idx := map[uuid.UUID]int{}
	for _, r := range rows {
		f := r.FlightSession
		facts := authz.Flight{OwnerID: f.PilotID, EventID: f.EventID, Visibility: f.Visibility, IncidentOpen: r.IncidentOpen}
		if !authz.CanSeeLiveFlight(a, ef, member, facts) {
			continue
		}
		name := r.PilotName
		if guestView && !a.Is(f.PilotID) {
			name = r.PilotDisplayName
		}
		lp := LivePilot{FlightID: f.ID, Pilot: users.PilotRef{UserID: f.PilotID, FullName: name, PublicID: r.PilotPublicID},
			IsSimulated: f.IsSimulated, Status: f.Status, Visibility: f.Visibility, Position: LastPosition(f), Freshness: "lost", Trail: [][]any{}}
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
		idx[f.ID] = len(out.Pilots)
		out.Pilots = append(out.Pilots, lp)
		ids = append(ids, f.ID)
	}
	if len(ids) > 0 {
		// received_at bound enables partition pruning; t bound defines the trail window.
		pos, err := s.Q.RecentPositionsForFlights(ctx, dbq.RecentPositionsForFlightsParams{FlightIds: ids,
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
			out.Pilots[idx[fid]].Trail = trail
		}
	}
	return out, nil
}

// LiveHandler serves GET /events/{id}/live.
type LiveHandler struct{ Live *LiveService }

// Routes mounts with optional auth.
func (h *LiveHandler) Routes(r chi.Router) {
	r.Get("/events/{id}/live", httpx.H(h.get))
}

func (h *LiveHandler) get(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, member, err := events.LoadVisible(ctx, h.Live.Q, chi.URLParam(r, "id"), a)
	if err != nil && !a.IsGlobalResponder() {
		return err
	}
	if err != nil { // global responders may see restricted events' live maps
		if e, err = events.Load(ctx, h.Live.Q, chi.URLParam(r, "id")); err != nil {
			return httpx.NotFound("Event not found")
		}
	}
	if !authz.CanViewEventLive(a, events.Facts(e), member) {
		if !a.Authenticated() {
			return httpx.Unauthorized("Sign in to view this live map")
		}
		return httpx.Forbidden("The live map of this event is not public")
	}
	live, err := h.Live.Snapshot(ctx, a, e, member)
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, live)
	return nil
}
