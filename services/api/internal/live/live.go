// Package live builds the event live snapshot (GET /events/{id}/live and the
// WebSocket `subscribed` snapshots): pilots (flights), retrievals and
// retrievers, each filtered per role by internal/authz.
package live

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/audit"
	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/events"
	"github.com/mdenizay/retfast/services/api/internal/flights"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/retrievals"
)

// RecentClosed is how long delivered/cancelled retrievals stay in snapshots.
const RecentClosed = 2 * time.Hour

// Snapshot is the GET /events/{id}/live document.
type Snapshot struct {
	EventID    uuid.UUID                   `json:"event_id"`
	ServerTime httpx.Time                  `json:"server_time"`
	Cursor     string                      `json:"cursor"`
	Pilots     []flights.LivePilot         `json:"pilots"`
	Retrievals []retrievals.Retrieval      `json:"retrievals"`
	Retrievers []retrievals.RetrieverState `json:"retrievers"`
}

// RetrievalSnapshot is the snapshot of the retrievals:<id> channel (no pilots).
type RetrievalSnapshot struct {
	EventID    uuid.UUID                   `json:"event_id"`
	ServerTime httpx.Time                  `json:"server_time"`
	Cursor     string                      `json:"cursor"`
	Retrievals []retrievals.Retrieval      `json:"retrievals"`
	Retrievers []retrievals.RetrieverState `json:"retrievers"`
}

// ForRetrievals drops the pilots list.
func (s *Snapshot) ForRetrievals() *RetrievalSnapshot {
	return &RetrievalSnapshot{EventID: s.EventID, ServerTime: s.ServerTime, Cursor: s.Cursor, Retrievals: s.Retrievals, Retrievers: s.Retrievers}
}

// Service builds snapshots from PostgreSQL (Redis is only a cache, ADR-005).
type Service struct {
	Q      *dbq.Queries
	Cursor func(ctx context.Context) string // latest realtime stream id
}

// Build returns the snapshot for the actor. withPilots=false omits the
// pilots list (retrievals:<id> channel). r may be nil (WebSocket); phone
// reveals are audited either way.
func (s *Service) Build(ctx context.Context, r *http.Request, a *authz.Actor, e events.Row, acc authz.Access, withPilots bool) (*Snapshot, error) {
	cursor := "0-0"
	if s.Cursor != nil {
		cursor = s.Cursor(ctx)
	}
	now := time.Now()
	out := &Snapshot{EventID: e.ID, ServerTime: httpx.T(now), Cursor: cursor, Pilots: []flights.LivePilot{}, Retrievals: []retrievals.Retrieval{},
		Retrievers: []retrievals.RetrieverState{}}
	if withPilots {
		p, err := flights.LivePilots(ctx, s.Q, a, e, acc, now)
		if err != nil {
			return nil, err
		}
		out.Pilots = p
	}
	if authz.CanListRetrievals(a, acc) {
		since := now.Add(-RecentClosed)
		items, revealed, err := retrievals.VisibleForEvent(ctx, s.Q, a, acc, e.ID, []string{}, &since)
		if err != nil {
			return nil, err
		}
		out.Retrievals = items
		ev := e.ID
		if err := audit.PhoneReveal(ctx, s.Q, r, &ev, "live_snapshot", revealed); err != nil {
			return nil, err
		}
		if out.Retrievers, err = retrievals.VisibleRetrievers(ctx, s.Q, a, acc, e.ID, now); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// Handler serves GET /events/{id}/live.
type Handler struct{ Live *Service }

// Routes mounts with optional auth.
func (h *Handler) Routes(r chi.Router) {
	r.Get("/events/{id}/live", httpx.H(h.get))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, acc, err := events.LoadVisible(ctx, h.Live.Q, chi.URLParam(r, "id"), a)
	if err != nil {
		return err
	}
	if !authz.CanViewEventLive(a, events.Facts(e), acc) {
		if !a.Authenticated() {
			return httpx.Unauthorized("Sign in to view this live map")
		}
		return httpx.Forbidden("The live map of this event is not public")
	}
	snap, err := h.Live.Build(ctx, r, a, e, acc, true)
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, snap)
	return nil
}
