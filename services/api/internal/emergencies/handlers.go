package emergencies

import (
	"context"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/audit"
	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/flights"
	"github.com/mdenizay/retfast/services/api/internal/notifications"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/ratelimit"
)

// Handler serves /incidents and /rescue.
type Handler struct {
	Pool    *pgxpool.Pool
	Q       *dbq.Queries
	Limiter *ratelimit.Limiter
}

// Routes mounts all endpoints (required auth).
func (h *Handler) Routes(r chi.Router) {
	r.Post("/incidents", httpx.H(h.create))
	r.Get("/incidents", httpx.H(h.list))
	r.Get("/incidents/{id}", httpx.H(h.get))
	r.Post("/incidents/{id}/cancel", httpx.H(h.cancel))
	r.Post("/incidents/{id}/acknowledge", httpx.H(h.acknowledge))
	r.Post("/incidents/{id}/status", httpx.H(h.setStatus))
	r.Post("/incidents/{id}/notes", httpx.H(h.note))
	r.Post("/incidents/{id}/assignments", httpx.H(h.assign))
	r.Get("/rescue/assignments", httpx.H(h.myAssignments))
	r.Post("/rescue/assignments/{id}/status", httpx.H(h.assignmentStatus))
	r.Put("/rescue/me/status", httpx.H(h.availability))
	r.Post("/rescue/me/position", httpx.H(h.position))
	r.Get("/rescue/team", httpx.H(h.team))
}

func auditContactAccess(ctx context.Context, q *dbq.Queries, r *http.Request, actor *uuid.UUID, action, incidentID string, n int) error {
	return audit.Record(ctx, q, r, audit.Entry{ActorID: actor, Action: action, TargetType: "incident", TargetID: incidentID,
		Details: map[string]any{"incidents": n, "fields": "emergency_contact_name,emergency_contact_phone,blood_type,position"}})
}

// responders returns everyone who should be alerted for an incident.
func responders(ctx context.Context, q *dbq.Queries, eventID *uuid.UUID) ([]uuid.UUID, error) {
	ids, err := q.ListGlobalResponderIDs(ctx)
	if err != nil {
		return nil, err
	}
	if eventID != nil {
		orgs, err := q.ListEventOrganizerIDs(ctx, *eventID)
		if err != nil {
			return nil, err
		}
		ids = append(ids, orgs...)
	}
	return ids, nil
}

type positionIn struct {
	Lat     *float64    `json:"lat"`
	Lon     *float64    `json:"lon"`
	GPSAltM *float64    `json:"gps_alt_m"`
	HAccM   *float64    `json:"h_acc_m"`
	T       *httpx.Time `json:"t"`
}

func (p *positionIn) validate(d map[string]string) {
	if p == nil {
		return
	}
	if p.Lat == nil || p.Lon == nil || *p.Lat < -90 || *p.Lat > 90 || *p.Lon < -180 || *p.Lon > 180 {
		d["position"] = "lat/lon required in WGS84"
	}
	if p.HAccM != nil && (*p.HAccM <= 0 || *p.HAccM > 10000) {
		d["position.h_acc_m"] = "must be in (0, 10000]"
	}
	if p.T == nil {
		d["position.t"] = "required"
	}
}

func (h *Handler) loadIncident(ctx context.Context, idStr string) (dbq.EmergencyIncident, string, error) {
	id, err := uuid.Parse(idStr)
	if err != nil {
		return dbq.EmergencyIncident{}, "", httpx.NotFound("Incident not found")
	}
	r, err := h.Q.GetIncident(ctx, id)
	if db.NotFound(err) {
		return r, "", httpx.NotFound("Incident not found")
	}
	if err != nil {
		return r, "", err
	}
	a := authz.ActorFrom(ctx)
	member, err := eventMember(ctx, h.Q, r, a)
	if err != nil {
		return r, "", err
	}
	if !authz.CanViewIncident(a, r.PilotID, member) {
		return r, "", httpx.NotFound("Incident not found")
	}
	return r, member, nil
}

