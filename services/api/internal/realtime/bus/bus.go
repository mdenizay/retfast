// Package bus defines the realtime envelope written to realtime_outbox inside
// producer transactions (ADR-005) and published to the Redis stream by the relay.
package bus

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
)

// Message types (match the WebSocket "type" field). member_changed and
// event_changed are internal: they update the authorization facts of live
// subscriptions on every instance and are never sent to clients.
const (
	TypePosition          = "position"
	TypeFlight            = "flight"
	TypeRetrieval         = "retrieval"
	TypeRetrieverPosition = "retriever_position"
	TypePilotPosition     = "pilot_position"
	TypeMemberChanged     = "member_changed"
	TypeEventChanged      = "event_changed"
)

// Envelope carries the authorization facts needed for per-message filtering
// alongside pre-rendered payloads.
type Envelope struct {
	Type    string     `json:"type"`
	EventID *uuid.UUID `json:"event_id,omitempty"`
	// Flight facts (position/flight messages)
	FlightID *uuid.UUID `json:"flight_id,omitempty"`
	OwnerID  *uuid.UUID `json:"owner_id,omitempty"`
	// Retrieval facts (retrieval/pilot_position messages)
	RetrievalID     *uuid.UUID `json:"retrieval_id,omitempty"`
	PilotID         *uuid.UUID `json:"pilot_id,omitempty"`
	RetrieverID     *uuid.UUID `json:"retriever_id,omitempty"`
	PrevRetrieverID *uuid.UUID `json:"prev_retriever_id,omitempty"`
	Status          string     `json:"status,omitempty"`
	// Retriever facts (retriever_position): the retriever and the pilots whose
	// open retrievals they hold (those pilots may see them).
	UserID   *uuid.UUID  `json:"user_id,omitempty"`
	PilotIDs []uuid.UUID `json:"pilot_ids,omitempty"`
	// member_changed: the user's new access to EventID
	Access *authz.Access `json:"access,omitempty"`
	// event_changed: the event's new facts
	Event *authz.Event `json:"event,omitempty"`
	// Data is the contract payload for fully authorized viewers.
	Data json.RawMessage `json:"data,omitempty"`
	// PublicData is the variant for guests/non-members (display names only, no
	// contact data). Empty means guests never receive the message.
	PublicData json.RawMessage `json:"public_data,omitempty"`
	// ServerReceivedMS is when the server received the underlying data (unix
	// ms); used to measure propagation delay.
	ServerReceivedMS int64 `json:"srv_ms,omitempty"`
}

// Write stores env in the outbox and schedules a NOTIFY at commit. q must be
// bound to the producer's transaction.
func Write(ctx context.Context, q *dbq.Queries, env Envelope) error {
	b, err := json.Marshal(env)
	if err != nil {
		return err
	}
	if err := q.InsertOutbox(ctx, dbq.InsertOutboxParams{Kind: env.Type, EventID: env.EventID, FlightID: env.FlightID, Payload: b}); err != nil {
		return err
	}
	return q.NotifyOutbox(ctx)
}

// MemberChanged publishes a user's new access to an event so live
// subscriptions re-check it (roles can change during the event).
func MemberChanged(ctx context.Context, q *dbq.Queries, eventID, userID uuid.UUID) error {
	acc, err := q.GetEventAccess(ctx, dbq.GetEventAccessParams{EventID: eventID, UserID: userID})
	if err != nil {
		return err
	}
	ev, uid := eventID, userID
	return Write(ctx, q, Envelope{Type: TypeMemberChanged, EventID: &ev, UserID: &uid,
		Access: &authz.Access{Organizer: acc.IsOrganizer, Role: acc.Role}})
}

// EventChanged publishes an event's new policy facts.
func EventChanged(ctx context.Context, q *dbq.Queries, e authz.Event) error {
	id := e.ID
	return Write(ctx, q, Envelope{Type: TypeEventChanged, EventID: &id, Event: &e})
}
