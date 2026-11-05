// Package emergencies implements SOS incidents, their state machine, rescue
// assignments and the rescue team console. Every responder action and every
// responder access to emergency-contact data is written to audit_logs.
package emergencies

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/flights"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/realtime/bus"
	"github.com/mdenizay/retfast/services/api/internal/users"
)

// Incident statuses.
const (
	StatusOpen         = "open"
	StatusAcknowledged = "acknowledged"
	StatusResponding   = "responding"
	StatusResolved     = "resolved"
	StatusCancelled    = "cancelled"
)

// OpenStatuses are the non-terminal statuses.
var OpenStatuses = []string{StatusOpen, StatusAcknowledged, StatusResponding}

// Terminal reports whether no further transitions are allowed.
func Terminal(s string) bool { return s == StatusResolved || s == StatusCancelled }

// CanTransition is the incident state machine.
//
//	open ─► acknowledged ─► responding ─► resolved
//	  └──────────┴──────────────┴────────► resolved / cancelled (owner)
func CanTransition(from, to string) bool {
	if Terminal(from) {
		return false
	}
	switch to {
	case StatusAcknowledged:
		return from == StatusOpen
	case StatusResponding:
		return from == StatusOpen || from == StatusAcknowledged
	case StatusResolved, StatusCancelled:
		return true
	}
	return false
}

// assignment transitions: forward only, withdrawn from any active state.
var assignmentOrder = map[string]int{"assigned": 0, "en_route": 1, "on_scene": 2, "completed": 3}

// CanTransitionAssignment validates a rescue assignment status change.
func CanTransitionAssignment(from, to string) bool {
	if from == "completed" || from == "withdrawn" {
		return false
	}
	if to == "withdrawn" {
		return true
	}
	a, ok1 := assignmentOrder[from]
	b, ok2 := assignmentOrder[to]
	return ok1 && ok2 && b > a
}

// IncidentPilot includes contact fields only for authorized viewers.
type IncidentPilot struct {
	UserID                uuid.UUID `json:"user_id"`
	FullName              string    `json:"full_name"`
	PublicID              string    `json:"public_id"`
	EmergencyContactName  *string   `json:"emergency_contact_name,omitempty"`
	EmergencyContactPhone *string   `json:"emergency_contact_phone,omitempty"`
	BloodType             *string   `json:"blood_type,omitempty"`
}

// IncidentPosition is the device-reported SOS position.
type IncidentPosition struct {
	Lat     float64    `json:"lat"`
	Lon     float64    `json:"lon"`
	GPSAltM *float64   `json:"gps_alt_m"`
	HAccM   *float64   `json:"h_acc_m"`
	T       httpx.Time `json:"t"`
}

// Update per the contract.
type Update struct {
	ID        uuid.UUID      `json:"id"`
	Kind      string         `json:"kind"`
	Actor     *users.UserRef `json:"actor"`
	Body      string         `json:"body"`
	Status    string         `json:"status"`
	CreatedAt httpx.Time     `json:"created_at"`
}

// LatLonT is {lat, lon, t}.
type LatLonT struct {
	Lat float64    `json:"lat"`
	Lon float64    `json:"lon"`
	T   httpx.Time `json:"t"`
}

// Assignment per the contract.
type Assignment struct {
	ID           uuid.UUID     `json:"id"`
	IncidentID   uuid.UUID     `json:"incident_id"`
	Responder    users.UserRef `json:"responder"`
	Status       string        `json:"status"`
	AssignedAt   httpx.Time    `json:"assigned_at"`
	UpdatedAt    httpx.Time    `json:"updated_at"`
	LastPosition *LatLonT      `json:"last_position"`
}

