// Package events owns events, organizers, memberships (one member role per
// user per event), applications and launch sites.
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
	ApplicationsOpen   bool `json:"applications_open"`
	LiveTracking       bool `json:"live_tracking"`
	PublicLiveMap      bool `json:"public_live_map"`
	PilotsSeeEachOther bool `json:"pilots_see_each_other"`
	LandingPrompt      bool `json:"landing_prompt"`
}

// OrganizerRef is {"user_id","full_name"}.
type OrganizerRef struct {
	UserID   uuid.UUID `json:"user_id"`
	FullName string    `json:"full_name"`
}

// Counts per the contract; pending_applications only for organizers/admins.
type Counts struct {
	Pilots              int  `json:"pilots"`
	Observers           int  `json:"observers"`
	Retrievers          int  `json:"retrievers"`
	PendingApplications *int `json:"pending_applications"`
}

// MyApplication is the caller's latest non-approved application.
type MyApplication struct {
	ID     uuid.UUID `json:"id"`
	Status string    `json:"status"`
}

// Me is the caller's relationship to the event.
type Me struct {
	IsOrganizer bool           `json:"is_organizer"`
	Role        *string        `json:"role"`
	Application *MyApplication `json:"application"`
}

// Event is the API representation.
type Event struct {
	ID                  uuid.UUID      `json:"id"`
	Slug                string         `json:"slug"`
	Name                string         `json:"name"`
	Description         string         `json:"description"`
	Kind                string         `json:"kind"`
	Status              string         `json:"status"`
	IsDemo              bool           `json:"is_demo"`
	Visibility          string         `json:"visibility"`
	LocationName        string         `json:"location_name"`
	Center              *LatLon        `json:"center"`
	CenterIsApproximate bool           `json:"center_is_approximate"`
	StartsAt            httpx.Time     `json:"starts_at"`
	EndsAt              httpx.Time     `json:"ends_at"`
	CoverImageURL       *string        `json:"cover_image_url"`
	Settings            Settings       `json:"settings"`
	Organizers          []OrganizerRef `json:"organizers"`
	Counts              Counts         `json:"counts"`
	Me                  Me             `json:"me"`
	CreatedAt           httpx.Time     `json:"created_at"`
	UpdatedAt           httpx.Time     `json:"updated_at"`
}

// Facts converts a row for policy checks.
func Facts(e Row) authz.Event {
	return authz.Event{ID: e.ID, Visibility: e.Visibility, Status: e.Status, ApplicationsOpen: e.ApplicationsOpen,
		LiveTracking: e.LiveTracking, PublicLiveMap: e.PublicLiveMap, PilotsSeeEachOther: e.PilotsSeeEachOther}
}

// Load fetches an event by UUID or slug.
func Load(ctx context.Context, q *dbq.Queries, idOrSlug string) (Row, error) {
	if id, err := uuid.Parse(idOrSlug); err == nil {
		return q.GetEventByID(ctx, id)
	}
	r, err := q.GetEventBySlug(ctx, idOrSlug)
	return Row(r), err
}

// AccessOf returns the actor's organizer flag and active member role.
func AccessOf(ctx context.Context, q *dbq.Queries, eventID uuid.UUID, a *authz.Actor) (authz.Access, error) {
	if !a.Authenticated() {
		return authz.Access{}, nil
	}
	r, err := q.GetEventAccess(ctx, dbq.GetEventAccessParams{EventID: eventID, UserID: a.UserID})
	if err != nil {
		return authz.Access{}, err
	}
	return authz.Access{Organizer: r.IsOrganizer, Role: r.Role}, nil
}

// LoadVisible loads an event and the caller's access, returning 404 when the
// caller may not see it (restricted events are not disclosed).
func LoadVisible(ctx context.Context, q *dbq.Queries, idOrSlug string, a *authz.Actor) (Row, authz.Access, error) {
	e, err := Load(ctx, q, idOrSlug)
	if db.NotFound(err) {
		return Row{}, authz.Access{}, httpx.NotFound("Event not found")
	}
	if err != nil {
		return Row{}, authz.Access{}, err
	}
	acc, err := AccessOf(ctx, q, e.ID, a)
	if err != nil {
		return Row{}, authz.Access{}, err
	}
	if !authz.CanViewEvent(a, Facts(e), acc) {
		return Row{}, authz.Access{}, httpx.NotFound("Event not found")
	}
	return e, acc, nil
}

