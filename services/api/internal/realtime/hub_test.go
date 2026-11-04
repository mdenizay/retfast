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

func env(eventID uuid.UUID, owner uuid.UUID, vis string) *bus.Envelope {
	fid := uuid.New()
	return &bus.Envelope{Type: bus.TypePosition, EventID: &eventID, FlightID: &fid, OwnerID: &owner, Visibility: vis,
		Data: json.RawMessage(`{"n":"full"}`), PublicData: json.RawMessage(`{"n":"display"}`)}
}

func TestDecidePerMessage(t *testing.T) {
	ev := uuid.New()
	owner := uuid.New()
	member := &authz.Actor{UserID: uuid.New(), Roles: []string{"pilot"}}
	evFacts := authz.Event{ID: ev, Visibility: "public", Status: "active", PublicLiveMap: true}
	memberSub := &Subscription{Kind: KindEvent, Actor: member, Event: evFacts, Member: authz.MemberParticipant}
	guestSub := &Subscription{Kind: KindEvent, Actor: nil, Event: evFacts, GuestView: true}
	if memberSub.Decide(env(ev, owner, "event")) != deliverData {
		t.Error("member should get event flight")
	}
	if memberSub.Decide(env(ev, owner, "private")) != deliverNone {
		t.Error("member must not get private flight positions")
	}
	if guestSub.Decide(env(ev, owner, "event")) != deliverNone {
		t.Error("guest must not get event flight")
	}
	if guestSub.Decide(env(ev, owner, "public")) != deliverPublic {
		t.Error("guest gets public variant")
	}
	fl := env(ev, owner, "private")
	fl.Type = bus.TypeFlight
	if memberSub.Decide(fl) != deliverRemoved {
		t.Error("visibility change to private must tell members to remove the flight")
	}
	other := env(uuid.New(), owner, "public")
	if memberSub.Decide(other) != deliverNone {
		t.Error("messages for another event must be ignored")
	}
	inc := &bus.Envelope{Type: bus.TypeIncident, EventID: &ev, Data: json.RawMessage(`{}`)}
	scoped := &Subscription{Kind: KindIncidents, IncidentEvents: map[uuid.UUID]bool{ev: true}}
	if scoped.Decide(inc) != deliverData {
		t.Error("organizer scope")
	}
	otherEv := uuid.New()
	if scoped.Decide(&bus.Envelope{Type: bus.TypeIncident, EventID: &otherEv}) != deliverNone {
		t.Error("incident outside scope delivered")
	}
}

func TestSlowConsumerIsDisconnected(t *testing.T) {
	m := metrics.New()
	h := NewHub(m, log.Discard())
	var closedWith int
	c := NewClient(func(code int, _ string) { closedWith = code })
	ev := uuid.New()
	owner := uuid.New()
	sub := &Subscription{Channel: "event:" + ev.String(), Kind: KindEvent, Client: c,
		Actor: &authz.Actor{UserID: owner}, Event: authz.Event{ID: ev, Visibility: "public"}}
	h.Add(sub)
	sub.Activate(h.SlowConsumer)
	for i := 1; i <= QueueSize+5; i++ {
		h.Dispatch("1700000000000-"+strconv.Itoa(i), env(ev, owner, "private"))
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
	sub := &Subscription{Channel: "event:" + ev.String(), Kind: KindEvent, Client: c, Actor: &authz.Actor{UserID: owner},
		Event: authz.Event{ID: ev, Visibility: "public"}}
	h.Add(sub)
	h.Dispatch("100-1", env(ev, owner, "event"))
	h.Dispatch("100-2", env(ev, owner, "event"))
	if len(c.send) != 0 {
		t.Fatal("messages delivered before subscribed")
	}
	sub.MarkReplayed(StreamID{100, 1}) // 100-1 was sent during replay
	sub.Activate(h.SlowConsumer)
	if len(c.send) != 1 {
		t.Fatalf("after activate: %d queued, want 1", len(c.send))
	}
	h.Dispatch("100-2", env(ev, owner, "event")) // at-least-once duplicate from the stream
	if len(c.send) != 1 {
		t.Fatal("duplicate stream id delivered twice")
	}
}
