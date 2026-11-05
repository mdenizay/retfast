package retrievals

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/audit"
	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/events"
	"github.com/mdenizay/retfast/services/api/internal/flights"
	"github.com/mdenizay/retfast/services/api/internal/notifications"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
	"github.com/mdenizay/retfast/services/api/internal/platform/ratelimit"
	"github.com/mdenizay/retfast/services/api/internal/realtime/bus"
)

// Handler serves retrieval and retriever endpoints.
type Handler struct {
	Pool    *pgxpool.Pool
	Q       *dbq.Queries
	Limiter *ratelimit.Limiter
	Metrics *metrics.Metrics
}

// Routes are mounted with required authentication.
func (h *Handler) Routes(r chi.Router) {
	r.Post("/events/{id}/retrievals", httpx.H(h.create))
	r.Get("/events/{id}/retrievals", httpx.H(h.list))
	r.Post("/events/{id}/retrievers/me/position", httpx.H(h.retrieverPosition))
	r.Put("/events/{id}/retrievers/me/duty", httpx.H(h.duty))
	r.Get("/events/{id}/retrievers/{uid}/track", httpx.H(h.track))
	r.Get("/retrievals/{rid}", httpx.H(h.get))
	r.Post("/retrievals/{rid}/position", httpx.H(h.pilotPosition))
	r.Post("/retrievals/{rid}/accept", httpx.H(h.accept))
	r.Post("/retrievals/{rid}/release", httpx.H(h.release))
	r.Post("/retrievals/{rid}/assign", httpx.H(h.assign))
	r.Post("/retrievals/{rid}/picked-up", httpx.H(h.pickedUp))
	r.Post("/retrievals/{rid}/delivered", httpx.H(h.delivered))
	r.Post("/retrievals/{rid}/cancel", httpx.H(h.cancel))
	r.Post("/retrievals/{rid}/notes", httpx.H(h.note))
}

func (h *Handler) limit(ctx context.Context, rule ratelimit.Rule) error {
	if h.Limiter == nil {
		return nil
	}
	a := authz.ActorFrom(ctx)
	if ok, retry := h.Limiter.Allow(ctx, rule, a.UserID.String()); !ok {
		return httpx.RateLimited(retry)
	}
	return nil
}

func validLatLon(lat, lon float64) bool {
	return !math.IsNaN(lat) && !math.IsNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat == 0 && lon == 0)
}

func validAcc(v float64) bool { return v > 0 && v <= 10000 }

// write responds with the retrieval as the caller sees it, auditing phone reveals.
func (h *Handler) write(w http.ResponseWriter, r *http.Request, status int, id uuid.UUID) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	full, row, err := Load(ctx, h.Q, id)
	if err != nil {
		return err
	}
	acc, err := events.AccessOf(ctx, h.Q, row.EventID, a)
	if err != nil {
		return err
	}
	v, revealed := ViewFor(full, Facts(row), a, acc)
	ev := row.EventID
	if err := audit.PhoneReveal(ctx, h.Q, r, &ev, "retrieval", revealed); err != nil {
		return err
	}
	httpx.WriteJSON(w, status, v)
	return nil
}

// load fetches a retrieval, its event and the caller's access. Retrievals the
// caller may not see are reported as 404 unless allowHidden.
func (h *Handler) load(r *http.Request, allowHidden func(authz.Access) bool) (Row, events.Row, authz.Access, error) {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	id, err := uuid.Parse(chi.URLParam(r, "rid"))
	if err != nil {
		return Row{}, events.Row{}, authz.Access{}, httpx.NotFound("Retrieval not found")
	}
	row, err := h.Q.GetRetrieval(ctx, id)
	if db.NotFound(err) {
		return Row{}, events.Row{}, authz.Access{}, httpx.NotFound("Retrieval not found")
	}
	if err != nil {
		return Row{}, events.Row{}, authz.Access{}, err
	}
	e, err := h.Q.GetEventByID(ctx, row.EventID)
	if err != nil {
		return Row{}, events.Row{}, authz.Access{}, err
	}
	acc, err := events.AccessOf(ctx, h.Q, row.EventID, a)
	if err != nil {
		return Row{}, events.Row{}, authz.Access{}, err
	}
	if !authz.CanViewRetrieval(a, acc, Facts(row)) && (allowHidden == nil || !allowHidden(acc)) {
		return Row{}, events.Row{}, authz.Access{}, httpx.NotFound("Retrieval not found")
	}
	return row, e, acc, nil
}

