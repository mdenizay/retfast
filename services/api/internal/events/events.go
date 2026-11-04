// Package events owns events, memberships (one table, role column) and launch sites.
package events

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
)

// Row is the canonical event row (all query row types convert to it).
type Row = dbq.GetEventByIDRow

// LatLon is {"lat","lon"}.
type LatLon struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// Settings per the contract.
type Settings struct {
	RegistrationOpen bool `json:"registration_open"`
	LiveTracking     bool `json:"live_tracking"`
	FlightRecording  bool `json:"flight_recording"`
	ObserversAllowed bool `json:"observers_allowed"`
	EmergencyTesting bool `json:"emergency_testing"`
	PublicLiveMap    bool `json:"public_live_map"`
}

// Ref is {"id","full_name"}.
type Ref struct {
	ID       uuid.UUID `json:"id"`
	FullName string    `json:"full_name"`
}

// Event is the API representation.
type Event struct {
	ID                  uuid.UUID  `json:"id"`
	Slug                string     `json:"slug"`
	Name                string     `json:"name"`
	Description         string     `json:"description"`
	Kind                string     `json:"kind"`
	Status              string     `json:"status"`
	IsDemo              bool       `json:"is_demo"`
	Visibility          string     `json:"visibility"`
	LocationName        string     `json:"location_name"`
	Center              *LatLon    `json:"center"`
	CenterIsApproximate bool       `json:"center_is_approximate"`
	StartsAt            httpx.Time `json:"starts_at"`
	EndsAt              httpx.Time `json:"ends_at"`
	CoverImageURL       *string    `json:"cover_image_url"`
	Settings            Settings   `json:"settings"`
	Organizer           *Ref       `json:"organizer"`
	ParticipantCount    int        `json:"participant_count"`
	MyRole              *string    `json:"my_role"`
	CreatedAt           httpx.Time `json:"created_at"`
	UpdatedAt           httpx.Time `json:"updated_at"`
}

// Facts converts a row for policy checks.
func Facts(e Row) authz.Event {
	return authz.Event{ID: e.ID, Visibility: e.Visibility, Status: e.Status, PublicLiveMap: e.PublicLiveMap,
		RegistrationOpen: e.RegistrationOpen, ObserversAllowed: e.ObserversAllowed, LiveTracking: e.LiveTracking,
		EmergencyTesting: e.EmergencyTesting}
}

// Load fetches an event by UUID or slug.
func Load(ctx context.Context, q *dbq.Queries, idOrSlug string) (Row, error) {
	if id, err := uuid.Parse(idOrSlug); err == nil {
		return q.GetEventByID(ctx, id)
	}
	r, err := q.GetEventBySlug(ctx, idOrSlug)
	return Row(r), err
}

// MemberRole returns the actor's active per-event role or "".
func MemberRole(ctx context.Context, q *dbq.Queries, eventID uuid.UUID, a *authz.Actor) (string, error) {
	if !a.Authenticated() {
		return "", nil
	}
	m, err := q.GetMembership(ctx, dbq.GetMembershipParams{EventID: eventID, UserID: a.UserID})
	if db.NotFound(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if m.Status != "active" {
		return "", nil
	}
	return m.Role, nil
}

// LoadVisible loads an event and the caller's role, returning 404 when the
// caller may not see it (restricted events are not disclosed).
func LoadVisible(ctx context.Context, q *dbq.Queries, idOrSlug string, a *authz.Actor) (Row, string, error) {
	e, err := Load(ctx, q, idOrSlug)
	if db.NotFound(err) {
		return Row{}, "", httpx.NotFound("Event not found")
	}
	if err != nil {
		return Row{}, "", err
	}
	role, err := MemberRole(ctx, q, e.ID, a)
	if err != nil {
		return Row{}, "", err
	}
	if !authz.CanViewEvent(a, Facts(e), role) {
		return Row{}, "", httpx.NotFound("Event not found")
	}
	return e, role, nil
}

// ToDTO converts a row. counts maps event id → participant count.
func ToDTO(ctx context.Context, q *dbq.Queries, e Row, role string, count int) (Event, error) {
	out := Event{ID: e.ID, Slug: e.Slug, Name: e.Name, Description: e.Description, Kind: e.Kind, Status: e.Status,
		IsDemo: e.IsDemo, Visibility: e.Visibility, LocationName: e.LocationName, CenterIsApproximate: e.CenterIsApproximate,
		StartsAt: httpx.T(e.StartsAt), EndsAt: httpx.T(e.EndsAt), CoverImageURL: e.CoverImageUrl,
		Settings: Settings{RegistrationOpen: e.RegistrationOpen, LiveTracking: e.LiveTracking, FlightRecording: e.FlightRecording,
			ObserversAllowed: e.ObserversAllowed, EmergencyTesting: e.EmergencyTesting, PublicLiveMap: e.PublicLiveMap},
		ParticipantCount: count, CreatedAt: httpx.T(e.CreatedAt), UpdatedAt: httpx.T(e.UpdatedAt)}
	if e.CenterLat != nil && e.CenterLon != nil {
		out.Center = &LatLon{Lat: *e.CenterLat, Lon: *e.CenterLon}
	}
	if role != "" {
		r := role
		out.MyRole = &r
	}
	if e.OrganizerID != nil {
		u, err := q.GetUserName(ctx, *e.OrganizerID)
		if err != nil && !db.NotFound(err) {
			return out, err
		}
		if err == nil {
			out.Organizer = &Ref{ID: u.ID, FullName: u.FullName}
		}
	}
	return out, nil
}

// ParticipantCounts returns active participant counts for events.
func ParticipantCounts(ctx context.Context, q *dbq.Queries, ids []uuid.UUID) (map[uuid.UUID]int, error) {
	rows, err := q.CountActiveParticipants(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]int, len(rows))
	for _, r := range rows {
		out[r.EventID] = int(r.N)
	}
	return out, nil
}

// Now is overridable in tests.
var Now = time.Now
