// Package authz is the single authorization policy (ADR-006) used by REST and
// WebSocket handlers. Policies are pure functions over facts so they can be
// tested exhaustively; loaders that fetch facts live with the domain packages.
package authz

import (
	"context"
	"slices"

	"github.com/google/uuid"
)

// Global roles.
const (
	RolePilot          = "pilot"
	RoleObserver       = "observer"
	RoleEventOrganizer = "event_organizer"
	RoleRescueOperator = "rescue_operator"
	RolePlatformAdmin  = "platform_admin"
)

// AllRoles lists valid global roles.
var AllRoles = []string{RolePilot, RoleObserver, RoleEventOrganizer, RoleRescueOperator, RolePlatformAdmin}

// Per-event membership roles ("" = not a member).
const (
	MemberOrganizer   = "organizer"
	MemberParticipant = "participant"
	MemberObserver    = "observer"
)

// Visibility values.
const (
	VisPrivate    = "private"
	VisEvent      = "event"
	VisPublic     = "public"
	EventPublic   = "public"
	EventRestrict = "restricted"
)

// Actor is the authenticated caller; the zero value / nil is a guest.
type Actor struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
	Roles     []string
	PCR       bool // password change required
	FullName  string
}

// Authenticated reports whether a is a signed-in user.
func (a *Actor) Authenticated() bool { return a != nil && a.UserID != uuid.Nil }

// Has reports whether a holds the global role.
func (a *Actor) Has(role string) bool { return a != nil && slices.Contains(a.Roles, role) }

// IsAdmin reports platform_admin.
func (a *Actor) IsAdmin() bool { return a.Has(RolePlatformAdmin) }

// IsGlobalResponder reports platform_admin or rescue_operator: they see every
// incident and every flight linked to it.
func (a *Actor) IsGlobalResponder() bool {
	return a.Has(RolePlatformAdmin) || a.Has(RoleRescueOperator)
}

// Is reports whether a is the given user.
func (a *Actor) Is(id uuid.UUID) bool { return a.Authenticated() && a.UserID == id }

type ctxKey struct{}

// WithActor stores a in ctx.
func WithActor(ctx context.Context, a *Actor) context.Context {
	return context.WithValue(ctx, ctxKey{}, a)
}

// ActorFrom returns the actor in ctx or nil for guests.
func ActorFrom(ctx context.Context) *Actor {
	a, _ := ctx.Value(ctxKey{}).(*Actor)
	return a
}

// Event holds the event facts policies need.
type Event struct {
	ID               uuid.UUID
	Visibility       string
	Status           string
	PublicLiveMap    bool
	RegistrationOpen bool
	ObserversAllowed bool
	LiveTracking     bool
	EmergencyTesting bool
}

// Flight holds the flight facts policies need.
type Flight struct {
	OwnerID      uuid.UUID
	EventID      *uuid.UUID
	Visibility   string
	IncidentOpen bool // an open/acknowledged/responding incident references this flight
}

// CanCreateEvent: global event_organizer or platform_admin.
func CanCreateEvent(a *Actor) bool { return a.Has(RoleEventOrganizer) || a.IsAdmin() }

// CanViewEvent: restricted and draft events are visible to members and admins only.
func CanViewEvent(a *Actor, e Event, member string) bool {
	if a.IsAdmin() || member != "" {
		if e.Status == "draft" {
			return a.IsAdmin() || member == MemberOrganizer
		}
		return true
	}
	return e.Visibility == EventPublic && e.Status != "draft"
}

// CanManageEvent: event organizers and platform admins.
func CanManageEvent(a *Actor, member string) bool {
	return a.Authenticated() && (a.IsAdmin() || member == MemberOrganizer)
}

// CanViewParticipants: any active member, or admin.
func CanViewParticipants(a *Actor, member string) bool {
	return a.Authenticated() && (a.IsAdmin() || member != "")
}

// JoinDecision explains a join attempt.
type JoinDecision int