func (h *Handler) writeIncident(w http.ResponseWriter, r *http.Request, status int, id uuid.UUID, auditAccess bool) error {
	ctx := r.Context()
	row, err := h.Q.GetIncident(ctx, id)
	if err != nil {
		return err
	}
	a := authz.ActorFrom(ctx)
	member, err := eventMember(ctx, h.Q, row, a)
	if err != nil {
		return err
	}
	items, err := Build(ctx, h.Q, []dbq.EmergencyIncident{row}, func(x dbq.EmergencyIncident) bool {
		return authz.CanSeeEmergencyContact(a, x.PilotID, member)
	})
	if err != nil {
		return err
	}
	if auditAccess && !a.Is(row.PilotID) {
		uid := a.UserID
		if err := auditContactAccess(ctx, h.Q, r, &uid, "incident.contact_viewed", id.String(), 1); err != nil {
			return err
		}
	}
	httpx.WriteJSON(w, status, items[0])
	return nil
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	if ok, retry := h.Limiter.Allow(ctx, ratelimit.Incident, a.UserID.String()); !ok {
		return httpx.RateLimited(retry)
	}
	var in struct {
		ID              uuid.UUID   `json:"id"`
		Kind            string      `json:"kind"`
		IsTest          bool        `json:"is_test"`
		FlightID        *uuid.UUID  `json:"flight_id"`
		Position        *positionIn `json:"position"`
		Message         string      `json:"message"`
		CreatedAtDevice *httpx.Time `json:"created_at_device"`
	}
	if err := httpx.DecodeJSON(w, r, 16<<10, &in); err != nil {
		return err
	}
	d := map[string]string{}
	if in.ID == uuid.Nil {
		d["id"] = "required (client-generated UUID)"
	}
	if in.Kind == "" {
		in.Kind = "sos"
	}
	if in.Kind != "sos" {
		d["kind"] = "must be sos"
	}
	if in.CreatedAtDevice == nil {
		d["created_at_device"] = "required"
	}
	in.Message = strings.TrimSpace(in.Message)
	if utf8.RuneCountInString(in.Message) > 2000 {
		d["message"] = "too long"
	}
	in.Position.validate(d)
	if len(d) > 0 {
		return httpx.Validation(d)
	}
	if existing, err := h.Q.GetIncident(ctx, in.ID); err == nil {
		if existing.PilotID != a.UserID {
			return httpx.Conflict("Incident id already in use")
		}
		// Idempotent re-send; a newer position updates the incident.
		if in.Position != nil && !Terminal(existing.Status) && (existing.PositionT == nil || in.Position.T.After(*existing.PositionT)) {
			err := pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
				q := dbq.New(tx)
				if err := q.UpdateIncidentPosition(ctx, dbq.UpdateIncidentPositionParams{ID: in.ID, Lat: in.Position.Lat, Lon: in.Position.Lon,
					GpsAltM: in.Position.GPSAltM, HAccM: in.Position.HAccM, PositionT: &in.Position.T.Time}); err != nil {
					return err
				}
				uid := a.UserID
				if err := q.InsertIncidentUpdate(ctx, dbq.InsertIncidentUpdateParams{IncidentID: in.ID, Kind: "position", ActorID: &uid}); err != nil {
					return err
				}
				return Publish(ctx, q, in.ID)
			})
			if err != nil {
				return err
			}
		}
		return h.writeIncident(w, r, http.StatusOK, in.ID, false)
	} else if !db.NotFound(err) {
		return err
	}
	var eventID *uuid.UUID
	if in.FlightID != nil {
		f, err := h.Q.GetFlight(ctx, *in.FlightID)
		if db.NotFound(err) || (err == nil && f.FlightSession.PilotID != a.UserID) {
			return httpx.Validation(map[string]string{"flight_id": "unknown flight"})
		}
		if err != nil {
			return err
		}
		eventID = f.FlightSession.EventID
	}
	if in.IsTest {
		ok := false
		if eventID != nil {
			if e, err := h.Q.GetEventByID(ctx, *eventID); err == nil && e.EmergencyTesting {
				ok = true
			}
		}
		if !ok {
			return httpx.Validation(map[string]string{"is_test": "test incidents are only allowed in events with emergency_testing enabled"})
		}
	}
	created := false
	err := pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		p := dbq.InsertIncidentParams{ID: in.ID, Kind: in.Kind, IsTest: in.IsTest, PilotID: a.UserID, FlightID: in.FlightID, EventID: eventID,
			Message: in.Message, CreatedAtDevice: in.CreatedAtDevice.Time}
		if in.Position != nil {
			t := in.Position.T.Time
			p.Lat, p.Lon, p.GpsAltM, p.HAccM, p.PositionT = in.Position.Lat, in.Position.Lon, in.Position.GPSAltM, in.Position.HAccM, &t
		}
		if _, err := q.InsertIncident(ctx, p); db.NotFound(err) {
			return nil // concurrent duplicate
		} else if err != nil {
			return err
		}
		created = true
		uid := a.UserID
		if err := q.InsertIncidentUpdate(ctx, dbq.InsertIncidentUpdateParams{IncidentID: in.ID, Kind: "created", ActorID: &uid, Status: StatusOpen}); err != nil {
			return err
		}
		ids, err := responders(ctx, q, eventID)
		if err != nil {
			return err
		}
		title := "ACİL DURUM: SOS"
		if in.IsTest {
			title = "TEST: SOS tatbikatı"
		}
		if err := notifications.Notify(ctx, q, ids, notifications.KindEmergencyAlert, title, a.FullName+" yardım çağrısı gönderdi.",
			map[string]any{"incident_id": in.ID, "is_test": in.IsTest, "event_id": eventID}); err != nil {
			return err
		}
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "incident.created", TargetType: "incident", TargetID: in.ID.String(), EventID: eventID,
			Details: map[string]any{"is_test": in.IsTest}}); err != nil {
			return err
		}
		if in.FlightID != nil {
			// Organizers may now see this flight even if private; tell subscribers.
			if err := publishFlightFacts(ctx, q, *in.FlightID); err != nil {
				return err
			}
		}
		return Publish(ctx, q, in.ID)
	})
	if err != nil {
		return err
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	return h.writeIncident(w, r, status, in.ID, false)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	qs := r.URL.Query()
	lim, err := httpx.Limit(r, 50, 200)
	if err != nil {
		return err
	}
	evs, err := organizedEvents(ctx, h.Q, a)
	if err != nil {
		return err
	}
	isResponder := a.IsGlobalResponder() || len(evs) > 0
	p := dbq.ListIncidentsParams{Statuses: []string{}, ViewerID: a.UserID, OwnOnly: !isResponder || qs.Get("mine") == "true",
		SeeAll: a.IsGlobalResponder(), Lim: int32(lim + 1)}
	if s := qs.Get("status"); s != "" {
		for _, st := range strings.Split(s, ",") {
			st = strings.TrimSpace(st)
			switch st {
			case StatusOpen, StatusAcknowledged, StatusResponding, StatusResolved, StatusCancelled:
				p.Statuses = append(p.Statuses, st)
			default:
				return httpx.Validation(map[string]string{"status": "unknown status " + st})
			}
		}
	}
	if s := qs.Get("event_id"); s != "" {
		id, err := uuid.Parse(s)
		if err != nil {
			return httpx.Validation(map[string]string{"event_id": "must be a UUID"})
		}
		p.EventID = &id
	}
	var cur struct {
		T  time.Time `json:"t"`
		ID uuid.UUID `json:"id"`
	}
	if ok, err := httpx.DecodeCursor(r, &cur); err != nil {
		return err
	} else if ok {
		p.AfterReceived, p.AfterID = &cur.T, &cur.ID
	}
	rows, err := h.Q.ListIncidents(ctx, p)
	if err != nil {
		return err
	}
	var next *string
	if len(rows) > lim {
		next = httpx.EncodeCursor(map[string]any{"t": rows[lim-1].ReceivedAt, "id": rows[lim-1].ID})
		rows = rows[:lim]
	}
	organized := map[uuid.UUID]bool{}
	for _, e := range evs {
		organized[e] = true
	}
	contact := func(x dbq.EmergencyIncident) bool {
		member := ""
		if x.EventID != nil && organized[*x.EventID] {
			member = authz.MemberOrganizer
		}
		return authz.CanSeeEmergencyContact(a, x.PilotID, member)
	}
	items, err := Build(ctx, h.Q, rows, contact)
	if err != nil {
		return err
	}
	others := 0
	for _, x := range rows {
		if x.PilotID != a.UserID {
			others++
		}
	}
	if others > 0 {
		uid := a.UserID
		if err := auditContactAccess(ctx, h.Q, r, &uid, "incident.contact_listed", "", others); err != nil {
			return err
		}
	}
	httpx.WriteJSON(w, http.StatusOK, httpx.Page[Incident]{Items: items, NextCursor: next})
	return nil
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) error {
	row, _, err := h.loadIncident(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	return h.writeIncident(w, r, http.StatusOK, row.ID, true)
}

func (h *Handler) cancel(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	row, _, err := h.loadIncident(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	if row.PilotID != a.UserID {
		return httpx.Forbidden("Only the pilot who raised the incident can cancel it")
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if err := httpx.DecodeOptionalJSON(w, r, 8<<10, &in); err != nil {
		return err
	}
	if utf8.RuneCountInString(in.Reason) > 1000 {
		return httpx.Validation(map[string]string{"reason": "too long"})
	}
	if row.Status == StatusCancelled {
		return h.writeIncident(w, r, http.StatusOK, row.ID, false)
	}
	err = h.transition(ctx, r, row.ID, StatusCancelled, strings.TrimSpace(in.Reason), "incident.cancelled", func(q *dbq.Queries, cur dbq.EmergencyIncident) error {
		ids, err := responders(ctx, q, cur.EventID)
		if err != nil {
			return err
		}
		return notifications.Notify(ctx, q, ids, notifications.KindEmergencyAlert, "SOS iptal edildi", a.FullName+" yardım çağrısını iptal etti.",
			map[string]any{"incident_id": cur.ID})
	})
	if err != nil {
		return err
	}
	return h.writeIncident(w, r, http.StatusOK, row.ID, false)
}

// transition applies a status change under a row lock, writes the update,
// audit row and outbox message, then runs extra.
func (h *Handler) transition(ctx context.Context, r *http.Request, id uuid.UUID, to, note, action string, extra func(*dbq.Queries, dbq.EmergencyIncident) error) error {
	a := authz.ActorFrom(ctx)
	return pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		cur, err := q.LockIncident(ctx, id)
		if err != nil {
			return err
		}
		if cur.Status == to {
			return nil // idempotent
		}
		if !CanTransition(cur.Status, to) {
			return httpx.Conflict("Cannot change incident from " + cur.Status + " to " + to)
		}
		uid := a.UserID
		if err := q.UpdateIncidentStatus(ctx, dbq.UpdateIncidentStatusParams{ID: id, Status: to, SetAck: to != StatusCancelled,
			ActorID: &uid, CancelReason: note}); err != nil {
			return err
		}
		kind := "status_changed"
		if to == StatusAcknowledged {
			kind = "acknowledged"
		}
		if err := q.InsertIncidentUpdate(ctx, dbq.InsertIncidentUpdateParams{IncidentID: id, Kind: kind, ActorID: &uid, Body: note, Status: to}); err != nil {
			return err
		}
		if err := audit.Record(ctx, q, r, audit.Entry{Action: action, TargetType: "incident", TargetID: id.String(), EventID: cur.EventID,
			Details: map[string]any{"from": cur.Status, "to": to}}); err != nil {
			return err
		}
		if extra != nil {
			if err := extra(q, cur); err != nil {
				return err
			}
		}
		if cur.FlightID != nil && Terminal(to) {
			if err := publishFlightFacts(ctx, q, *cur.FlightID); err != nil {
				return err
			}
		}
		return Publish(ctx, q, id)
	})
}

func (h *Handler) requireResponder(ctx context.Context, idStr string) (dbq.EmergencyIncident, error) {
	row, member, err := h.loadIncident(ctx, idStr)
	if err != nil {
		return row, err
	}
	if !authz.IsIncidentResponder(authz.ActorFrom(ctx), member) {
		return row, httpx.Forbidden("Only responders can do this")
	}
	return row, nil
}

func (h *Handler) acknowledge(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	row, err := h.requireResponder(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	a := authz.ActorFrom(ctx)
	if row.Status == StatusAcknowledged || row.Status == StatusResponding {
		return h.writeIncident(w, r, http.StatusOK, row.ID, true)
	}
	err = h.transition(ctx, r, row.ID, StatusAcknowledged, "", "incident.acknowledged", func(q *dbq.Queries, cur dbq.EmergencyIncident) error {
		return notifications.Notify(ctx, q, []uuid.UUID{cur.PilotID}, notifications.KindRescueAck, "Yardım çağrınız alındı",
			a.FullName+" SOS çağrınızı onayladı.", map[string]any{"incident_id": cur.ID})
	})
	if err != nil {
		return err
	}
	return h.writeIncident(w, r, http.StatusOK, row.ID, true)
}

func (h *Handler) setStatus(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	row, err := h.requireResponder(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	var in struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := httpx.DecodeJSON(w, r, 8<<10, &in); err != nil {
		return err
	}
	if in.Status != StatusResponding && in.Status != StatusResolved {
		return httpx.Validation(map[string]string{"status": "must be responding or resolved"})
	}
	if utf8.RuneCountInString(in.Note) > 4000 {
		return httpx.Validation(map[string]string{"note": "too long"})
	}
	a := authz.ActorFrom(ctx)
	err = h.transition(ctx, r, row.ID, in.Status, strings.TrimSpace(in.Note), "incident.status_"+in.Status, func(q *dbq.Queries, cur dbq.EmergencyIncident) error {
		title := "Ekip yolda"
		if in.Status == StatusResolved {
			title = "Acil durum kapatıldı"
		}
		return notifications.Notify(ctx, q, []uuid.UUID{cur.PilotID}, notifications.KindRescueAck, title, a.FullName+": "+in.Status,
			map[string]any{"incident_id": cur.ID, "status": in.Status})
	})
	if err != nil {
		return err
	}
	return h.writeIncident(w, r, http.StatusOK, row.ID, true)
}

func (h *Handler) note(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	row, err := h.requireResponder(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	var in struct {
		Body string `json:"body"`
	}
	if err := httpx.DecodeJSON(w, r, 8<<10, &in); err != nil {
		return err
	}
	in.Body = strings.TrimSpace(in.Body)
	if in.Body == "" || utf8.RuneCountInString(in.Body) > 4000 {
		return httpx.Validation(map[string]string{"body": "must be 1-4000 characters"})
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		uid := authz.ActorFrom(ctx).UserID
		if err := q.InsertIncidentUpdate(ctx, dbq.InsertIncidentUpdateParams{IncidentID: row.ID, Kind: "note", ActorID: &uid, Body: in.Body}); err != nil {
			return err
		}
		if err := q.TouchIncident(ctx, row.ID); err != nil {
			return err
		}
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "incident.note_added", TargetType: "incident", TargetID: row.ID.String(), EventID: row.EventID}); err != nil {
			return err
		}
		return Publish(ctx, q, row.ID)
	})
	if err != nil {
		return err
	}
	return h.writeIncident(w, r, http.StatusCreated, row.ID, true)
}

func (h *Handler) assign(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	row, err := h.requireResponder(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	if Terminal(row.Status) {
		return httpx.Conflict("Incident is closed")
	}
	var in struct {
		ResponderUserID uuid.UUID `json:"responder_user_id"`
	}
	if err := httpx.DecodeJSON(w, r, 4<<10, &in); err != nil {
		return err
	}
	roles, err := h.Q.GetUserRolesFor(ctx, in.ResponderUserID)
	if err != nil {
		return err
	}
	target := &authz.Actor{UserID: in.ResponderUserID, Roles: roles}
	tMember, err := eventMember(ctx, h.Q, row, target)
	if err != nil {
		return err
	}
	if !authz.IsIncidentResponder(target, tMember) {
		return httpx.Validation(map[string]string{"responder_user_id": "must be a rescue operator, admin or organizer of the event"})
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		uid := authz.ActorFrom(ctx).UserID
		aid, err := q.UpsertAssignment(ctx, dbq.UpsertAssignmentParams{IncidentID: row.ID, ResponderID: in.ResponderUserID, AssignedBy: &uid})
		if err != nil {
			return err
		}
		if err := q.InsertIncidentUpdate(ctx, dbq.InsertIncidentUpdateParams{IncidentID: row.ID, Kind: "assigned", ActorID: &uid,
			Body: in.ResponderUserID.String()}); err != nil {
			return err
		}
		if err := notifications.Notify(ctx, q, []uuid.UUID{in.ResponderUserID}, notifications.KindEmergencyAlert, "Göreve atandınız",
			"Bir SOS olayına atandınız.", map[string]any{"incident_id": row.ID, "assignment_id": aid}); err != nil {
			return err
		}
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "incident.assigned", TargetType: "incident", TargetID: row.ID.String(), EventID: row.EventID,
			Details: map[string]any{"responder_id": in.ResponderUserID, "assignment_id": aid}}); err != nil {
			return err
		}
		return Publish(ctx, q, row.ID)
	})
	if err != nil {
		return err
	}
	return h.writeIncident(w, r, http.StatusCreated, row.ID, true)
}

