package realtime

import (
	"encoding/json"
	"strconv"
	"testing"

	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/platform/log"
	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
	"github.com/mdenizay/retfast/services/api/internal/realtime/bus"
)

func TestStreamID(t *testing.T) {
	a, ok := ParseStreamID("1700000000000-3")
	b, _ := ParseStreamID("1700000000000-10")
	c, _ := ParseStreamID("1700000000001-0")
	if !ok || !a.Less(b) || !b.Less(c) || a.String() != "1700000000000-3" {
		t.Fatal("stream id ordering")
	}
	for _, bad := range []string{"", "abc", "1-", "-1", "1-2-3"} {
		if _, ok := ParseStreamID(bad); ok {
			t.Errorf("%q parsed", bad)
		}
	}
}

func env(eventID uuid.UUID, owner uuid.UUID) *bus.Envelope {
	fid := uuid.New()
	return &bus.Envelope{Type: bus.TypePosition, EventID: &eventID, FlightID: &fid, OwnerID: &owner,
		Data: json.RawMessage(`{"n":"full"}`), PublicData: json.RawMessage(`{"n":"display"}`)}
}

func eventSub(a *authz.Actor, e authz.Event, acc authz.Access) *Subscription {
	s := &Subscription{Kind: KindEvent, Actor: a, EventID: e.ID}
	s.SetFacts(&e, acc)
	return s
}

func TestDecidePerMessage(t *testing.T) {
	ev := uuid.New()
	owner := uuid.New()
	evFacts := authz.Event{ID: ev, Visibility: "public", Status: "active", PublicLiveMap: false, PilotsSeeEachOther: true}
	observer := eventSub(&authz.Actor{UserID: uuid.New()}, evFacts, authz.Access{Role: authz.MemberObserver})
	pilot := eventSub(&authz.Actor{UserID: uuid.New()}, evFacts, authz.Access{Role: authz.MemberPilot})
	retriever := eventSub(&authz.Actor{UserID: uuid.New()}, evFacts, authz.Access{Role: authz.MemberRetriever})
	guest := eventSub(nil, evFacts, authz.Access{})
	if observer.Decide(env(ev, owner)) != deliverData || pilot.Decide(env(ev, owner)) != deliverData {
		t.Error("observer and pilot (pilots_see_each_other) get event flights")
	}
	if retriever.Decide(env(ev, owner)) != deliverNone {
		t.Error("retrievers never get the general live map")
	}
	if guest.Decide(env(ev, owner)) != deliverNone {
		t.Error("guest without public_live_map")
	}
	// settings change at runtime: pilots stop seeing each other, map becomes public
	h := NewHub(metrics.New(), log.Discard())
	for _, s := range []*Subscription{observer, pilot, retriever, guest} {
		s.Channel, s.Client = "event:"+ev.String(), NewClient(nil)
		h.Add(s)
	}
	changed := evFacts
	changed.PilotsSeeEachOther, changed.PublicLiveMap = false, true
	h.Dispatch("1-1", &bus.Envelope{Type: bus.TypeEventChanged, EventID: &ev, Event: &changed})
	if pilot.Decide(env(ev, owner)) != deliverNone {
		t.Error("pilot must not see others when pilots_see_each_other is off")
	}
	if pilot.Decide(env(ev, pilot.Actor.UserID)) != deliverData {
		t.Error("pilot sees own flight")
	}
	if guest.Decide(env(ev, owner)) != deliverPublic {
		t.Error("guest gets the public variant on a public live map")
	}
	// role change at runtime: the observer is removed
	uid := observer.Actor.UserID
	h.Dispatch("1-2", &bus.Envelope{Type: bus.TypeMemberChanged, EventID: &ev, UserID: &uid, Access: &authz.Access{}})
	if observer.Decide(env(ev, owner)) != deliverPublic {
		t.Error("removed observer falls back to the guest view")
	}
	fl := env(ev, owner)
	fl.Type = bus.TypeFlight
	if retriever.Decide(fl) != deliverRemoved {
		t.Error("flight messages a subscriber may not see are rendered as removed")
	}
	if pilot.Decide(env(uuid.New(), owner)) != deliverNone {
		t.Error("messages for another event must be ignored")
	}
}