func conflictFor(status string) error {
	return httpx.Conflict("Not allowed while the retrieval is " + status)
}

// transition records a state change atomically: timeline entry, audit row,
// notifications and the realtime outbox envelope.
type transition struct {
	kind    string // update kind
	body    string
	notify  []uuid.UUID
	title   string
	text    string
	prev    *uuid.UUID
	details map[string]any
	reveal  *revealInfo
}

type revealInfo struct {
	retriever uuid.UUID
	pilot     uuid.UUID
}

func (h *Handler) record(ctx context.Context, q *dbq.Queries, r *http.Request, e events.Row, id uuid.UUID, from string, t transition) error {
	a := authz.ActorFrom(ctx)
	var actor *uuid.UUID
	if a.Authenticated() {
		uid := a.UserID
		actor = &uid
	}
	if err := q.InsertRetrievalUpdate(ctx, dbq.InsertRetrievalUpdateParams{RetrievalID: id, Kind: t.kind, ActorID: actor, Body: t.body}); err != nil {
		return err
	}
	cur, err := q.GetRetrieval(ctx, id)
	if err != nil {
		return err
	}
	details := map[string]any{"from": from, "to": cur.Status, "pilot_id": cur.PilotID, "is_simulated": cur.IsSimulated}
	if cur.RetrieverID != nil {
		details["retriever_id"] = *cur.RetrieverID
	}
	for k, v := range t.details {
		details[k] = v
	}
	ev := e.ID
	if err := audit.Record(ctx, q, r, audit.Entry{Action: "retrieval." + t.kind, TargetType: "retrieval", TargetID: id.String(),
		EventID: &ev, Details: details}); err != nil {
		return err
	}
	if t.reveal != nil {
		// Accepting/assignment reveals the pilot's phone to the retriever and the
		// retriever's phone to the pilot.
		for _, x := range []struct {
			to, of uuid.UUID
			phone  string
		}{{t.reveal.retriever, t.reveal.pilot, cur.PilotPhone}, {t.reveal.pilot, t.reveal.retriever, cur.RetrieverPhone}} {
			if x.phone == "" {
				continue
			}
			if err := audit.Record(ctx, q, r, audit.Entry{Action: "privacy.phone_revealed", TargetType: "user", TargetID: x.of.String(),
				EventID: &ev, Details: map[string]any{"context": "retrieval_" + t.kind, "retrieval_id": id, "revealed_to": x.to,
					"user_ids": []string{x.of.String()}}}); err != nil {
				return err
			}
		}
	}
	if len(t.notify) > 0 {
		recipients := make([]uuid.UUID, 0, len(t.notify))
		for _, u := range t.notify {
			if !a.Is(u) {
				recipients = append(recipients, u)
			}
		}
		if err := notifications.Notify(ctx, q, recipients, notifications.KindRetrieval, t.title, t.text,
			map[string]any{"event_id": e.ID, "slug": e.Slug, "retrieval_id": id, "status": cur.Status}); err != nil {
			return err
		}
	}
	if h.Metrics != nil {
		h.Metrics.Retrievals.WithLabelValues(t.kind).Inc()
	}
	return Publish(ctx, q, id, t.prev)
}

// ---------------------------------------------------------------- create / read

type positionIn struct {
	Lat       *float64    `json:"lat"`
	Lon       *float64    `json:"lon"`
	GPSAltM   *float64    `json:"gps_alt_m"`
	HAccM     *float64    `json:"h_acc_m"`
	T         *httpx.Time `json:"t"`
	CourseDeg *float64    `json:"course_deg"`
	SpeedMS   *float64    `json:"speed_ms"`
}