// Incident per the contract.
type Incident struct {
	ID                uuid.UUID         `json:"id"`
	Kind              string            `json:"kind"`
	IsTest            bool              `json:"is_test"`
	Status            string            `json:"status"`
	Pilot             IncidentPilot     `json:"pilot"`
	FlightID          *uuid.UUID        `json:"flight_id"`
	EventID           *uuid.UUID        `json:"event_id"`
	Position          *IncidentPosition `json:"position"`
	LastKnownPosition *flights.Position `json:"last_known_position"`
	Message           string            `json:"message"`
	CreatedAtDevice   httpx.Time        `json:"created_at_device"`
	ReceivedAt        httpx.Time        `json:"received_at"`
	AcknowledgedAt    *httpx.Time       `json:"acknowledged_at"`
	AcknowledgedBy    *users.UserRef    `json:"acknowledged_by"`
	ResolvedAt        *httpx.Time       `json:"resolved_at"`
	Assignments       []Assignment      `json:"assignments"`
	Updates           []Update          `json:"updates"`
}

func assignmentDTO(a dbq.ListAssignmentsForIncidentsRow) Assignment {
	out := Assignment{ID: a.ID, IncidentID: a.IncidentID, Responder: users.UserRef{UserID: a.ResponderID, FullName: a.ResponderName},
		Status: a.Status, AssignedAt: httpx.T(a.AssignedAt), UpdatedAt: httpx.T(a.UpdatedAt)}
	if a.LastLat != nil && a.LastLon != nil && a.LastT != nil {
		out.LastPosition = &LatLonT{*a.LastLat, *a.LastLon, httpx.T(*a.LastT)}
	}
	return out
}