func TestDecideRetrievals(t *testing.T) {
	ev := uuid.New()
	pilotID, rA, rB, org := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	sub := func(id uuid.UUID, acc authz.Access) *Subscription {
		s := &Subscription{Kind: KindRetrievals, Actor: &authz.Actor{UserID: id}, EventID: ev}
		s.SetFacts(&authz.Event{ID: ev}, acc)
		return s
	}
	ret := func(status string, retriever *uuid.UUID) *bus.Envelope {
		rid := uuid.New()
		return &bus.Envelope{Type: bus.TypeRetrieval, EventID: &ev, RetrievalID: &rid, PilotID: &pilotID, RetrieverID: retriever, Status: status,
			Data: json.RawMessage(`{"pilot":{"phone":"+90 1"},"retriever":{"phone":"+90 2"},"pilot_position":{"lat":1},"retriever_position":{"lat":2},"updates":[{"kind":"note"}]}`)}
	}
	a, b := sub(rA, authz.Access{Role: authz.MemberRetriever}), sub(rB, authz.Access{Role: authz.MemberRetriever})
	o := sub(org, authz.Access{Organizer: true})
	obs := sub(uuid.New(), authz.Access{Role: authz.MemberObserver})
	p := sub(pilotID, authz.Access{Role: authz.MemberPilot})
	other := sub(uuid.New(), authz.Access{Role: authz.MemberPilot})

	req := ret("requested", nil)
	if v := a.Decide(req); v != deliverRedacted+stripPilotPhone+stripRetrieverPhone+stripPilotPosition+stripPrivate {
		t.Errorf("retriever on a request: variant %d", v)
	}
	acc := ret("accepted", &rA)
	if a.Decide(acc) != deliverData || o.Decide(acc) != deliverData || p.Decide(acc) != deliverData {
		t.Error("accepting retriever, organizer and pilot get the full retrieval")
	}
	if b.Decide(acc) != deliverRemoved {
		t.Error("another retriever only learns the request left the list")
	}
	if obs.Decide(acc) != deliverRedacted+stripPilotPhone+stripRetrieverPhone {
		t.Errorf("observer sees no phones: %d", obs.Decide(acc))
	}
	if other.Decide(acc) != deliverNone {
		t.Error("other pilots get nothing")
	}
	out := Render(acc, "retrievals:x", "1-1", obs.Decide(acc))
	var m struct {
		Data struct {
			Pilot     map[string]any `json:"pilot"`
			Retriever map[string]any `json:"retriever"`
		} `json:"data"`
	}
	_ = json.Unmarshal(out, &m)
	if m.Data.Pilot["phone"] != "" || m.Data.Retriever["phone"] != "" {
		t.Errorf("redaction failed: %s", out)
	}
	// delivered: the retriever keeps the record but loses phone and live position
	del := ret("delivered", &rA)
	if v := a.Decide(del); v != deliverRedacted+stripPilotPhone+stripPilotPosition {
		t.Errorf("delivered for retriever: %d", v)
	}
	// pilot_position: accepting retriever, organizers, observers, the pilot
	pp := &bus.Envelope{Type: bus.TypePilotPosition, EventID: &ev, PilotID: &pilotID, RetrieverID: &rA, Status: "accepted", Data: json.RawMessage(`{}`)}
	for _, s := range []*Subscription{a, o, obs, p} {
		if s.Decide(pp) != deliverData {
			t.Error("pilot_position should be delivered")
		}
	}
	if b.Decide(pp) != deliverNone || other.Decide(pp) != deliverNone {
		t.Error("pilot_position leaked")
	}
	// retriever_position: organizers/observers, the retriever, the served pilot only
	rp := &bus.Envelope{Type: bus.TypeRetrieverPosition, EventID: &ev, UserID: &rA, PilotIDs: []uuid.UUID{pilotID}, Data: json.RawMessage(`{}`)}
	for _, s := range []*Subscription{a, o, obs, p} {
		if s.Decide(rp) != deliverData {
			t.Error("retriever_position should be delivered")
		}
	}
	if b.Decide(rp) != deliverNone || other.Decide(rp) != deliverNone {
		t.Error("retriever_position leaked")
	}
}

func TestSlowConsumerIsDisconnected(t *testing.T) {
	m := metrics.New()
	h := NewHub(m, log.Discard())
	var closedWith int
	c := NewClient(func(code int, _ string) { closedWith = code })
	ev := uuid.New()
	owner := uuid.New()
	sub := eventSub(&authz.Actor{UserID: owner}, authz.Event{ID: ev, Visibility: "public"}, authz.Access{})
	sub.Channel, sub.Client = "event:"+ev.String(), c
	h.Add(sub)
	sub.Activate(h.SlowConsumer)
	for i := 1; i <= QueueSize+5; i++ {
		h.Dispatch("1700000000000-"+strconv.Itoa(i), env(ev, owner))
	}
	if closedWith != CloseSlowConsumer {
		t.Fatalf("close code = %d, want %d", closedWith, CloseSlowConsumer)
	}
	if len(c.send) != QueueSize {
		t.Fatalf("queue len %d", len(c.send))
	}
}

func TestPendingUntilActivatedAndDedup(t *testing.T) {
	m := metrics.New()
	h := NewHub(m, log.Discard())
	c := NewClient(nil)
	ev := uuid.New()
	owner := uuid.New()
	sub := eventSub(&authz.Actor{UserID: owner}, authz.Event{ID: ev, Visibility: "public"}, authz.Access{})
	sub.Channel, sub.Client = "event:"+ev.String(), c
	h.Add(sub)
	h.Dispatch("100-1", env(ev, owner))
	h.Dispatch("100-2", env(ev, owner))
	if len(c.send) != 0 {
		t.Fatal("messages delivered before subscribed")
	}
	sub.MarkReplayed(StreamID{100, 1}) // 100-1 was sent during replay
	sub.Activate(h.SlowConsumer)
	if len(c.send) != 1 {
		t.Fatalf("after activate: %d queued, want 1", len(c.send))
	}
	h.Dispatch("100-2", env(ev, owner)) // at-least-once duplicate from the stream
	if len(c.send) != 1 {
		t.Fatal("duplicate stream id delivered twice")
	}
}
