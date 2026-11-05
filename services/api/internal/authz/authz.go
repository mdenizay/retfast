// Package authz is the single authorization policy (ADR-006/ADR-012) used by
// REST and WebSocket handlers. Policies are pure functions over facts so they
// can be tested exhaustively; loaders that fetch facts live with the domain
// packages.
package authz

import (
	"context"
	"slices"

	"github.com/google/uuid"
)

// RolePlatformAdmin is the only global role.
const RolePlatformAdmin = "platform_admin"

// AllRoles lists valid global roles.
var AllRoles = []string{RolePlatformAdmin}

// Per-event member roles (exactly one per user per event).
const (
	MemberPilot     = "pilot"
	MemberObserver  = "observer"
	MemberRetriever = "retriever"
)

// MemberRoles is the set of valid member roles.
var MemberRoles = map[string]bool{MemberPilot: true, MemberObserver: true, MemberRetriever: true}

// Event visibility values.
const (
	EventPublic   = "public"
	EventRestrict = "restricted"
)

// Retrieval statuses.
const (
	RetrievalRequested = "requested"
	RetrievalAccepted  = "accepted"
	RetrievalPickedUp  = "picked_up"
	RetrievalDelivered = "delivered"
	RetrievalCancelled = "cancelled"
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

// Is reports whether a is the given user.
func (a *Actor) Is(id uuid.UUID) bool { return a.Authenticated() && a.UserID == id }

// IsPtr reports whether a is the user id points to (false for nil).
func (a *Actor) IsPtr(id *uuid.UUID) bool { return id != nil && a.Is(*id) }

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
	ID                 uuid.UUID `json:"id"`
	Visibility         string    `json:"visibility"`
	Status             string    `json:"status"`
	ApplicationsOpen   bool      `json:"applications_open"`
	LiveTracking       bool      `json:"live_tracking"`
	PublicLiveMap      bool      `json:"public_live_map"`
	PilotsSeeEachOther bool      `json:"pilots_see_each_other"`
}

// Access is the caller's relationship to one event: organizer flag plus the
// active member role ("" = none).
type Access struct {
	Organizer bool   `json:"organizer"`
	Role      string `json:"role"`
}

// Involved reports organizer or active member.
func (m Access) Involved() bool { return m.Organizer || m.Role != "" }

// CanCreateEvent: platform admins only.
func CanCreateEvent(a *Actor) bool { return a.IsAdmin() }

// CanManageOrganizers: platform admins only.
func CanManageOrganizers(a *Actor) bool { return a.IsAdmin() }

// CanViewEvent: drafts are visible to admins and organizers; restricted
// events to admins, organizers and members; public events to everyone.
func CanViewEvent(a *Actor, e Event, m Access) bool {
	if a.IsAdmin() || m.Organizer {
		return true
	}
	if e.Status == "draft" {
		return false
	}
	return m.Role != "" || e.Visibility == EventPublic
}

// CanManageEvent: event organizers and platform admins (settings, members,
// applications, launch sites, report).
func CanManageEvent(a *Actor, m Access) bool {
	return a.Authenticated() && (a.IsAdmin() || m.Organizer)
}

// CanViewMembers: organizers, admins and active members (members see no phones).
func CanViewMembers(a *Actor, m Access) bool {
	return a.Authenticated() && (a.IsAdmin() || m.Involved())
}

// CanSeeMemberPhones: organizers and admins.
func CanSeeMemberPhones(a *Actor, m Access) bool { return CanManageEvent(a, m) }

// ApplyDecision explains an application attempt.
type ApplyDecision int

// Application outcomes.
const (
	ApplyAllowed ApplyDecision = iota
	ApplyForbidden
	ApplyClosed
	ApplyAlreadyMember
)

