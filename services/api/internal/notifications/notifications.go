// Package notifications stores in-app notification records and hands them to a
// push sender. APNs is NOT configured in this release: the only PushSender is
// UnconfiguredAPNs, which logs "apns_unconfigured" and marks records so; the
// in-app list (GET /notifications) is the delivery channel that works today.
package notifications

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
)

// Kinds.
const (
	KindEventUpdate = "event_update"
	KindApplication = "application"
	KindRetrieval   = "retrieval"
	KindFlight      = "flight"
	KindSystem      = "system"
)

// Notify inserts one record per recipient using q (transaction-bound when it
// must be atomic with the triggering change).
func Notify(ctx context.Context, q *dbq.Queries, userIDs []uuid.UUID, kind, title, body string, data map[string]any) error {
	raw := []byte("{}")
	if data != nil {
		b, err := json.Marshal(data)
		if err != nil {
			return err
		}
		raw = b
	}
	seen := map[uuid.UUID]bool{}
	for _, u := range userIDs {
		if seen[u] {
			continue
		}
		seen[u] = true
		if _, err := q.InsertNotification(ctx, dbq.InsertNotificationParams{UserID: u, Kind: kind, Title: title, Body: body, Data: raw}); err != nil {
			return err
		}
	}
	return nil
}

// Push is one push notification for one device.
type Push struct {
	UserID      uuid.UUID
	DeviceToken string
	Kind        string
	Title       string
	Body        string
	Data        json.RawMessage
}

// PushSender delivers pushes. A real APNs implementation (token-based .p8 auth,
// HTTP/2 to api.push.apple.com) must implement this interface.
type PushSender interface {
	Configured() bool
	Send(ctx context.Context, p Push) error
}

// UnconfiguredAPNs is the no-op sender used until APNs credentials exist.
type UnconfiguredAPNs struct {
	Log     *slog.Logger
	Metrics *metrics.Metrics
}

// Configured implements PushSender.
func (UnconfiguredAPNs) Configured() bool { return false }

// Send implements PushSender by logging apns_unconfigured.
func (u UnconfiguredAPNs) Send(ctx context.Context, p Push) error {
	u.Metrics.PushUnconfigured.Inc()
	u.Log.Info("apns_unconfigured", "kind", p.Kind, "user_id", p.UserID.String())
	return nil
}

// PushWorker hands pending records to the PushSender.
type PushWorker struct {
	Pool   *pgxpool.Pool
	Sender PushSender
	Log    *slog.Logger
}

// Run drains pending pushes every 2 s until ctx is cancelled.
func (w *PushWorker) Run(ctx context.Context) {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		if err := w.ProcessOnce(ctx); err != nil && ctx.Err() == nil {
			w.Log.Warn("push worker error", "err", err.Error())
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// ProcessOnce handles one batch of pending notification records.
func (w *PushWorker) ProcessOnce(ctx context.Context) error {
	return pgx.BeginFunc(ctx, w.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		rows, err := q.ClaimPendingPush(ctx)
		if err != nil || len(rows) == 0 {
			return err
		}
		users := make([]uuid.UUID, 0, len(rows))
		for _, r := range rows {
			users = append(users, r.UserID)
		}
		devs, err := q.ListPushDevices(ctx, users)
		if err != nil {
			return err
		}
		byUser := map[uuid.UUID][]string{}
		for _, d := range devs {
			if d.ApnsToken != nil {
				byUser[d.UserID] = append(byUser[d.UserID], *d.ApnsToken)
			}
		}
		status := map[string][]uuid.UUID{}
		for _, r := range rows {
			toks := byUser[r.UserID]
			switch {
			case len(toks) == 0:
				status["no_device"] = append(status["no_device"], r.ID)
			case !w.Sender.Configured():
				_ = w.Sender.Send(ctx, Push{UserID: r.UserID, Kind: r.Kind, Title: r.Title, Body: r.Body, Data: r.Data})
				status["unconfigured"] = append(status["unconfigured"], r.ID)
			default:
				ok := true
				for _, tok := range toks {
					if err := w.Sender.Send(ctx, Push{UserID: r.UserID, DeviceToken: tok, Kind: r.Kind, Title: r.Title, Body: r.Body, Data: r.Data}); err != nil {
						ok = false
					}
				}
				if ok {
					status["sent"] = append(status["sent"], r.ID)
				} else {
					status["failed"] = append(status["failed"], r.ID)
				}
			}
		}
		for s, ids := range status {
			if err := q.SetPushStatus(ctx, dbq.SetPushStatusParams{PushStatus: s, Ids: ids}); err != nil {
				return err
			}
		}
		return nil
	})
}

// Handler serves /notifications.
type Handler struct{ Q *dbq.Queries }

type notificationDTO struct {
	ID        uuid.UUID       `json:"id"`
	Kind      string          `json:"kind"`
	Title     string          `json:"title"`
	Body      string          `json:"body"`
	Data      json.RawMessage `json:"data"`
	ReadAt    *httpx.Time     `json:"read_at"`
	CreatedAt httpx.Time      `json:"created_at"`
}

// Routes mounts the authenticated notification endpoints.
func (h *Handler) Routes(r chi.Router) {
	r.Get("/notifications", httpx.H(h.list))
	r.Post("/notifications/read-all", httpx.H(h.readAll))
	r.Post("/notifications/{id}/read", httpx.H(h.read))
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) error {
	a := authz.ActorFrom(r.Context())
	lim, err := httpx.Limit(r, 50, 200)
	if err != nil {
		return err
	}
	var cur struct {
		T  time.Time `json:"t"`
		ID uuid.UUID `json:"id"`
	}
	p := dbq.ListNotificationsParams{UserID: a.UserID, Lim: int32(lim + 1)}
	if ok, err := httpx.DecodeCursor(r, &cur); err != nil {
		return err
	} else if ok {
		p.AfterCreated, p.AfterID = &cur.T, &cur.ID
	}
	rows, err := h.Q.ListNotifications(r.Context(), p)
	if err != nil {
		return err
	}
	out := httpx.Page[notificationDTO]{Items: []notificationDTO{}}
	for i, n := range rows {
		if i == lim {
			last := rows[lim-1]
			out.NextCursor = httpx.EncodeCursor(map[string]any{"t": last.CreatedAt, "id": last.ID})
			break
		}
		out.Items = append(out.Items, notificationDTO{ID: n.ID, Kind: n.Kind, Title: n.Title, Body: n.Body, Data: n.Data,
			ReadAt: httpx.TP(n.ReadAt), CreatedAt: httpx.T(n.CreatedAt)})
	}
	httpx.WriteJSON(w, http.StatusOK, out)
	return nil
}

func (h *Handler) read(w http.ResponseWriter, r *http.Request) error {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return httpx.NotFound("")
	}
	n, err := h.Q.MarkNotificationRead(r.Context(), dbq.MarkNotificationReadParams{ID: id, UserID: authz.ActorFrom(r.Context()).UserID})
	if err != nil {
		return err
	}
	if n == 0 {
		return httpx.NotFound("")
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handler) readAll(w http.ResponseWriter, r *http.Request) error {
	if err := h.Q.MarkAllNotificationsRead(r.Context(), authz.ActorFrom(r.Context()).UserID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