func (p *positionIn) validate(prefix string, requireAcc bool) map[string]string {
	d := map[string]string{}
	if p.Lat == nil || p.Lon == nil || !validLatLon(*p.Lat, *p.Lon) {
		d[prefix+"lat"] = "lat/lon required and valid"
	}
	if p.HAccM == nil {
		if requireAcc {
			d[prefix+"h_acc_m"] = "required"
		}
	} else if !validAcc(*p.HAccM) {
		d[prefix+"h_acc_m"] = "must be in (0, 10000]"
	}
	now := time.Now()
	if p.T == nil {
		d[prefix+"t"] = "required"
	} else if p.T.After(now.Add(10*time.Minute)) || p.T.Before(now.Add(-24*time.Hour)) {
		d[prefix+"t"] = "out of range"
	}
	if p.CourseDeg != nil && (*p.CourseDeg < -1 || *p.CourseDeg > 360) {
		d[prefix+"course_deg"] = "must be 0-360"
	}
	if p.SpeedMS != nil && (*p.SpeedMS < -1 || *p.SpeedMS > 120) {
		d[prefix+"speed_ms"] = "out of range"
	}
	return d
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, acc, err := events.LoadVisible(ctx, h.Q, chi.URLParam(r, "id"), a)
	if err != nil {
		return err
	}
	var in struct {
		ID          uuid.UUID  `json:"id"`
		FlightID    *uuid.UUID `json:"flight_id"`
		Pickup      positionIn `json:"pickup"`
		Note        string     `json:"note"`
		IsSimulated bool       `json:"is_simulated"`
	}
	if err := httpx.DecodeJSON(w, r, 16<<10, &in); err != nil {
		return err
	}
	in.Note = strings.TrimSpace(in.Note)
	d := in.Pickup.validate("pickup.", false)
	if in.ID == uuid.Nil {
		d["id"] = "required (client-generated UUID)"
	}
	if utf8.RuneCountInString(in.Note) > 1000 {
		d["note"] = "too long (max 1000)"
	}
	if len(d) > 0 {
		return httpx.Validation(d)
	}
	// idempotent re-send
	if ex, err := h.Q.GetRetrieval(ctx, in.ID); err == nil {
		if ex.PilotID != a.UserID || ex.EventID != e.ID {
			return httpx.Conflict("Retrieval id already in use")
		}
		return h.write(w, r, http.StatusOK, ex.ID)
	} else if !db.NotFound(err) {
		return err
	}
	if !authz.CanCreateRetrieval(acc) {
		return httpx.Forbidden("Only pilots of this event can request a retrieval")
	}
	if e.Status == "archived" || e.Status == "completed" || e.Status == "draft" {
		return httpx.Forbidden("The event is not running")
	}
	if err := h.limit(ctx, ratelimit.Retrieval); err != nil {
		return err
	}
	if in.FlightID != nil {
		fr, err := h.Q.GetFlight(ctx, *in.FlightID)
		f := fr.FlightSession
		if db.NotFound(err) || (err == nil && (f.PilotID != a.UserID || f.EventID == nil || *f.EventID != e.ID)) {
			return httpx.Validation(map[string]string{"flight_id": "must be your flight in this event"})
		}
		if err != nil {
			return err
		}
		in.IsSimulated = in.IsSimulated || f.IsSimulated
	}
	created := false
	var openID uuid.UUID
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		_, err := q.InsertRetrieval(ctx, dbq.InsertRetrievalParams{ID: in.ID, EventID: e.ID, PilotID: a.UserID, FlightID: in.FlightID,
			PickupLat: *in.Pickup.Lat, PickupLon: *in.Pickup.Lon, PickupGpsAltM: in.Pickup.GPSAltM, PickupHAccM: in.Pickup.HAccM,
			PickupT: in.Pickup.T.Time, Note: in.Note, IsSimulated: in.IsSimulated})
		if db.NotFound(err) {
			return nil // concurrent insert of the same id; checked below
		}
		if db.IsUniqueViolation(err, "retrievals_open_pilot_uq") {
			id, lerr := dbq.New(h.Pool).OpenRetrievalForPilot(ctx, dbq.OpenRetrievalForPilotParams{EventID: e.ID, PilotID: a.UserID})
			if lerr == nil {
				openID = id
			}
			return errOpenExists
		}
		if err != nil {
			return err
		}
		created = true
		retrievers, err := q.ListMemberIDsByRole(ctx, dbq.ListMemberIDsByRoleParams{EventID: e.ID, Role: authz.MemberRetriever})
		if err != nil {
			return err
		}
		orgs, err := q.ListOrganizerIDs(ctx, e.ID)
		if err != nil {
			return err
		}
		text := a.FullName + " toplanmak istiyor."
		if in.Note != "" {
			text += " Not: " + in.Note
		}
		return h.record(ctx, q, r, e, in.ID, "", transition{kind: "requested", body: in.Note, notify: append(retrievers, orgs...),
			title: e.Name + ": yeni toplama isteği", text: text})
	})
	if err == errOpenExists {
		body := map[string]any{"error": httpx.Conflict("You already have an open retrieval in this event")}
		if openID != uuid.Nil {
			if full, row, lerr := Load(ctx, h.Q, openID); lerr == nil {
				v, _ := ViewFor(full, Facts(row), a, acc)
				body["retrieval"] = v
				body["error"] = &httpx.Error{Status: 409, Code: "conflict", Message: "You already have an open retrieval in this event",
					Details: map[string]string{"retrieval_id": openID.String()}}
			}
		}
		httpx.WriteJSON(w, http.StatusConflict, body)
		return nil
	}
	if err != nil {
		return err
	}
	ex, err := h.Q.GetRetrieval(ctx, in.ID)
	if err != nil {
		return err
	}
	if ex.PilotID != a.UserID {
		return httpx.Conflict("Retrieval id already in use")
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	return h.write(w, r, status, in.ID)
}

