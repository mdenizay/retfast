// Package flights owns flight sessions, position reads, GPX export and the
// live-map read model. Ingestion lives in package tracking.
package flights

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/events"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/realtime/bus"
	"github.com/mdenizay/retfast/services/api/internal/tracking/stats"
	"github.com/mdenizay/retfast/services/api/internal/users"
)

// Position per the contract.
type Position struct {
	ID         uuid.UUID  `json:"id"`
	Seq        int32      `json:"seq"`
	T          httpx.Time `json:"t"`
	ReceivedAt httpx.Time `json:"received_at"`
	Lat        float64    `json:"lat"`
	Lon        float64    `json:"lon"`
	GPSAltM    *float64   `json:"gps_alt_m"`
	HAccM      float64    `json:"h_acc_m"`
	VAccM      *float64   `json:"v_acc_m"`
	SpeedMS    *float64   `json:"speed_ms"`
	CourseDeg  *float64   `json:"course_deg"`
}

// PositionFromRow converts a position row.
func PositionFromRow(p dbq.ListPositionsRow) Position {
	return Position{ID: p.SampleID, Seq: p.Seq, T: httpx.T(p.T), ReceivedAt: httpx.T(p.ReceivedAt), Lat: p.Lat, Lon: p.Lon,
		GPSAltM: p.GpsAltM, HAccM: p.HAccM, VAccM: p.VAccM, SpeedMS: p.SpeedMs, CourseDeg: p.CourseDeg}
}

// Stats per the contract.
type Stats struct {
	DurationS           float64  `json:"duration_s"`
	DistanceM           float64  `json:"distance_m"`
	MaxGPSAltM          *float64 `json:"max_gps_alt_m"`
	MinGPSAltM          *float64 `json:"min_gps_alt_m"`
	MaxGroundSpeedMS    *float64 `json:"max_ground_speed_ms"`
	TotalAscentM        float64  `json:"total_ascent_m"`
	TotalDescentM       float64  `json:"total_descent_m"`
	SampleCount         int32    `json:"sample_count"`
	ExpectedSampleCount int64    `json:"expected_sample_count"`
	GapCount            int32    `json:"gap_count"`
}

// Device per the contract.
type Device struct {
	Platform   string `json:"platform"`
	AppVersion string `json:"app_version"`
}

// Flight per the contract.
type Flight struct {
	ID             uuid.UUID      `json:"id"`
	PublicID       string         `json:"public_id"`
	Pilot          users.PilotRef `json:"pilot"`
	EventID        *uuid.UUID     `json:"event_id"`
	Status         string         `json:"status"`
	Visibility     string         `json:"visibility"`
	IsSimulated    bool           `json:"is_simulated"`
	StartedAt      httpx.Time     `json:"started_at"`
	EndedAt        *httpx.Time    `json:"ended_at"`
	LastPosition   *Position      `json:"last_position"`
	LastReceivedAt *httpx.Time    `json:"last_received_at"`
	Stats          Stats          `json:"stats"`
	Device         Device         `json:"device"`
}

// Row is a flight with its pilot names.
type Row struct {
	dbq.FlightSession
	PilotName     string
	PilotPublicID string
}

// LastPosition returns the denormalised latest position or nil.
func LastPosition(f dbq.FlightSession) *Position {
	if f.LastSeq == nil || f.LastLat == nil || f.LastLon == nil || f.LastT == nil || f.LastSampleID == nil {
		return nil
	}
	p := &Position{ID: *f.LastSampleID, Seq: *f.LastSeq, T: httpx.T(*f.LastT), Lat: *f.LastLat, Lon: *f.LastLon,
		GPSAltM: f.LastGpsAltM, VAccM: f.LastVAccM, SpeedMS: f.LastSpeedMs, CourseDeg: f.LastCourseDeg}
	if f.LastHAccM != nil {
		p.HAccM = *f.LastHAccM
	}
	if f.LastPositionReceivedAt != nil {
		p.ReceivedAt = httpx.T(*f.LastPositionReceivedAt)
	}
	return p
}

