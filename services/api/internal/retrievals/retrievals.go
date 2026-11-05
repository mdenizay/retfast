// Package retrievals implements pilot retrieval after landing: requests,
// the state machine (requested → accepted → picked_up → delivered, cancel,
// release, assign), pilot positions while a retrieval is open, retriever duty
// and positions. Every state change is audited and published through the
// realtime outbox on retrievals:<event_id>.
package retrievals

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/flights"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/realtime/bus"
	"github.com/mdenizay/retfast/services/api/internal/users"
)

// Statuses.
const (
	StatusRequested = authz.RetrievalRequested
	StatusAccepted  = authz.RetrievalAccepted
	StatusPickedUp  = authz.RetrievalPickedUp
	StatusDelivered = authz.RetrievalDelivered
	StatusCancelled = authz.RetrievalCancelled
)

// OpenStatuses are the non-terminal statuses.
var OpenStatuses = []string{StatusRequested, StatusAccepted, StatusPickedUp}

// Action is a state-machine input.
type Action string

// Actions.
const (
	ActAccept   Action = "accept"
	ActAssign   Action = "assign"
	ActRelease  Action = "release"
	ActPickUp   Action = "picked_up"
	ActDeliver  Action = "deliver"
	ActCancel   Action = "cancel"
	ActPosition Action = "position"
	ActNote     Action = "note"
)

// Next is the state machine: it returns the status after act from status
// from, or false if act is not allowed there.
//
//	requested ──accept/assign──► accepted ──picked_up──► picked_up ──deliver──► delivered
//	    ▲                           │  ▲                     │
//	    └─────────release───────────┘  └─assign (reassign)   │
//	requested / accepted / picked_up ──cancel──► cancelled ◄─┘
func Next(from string, act Action) (string, bool) {
	switch act {
	case ActAccept:
		return StatusAccepted, from == StatusRequested
	case ActAssign:
		return StatusAccepted, from == StatusRequested || from == StatusAccepted
	case ActRelease:
		return StatusRequested, from == StatusAccepted
	case ActPickUp:
		return StatusPickedUp, from == StatusAccepted
	case ActDeliver:
		return StatusDelivered, from == StatusPickedUp
	case ActCancel:
		return StatusCancelled, authz.RetrievalOpen(from)
	case ActPosition, ActNote:
		return from, authz.RetrievalOpen(from) || act == ActNote
	}
	return from, false
}

// PilotRef is the retrieval's pilot (phone only for authorized viewers).
type PilotRef struct {
	UserID   uuid.UUID `json:"user_id"`
	FullName string    `json:"full_name"`
	PublicID string    `json:"public_id"`
	Phone    string    `json:"phone"`
}

// RetrieverRef is the accepting retriever (phone visible to the pilot after acceptance).
type RetrieverRef struct {
	UserID   uuid.UUID `json:"user_id"`
	FullName string    `json:"full_name"`
	Phone    string    `json:"phone"`
}

// Pickup is where the pilot asked to be picked up.
type Pickup struct {
	Lat     float64    `json:"lat"`
	Lon     float64    `json:"lon"`
	GPSAltM *float64   `json:"gps_alt_m"`
	HAccM   *float64   `json:"h_acc_m"`
	T       httpx.Time `json:"t"`
}

// RetrieverPosition is the retriever's latest position as seen in a retrieval.
type RetrieverPosition struct {
	Lat   float64    `json:"lat"`
	Lon   float64    `json:"lon"`
	HAccM *float64   `json:"h_acc_m"`
	T     httpx.Time `json:"t"`
}

// Update is one timeline entry.
type Update struct {
	ID        uuid.UUID      `json:"id"`
	Kind      string         `json:"kind"`
	Actor     *users.UserRef `json:"actor"`
	Body      string         `json:"body"`
	CreatedAt httpx.Time     `json:"created_at"`
}