type sentinel string

func (s sentinel) Error() string { return string(s) }

const errOpenExists = sentinel("open retrieval exists")

func (h *Handler) list(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, acc, err := events.LoadVisible(ctx, h.Q, chi.URLParam(r, "id"), a)
	if err != nil {
		return err
	}
	if !authz.CanListRetrievals(a, acc) {
		return httpx.Forbidden("Only event members can see retrievals")
	}
	statuses := []string{}
	if s := r.URL.Query().Get("status"); s != "" {
		for _, st := range strings.Split(s, ",") {
			st = strings.TrimSpace(st)
			switch st {
			case StatusRequested, StatusAccepted, StatusPickedUp, StatusDelivered, StatusCancelled:
				statuses = append(statuses, st)
			default:
				return httpx.Validation(map[string]string{"status": "unknown status " + st})
			}
		}
	}
	items, revealed, err := VisibleForEvent(ctx, h.Q, a, acc, e.ID, statuses, nil)
	if err != nil {
		return err
	}
	ev := e.ID
	if err := audit.PhoneReveal(ctx, h.Q, r, &ev, "retrievals", revealed); err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
	return nil
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) error {
	row, _, _, err := h.load(r, nil)
	if err != nil {
		return err
	}
	return h.write(w, r, http.StatusOK, row.ID)
}

// ---------------------------------------------------------------- transitions

func (h *Handler) accept(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	row, e, acc, err := h.load(r, authz.CanAcceptRetrieval)
	if err != nil {
		return err
	}
	if !authz.CanAcceptRetrieval(acc) {
		return httpx.Forbidden("Only retrievers of this event can accept retrievals")
	}
	if err := h.limit(ctx, ratelimit.Retrieval); err != nil {
		return err
	}
	if a.IsPtr(row.RetrieverID) && authz.RetrievalHeld(row.Status) {
		return h.write(w, r, http.StatusOK, row.ID) // already mine: idempotent
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		// first accept wins: the conditional UPDATE matches only while 'requested'
		if _, err := q.AcceptRetrieval(ctx, dbq.AcceptRetrievalParams{ID: row.ID, RetrieverID: &a.UserID}); db.NotFound(err) {
			return httpx.Conflict("This retrieval has already been taken")
		} else if err != nil {
			return err
		}
		return h.record(ctx, q, r, e, row.ID, row.Status, transition{kind: "accepted", notify: []uuid.UUID{row.PilotID},
			title: e.Name + ": toplayıcı yolda", text: a.FullName + " sizi almaya geliyor.",
			reveal: &revealInfo{retriever: a.UserID, pilot: row.PilotID}})
	})
	if err != nil {
		return err
	}
	return h.write(w, r, http.StatusOK, row.ID)
}

func (h *Handler) release(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	row, e, _, err := h.load(r, nil)
	if err != nil {
		return err
	}
	if !a.IsPtr(row.RetrieverID) {
		return httpx.Forbidden("Only the accepting retriever can release this retrieval")
	}
	if _, ok := Next(row.Status, ActRelease); !ok {
		return conflictFor(row.Status)
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if _, err := q.ReleaseRetrieval(ctx, dbq.ReleaseRetrievalParams{ID: row.ID, RetrieverID: &a.UserID}); db.NotFound(err) {
			return httpx.Conflict("The retrieval changed; reload it")
		} else if err != nil {
			return err
		}
		prev := a.UserID
		return h.record(ctx, q, r, e, row.ID, row.Status, transition{kind: "released", prev: &prev, notify: []uuid.UUID{row.PilotID},
			title: e.Name + ": toplama isteği yeniden açıldı", text: a.FullName + " isteği bıraktı; başka bir toplayıcı bekleniyor."})
	})
	if err != nil {
		return err
	}
	return h.write(w, r, http.StatusOK, row.ID)
}

