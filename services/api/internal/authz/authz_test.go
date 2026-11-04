package authz

import (
	"testing"

	"github.com/google/uuid"
)

var (
	owner   = uuid.New()
	ev      = uuid.New()
	guest   *Actor
	pilot   = &Actor{UserID: uuid.New(), Roles: []string{RolePilot}}
	ownerA  = &Actor{UserID: owner, Roles: []string{RolePilot}}
	admin   = &Actor{UserID: uuid.New(), Roles: []string{RolePlatformAdmin}}
	rescuer = &Actor{UserID: uuid.New(), Roles: []string{RoleRescueOperator}}
	orgRole = &Actor{UserID: uuid.New(), Roles: []string{RoleEventOrganizer}}
)

func flight(vis string, incident bool) Flight {
	e := ev
	return Flight{OwnerID: owner, EventID: &e, Visibility: vis, IncidentOpen: incident}
}

// TestLiveVisibilityMatrix encodes the contract's "Live visibility" rules.
func TestLiveVisibilityMatrix(t *testing.T) {
	pub := Event{ID: ev, Visibility: EventPublic, Status: "active", PublicLiveMap: true}
	noMap := Event{ID: ev, Visibility: EventPublic, Status: "active", PublicLiveMap: false}
	type row struct {
		name   string
		a      *Actor
		member string
		e      Event
		vis    string
		inc    bool
		want   bool
	}
	rows := []row{
		{"guest public flight public map", guest, "", pub, VisPublic, false, true},
		{"guest event flight", guest, "", pub, VisEvent, false, false},
		{"guest private flight", guest, "", pub, VisPrivate, false, false},
		{"guest public flight no public map", guest, "", noMap, VisPublic, false, false},
		{"non-member pilot public", pilot, "", pub, VisPublic, false, true},
		{"non-member pilot event", pilot, "", pub, VisEvent, false, false},
		{"participant event", pilot, MemberParticipant, noMap, VisEvent, false, true},
		{"observer public", pilot, MemberObserver, noMap, VisPublic, false, true},
		{"participant private", pilot, MemberParticipant, pub, VisPrivate, false, false},
		{"participant private with incident", pilot, MemberParticipant, pub, VisPrivate, true, false},
		{"organizer private no incident", pilot, MemberOrganizer, pub, VisPrivate, false, false},
		{"organizer private with incident", pilot, MemberOrganizer, pub, VisPrivate, true, true},
		{"organizer event", pilot, MemberOrganizer, noMap, VisEvent, false, true},
		{"admin private", admin, "", noMap, VisPrivate, false, true},
		{"rescue private", rescuer, "", noMap, VisPrivate, false, true},
		{"owner private", ownerA, "", noMap, VisPrivate, false, true},
		{"global organizer role alone grants nothing", orgRole, "", noMap, VisEvent, false, false},
	}
	for _, r := range rows {
		if got := CanSeeLiveFlight(r.a, r.e, r.member, flight(r.vis, r.inc)); got != r.want {
			t.Errorf("%s: got %v want %v", r.name, got, r.want)
		}
	}
}