// Retrieval per the contract.
type Retrieval struct {
	ID                uuid.UUID          `json:"id"`
	EventID           uuid.UUID          `json:"event_id"`
	FlightID          *uuid.UUID         `json:"flight_id"`
	Pilot             PilotRef           `json:"pilot"`
	Status            string             `json:"status"`
	Pickup            Pickup             `json:"pickup"`
	PilotPosition     *flights.Position  `json:"pilot_position"`
	Note              string             `json:"note"`
	Retriever         *RetrieverRef      `json:"retriever"`
	RetrieverPosition *RetrieverPosition `json:"retriever_position"`
	RequestedAt       httpx.Time         `json:"requested_at"`
	AcceptedAt        *httpx.Time        `json:"accepted_at"`
	PickedUpAt        *httpx.Time        `json:"picked_up_at"`
	DeliveredAt       *httpx.Time        `json:"delivered_at"`
	CancelledAt       *httpx.Time        `json:"cancelled_at"`
	CancelledBy       *users.UserRef     `json:"cancelled_by"`
	CancelReason      string             `json:"cancel_reason"`
	DeliveryNote      string             `json:"delivery_note"`
	IsSimulated       bool               `json:"is_simulated"`
	Updates           []Update           `json:"updates"`
}

// Row is a retrieval joined with names, phones and the retriever's state.
type Row = dbq.GetRetrievalRow

// Facts converts a row for policy checks.
func Facts(r Row) authz.Retrieval {
	return authz.Retrieval{EventID: r.EventID, PilotID: r.PilotID, RetrieverID: r.RetrieverID, Status: r.Status}
}

// pilotPosition converts the denormalised latest pilot position.
func pilotPosition(r Row) *flights.Position {
	if r.PpLat == nil || r.PpLon == nil || r.PpT == nil {
		return nil
	}
	p := &flights.Position{Seq: r.PpSeq, T: httpx.T(*r.PpT), Lat: *r.PpLat, Lon: *r.PpLon, GPSAltM: r.PpGpsAltM}
	if r.PpSampleID != nil {
		p.ID = *r.PpSampleID
	}
	if r.PpHAccM != nil {
		p.HAccM = *r.PpHAccM
	}
	if r.PpReceivedAt != nil {
		p.ReceivedAt = httpx.T(*r.PpReceivedAt)
	}
	return p
}

// Build converts a row with its timeline into the full (unredacted) representation.
func Build(r Row, upd []Update) Retrieval {
	out := Retrieval{ID: r.ID, EventID: r.EventID, FlightID: r.FlightID, Status: r.Status,
		Pilot:  PilotRef{UserID: r.PilotID, FullName: r.PilotName, PublicID: r.PilotPublicID, Phone: r.PilotPhone},
		Pickup: Pickup{Lat: r.PickupLat, Lon: r.PickupLon, GPSAltM: r.PickupGpsAltM, HAccM: r.PickupHAccM, T: httpx.T(r.PickupT)},
		Note:   r.Note, PilotPosition: pilotPosition(r), RequestedAt: httpx.T(r.RequestedAt), AcceptedAt: httpx.TP(r.AcceptedAt),
		PickedUpAt: httpx.TP(r.PickedUpAt), DeliveredAt: httpx.TP(r.DeliveredAt), CancelledAt: httpx.TP(r.CancelledAt),
		CancelReason: r.CancelReason, DeliveryNote: r.DeliveryNote, IsSimulated: r.IsSimulated, Updates: upd}
	if out.Updates == nil {
		out.Updates = []Update{}
	}
	if r.RetrieverID != nil {
		out.Retriever = &RetrieverRef{UserID: *r.RetrieverID, FullName: r.RetrieverName, Phone: r.RetrieverPhone}
		if r.RvLat != nil && r.RvLon != nil && r.RvT != nil {
			out.RetrieverPosition = &RetrieverPosition{Lat: *r.RvLat, Lon: *r.RvLon, HAccM: r.RvHAccM, T: httpx.T(*r.RvT)}
		}
	}
	if r.CancelledBy != nil {
		out.CancelledBy = &users.UserRef{UserID: *r.CancelledBy, FullName: r.CancelledByName}
	}
	return out
}