// Join outcomes.
const (
	JoinAllowed JoinDecision = iota
	JoinForbidden
	JoinClosed
	JoinNotPilot
	JoinObserversDisallowed
)

// CanJoinEvent decides self-service join as participant or observer.
func CanJoinEvent(a *Actor, e Event, asRole string) JoinDecision {
	if !a.Authenticated() {
		return JoinForbidden
	}
	if e.Visibility != EventPublic || e.Status == "draft" || e.Status == "archived" || e.Status == "completed" {
		return JoinForbidden
	}
	if !e.RegistrationOpen {
		return JoinClosed
	}
	switch asRole {
	case MemberParticipant:
		if !a.Has(RolePilot) {
			return JoinNotPilot
		}
	case MemberObserver:
		if !e.ObserversAllowed {
			return JoinObserversDisallowed
		}
	default:
		return JoinForbidden
	}
	return JoinAllowed
}

// CanViewFlight governs GET /flights/{id}, positions and GPX.
//   - owners, admins and rescue operators: always
//   - public flights: everyone
//   - event flights: active members of the flight's event
//   - private flights: organizers of the flight's event only while an incident is open on it
func CanViewFlight(a *Actor, f Flight, member string) bool {
	if a.Is(f.OwnerID) || a.IsGlobalResponder() {
		return true
	}
	switch f.Visibility {
	case VisPublic:
		return true
	case VisEvent:
		return member != "" && f.EventID != nil
	default:
		return member == MemberOrganizer && f.EventID != nil && f.IncidentOpen
	}
}

// CanViewEventLive governs access to an event's live map (REST snapshot and
// event:<id> WebSocket channel). Per-flight filtering is CanSeeLiveFlight.
func CanViewEventLive(a *Actor, e Event, member string) bool {
	if a.IsGlobalResponder() {
		return true
	}
	if !CanViewEvent(a, e, member) {
		return false
	}
	if member != "" {
		return true
	}
	return e.Visibility == EventPublic && e.PublicLiveMap
}

// CanSeeLiveFlight filters individual flights on an event live map.
func CanSeeLiveFlight(a *Actor, e Event, member string, f Flight) bool {
	if a.Is(f.OwnerID) || a.IsGlobalResponder() {
		return true
	}
	switch member {
	case MemberOrganizer:
		return f.Visibility != VisPrivate || f.IncidentOpen
	case MemberParticipant, MemberObserver:
		return f.Visibility != VisPrivate
	}
	return e.Visibility == EventPublic && e.PublicLiveMap && f.Visibility == VisPublic
}

// IsIncidentResponder: admin, rescue_operator, or organizer of the incident's event.
func IsIncidentResponder(a *Actor, incidentEventMember string) bool {
	return a.IsGlobalResponder() || (a.Authenticated() && incidentEventMember == MemberOrganizer)
}

// CanViewIncident: the reporting pilot or a responder.
func CanViewIncident(a *Actor, pilotID uuid.UUID, incidentEventMember string) bool {
	return a.Is(pilotID) || IsIncidentResponder(a, incidentEventMember)
}

// CanSeeEmergencyContact: responders only, never the general public; the
// owner sees their own data anyway.
func CanSeeEmergencyContact(a *Actor, pilotID uuid.UUID, incidentEventMember string) bool {
	return a.Is(pilotID) || IsIncidentResponder(a, incidentEventMember)
}

// CanSubscribeIncidents: admins, rescue operators, and anyone organizing at least one event (scoped).
func CanSubscribeIncidents(a *Actor, organizesAny bool) bool {
	return a.IsGlobalResponder() || (a.Authenticated() && organizesAny)
}

// CanListPilots: organizers and admins (GET /pilots).
func CanListPilots(a *Actor, organizesAny bool) bool {
	return a.IsAdmin() || a.Has(RoleEventOrganizer) || (a.Authenticated() && organizesAny)
}

// CanUseRescueConsole: rescue_operator or admin.
func CanUseRescueConsole(a *Actor) bool { return a.IsGlobalResponder() }