func (h *Handler) assign(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	row, e, acc, err := h.load(r, nil)
	if err != nil {
		return err
	}
	if !authz.CanAssignRetrieval(a, acc) {
		return httpx.Forbidden("Only organizers can assign retrievals")
	}
	var in struct {
		RetrieverUserID uuid.UUID `json:"retriever_user_id"`
	}
	if err := httpx.DecodeJSON(w, r, 4<<10, &in); err != nil {
		return err
	}
	target, err := h.Q.GetEventAccess(ctx, dbq.GetEventAccessParams{EventID: e.ID, UserID: in.RetrieverUserID})
	if err != nil {
		return err
	}
	if target.Role != authz.MemberRetriever {
		return httpx.Validation(map[string]string{"retriever_user_id": "must be a retriever of this event"})
	}
	if _, ok := Next(row.Status, ActAssign); !ok {
		return conflictFor(row.Status)
	}
	if row.RetrieverID != nil && *row.RetrieverID == in.RetrieverUserID {
		return h.write(w, r, http.StatusOK, row.ID)
	}
	name, err := h.Q.GetUserName(ctx, in.RetrieverUserID)
	if err != nil {
		return err
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if _, err := q.AssignRetrieval(ctx, dbq.AssignRetrievalParams{ID: row.ID, RetrieverID: &in.RetrieverUserID}); db.NotFound(err) {
			return httpx.Conflict("The retrieval changed; reload it")
		} else if err != nil {
			return err
		}
		notify := []uuid.UUID{row.PilotID, in.RetrieverUserID}
		if row.RetrieverID != nil {
			notify = append(notify, *row.RetrieverID)
		}
		return h.record(ctx, q, r, e, row.ID, row.Status, transition{kind: "assigned", body: name.FullName, prev: row.RetrieverID,
			notify: notify, title: e.Name + ": toplayıcı atandı", text: name.FullName + " toplama görevine atandı.",
			details: map[string]any{"previous_retriever_id": row.RetrieverID},
			reveal:  &revealInfo{retriever: in.RetrieverUserID, pilot: row.PilotID}})
	})
	if err != nil {
		return err
	}
	return h.write(w, r, http.StatusOK, row.ID)
}

func (h *Handler) pickedUp(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	row, e, _, err := h.load(r, nil)
	if err != nil {
		return err
	}
	if !a.IsPtr(row.RetrieverID) {
		return httpx.Forbidden("Only the accepting retriever can mark the pilot picked up")
	}
	if row.Status == StatusPickedUp {
		return h.write(w, r, http.StatusOK, row.ID)
	}
	if _, ok := Next(row.Status, ActPickUp); !ok {
		return conflictFor(row.Status)
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if _, err := q.PickUpRetrieval(ctx, dbq.PickUpRetrievalParams{ID: row.ID, RetrieverID: &a.UserID}); db.NotFound(err) {
			return httpx.Conflict("The retrieval changed; reload it")
		} else if err != nil {
			return err
		}
		return h.record(ctx, q, r, e, row.ID, row.Status, transition{kind: "picked_up", notify: []uuid.UUID{row.PilotID},
			title: e.Name + ": alındınız", text: a.FullName + " sizi aldı."})
	})
	if err != nil {
		return err
	}
	return h.write(w, r, http.StatusOK, row.ID)
}

func (h *Handler) delivered(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	row, e, _, err := h.load(r, nil)
	if err != nil {
		return err
	}
	if !a.IsPtr(row.RetrieverID) {
		return httpx.Forbidden("Only the accepting retriever can mark the delivery")
	}
	var in struct {
		Note string `json:"note"`
	}
	if err := httpx.DecodeOptionalJSON(w, r, 8<<10, &in); err != nil {
		return err
	}
	in.Note = strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(in.Note) > 1000 {
		return httpx.Validation(map[string]string{"note": "too long (max 1000)"})
	}
	if row.Status == StatusDelivered {
		return h.write(w, r, http.StatusOK, row.ID)
	}
	if _, ok := Next(row.Status, ActDeliver); !ok {
		return conflictFor(row.Status)
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if _, err := q.DeliverRetrieval(ctx, dbq.DeliverRetrievalParams{ID: row.ID, RetrieverID: &a.UserID, DeliveryNote: in.Note}); db.NotFound(err) {
			return httpx.Conflict("The retrieval changed; reload it")
		} else if err != nil {
			return err
		}
		return h.record(ctx, q, r, e, row.ID, row.Status, transition{kind: "delivered", body: in.Note, notify: []uuid.UUID{row.PilotID},
			title: e.Name + ": teslim edildiniz", text: "Toplama tamamlandı."})
	})
	if err != nil {
		return err
	}
	return h.write(w, r, http.StatusOK, row.ID)
}