// CanApply decides whether the caller may apply to an event they can see.
func CanApply(a *Actor, e Event, m Access) ApplyDecision {
	if !a.Authenticated() {
		return ApplyForbidden
	}
	if m.Role != "" {
		return ApplyAlreadyMember
	}
	if !CanViewEvent(a, e, m) {
		return ApplyForbidden
	}
	if !e.ApplicationsOpen || e.Status == "completed" || e.Status == "archived" || e.Status == "draft" {
		return ApplyClosed
	}
	return ApplyAllowed
}

// CanSearchUsers: admins and anyone organizing at least one event.
func CanSearchUsers(a *Actor, organizesAny bool) bool {
	return a.IsAdmin() || (a.Authenticated() && organizesAny)
}

// LiveScope is how much of an event's live map a caller sees.
type LiveScope int

// Live scopes.
const (
	LiveNone      LiveScope = iota // no access
	LiveGuest                      // public map: positions and display names only
	LiveRetriever                  // no general map: retrieval requests and own accepted retrievals only
	LivePilot                      // own flight (+ other pilots when pilots_see_each_other)
	LiveFull                       // organizers, observers, admins: all event flights
)

// LiveScopeFor resolves the caller's live scope for an event.
func LiveScopeFor(a *Actor, e Event, m Access) LiveScope {
	switch {
	case a.IsAdmin() || m.Organizer || m.Role == MemberObserver:
		return LiveFull
	case m.Role == MemberPilot:
		return LivePilot
	case m.Role == MemberRetriever:
		return LiveRetriever
	case e.Visibility == EventPublic && e.PublicLiveMap && e.Status != "draft":
		return LiveGuest
	}
	return LiveNone
}

// CanViewEventLive governs GET /events/{id}/live and the event:<id> channel.
// Retrievers get access but never receive pilot flights there.
func CanViewEventLive(a *Actor, e Event, m Access) bool { return LiveScopeFor(a, e, m) != LiveNone }

// CanSeeLiveFlight filters one flight (owned by ownerID) on an event live map.
func CanSeeLiveFlight(a *Actor, e Event, m Access, ownerID uuid.UUID) bool {
	if a.Is(ownerID) {
		return true
	}
	switch LiveScopeFor(a, e, m) {
	case LiveFull, LiveGuest:
		return true
	case LivePilot:
		return e.PilotsSeeEachOther
	}
	return false
}

// GuestView reports whether flight data must be reduced to display names
// (callers who are not involved in the event).
func GuestView(a *Actor, e Event, m Access) bool { return LiveScopeFor(a, e, m) == LiveGuest }

// Flight holds the flight facts policies need.
type Flight struct {
	OwnerID uuid.UUID
	EventID *uuid.UUID
}

// CanViewFlight governs GET /flights/{id}, positions, GPX and flight:<id>.
// e must be the flight's event (nil for flights outside events, which are
// private to their pilot and admins).
func CanViewFlight(a *Actor, f Flight, e *Event, m Access) bool {
	if a.Is(f.OwnerID) || a.IsAdmin() {
		return true
	}
	if f.EventID == nil || e == nil || e.ID != *f.EventID {
		return false
	}
	return CanSeeLiveFlight(a, *e, m, f.OwnerID)
}

// CanCreateFlightInEvent: pilots of the event while live tracking is on.
func CanCreateFlightInEvent(m Access) bool { return m.Role == MemberPilot }

// Retrieval holds the retrieval facts policies need.
type Retrieval struct {
	EventID     uuid.UUID
	PilotID     uuid.UUID
	RetrieverID *uuid.UUID
	Status      string
}

// RetrievalOpen reports a non-terminal status.
func RetrievalOpen(status string) bool {
	return status == RetrievalRequested || status == RetrievalAccepted || status == RetrievalPickedUp
}

// RetrievalHeld reports a status in which the retriever holds the retrieval.
func RetrievalHeld(status string) bool {
	return status == RetrievalAccepted || status == RetrievalPickedUp
}

// CanListRetrievals: admins and anyone involved in the event (results are
// filtered per retrieval with CanViewRetrieval).
func CanListRetrievals(a *Actor, m Access) bool {
	return a.Authenticated() && (a.IsAdmin() || m.Involved())
}