// DTO converts a row.
func DTO(r Row) Flight {
	f := r.FlightSession
	end := f.StartedAt
	switch {
	case f.EndedAt != nil:
		end = *f.EndedAt
	case f.LastSampleT != nil:
		end = *f.LastSampleT
	}
	dur := end.Sub(f.StartedAt).Seconds()
	if dur < 0 {
		dur = 0
	}
	return Flight{ID: f.ID, PublicID: f.PublicID, Pilot: users.PilotRef{UserID: f.PilotID, FullName: r.PilotName, PublicID: r.PilotPublicID},
		EventID: f.EventID, Status: f.Status, Visibility: f.Visibility, IsSimulated: f.IsSimulated, StartedAt: httpx.T(f.StartedAt),
		EndedAt: httpx.TP(f.EndedAt), LastPosition: LastPosition(f), LastReceivedAt: httpx.TP(f.LastReceivedAt),
		Stats: Stats{DurationS: dur, DistanceM: f.DistanceM, MaxGPSAltM: f.MaxGpsAltM, MinGPSAltM: f.MinGpsAltM,
			MaxGroundSpeedMS: f.MaxGroundSpeedMs, TotalAscentM: f.TotalAscentM, TotalDescentM: f.TotalDescentM,
			SampleCount: f.SampleCount, ExpectedSampleCount: stats.ExpectedSamples(f.FirstSampleT, f.LastSampleT), GapCount: f.GapCount},
		Device: Device{Platform: f.DevicePlatform, AppVersion: f.DeviceAppVersion}}
}

// Get loads a flight by id or public id.
func Get(ctx context.Context, q *dbq.Queries, idOrPublic string) (Row, error) {
	if id, err := uuid.Parse(idOrPublic); err == nil {
		r, err := q.GetFlight(ctx, id)
		return Row{r.FlightSession, r.PilotName, r.PilotPublicID}, err
	}
	r, err := q.GetFlightByPublicID(ctx, idOrPublic)
	return Row{r.FlightSession, r.PilotName, r.PilotPublicID}, err
}

// Facts builds policy facts for a flight.
func Facts(ctx context.Context, q *dbq.Queries, f dbq.FlightSession) (authz.Flight, error) {
	open, err := q.FlightHasOpenIncident(ctx, &f.ID)
	if err != nil {
		return authz.Flight{}, err
	}
	return authz.Flight{OwnerID: f.PilotID, EventID: f.EventID, Visibility: f.Visibility, IncidentOpen: open}, nil
}

// LoadVisible loads a flight the actor may view (404 otherwise).
func LoadVisible(ctx context.Context, q *dbq.Queries, idOrPublic string, a *authz.Actor) (Row, error) {
	r, err := Get(ctx, q, idOrPublic)
	if db.NotFound(err) {
		return Row{}, httpx.NotFound("Flight not found")
	}
	if err != nil {
		return Row{}, err
	}
	facts, err := Facts(ctx, q, r.FlightSession)
	if err != nil {
		return Row{}, err
	}
	member := ""
	if r.EventID != nil {
		if member, err = events.MemberRole(ctx, q, *r.EventID, a); err != nil {
			return Row{}, err
		}
	}
	if !authz.CanViewFlight(a, facts, member) {
		return Row{}, httpx.NotFound("Flight not found")
	}
	return r, nil
}

// PublishFlight writes a "flight" envelope (started/ended/visibility changed).
func PublishFlight(ctx context.Context, q *dbq.Queries, flightID uuid.UUID) error {
	r, err := q.GetFlight(ctx, flightID)
	if err != nil {
		return err
	}
	row := Row{r.FlightSession, r.PilotName, r.PilotPublicID}
	open, err := q.FlightHasOpenIncident(ctx, &flightID)
	if err != nil {
		return err
	}
	dto := DTO(row)
	data, _ := json.Marshal(dto)
	pub := dto
	pub.Pilot.FullName = displayName(ctx, q, row)
	pubData, _ := json.Marshal(pub)
	owner := row.PilotID
	return bus.Write(ctx, q, bus.Envelope{Type: bus.TypeFlight, EventID: row.EventID, FlightID: &flightID, OwnerID: &owner,
		Visibility: row.Visibility, IncidentOpen: open, Data: data, PublicData: pubData, ServerReceivedMS: time.Now().UnixMilli()})
}

func displayName(ctx context.Context, q *dbq.Queries, r Row) string {
	if p, err := q.GetPilotProfile(ctx, r.PilotID); err == nil && p.DisplayName != "" {
		return p.DisplayName
	}
	return r.PilotName
}

// MarshalState serialises the running stats state.
func MarshalState(st stats.State) ([]byte, error) { return json.Marshal(st) }

// StateFromRow restores the running stats state and aggregates of a flight.
func StateFromRow(f dbq.FlightSession) stats.State {
	var st stats.State
	_ = json.Unmarshal(f.StatsState, &st)
	st.SampleCount, st.DistanceM, st.MaxAltM, st.MinAltM = f.SampleCount, f.DistanceM, f.MaxGpsAltM, f.MinGpsAltM
	st.MaxSpeedMS, st.AscentM, st.DescentM, st.GapCount = f.MaxGroundSpeedMs, f.TotalAscentM, f.TotalDescentM, f.GapCount
	st.FirstT, st.LastSampleT = f.FirstSampleT, f.LastSampleT
	return st
}