// BuildDTOs converts rows for the caller with batched lookups.
func BuildDTOs(ctx context.Context, q *dbq.Queries, a *authz.Actor, rows []Row) ([]Event, error) {
	out := make([]Event, 0, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	ids := make([]uuid.UUID, len(rows))
	for i, e := range rows {
		ids[i] = e.ID
	}
	counts, err := q.EventCounts(ctx, ids)
	if err != nil {
		return nil, err
	}
	cm := map[uuid.UUID]dbq.EventCountsRow{}
	for _, c := range counts {
		cm[c.EventID] = c
	}
	orgs, err := q.ListOrganizersForEvents(ctx, ids)
	if err != nil {
		return nil, err
	}
	om := map[uuid.UUID][]OrganizerRef{}
	for _, o := range orgs {
		om[o.EventID] = append(om[o.EventID], OrganizerRef{UserID: o.UserID, FullName: o.FullName})
	}
	access := map[uuid.UUID]authz.Access{}
	apps := map[uuid.UUID]dbq.LatestApplicationsForUserRow{}
	if a.Authenticated() {
		acc, err := q.ListAccessForUser(ctx, dbq.ListAccessForUserParams{UserID: a.UserID, EventIds: ids})
		if err != nil {
			return nil, err
		}
		for _, x := range acc {
			access[x.EventID] = authz.Access{Organizer: x.IsOrganizer, Role: x.Role}
		}
		la, err := q.LatestApplicationsForUser(ctx, dbq.LatestApplicationsForUserParams{UserID: a.UserID, EventIds: ids})
		if err != nil {
			return nil, err
		}
		for _, x := range la {
			apps[x.EventID] = x
		}
	}
	for _, e := range rows {
		acc := access[e.ID]
		c := cm[e.ID]
		dto := Event{ID: e.ID, Slug: e.Slug, Name: e.Name, Description: e.Description, Kind: e.Kind, Status: e.Status,
			IsDemo: e.IsDemo, Visibility: e.Visibility, LocationName: e.LocationName, CenterIsApproximate: e.CenterIsApproximate,
			StartsAt: httpx.T(e.StartsAt), EndsAt: httpx.T(e.EndsAt), CoverImageURL: e.CoverImageUrl,
			Settings: Settings{ApplicationsOpen: e.ApplicationsOpen, LiveTracking: e.LiveTracking, PublicLiveMap: e.PublicLiveMap,
				PilotsSeeEachOther: e.PilotsSeeEachOther, LandingPrompt: e.LandingPrompt},
			Organizers: om[e.ID], Counts: Counts{Pilots: int(c.Pilots), Observers: int(c.Observers), Retrievers: int(c.Retrievers)},
			Me: Me{IsOrganizer: acc.Organizer}, CreatedAt: httpx.T(e.CreatedAt), UpdatedAt: httpx.T(e.UpdatedAt)}
		if dto.Organizers == nil {
			dto.Organizers = []OrganizerRef{}
		}
		if e.CenterLat != nil && e.CenterLon != nil {
			dto.Center = &LatLon{Lat: *e.CenterLat, Lon: *e.CenterLon}
		}
		if authz.CanManageEvent(a, acc) {
			n := int(c.PendingApplications)
			dto.Counts.PendingApplications = &n
		}
		if acc.Role != "" {
			r := acc.Role
			dto.Me.Role = &r
		}
		if ap, ok := apps[e.ID]; ok && ap.Status != "approved" {
			dto.Me.Application = &MyApplication{ID: ap.ID, Status: ap.Status}
		}
		out = append(out, dto)
	}
	return out, nil
}

// Now is overridable in tests.
var Now = time.Now