// SeesAllRetrievals: organizers, observers and admins see every retrieval of the event.
func SeesAllRetrievals(a *Actor, m Access) bool {
	return a.IsAdmin() || m.Organizer || m.Role == MemberObserver
}

// CanViewRetrieval: organizers/observers/admins all; retrievers the requested
// ones plus those they accepted; pilots their own.
func CanViewRetrieval(a *Actor, m Access, r Retrieval) bool {
	if !a.Authenticated() {
		return false
	}
	if SeesAllRetrievals(a, m) || a.Is(r.PilotID) || a.IsPtr(r.RetrieverID) {
		return true
	}
	return m.Role == MemberRetriever && r.Status == RetrievalRequested
}

// CanSeePilotPhone: organizers/admins, the pilot, and the accepting retriever
// while they hold the retrieval.
func CanSeePilotPhone(a *Actor, m Access, r Retrieval) bool {
	if a.IsAdmin() || m.Organizer || a.Is(r.PilotID) {
		return true
	}
	return a.IsPtr(r.RetrieverID) && RetrievalHeld(r.Status)
}

// CanSeeRetrieverPhone: organizers/admins, the retriever, and the pilot after
// acceptance while the retrieval is held.
func CanSeeRetrieverPhone(a *Actor, m Access, r Retrieval) bool {
	if r.RetrieverID == nil {
		return false
	}
	if a.IsAdmin() || m.Organizer || a.IsPtr(r.RetrieverID) {
		return true
	}
	return a.Is(r.PilotID) && RetrievalHeld(r.Status)
}

// CanSeeRetrievalPilotPosition: the pilot's live position inside a retrieval
// goes to organizers/observers/admins, the pilot, and the accepting retriever
// until delivery. Other retrievers see only the pickup point.
func CanSeeRetrievalPilotPosition(a *Actor, m Access, r Retrieval) bool {
	if SeesAllRetrievals(a, m) || a.Is(r.PilotID) {
		return true
	}
	return a.IsPtr(r.RetrieverID) && RetrievalHeld(r.Status)
}

// CanCreateRetrieval: pilots of the event.
func CanCreateRetrieval(m Access) bool { return m.Role == MemberPilot }

// CanAcceptRetrieval: retrievers of the event.
func CanAcceptRetrieval(m Access) bool { return m.Role == MemberRetriever }

// CanAssignRetrieval: organizers and admins.
func CanAssignRetrieval(a *Actor, m Access) bool { return CanManageEvent(a, m) }

// CanCancelRetrieval: the pilot (own) or organizers/admins.
func CanCancelRetrieval(a *Actor, m Access, r Retrieval) bool {
	return a.Is(r.PilotID) || CanManageEvent(a, m)
}

// CanAddRetrievalNote: the pilot, the accepting retriever, organizers/admins.
func CanAddRetrievalNote(a *Actor, m Access, r Retrieval) bool {
	return a.Is(r.PilotID) || a.IsPtr(r.RetrieverID) || CanManageEvent(a, m)
}

// CanSeeRetriever governs retriever positions/states (snapshot "retrievers"
// and retriever_position messages): organizers/observers/admins all; the
// retriever themself; a pilot only the retriever holding their open retrieval
// (pilotsServed lists the pilots that retriever currently serves).
func CanSeeRetriever(a *Actor, m Access, retrieverID uuid.UUID, pilotsServed []uuid.UUID) bool {
	if SeesAllRetrievals(a, m) || a.Is(retrieverID) {
		return true
	}
	return a.Authenticated() && slices.Contains(pilotsServed, a.UserID)
}

// CanSeePilotPositionMessage governs pilot_position messages on retrievals:<id>.
func CanSeePilotPositionMessage(a *Actor, m Access, r Retrieval) bool {
	return CanSeeRetrievalPilotPosition(a, m, r)
}