func (h *Handler) cancel(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	row, e, acc, err := h.load(r, nil)
	if err != nil {
		return err
	}
	if !authz.CanCancelRetrieval(a, acc, Facts(row)) {
		return httpx.Forbidden("Only the pilot or an organizer can cancel this retrieval")
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if err := httpx.DecodeOptionalJSON(w, r, 8<<10, &in); err != nil {
		return err
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if utf8.RuneCountInString(in.Reason) > 1000 {
		return httpx.Validation(map[string]string{"reason": "too long (max 1000)"})
	}
	if row.Status == StatusCancelled {
		return h.write(w, r, http.StatusOK, row.ID)
	}
	if _, ok := Next(row.Status, ActCancel); !ok {
		return conflictFor(row.Status)
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if _, err := q.CancelRetrieval(ctx, dbq.CancelRetrievalParams{ID: row.ID, CancelledBy: &a.UserID, CancelReason: in.Reason}); db.NotFound(err) {
			return httpx.Conflict("The retrieval changed; reload it")
		} else if err != nil {
			return err
		}
		notify := []uuid.UUID{row.PilotID}
		if row.RetrieverID != nil {
			notify = append(notify, *row.RetrieverID)
		}
		text := "Toplama isteği iptal edildi."
		if in.Reason != "" {
			text += " Neden: " + in.Reason
		}
		return h.record(ctx, q, r, e, row.ID, row.Status, transition{kind: "cancelled", body: in.Reason, notify: notify,
			title: e.Name + ": toplama iptal edildi", text: text})
	})
	if err != nil {
		return err
	}
	return h.write(w, r, http.StatusOK, row.ID)
}

func (h *Handler) note(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	row, e, acc, err := h.load(r, nil)
	if err != nil {
		return err
	}
	if !authz.CanAddRetrievalNote(a, acc, Facts(row)) {
		return httpx.Forbidden("Only the pilot, the accepting retriever or an organizer can add notes")
	}
	var in struct {
		Body string `json:"body"`
	}
	if err := httpx.DecodeJSON(w, r, 8<<10, &in); err != nil {
		return err
	}
	in.Body = strings.TrimSpace(in.Body)
	if in.Body == "" || utf8.RuneCountInString(in.Body) > 2000 {
		return httpx.Validation(map[string]string{"body": "must be 1-2000 characters"})
	}
	if err := h.limit(ctx, ratelimit.Retrieval); err != nil {
		return err
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if err := q.TouchRetrieval(ctx, row.ID); err != nil {
			return err
		}
		notify := []uuid.UUID{row.PilotID}
		if row.RetrieverID != nil {
			notify = append(notify, *row.RetrieverID)
		}
		return h.record(ctx, q, r, e, row.ID, row.Status, transition{kind: "note", body: in.Body, notify: notify,
			title: e.Name + ": toplama notu", text: a.FullName + ": " + in.Body})
	})
	if err != nil {
		return err
	}
	return h.write(w, r, http.StatusCreated, row.ID)
}

// ---------------------------------------------------------------- positions

// PilotPositionMsg is the pilot_position payload.
type PilotPositionMsg struct {
	RetrievalID uuid.UUID        `json:"retrieval_id"`
	UserID      uuid.UUID        `json:"user_id"`
	Position    flights.Position `json:"position"`
}

