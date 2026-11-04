// Package bus defines the realtime envelope written to realtime_outbox inside
// producer transactions (ADR-005) and published to the Redis stream by the relay.
package bus

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
)

// Message types (match the WebSocket "type" field).
const (
	TypePosition = "position"
	TypeFlight   = "flight"
	TypeIncident = "incident"
)

// Envelope carries the authorization facts needed for per-message filtering
// alongside pre-rendered payloads.
type Envelope struct {
	Type    string     `json:"type"`
	EventID *uuid.UUID `json:"event_id,omitempty"`
	// Flight facts (position/flight messages)
	FlightID     *uuid.UUID `json:"flight_id,omitempty"`
	OwnerID      *uuid.UUID `json:"owner_id,omitempty"`
	Visibility   string     `json:"visibility,omitempty"`
	IncidentOpen bool       `json:"incident_open,omitempty"`
	// Incident facts
	IncidentID *uuid.UUID `json:"incident_id,omitempty"`
	PilotID    *uuid.UUID `json:"pilot_id,omitempty"`
	// Data is the contract payload for authorized members/responders.
	Data json.RawMessage `json:"data"`
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