func (h *Handler) myAssignments(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	if !authz.CanUseRescueConsole(a) {
		return httpx.Forbidden("Rescue operators only")
	}
	rows, err := h.Q.ListAssignmentsForResponder(ctx, a.UserID)
	if err != nil {
		return err
	}
	out := []Assignment{}
	for _, x := range rows {
		out = append(out, assignmentDTO(dbq.ListAssignmentsForIncidentsRow(x)))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": out})
	return nil
}

func (h *Handler) assignmentStatus(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return httpx.NotFound("")
	}
	var in struct {
		Status string `json:"status"`
	}
	if err := httpx.DecodeJSON(w, r, 4<<10, &in); err != nil {
		return err
	}
	if _, ok := assignmentOrder[in.Status]; !ok && in.Status != "withdrawn" {
		return httpx.Validation(map[string]string{"status": "must be en_route, on_scene, completed or withdrawn"})
	}
	var incidentID uuid.UUID
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		as, err := q.LockAssignment(ctx, id)
		if db.NotFound(err) {
			return httpx.NotFound("")
		}
		if err != nil {
			return err
		}
		if as.ResponderID != a.UserID {
			return httpx.Forbidden("Only the assignee can update this assignment")
		}
		incidentID = as.IncidentID
		if as.Status == in.Status {
			return nil
		}
		if !CanTransitionAssignment(as.Status, in.Status) {
			return httpx.Conflict("Cannot change assignment from " + as.Status + " to " + in.Status)
		}
		if err := q.UpdateAssignmentStatus(ctx, dbq.UpdateAssignmentStatusParams{ID: id, Status: in.Status}); err != nil {
			return err
		}
		uid := a.UserID
		if err := q.InsertIncidentUpdate(ctx, dbq.InsertIncidentUpdateParams{IncidentID: as.IncidentID, Kind: "assignment_status", ActorID: &uid, Status: in.Status}); err != nil {
			return err
		}
		inc, err := q.GetIncident(ctx, as.IncidentID)
		if err != nil {
			return err
		}
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "rescue.assignment_status", TargetType: "assignment", TargetID: id.String(), EventID: inc.EventID,
			Details: map[string]any{"from": as.Status, "to": in.Status, "incident_id": as.IncidentID}}); err != nil {
			return err
		}
		return Publish(ctx, q, as.IncidentID)
	})
	if err != nil {
		return err
	}
	rows, err := h.Q.ListAssignmentsForIncidents(ctx, []uuid.UUID{incidentID})
	if err != nil {
		return err
	}
	for _, x := range rows {
		if x.ID == id {
			httpx.WriteJSON(w, http.StatusOK, assignmentDTO(x))
			return nil
		}
	}
	return httpx.NotFound("")
}