func (h *Handler) pilotPosition(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	row, _, _, err := h.load(r, nil)
	if err != nil {
		return err
	}
	if row.PilotID != a.UserID {
		return httpx.Forbidden("Only the pilot can share their position for this retrieval")
	}
	var in positionIn
	if err := httpx.DecodeJSON(w, r, 4<<10, &in); err != nil {
		return err
	}
	if d := in.validate("", true); len(d) > 0 {
		return httpx.Validation(d)
	}
	if !authz.RetrievalOpen(row.Status) {
		return conflictFor(row.Status)
	}
	if err := h.limit(ctx, ratelimit.Position); err != nil {
		return err
	}
	var pos flights.Position
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		res, err := q.UpdateRetrievalPilotPosition(ctx, dbq.UpdateRetrievalPilotPositionParams{ID: row.ID, PilotID: a.UserID,
			T: &in.T.Time, Lat: in.Lat, Lon: in.Lon, GpsAltM: in.GPSAltM, HAccM: in.HAccM})
		if db.NotFound(err) {
			return httpx.Conflict("The retrieval is closed")
		}
		if err != nil {
			return err
		}
		if err := q.InsertRetrievalPosition(ctx, dbq.InsertRetrievalPositionParams{RetrievalID: row.ID, Seq: res.PpSeq, T: in.T.Time,
			Lat: *in.Lat, Lon: *in.Lon, GpsAltM: in.GPSAltM, HAccM: *in.HAccM}); err != nil {
			return err
		}
		pos = flights.Position{Seq: res.PpSeq, T: *in.T, Lat: *in.Lat, Lon: *in.Lon, GPSAltM: in.GPSAltM, HAccM: *in.HAccM,
			SpeedMS: in.SpeedMS, CourseDeg: in.CourseDeg}
		if res.PpSampleID != nil {
			pos.ID = *res.PpSampleID
		}
		if res.PpReceivedAt != nil {
			pos.ReceivedAt = httpx.T(*res.PpReceivedAt)
		}
		data, _ := json.Marshal(PilotPositionMsg{RetrievalID: row.ID, UserID: a.UserID, Position: pos})
		ev, rid, pilot := row.EventID, row.ID, row.PilotID
		cur, err := q.GetRetrieval(ctx, row.ID)
		if err != nil {
			return err
		}
		return bus.Write(ctx, q, bus.Envelope{Type: bus.TypePilotPosition, EventID: &ev, RetrievalID: &rid, PilotID: &pilot,
			RetrieverID: cur.RetrieverID, Status: cur.Status, Data: data, ServerReceivedMS: time.Now().UnixMilli()})
	})
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"retrieval_id": row.ID, "position": pos})
	return nil
}

// RetrieverPositionMsg is the retriever_position payload.
type RetrieverPositionMsg struct {
	UserID           uuid.UUID     `json:"user_id"`
	FullName         string        `json:"full_name"`
	OnDuty           bool          `json:"on_duty"`
	ActiveRetrievals int           `json:"active_retrievals"`
	Position         *RetrieverFix `json:"position"`
}

// publishRetriever writes a retriever_position envelope with the retriever's current state.
func publishRetriever(ctx context.Context, q *dbq.Queries, eventID, userID uuid.UUID) (RetrieverState, error) {
	rows, err := q.ListRetrieversForEvent(ctx, eventID)
	if err != nil {
		return RetrieverState{}, err
	}
	var st *RetrieverState
	for _, x := range rows {
		if x.UserID == userID {
			s := StateDTO(x, time.Now())
			st = &s
		}
	}
	if st == nil {
		return RetrieverState{}, httpx.Forbidden("Only retrievers of this event can do this")
	}
	pilots, err := q.ActiveRetrievalPilotsForRetriever(ctx, dbq.ActiveRetrievalPilotsForRetrieverParams{EventID: eventID, RetrieverID: &userID})
	if err != nil {
		return RetrieverState{}, err
	}
	data, _ := json.Marshal(RetrieverPositionMsg{UserID: st.UserID, FullName: st.FullName, OnDuty: st.OnDuty,
		ActiveRetrievals: st.ActiveRetrievals, Position: st.Position})
	ev, uid := eventID, userID
	return *st, bus.Write(ctx, q, bus.Envelope{Type: bus.TypeRetrieverPosition, EventID: &ev, UserID: &uid, PilotIDs: pilots,
		Data: data, ServerReceivedMS: time.Now().UnixMilli()})
}

func (h *Handler) retrieverEvent(r *http.Request) (events.Row, error) {
	ctx := r.Context()
	e, acc, err := events.LoadVisible(ctx, h.Q, chi.URLParam(r, "id"), authz.ActorFrom(ctx))
	if err != nil {
		return events.Row{}, err
	}
	if acc.Role != authz.MemberRetriever {
		return events.Row{}, httpx.Forbidden("Only retrievers of this event can do this")
	}
	return e, nil
}

