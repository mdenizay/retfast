package authz

import (
	"testing"

	"github.com/google/uuid"
)

func actor(admin bool) *Actor {
	a := &Actor{UserID: uuid.New()}
	if admin {
		a.Roles = []string{RolePlatformAdmin}
	}
	return a
}

func TestEventPolicies(t *testing.T) {
	pub := Event{ID: uuid.New(), Visibility: EventPublic, Status: "active", ApplicationsOpen: true}
	res := Event{ID: uuid.New(), Visibility: EventRestrict, Status: "active", ApplicationsOpen: true}
	draft := Event{ID: uuid.New(), Visibility: EventPublic, Status: "draft"}
	u, adm := actor(false), actor(true)
	var guest *Actor
	if !CanCreateEvent(adm) || CanCreateEvent(u) || CanCreateEvent(guest) {
		t.Error("only admins create events")
	}
	if !CanViewEvent(guest, pub, Access{}) || CanViewEvent(u, res, Access{}) || !CanViewEvent(u, res, Access{Role: MemberObserver}) {
		t.Error("view visibility")
	}
	if CanViewEvent(u, draft, Access{Role: MemberPilot}) || !CanViewEvent(u, draft, Access{Organizer: true}) || !CanViewEvent(adm, draft, Access{}) {
		t.Error("drafts are for organizers/admins")
	}
	if CanManageEvent(u, Access{Role: MemberObserver}) || !CanManageEvent(u, Access{Organizer: true}) || !CanManageEvent(adm, Access{}) {
		t.Error("manage")
	}
	if CanApply(u, pub, Access{}) != ApplyAllowed || CanApply(u, pub, Access{Role: MemberPilot}) != ApplyAlreadyMember ||
		CanApply(guest, pub, Access{}) != ApplyForbidden || CanApply(u, res, Access{}) != ApplyForbidden {
		t.Error("apply")
	}
	closed := pub
	closed.ApplicationsOpen = false
	if CanApply(u, closed, Access{}) != ApplyClosed {
		t.Error("closed applications")
	}
	if !CanSearchUsers(u, true) || CanSearchUsers(u, false) || !CanSearchUsers(adm, false) {
		t.Error("user search")
	}
}

func TestLiveMatrix(t *testing.T) {
	owner := uuid.New()
	base := Event{ID: uuid.New(), Visibility: EventPublic, Status: "active", PilotsSeeEachOther: true}
	u := actor(false)
	cases := []struct {
		name   string
		a      *Actor
		e      func(Event) Event
		acc    Access
		scope  LiveScope
		sees   bool
		guestV bool
	}{
		{"organizer", u, nil, Access{Organizer: true}, LiveFull, true, false},
		{"organizer+retriever", u, nil, Access{Organizer: true, Role: MemberRetriever}, LiveFull, true, false},
		{"observer", u, nil, Access{Role: MemberObserver}, LiveFull, true, false},
		{"admin", actor(true), nil, Access{}, LiveFull, true, false},
		{"pilot sees others", u, nil, Access{Role: MemberPilot}, LivePilot, true, false},
		{"pilot alone", u, func(e Event) Event { e.PilotsSeeEachOther = false; return e }, Access{Role: MemberPilot}, LivePilot, false, false},
		{"retriever", u, nil, Access{Role: MemberRetriever}, LiveRetriever, false, false},
		{"guest no map", nil, nil, Access{}, LiveNone, false, false},
		{"guest public map", nil, func(e Event) Event { e.PublicLiveMap = true; return e }, Access{}, LiveGuest, true, true},
		{"outsider public map", u, func(e Event) Event { e.PublicLiveMap = true; return e }, Access{}, LiveGuest, true, true},
		{"restricted public map", nil, func(e Event) Event { e.PublicLiveMap = true; e.Visibility = EventRestrict; return e }, Access{}, LiveNone, false, false},
	}
	for _, c := range cases {
		e := base
		if c.e != nil {
			e = c.e(e)
		}
		if got := LiveScopeFor(c.a, e, c.acc); got != c.scope {
			t.Errorf("%s: scope %d want %d", c.name, got, c.scope)
		}
		if got := CanSeeLiveFlight(c.a, e, c.acc, owner); got != c.sees {
			t.Errorf("%s: sees %v", c.name, got)
		}
		if got := GuestView(c.a, e, c.acc); got != c.guestV {
			t.Errorf("%s: guest view %v", c.name, got)
		}
	}
	// owners always see their own flight
	o := &Actor{UserID: owner}
	alone := base
	alone.PilotsSeeEachOther = false
	if !CanSeeLiveFlight(o, alone, Access{Role: MemberPilot}, owner) {
		t.Error("own flight")
	}
	// flights outside events: owner and admin only
	f := Flight{OwnerID: owner}
	if !CanViewFlight(o, f, nil, Access{}) || !CanViewFlight(actor(true), f, nil, Access{}) || CanViewFlight(u, f, nil, Access{Organizer: true}) {
		t.Error("private flight")
	}
	eid := base.ID
	ef := Flight{OwnerID: owner, EventID: &eid}
	if CanViewFlight(u, ef, &base, Access{Role: MemberRetriever}) || !CanViewFlight(u, ef, &base, Access{Role: MemberObserver}) {
		t.Error("event flight")
	}
}