func (h *Handler) availability(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	if !authz.CanUseRescueConsole(a) {
		return httpx.Forbidden("Rescue operators only")
	}
	var in struct {
		Availability string `json:"availability"`
	}
	if err := httpx.DecodeJSON(w, r, 4<<10, &in); err != nil {
		return err
	}
	if in.Availability != "available" && in.Availability != "unavailable" {
		return httpx.Validation(map[string]string{"availability": "must be available or unavailable"})
	}
	err := pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if err := q.UpsertResponderAvailability(ctx, dbq.UpsertResponderAvailabilityParams{UserID: a.UserID, Availability: in.Availability}); err != nil {
			return err
		}
		return audit.Record(ctx, q, r, audit.Entry{Action: "rescue.availability", TargetType: "user", TargetID: a.UserID.String(),
			Details: map[string]any{"availability": in.Availability}})
	})
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"availability": in.Availability})
	return nil
}

func (h *Handler) position(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	if !authz.CanUseRescueConsole(a) {
		return httpx.Forbidden("Rescue operators only")
	}
	var in positionIn
	if err := httpx.DecodeJSON(w, r, 4<<10, &in); err != nil {
		return err
	}
	d := map[string]string{}
	in.validate(d)
	if in.HAccM == nil {
		d["h_acc_m"] = "required"
	}
	if len(d) > 0 {
		return httpx.Validation(d)
	}
	err := pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		t := in.T.Time
		if err := q.UpsertResponderPosition(ctx, dbq.UpsertResponderPositionParams{UserID: a.UserID, Lat: in.Lat, Lon: in.Lon, HAccM: in.HAccM, T: &t}); err != nil {
			return err
		}
		// Audited without coordinates.
		return audit.Record(ctx, q, r, audit.Entry{Action: "rescue.position_updated", TargetType: "user", TargetID: a.UserID.String()})
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handler) team(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	evs, err := organizedEvents(ctx, h.Q, a)
	if err != nil {
		return err
	}
	if !a.IsGlobalResponder() && len(evs) == 0 {
		return httpx.Forbidden("Responders only")
	}
	rows, err := h.Q.ListRescueTeam(ctx)
	if err != nil {
		return err
	}
	type member struct {
		UserID           uuid.UUID  `json:"user_id"`
		FullName         string     `json:"full_name"`
		Availability     string     `json:"availability"`
		LastPosition     *LatLonT   `json:"last_position"`
		ActiveAssignment *uuid.UUID `json:"active_assignment"`
	}
	out := []member{}
	for _, x := range rows {
		m := member{UserID: x.UserID, FullName: x.FullName, Availability: x.Availability}
		if x.LastLat != nil && x.LastLon != nil && x.LastT != nil {
			m.LastPosition = &LatLonT{*x.LastLat, *x.LastLon, httpx.T(*x.LastT)}
		}
		if x.ActiveAssignmentID != uuid.Nil {
			id := x.ActiveAssignmentID
			m.ActiveAssignment = &id
		}
		out = append(out, m)
	}
	_ = audit.Record(ctx, h.Q, r, audit.Entry{Action: "rescue.team_viewed", TargetType: "rescue_team", Details: map[string]any{"members": len(out)}})
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": out})
	return nil
}

// publishFlightFacts re-publishes a flight so subscribers re-evaluate
// visibility when an incident opens or closes on it.
func publishFlightFacts(ctx context.Context, q *dbq.Queries, flightID uuid.UUID) error {
	return flights.PublishFlight(ctx, q, flightID)
}