func TestEventAccess(t *testing.T) {
	pub := Event{Visibility: EventPublic, Status: "active", PublicLiveMap: true, RegistrationOpen: true, ObserversAllowed: true}
	res := Event{Visibility: EventRestrict, Status: "active", PublicLiveMap: true, RegistrationOpen: true}
	draft := Event{Visibility: EventPublic, Status: "draft"}
	checks := []struct {
		name string
		got  bool
		want bool
	}{
		{"guest sees public", CanViewEvent(guest, pub, ""), true},
		{"guest cannot see restricted", CanViewEvent(guest, res, ""), false},
		{"member sees restricted", CanViewEvent(pilot, res, MemberParticipant), true},
		{"guest cannot see draft", CanViewEvent(guest, draft, ""), false},
		{"participant cannot see draft", CanViewEvent(pilot, draft, MemberParticipant), false},
		{"organizer sees draft", CanViewEvent(pilot, draft, MemberOrganizer), true},
		{"admin sees everything", CanViewEvent(admin, res, ""), true},
		{"restricted live map not public even with flag", CanViewEventLive(guest, res, ""), false},
		{"rescue sees restricted live", CanViewEventLive(rescuer, res, ""), true},
		{"pilot may create? no", CanCreateEvent(pilot), false},
		{"event_organizer may create", CanCreateEvent(orgRole), true},
		{"admin may create", CanCreateEvent(admin), true},
		{"organizer manages", CanManageEvent(pilot, MemberOrganizer), true},
		{"participant does not manage", CanManageEvent(pilot, MemberParticipant), false},
		{"guest cannot manage", CanManageEvent(guest, MemberOrganizer), false},
		{"participants list needs membership", CanViewParticipants(pilot, ""), false},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s: got %v want %v", c.name, c.got, c.want)
		}
	}
	if CanJoinEvent(pilot, pub, MemberParticipant) != JoinAllowed {
		t.Error("pilot join public")
	}
	if CanJoinEvent(&Actor{UserID: uuid.New(), Roles: []string{RoleObserver}}, pub, MemberParticipant) != JoinNotPilot {
		t.Error("observer as participant")
	}
	if CanJoinEvent(pilot, res, MemberParticipant) != JoinForbidden {
		t.Error("restricted self-join")
	}
	closed := pub
	closed.RegistrationOpen = false
	if CanJoinEvent(pilot, closed, MemberParticipant) != JoinClosed {
		t.Error("closed registration")
	}
	noObs := pub
	noObs.ObserversAllowed = false
	if CanJoinEvent(pilot, noObs, MemberObserver) != JoinObserversDisallowed {
		t.Error("observers disallowed")
	}
	if CanJoinEvent(guest, pub, MemberParticipant) != JoinForbidden {
		t.Error("guest join")
	}
}

func TestFlightAndIncidentAccess(t *testing.T) {
	checks := []struct {
		name string
		got  bool
		want bool
	}{
		{"guest public flight", CanViewFlight(guest, flight(VisPublic, false), ""), true},
		{"guest event flight", CanViewFlight(guest, flight(VisEvent, false), ""), false},
		{"member event flight", CanViewFlight(pilot, flight(VisEvent, false), MemberObserver), true},
		{"member private flight", CanViewFlight(pilot, flight(VisPrivate, false), MemberParticipant), false},
		{"organizer private during incident", CanViewFlight(pilot, flight(VisPrivate, true), MemberOrganizer), true},
		{"organizer private after incident", CanViewFlight(pilot, flight(VisPrivate, false), MemberOrganizer), false},
		{"owner private", CanViewFlight(ownerA, flight(VisPrivate, false), ""), true},
		{"rescue private", CanViewFlight(rescuer, flight(VisPrivate, false), ""), true},
		{"incident owner", CanViewIncident(ownerA, owner, ""), true},
		{"incident stranger", CanViewIncident(pilot, owner, ""), false},
		{"incident event participant", CanViewIncident(pilot, owner, MemberParticipant), false},
		{"incident organizer", CanViewIncident(pilot, owner, MemberOrganizer), true},
		{"incident admin", IsIncidentResponder(admin, ""), true},
		{"incident rescue", IsIncidentResponder(rescuer, ""), true},
		{"incident guest", IsIncidentResponder(guest, MemberOrganizer), false},
		{"contact for organizer", CanSeeEmergencyContact(pilot, owner, MemberOrganizer), true},
		{"contact for participant", CanSeeEmergencyContact(pilot, owner, MemberParticipant), false},
		{"incidents channel: plain pilot", CanSubscribeIncidents(pilot, false), false},
		{"incidents channel: organizer", CanSubscribeIncidents(pilot, true), true},
		{"incidents channel: rescue", CanSubscribeIncidents(rescuer, false), true},
		{"rescue console: organizer", CanUseRescueConsole(orgRole), false},
		{"pilots list: pilot", CanListPilots(pilot, false), false},
		{"pilots list: organizer of an event", CanListPilots(pilot, true), true},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s: got %v want %v", c.name, c.got, c.want)
		}
	}
}