// ViewFor redacts a full retrieval for one viewer and returns the ids of the
// users whose phone numbers the viewer can now see (for the privacy audit).
func ViewFor(full Retrieval, f authz.Retrieval, a *authz.Actor, acc authz.Access) (Retrieval, []uuid.UUID) {
	v := full
	var revealed []uuid.UUID
	if !authz.CanSeePilotPhone(a, acc, f) {
		v.Pilot.Phone = ""
	} else if v.Pilot.Phone != "" && !a.Is(v.Pilot.UserID) {
		revealed = append(revealed, v.Pilot.UserID)
	}
	if v.Retriever != nil {
		rr := *v.Retriever
		if !authz.CanSeeRetrieverPhone(a, acc, f) {
			rr.Phone = ""
		} else if rr.Phone != "" && !a.Is(rr.UserID) {
			revealed = append(revealed, rr.UserID)
		}
		v.Retriever = &rr
	}
	if !authz.CanSeeRetrievalPilotPosition(a, acc, f) {
		v.PilotPosition = nil
	}
	// The retriever's position goes to the pilot, organizers, observers (and the retriever).
	if !authz.SeesAllRetrievals(a, acc) && !a.Is(f.PilotID) && !a.IsPtr(f.RetrieverID) {
		v.RetrieverPosition = nil
		v.Updates = []Update{} // other retrievers see the request, not its conversation
	}
	return v, revealed
}