func (h *Handler) retrieverPosition(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, err := h.retrieverEvent(r)
	if err != nil {
		return err
	}
	var in positionIn
	if err := httpx.DecodeJSON(w, r, 4<<10, &in); err != nil {
		return err
	}
	if d := in.validate("", true); len(d) > 0 {
		return httpx.Validation(d)
	}
	if err := h.limit(ctx, ratelimit.Position); err != nil {
		return err
	}
	var st RetrieverState
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		onDuty := false
		if s, err := q.GetRetrieverState(ctx, dbq.GetRetrieverStateParams{EventID: e.ID, UserID: a.UserID}); err == nil {
			onDuty = s.OnDuty
		} else if !db.NotFound(err) {
			return err
		}
		if !onDuty {
			n, err := q.CountActiveRetrievalsForRetriever(ctx, dbq.CountActiveRetrievalsForRetrieverParams{EventID: e.ID, RetrieverID: &a.UserID})
			if err != nil {
				return err
			}
			if n == 0 {
				return httpx.Conflict("Go on duty or accept a retrieval before sharing your position")
			}
		}
		p := dbq.SetRetrieverPositionParams{EventID: e.ID, UserID: a.UserID, Lat: in.Lat, Lon: in.Lon, HAccM: in.HAccM, T: &in.T.Time,
			CourseDeg: in.CourseDeg, SpeedMs: in.SpeedMS}
		if err := q.SetRetrieverPosition(ctx, p); err != nil {
			return err
		}
		if err := q.InsertRetrieverPosition(ctx, dbq.InsertRetrieverPositionParams{EventID: e.ID, UserID: a.UserID, T: in.T.Time,
			Lat: *in.Lat, Lon: *in.Lon, HAccM: *in.HAccM, CourseDeg: in.CourseDeg, SpeedMs: in.SpeedMS}); err != nil {
			return err
		}
		var err error
		st, err = publishRetriever(ctx, q, e.ID, a.UserID)
		return err
	})
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, st)
	return nil
}

func (h *Handler) duty(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, err := h.retrieverEvent(r)
	if err != nil {
		return err
	}
	var in struct {
		OnDuty *bool `json:"on_duty"`
	}
	if err := httpx.DecodeJSON(w, r, 1<<10, &in); err != nil {
		return err
	}
	if in.OnDuty == nil {
		return httpx.Validation(map[string]string{"on_duty": "required"})
	}
	var st RetrieverState
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if err := q.SetRetrieverDuty(ctx, dbq.SetRetrieverDutyParams{EventID: e.ID, UserID: a.UserID, OnDuty: *in.OnDuty}); err != nil {
			return err
		}
		ev := e.ID
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "retriever.duty_changed", TargetType: "user", TargetID: a.UserID.String(),
			EventID: &ev, Details: map[string]any{"on_duty": *in.OnDuty}}); err != nil {
			return err
		}
		var err error
		st, err = publishRetriever(ctx, q, e.ID, a.UserID)
		return err
	})
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, st)
	return nil
}

// TrackPoint is one recorded retriever fix.
type TrackPoint struct {
	T         httpx.Time `json:"t"`
	Lat       float64    `json:"lat"`
	Lon       float64    `json:"lon"`
	HAccM     float64    `json:"h_acc_m"`
	CourseDeg *float64   `json:"course_deg"`
	SpeedMS   *float64   `json:"speed_ms"`
}

const (
	trackDefaultWindow = 3 * time.Hour
	trackMaxWindow     = 24 * time.Hour
	trackMaxRows       = 5000
)

// track serves GET /events/{id}/retrievers/{uid}/track?minutes=N: the
// retriever's recorded positions (oldest first). Organizers, observers and
// admins may read any retriever's track; a retriever only their own.
func (h *Handler) track(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, acc, err := events.LoadVisible(ctx, h.Q, chi.URLParam(r, "id"), a)
	if err != nil {
		return err
	}
	uid, err := uuid.Parse(chi.URLParam(r, "uid"))
	if err != nil {
		return httpx.NotFound("Retriever not found")
	}
	if !a.Authenticated() || !(authz.SeesAllRetrievals(a, acc) || a.Is(uid)) {
		return httpx.Forbidden("Only organizers can see other retrievers' tracks")
	}
	window := trackDefaultWindow
	if m := r.URL.Query().Get("minutes"); m != "" {
		n, err := strconv.Atoi(m)
		if err != nil || n < 1 {
			return httpx.Validation(map[string]string{"minutes": "must be a positive integer"})
		}
		window = min(time.Duration(n)*time.Minute, trackMaxWindow)
	}
	rows, err := h.Q.ListRetrieverTrack(ctx, dbq.ListRetrieverTrackParams{EventID: e.ID, UserID: uid,
		Since: time.Now().Add(-window), MaxRows: trackMaxRows})
	if err != nil {
		return err
	}
	out := make([]TrackPoint, 0, len(rows))
	for _, p := range rows {
		out = append(out, TrackPoint{T: httpx.T(p.T), Lat: p.Lat, Lon: p.Lon, HAccM: p.HAccM, CourseDeg: p.CourseDeg, SpeedMS: p.SpeedMs})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"user_id": uid, "items": out})
	return nil
}