// Build renders incidents with updates and assignments. withContact controls
// whether emergency contact fields are included.
func Build(ctx context.Context, q *dbq.Queries, rows []dbq.EmergencyIncident, withContact func(dbq.EmergencyIncident) bool) ([]Incident, error) {
	out := make([]Incident, 0, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	ids := make([]uuid.UUID, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	ups, err := q.ListIncidentUpdates(ctx, ids)
	if err != nil {
		return nil, err
	}
	asg, err := q.ListAssignmentsForIncidents(ctx, ids)
	if err != nil {
		return nil, err
	}
	upBy := map[uuid.UUID][]Update{}
	for _, u := range ups {
		var actor *users.UserRef
		if u.ActorID != nil {
			actor = &users.UserRef{UserID: *u.ActorID, FullName: u.ActorName}
		}
		upBy[u.IncidentID] = append(upBy[u.IncidentID], Update{ID: u.ID, Kind: u.Kind, Actor: actor, Body: u.Body, Status: u.Status, CreatedAt: httpx.T(u.CreatedAt)})
	}
	asgBy := map[uuid.UUID][]Assignment{}
	for _, a := range asg {
		asgBy[a.IncidentID] = append(asgBy[a.IncidentID], assignmentDTO(a))
	}
	names := map[uuid.UUID]string{}
	name := func(id uuid.UUID) string {
		if n, ok := names[id]; ok {
			return n
		}
		u, err := q.GetUserName(ctx, id)
		if err == nil {
			names[id] = u.FullName
		}
		return names[id]
	}
	for _, r := range rows {
		inc := Incident{ID: r.ID, Kind: r.Kind, IsTest: r.IsTest, Status: r.Status, FlightID: r.FlightID, EventID: r.EventID,
			Message: r.Message, CreatedAtDevice: httpx.T(r.CreatedAtDevice), ReceivedAt: httpx.T(r.ReceivedAt),
			AcknowledgedAt: httpx.TP(r.AcknowledgedAt), ResolvedAt: httpx.TP(r.ResolvedAt),
			Assignments: asgBy[r.ID], Updates: upBy[r.ID]}
		if inc.Assignments == nil {
			inc.Assignments = []Assignment{}
		}
		if inc.Updates == nil {
			inc.Updates = []Update{}
		}
		inc.Pilot = IncidentPilot{UserID: r.PilotID, FullName: name(r.PilotID)}
		if p, err := q.GetPilotProfile(ctx, r.PilotID); err == nil {
			inc.Pilot.PublicID = p.PublicID
			if withContact(r) {
				inc.Pilot.EmergencyContactName, inc.Pilot.EmergencyContactPhone, inc.Pilot.BloodType =
					&p.EmergencyContactName, &p.EmergencyContactPhone, &p.BloodType
			}
		} else if !db.NotFound(err) {
			return nil, err
		}
		if r.Lat != nil && r.Lon != nil {
			t := r.ReceivedAt
			if r.PositionT != nil {
				t = *r.PositionT
			}
			inc.Position = &IncidentPosition{Lat: *r.Lat, Lon: *r.Lon, GPSAltM: r.GpsAltM, HAccM: r.HAccM, T: httpx.T(t)}
		}
		if r.FlightID != nil {
			if f, err := q.GetFlight(ctx, *r.FlightID); err == nil {
				inc.LastKnownPosition = flights.LastPosition(f.FlightSession)
			}
		}
		if r.AcknowledgedBy != nil {
			inc.AcknowledgedBy = &users.UserRef{UserID: *r.AcknowledgedBy, FullName: name(*r.AcknowledgedBy)}
		}
		out = append(out, inc)
	}
	return out, nil
}

// Publish writes an incident envelope to the outbox (incidents channel). The
// payload includes contact data: only responders can subscribe to it.
func Publish(ctx context.Context, q *dbq.Queries, id uuid.UUID) error {
	r, err := q.GetIncident(ctx, id)
	if err != nil {
		return err
	}
	inc, err := Build(ctx, q, []dbq.EmergencyIncident{r}, func(dbq.EmergencyIncident) bool { return true })
	if err != nil {
		return err
	}
	data, _ := json.Marshal(inc[0])
	iid, pid := r.ID, r.PilotID
	return bus.Write(ctx, q, bus.Envelope{Type: bus.TypeIncident, EventID: r.EventID, FlightID: r.FlightID, IncidentID: &iid,
		PilotID: &pid, Data: data, ServerReceivedMS: time.Now().UnixMilli()})
}

// organizedEvents lists event ids the actor organises.
func organizedEvents(ctx context.Context, q *dbq.Queries, a *authz.Actor) ([]uuid.UUID, error) {
	if !a.Authenticated() {
		return nil, nil
	}
	ms, err := q.ListMembershipsForUser(ctx, a.UserID)
	if err != nil {
		return nil, err
	}
	var out []uuid.UUID
	for _, m := range ms {
		if m.Role == authz.MemberOrganizer {
			out = append(out, m.EventID)
		}
	}
	return out, nil
}

// eventMember returns the actor's role in the incident's event.
func eventMember(ctx context.Context, q *dbq.Queries, r dbq.EmergencyIncident, a *authz.Actor) (string, error) {
	if r.EventID == nil || !a.Authenticated() {
		return "", nil
	}
	m, err := q.GetMembership(ctx, dbq.GetMembershipParams{EventID: *r.EventID, UserID: a.UserID})
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

// Provider implements realtime.IncidentProvider.
type Provider struct{ Q *dbq.Queries }

// Scope implements realtime.IncidentProvider.
func (p *Provider) Scope(ctx context.Context, a *authz.Actor) (bool, []uuid.UUID, error) {
	evs, err := organizedEvents(ctx, p.Q, a)
	return a.IsGlobalResponder(), evs, err
}

// Snapshot implements realtime.IncidentProvider.
func (p *Provider) Snapshot(ctx context.Context, a *authz.Actor) (any, error) {
	rows, err := p.Q.ListIncidents(ctx, dbq.ListIncidentsParams{Statuses: OpenStatuses, ViewerID: a.UserID, SeeAll: a.IsGlobalResponder(), Lim: 500})
	if err != nil {
		return nil, err
	}
	items, err := Build(ctx, p.Q, rows, func(dbq.EmergencyIncident) bool { return true })
	if err != nil {
		return nil, err
	}
	if len(items) > 0 {
		uid := a.UserID
		_ = auditContactAccess(ctx, p.Q, nil, &uid, "incident.contact_viewed_realtime", "", len(items))
	}
	return map[string]any{"items": items}, nil
}