// LoadUpdates returns timelines keyed by retrieval id.
func LoadUpdates(ctx context.Context, q *dbq.Queries, ids []uuid.UUID) (map[uuid.UUID][]Update, error) {
	out := map[uuid.UUID][]Update{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.ListRetrievalUpdates(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, u := range rows {
		up := Update{ID: u.ID, Kind: u.Kind, Body: u.Body, CreatedAt: httpx.T(u.CreatedAt)}
		if u.ActorID != nil {
			up.Actor = &users.UserRef{UserID: *u.ActorID, FullName: u.ActorName}
		}
		out[u.RetrievalID] = append(out[u.RetrievalID], up)
	}
	return out, nil
}

// Load returns the full retrieval and its row.
func Load(ctx context.Context, q *dbq.Queries, id uuid.UUID) (Retrieval, Row, error) {
	r, err := q.GetRetrieval(ctx, id)
	if err != nil {
		return Retrieval{}, Row{}, err
	}
	upd, err := LoadUpdates(ctx, q, []uuid.UUID{id})
	if err != nil {
		return Retrieval{}, Row{}, err
	}
	return Build(r, upd[id]), r, nil
}

// ListForEvent returns full retrievals of an event (newest first) with facts.
// closedSince limits terminal retrievals to those changed after it (nil: all).
func ListForEvent(ctx context.Context, q *dbq.Queries, eventID uuid.UUID, statuses []string, closedSince *time.Time) ([]Retrieval, []authz.Retrieval, error) {
	rows, err := q.ListRetrievalsForEvent(ctx, dbq.ListRetrievalsForEventParams{EventID: eventID, Statuses: statuses,
		ClosedSince: closedSince, Lim: 1000})
	if err != nil {
		return nil, nil, err
	}
	ids := make([]uuid.UUID, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	upd, err := LoadUpdates(ctx, q, ids)
	if err != nil {
		return nil, nil, err
	}
	out := make([]Retrieval, 0, len(rows))
	facts := make([]authz.Retrieval, 0, len(rows))
	for _, lr := range rows {
		r := Row(lr)
		out = append(out, Build(r, upd[r.ID]))
		facts = append(facts, Facts(r))
	}
	return out, facts, nil
}

// VisibleForEvent filters and redacts an event's retrievals for the actor.
func VisibleForEvent(ctx context.Context, q *dbq.Queries, a *authz.Actor, acc authz.Access, eventID uuid.UUID, statuses []string,
	closedSince *time.Time) ([]Retrieval, []uuid.UUID, error) {
	all, facts, err := ListForEvent(ctx, q, eventID, statuses, closedSince)
	if err != nil {
		return nil, nil, err
	}
	out := []Retrieval{}
	var revealed []uuid.UUID
	for i, r := range all {
		if !authz.CanViewRetrieval(a, acc, facts[i]) {
			continue
		}
		v, rv := ViewFor(r, facts[i], a, acc)
		out = append(out, v)
		revealed = append(revealed, rv...)
	}
	return out, revealed, nil
}

// Publish writes a "retrieval" envelope with the full payload; the hub
// redacts it per subscriber. prev is the retriever who lost the retrieval
// (release or reassignment) so they learn it is no longer theirs.
func Publish(ctx context.Context, q *dbq.Queries, id uuid.UUID, prev *uuid.UUID) error {
	full, row, err := Load(ctx, q, id)
	if err != nil {
		return err
	}
	data, err := json.Marshal(full)
	if err != nil {
		return err
	}
	ev, rid, pilot := row.EventID, row.ID, row.PilotID
	return bus.Write(ctx, q, bus.Envelope{Type: bus.TypeRetrieval, EventID: &ev, RetrievalID: &rid, PilotID: &pilot,
		RetrieverID: row.RetrieverID, PrevRetrieverID: prev, Status: row.Status, Data: data, ServerReceivedMS: time.Now().UnixMilli()})
}

// RetrieverState is one entry of the snapshot "retrievers" list.
type RetrieverState struct {
	UserID           uuid.UUID     `json:"user_id"`
	FullName         string        `json:"full_name"`
	OnDuty           bool          `json:"on_duty"`
	Position         *RetrieverFix `json:"position"`
	AgeS             *float64      `json:"age_s"`
	ActiveRetrievals int           `json:"active_retrievals"`
}

// RetrieverFix is a retriever position per the contract.
type RetrieverFix struct {
	Lat       float64    `json:"lat"`
	Lon       float64    `json:"lon"`
	HAccM     *float64   `json:"h_acc_m"`
	T         httpx.Time `json:"t"`
	CourseDeg *float64   `json:"course_deg"`
	SpeedMS   *float64   `json:"speed_ms"`
}

// VisibleRetrievers returns the event's retrievers the actor may see.
func VisibleRetrievers(ctx context.Context, q *dbq.Queries, a *authz.Actor, acc authz.Access, eventID uuid.UUID, now time.Time) ([]RetrieverState, error) {
	out := []RetrieverState{}
	if !a.Authenticated() {
		return out, nil
	}
	all := authz.SeesAllRetrievals(a, acc)
	// a pilot sees only the retrievers holding their open retrievals
	serving := map[uuid.UUID]bool{}
	if !all && acc.Role == authz.MemberPilot {
		if id, err := q.OpenRetrievalForPilot(ctx, dbq.OpenRetrievalForPilotParams{EventID: eventID, PilotID: a.UserID}); err == nil {
			if r, err := q.GetRetrieval(ctx, id); err == nil && r.RetrieverID != nil && authz.RetrievalHeld(r.Status) {
				serving[*r.RetrieverID] = true
			}
		}
	}
	if !all && len(serving) == 0 && acc.Role != authz.MemberRetriever {
		return out, nil
	}
	rows, err := q.ListRetrieversForEvent(ctx, eventID)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if !all && !serving[r.UserID] && !a.Is(r.UserID) {
			continue
		}
		out = append(out, StateDTO(r, now))
	}
	return out, nil
}

// StateDTO converts a retriever row.
func StateDTO(r dbq.ListRetrieversForEventRow, now time.Time) RetrieverState {
	s := RetrieverState{UserID: r.UserID, FullName: r.FullName, OnDuty: r.OnDuty, ActiveRetrievals: int(r.ActiveRetrievals)}
	if r.Lat != nil && r.Lon != nil && r.T != nil {
		s.Position = &RetrieverFix{Lat: *r.Lat, Lon: *r.Lon, HAccM: r.HAccM, T: httpx.T(*r.T), CourseDeg: r.CourseDeg, SpeedMS: r.SpeedMs}
	}
	if r.PositionReceivedAt != nil {
		age := now.Sub(*r.PositionReceivedAt).Seconds()
		s.AgeS = &age
	}
	return s
}