func TestRetrievalPolicies(t *testing.T) {
	pilot, ra, rb := actor(false), actor(false), actor(false)
	org, obs, adm := actor(false), actor(false), actor(true)
	asR := Access{Role: MemberRetriever}
	asO := Access{Organizer: true}
	asObs := Access{Role: MemberObserver}
	asP := Access{Role: MemberPilot}
	req := Retrieval{PilotID: pilot.UserID, Status: RetrievalRequested}
	acc := Retrieval{PilotID: pilot.UserID, RetrieverID: &ra.UserID, Status: RetrievalAccepted}
	del := Retrieval{PilotID: pilot.UserID, RetrieverID: &ra.UserID, Status: RetrievalDelivered}

	if !CanViewRetrieval(rb, asR, req) || CanViewRetrieval(rb, asR, acc) || !CanViewRetrieval(ra, asR, acc) {
		t.Error("retriever visibility")
	}
	if !CanViewRetrieval(obs, asObs, acc) || !CanViewRetrieval(org, asO, acc) || !CanViewRetrieval(adm, Access{}, acc) {
		t.Error("organizer/observer/admin see all")
	}
	if !CanViewRetrieval(pilot, asP, acc) || CanViewRetrieval(actor(false), asP, acc) {
		t.Error("pilots see their own only")
	}
	// phones
	if CanSeePilotPhone(rb, asR, req) || CanSeePilotPhone(ra, asR, req) {
		t.Error("no pilot phone before acceptance")
	}
	if !CanSeePilotPhone(ra, asR, acc) || CanSeePilotPhone(ra, asR, del) || CanSeePilotPhone(obs, asObs, acc) {
		t.Error("pilot phone only to the accepting retriever while held")
	}
	if !CanSeePilotPhone(org, asO, req) || !CanSeePilotPhone(adm, Access{}, req) {
		t.Error("organizers/admins see phones")
	}
	if !CanSeeRetrieverPhone(pilot, asP, acc) || CanSeeRetrieverPhone(pilot, asP, del) || CanSeeRetrieverPhone(obs, asObs, acc) ||
		CanSeeRetrieverPhone(rb, asR, acc) {
		t.Error("retriever phone to the pilot after acceptance only")
	}
	// live pilot position inside a retrieval
	if CanSeeRetrievalPilotPosition(rb, asR, req) || !CanSeeRetrievalPilotPosition(ra, asR, acc) || CanSeeRetrievalPilotPosition(ra, asR, del) ||
		!CanSeeRetrievalPilotPosition(obs, asObs, acc) {
		t.Error("pilot position")
	}
	// actions
	if !CanCreateRetrieval(asP) || CanCreateRetrieval(asR) || !CanAcceptRetrieval(asR) || CanAcceptRetrieval(asO) {
		t.Error("create/accept")
	}
	if !CanCancelRetrieval(pilot, asP, acc) || !CanCancelRetrieval(org, asO, acc) || CanCancelRetrieval(ra, asR, acc) {
		t.Error("cancel")
	}
	if !CanAddRetrievalNote(ra, asR, acc) || CanAddRetrievalNote(rb, asR, acc) || CanAddRetrievalNote(obs, asObs, acc) {
		t.Error("notes")
	}
	// retriever visibility (positions)
	if !CanSeeRetriever(obs, asObs, ra.UserID, nil) || !CanSeeRetriever(ra, asR, ra.UserID, nil) || CanSeeRetriever(rb, asR, ra.UserID, nil) ||
		!CanSeeRetriever(pilot, asP, ra.UserID, []uuid.UUID{pilot.UserID}) || CanSeeRetriever(pilot, asP, ra.UserID, nil) {
		t.Error("retriever positions")
	}
}
