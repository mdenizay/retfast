package events

import (
	"context"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/mdenizay/retfast/services/api/internal/audit"
	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/notifications"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/realtime/bus"
	"github.com/mdenizay/retfast/services/api/internal/tracking/stats"
)

// Member per the contract. Phone is present for organizers/admins only.
type Member struct {
	UserID      uuid.UUID  `json:"user_id"`
	FullName    string     `json:"full_name"`
	PublicID    *string    `json:"public_id"`
	Role        *string    `json:"role"`
	IsOrganizer bool       `json:"is_organizer"`
	Status      string     `json:"status"`
	JoinedAt    httpx.Time `json:"joined_at"`
	Phone       *string    `json:"phone,omitempty"`
}

// AppUser is the applicant reference.
type AppUser struct {
	UserID   uuid.UUID `json:"user_id"`
	FullName string    `json:"full_name"`
	Email    string    `json:"email"`
	PublicID *string   `json:"public_id"`
}

// Application per the contract.
type Application struct {
	ID           uuid.UUID     `json:"id"`
	EventID      uuid.UUID     `json:"event_id"`
	User         AppUser       `json:"user"`
	Message      string        `json:"message"`
	Status       string        `json:"status"`
	GrantedRole  *string       `json:"granted_role"`
	DecidedBy    *OrganizerRef `json:"decided_by"`
	DecisionNote string        `json:"decision_note"`
	CreatedAt    httpx.Time    `json:"created_at"`
	DecidedAt    *httpx.Time   `json:"decided_at"`
}

func applicationDTO(a dbq.ListApplicationsRow) Application {
	out := Application{ID: a.ID, EventID: a.EventID, User: AppUser{UserID: a.UserID, FullName: a.FullName, Email: a.Email, PublicID: a.PublicID},
		Message: a.Message, Status: a.Status, GrantedRole: a.GrantedRole, DecisionNote: a.DecisionNote,
		CreatedAt: httpx.T(a.CreatedAt), DecidedAt: httpx.TP(a.DecidedAt)}
	if a.DecidedBy != nil {
		out.DecidedBy = &OrganizerRef{UserID: *a.DecidedBy, FullName: a.DecidedByName}
	}
	return out
}

var roleTR = map[string]string{authz.MemberPilot: "pilot", authz.MemberObserver: "gözlemci", authz.MemberRetriever: "toplayıcı"}

// ---------------------------------------------------------------- organizers

func (h *Handler) listOrganizers(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, acc, err := LoadVisible(ctx, h.Q, chi.URLParam(r, "id"), a)
	if err != nil {
		return err
	}
	if !authz.CanViewMembers(a, acc) {
		return httpx.Forbidden("Only event members can see organizers")
	}
	rows, err := h.Q.ListOrganizersForEvents(ctx, []uuid.UUID{e.ID})
	if err != nil {
		return err
	}
	out := []OrganizerRef{}
	for _, o := range rows {
		out = append(out, OrganizerRef{UserID: o.UserID, FullName: o.FullName})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": out})
	return nil
}

// addOrganizerTx assigns an organizer inside a transaction. It reports whether
// the user was newly assigned.
func addOrganizerTx(ctx context.Context, q *dbq.Queries, r *http.Request, eventID, userID, by uuid.UUID) error {
	_, err := addOrganizerTxN(ctx, q, r, eventID, userID, by)
	return err
}

func addOrganizerTxN(ctx context.Context, q *dbq.Queries, r *http.Request, eventID, userID, by uuid.UUID) (bool, error) {
	u, err := q.GetUserByID(ctx, userID)
	if db.NotFound(err) || (err == nil && (u.DeletedAt != nil || u.DisabledAt != nil)) {
		return false, httpx.Validation(map[string]string{"user_id": "unknown user"})
	}
	if err != nil {
		return false, err
	}
	n, err := q.AddOrganizer(ctx, dbq.AddOrganizerParams{EventID: eventID, UserID: userID, AssignedBy: &by})
	if err != nil || n == 0 {
		return false, err
	}
	ev := eventID
	if err := audit.Record(ctx, q, r, audit.Entry{Action: "event.organizer_added", TargetType: "user", TargetID: userID.String(), EventID: &ev}); err != nil {
		return false, err
	}
	if err := notifications.Notify(ctx, q, []uuid.UUID{userID}, notifications.KindEventUpdate, "Organizatör olarak atandınız",
		"Bir etkinliğin organizatörü olarak atandınız.", map[string]any{"event_id": eventID}); err != nil {
		return false, err
	}
	return true, bus.MemberChanged(ctx, q, eventID, userID)
}

func (h *Handler) addOrganizer(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	if !authz.CanManageOrganizers(a) {
		return httpx.Forbidden("Only platform admins can assign organizers")
	}
	e, err := Load(ctx, h.Q, chi.URLParam(r, "id"))
	if db.NotFound(err) {
		return httpx.NotFound("Event not found")
	}
	if err != nil {
		return err
	}
	var in struct {
		UserID uuid.UUID `json:"user_id"`
	}
	if err := httpx.DecodeJSON(w, r, 4<<10, &in); err != nil {
		return err
	}
	if in.UserID == uuid.Nil {
		return httpx.Validation(map[string]string{"user_id": "required"})
	}
	created := false
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		var err error
		created, err = addOrganizerTxN(ctx, dbq.New(tx), r, e.ID, in.UserID, a.UserID)
		return err
	})
	if err != nil {
		return err
	}
	u, err := h.Q.GetUserName(ctx, in.UserID)
	if err != nil {
		return err
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpx.WriteJSON(w, status, OrganizerRef{UserID: u.ID, FullName: u.FullName})
	return nil
}

func (h *Handler) removeOrganizer(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	if !authz.CanManageOrganizers(a) {
		return httpx.Forbidden("Only platform admins can remove organizers")
	}
	e, err := Load(ctx, h.Q, chi.URLParam(r, "id"))
	if db.NotFound(err) {
		return httpx.NotFound("Event not found")
	}
	if err != nil {
		return err
	}
	uid, err := uuid.Parse(chi.URLParam(r, "user_id"))
	if err != nil {
		return httpx.NotFound("")
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		n, err := q.RemoveOrganizer(ctx, dbq.RemoveOrganizerParams{EventID: e.ID, UserID: uid})
		if err != nil {
			return err
		}
		if n == 0 {
			return httpx.NotFound("Not an organizer")
		}
		id := e.ID
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "event.organizer_removed", TargetType: "user", TargetID: uid.String(), EventID: &id}); err != nil {
			return err
		}
		return bus.MemberChanged(ctx, q, e.ID, uid)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---------------------------------------------------------------- applications

func (h *Handler) writeApplication(w http.ResponseWriter, r *http.Request, status int, eventID, appID uuid.UUID) error {
	rows, err := h.Q.ListApplications(r.Context(), dbq.ListApplicationsParams{EventID: eventID, Statuses: []string{}, OnlyID: &appID})
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return httpx.NotFound("")
	}
	httpx.WriteJSON(w, status, applicationDTO(rows[0]))
	return nil
}

func (h *Handler) apply(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, acc, err := LoadVisible(ctx, h.Q, chi.URLParam(r, "id"), a)
	if err != nil {
		return err
	}
	var in struct {
		Message string `json:"message"`
	}
	if err := httpx.DecodeOptionalJSON(w, r, 8<<10, &in); err != nil {
		return err
	}
	in.Message = strings.TrimSpace(in.Message)
	d := map[string]string{}
	if utf8.RuneCountInString(in.Message) > 2000 {
		d["message"] = "too long (max 2000)"
	}
	if len(d) > 0 {
		return httpx.Validation(d)
	}
	switch authz.CanApply(a, Facts(e), acc) {
	case authz.ApplyAllowed:
	case authz.ApplyAlreadyMember:
		return httpx.Conflict("You are already a member of this event")
	case authz.ApplyClosed:
		return httpx.Forbidden("Applications are closed for this event")
	default:
		return httpx.Forbidden("")
	}
	var id uuid.UUID
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		var err error
		id, err = q.CreateApplication(ctx, dbq.CreateApplicationParams{EventID: e.ID, UserID: a.UserID, Message: in.Message})
		if db.IsUniqueViolation(err, "event_applications_pending_uq") {
			return httpx.Conflict("You already have a pending application for this event")
		}
		if err != nil {
			return err
		}
		ev := e.ID
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "event.application_created", TargetType: "application", TargetID: id.String(),
			EventID: &ev}); err != nil {
			return err
		}
		orgs, err := q.ListOrganizerIDs(ctx, e.ID)
		if err != nil {
			return err
		}
		return notifications.Notify(ctx, q, orgs, notifications.KindApplication, e.Name+": yeni başvuru",
			a.FullName+" etkinliğe başvurdu.", map[string]any{"event_id": e.ID, "application_id": id})
	})
	if err != nil {
		return err
	}
	return h.writeApplication(w, r, http.StatusCreated, e.ID, id)
}

func (h *Handler) listApplications(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	e, err := h.loadManaged(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	statuses := []string{}
	if s := r.URL.Query().Get("status"); s != "" {
		for _, st := range strings.Split(s, ",") {
			st = strings.TrimSpace(st)
			switch st {
			case "pending", "approved", "rejected", "withdrawn":
				statuses = append(statuses, st)
			default:
				return httpx.Validation(map[string]string{"status": "unknown status " + st})
			}
		}
	}
	rows, err := h.Q.ListApplications(ctx, dbq.ListApplicationsParams{EventID: e.ID, Statuses: statuses})
	if err != nil {
		return err
	}
	out := make([]Application, 0, len(rows))
	for _, x := range rows {
		out = append(out, applicationDTO(x))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": out})
	return nil
}

// decide runs fn on the locked pending application.
func (h *Handler) decide(w http.ResponseWriter, r *http.Request, e Row, fn func(q *dbq.Queries, app dbq.EventApplication) error) error {
	ctx := r.Context()
	appID, err := uuid.Parse(chi.URLParam(r, "app_id"))
	if err != nil {
		return httpx.NotFound("Application not found")
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		app, err := q.LockApplication(ctx, dbq.LockApplicationParams{ID: appID, EventID: e.ID})
		if db.NotFound(err) {
			return httpx.NotFound("Application not found")
		}
		if err != nil {
			return err
		}
		if app.Status != "pending" {
			return httpx.Conflict("The application is already " + app.Status)
		}
		return fn(q, app)
	})
	if err != nil {
		return err
	}
	return h.writeApplication(w, r, http.StatusOK, e.ID, appID)
}

func (h *Handler) approve(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, err := h.loadManaged(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	var in struct {
		Role string `json:"role"`
		Note string `json:"note"`
	}
	if err := httpx.DecodeJSON(w, r, 8<<10, &in); err != nil {
		return err
	}
	if !authz.MemberRoles[in.Role] {
		return httpx.Validation(map[string]string{"role": "required: pilot, observer or retriever"})
	}
	if utf8.RuneCountInString(in.Note) > 2000 {
		return httpx.Validation(map[string]string{"note": "too long (max 2000)"})
	}
	return h.decide(w, r, e, func(q *dbq.Queries, app dbq.EventApplication) error {
		role := in.Role
		if _, err := q.DecideApplication(ctx, dbq.DecideApplicationParams{ID: app.ID, Status: "approved", GrantedRole: &role,
			DecidedBy: &a.UserID, DecisionNote: strings.TrimSpace(in.Note)}); err != nil {
			return err
		}
		// the membership is created or updated in the same transaction
		if err := q.UpsertMember(ctx, dbq.UpsertMemberParams{EventID: e.ID, UserID: app.UserID, Role: role, AddedBy: &a.UserID}); err != nil {
			return err
		}
		ev := e.ID
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "event.application_approved", TargetType: "application", TargetID: app.ID.String(),
			EventID: &ev, Details: map[string]any{"user_id": app.UserID, "granted_role": role}}); err != nil {
			return err
		}
		body := "Başvurunuz onaylandı. Rolünüz: " + roleTR[role] + "."
		if n := strings.TrimSpace(in.Note); n != "" {
			body += "\n" + n
		}
		if err := notifications.Notify(ctx, q, []uuid.UUID{app.UserID}, notifications.KindApplication, e.Name+": başvuru onaylandı", body,
			map[string]any{"event_id": e.ID, "slug": e.Slug, "application_id": app.ID, "status": "approved", "role": role}); err != nil {
			return err
		}
		return bus.MemberChanged(ctx, q, e.ID, app.UserID)
	})
}

func (h *Handler) reject(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, err := h.loadManaged(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	var in struct {
		Note string `json:"note"`
	}
	if err := httpx.DecodeOptionalJSON(w, r, 8<<10, &in); err != nil {
		return err
	}
	if utf8.RuneCountInString(in.Note) > 2000 {
		return httpx.Validation(map[string]string{"note": "too long (max 2000)"})
	}
	return h.decide(w, r, e, func(q *dbq.Queries, app dbq.EventApplication) error {
		if _, err := q.DecideApplication(ctx, dbq.DecideApplicationParams{ID: app.ID, Status: "rejected", DecidedBy: &a.UserID,
			DecisionNote: strings.TrimSpace(in.Note)}); err != nil {
			return err
		}
		ev := e.ID
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "event.application_rejected", TargetType: "application", TargetID: app.ID.String(),
			EventID: &ev, Details: map[string]any{"user_id": app.UserID}}); err != nil {
			return err
		}
		body := "Başvurunuz reddedildi."
		if n := strings.TrimSpace(in.Note); n != "" {
			body += "\n" + n
		}
		return notifications.Notify(ctx, q, []uuid.UUID{app.UserID}, notifications.KindApplication, e.Name+": başvuru sonucu", body,
			map[string]any{"event_id": e.ID, "slug": e.Slug, "application_id": app.ID, "status": "rejected"})
	})
}

func (h *Handler) withdraw(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, _, err := LoadVisible(ctx, h.Q, chi.URLParam(r, "id"), a)
	if err != nil {
		return err
	}
	appID, err := uuid.Parse(chi.URLParam(r, "app_id"))
	if err != nil {
		return httpx.NotFound("Application not found")
	}
	app, err := h.Q.GetApplication(ctx, dbq.GetApplicationParams{ID: appID, EventID: e.ID})
	if db.NotFound(err) || (err == nil && app.UserID != a.UserID) {
		return httpx.NotFound("Application not found") // others' applications are not disclosed
	}
	if err != nil {
		return err
	}
	return h.decide(w, r, e, func(q *dbq.Queries, app dbq.EventApplication) error {
		if _, err := q.DecideApplication(ctx, dbq.DecideApplicationParams{ID: app.ID, Status: "withdrawn", DecidedBy: &a.UserID}); err != nil {
			return err
		}
		ev := e.ID
		return audit.Record(ctx, q, r, audit.Entry{Action: "event.application_withdrawn", TargetType: "application", TargetID: app.ID.String(), EventID: &ev})
	})
}

// ---------------------------------------------------------------- members

func memberDTO(m dbq.ListMembersRow, withPhone bool) Member {
	out := Member{UserID: m.UserID, FullName: m.FullName, PublicID: m.PublicID, Role: m.Role, IsOrganizer: m.IsOrganizer,
		Status: m.Status, JoinedAt: httpx.T(m.JoinedAt)}
	if withPhone {
		p := m.Phone
		out.Phone = &p
	}
	return out
}

func (h *Handler) members(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, acc, err := LoadVisible(ctx, h.Q, chi.URLParam(r, "id"), a)
	if err != nil {
		return err
	}
	if !authz.CanViewMembers(a, acc) {
		return httpx.Forbidden("Only event members can see the member list")
	}
	role := r.URL.Query().Get("role")
	if role != "" && !authz.MemberRoles[role] {
		return httpx.Validation(map[string]string{"role": "must be pilot, observer or retriever"})
	}
	manage := authz.CanSeeMemberPhones(a, acc)
	rows, err := h.Q.ListMembers(ctx, dbq.ListMembersParams{EventID: e.ID, IncludeRemoved: manage, Role: role})
	if err != nil {
		return err
	}
	out := make([]Member, 0, len(rows))
	revealed := []uuid.UUID{}
	for _, m := range rows {
		out = append(out, memberDTO(m, manage))
		if manage && m.Phone != "" {
			revealed = append(revealed, m.UserID)
		}
	}
	ev := e.ID
	if err := audit.PhoneReveal(ctx, h.Q, r, &ev, "event_members", revealed); err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": out})
	return nil
}

func (h *Handler) writeMember(w http.ResponseWriter, r *http.Request, eventID, userID uuid.UUID, status int) error {
	rows, err := h.Q.ListMembers(r.Context(), dbq.ListMembersParams{EventID: eventID, IncludeRemoved: true})
	if err != nil {
		return err
	}
	for _, m := range rows {
		if m.UserID == userID {
			ev := eventID
			if m.Phone != "" {
				if err := audit.PhoneReveal(r.Context(), h.Q, r, &ev, "event_member", []uuid.UUID{userID}); err != nil {
					return err
				}
			}
			httpx.WriteJSON(w, status, memberDTO(m, true))
			return nil
		}
	}
	return httpx.NotFound("")
}

func (h *Handler) addMember(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, err := h.loadManaged(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	var in struct {
		UserID uuid.UUID `json:"user_id"`
		Role   string    `json:"role"`
	}
	if err := httpx.DecodeJSON(w, r, 4<<10, &in); err != nil {
		return err
	}
	if !authz.MemberRoles[in.Role] {
		return httpx.Validation(map[string]string{"role": "must be pilot, observer or retriever"})
	}
	u, err := h.Q.GetUserByID(ctx, in.UserID)
	if db.NotFound(err) || (err == nil && (u.DeletedAt != nil || u.DisabledAt != nil)) {
		return httpx.Validation(map[string]string{"user_id": "unknown user"})
	}
	if err != nil {
		return err
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if err := q.UpsertMember(ctx, dbq.UpsertMemberParams{EventID: e.ID, UserID: in.UserID, Role: in.Role, AddedBy: &a.UserID}); err != nil {
			return err
		}
		role := in.Role
		if _, err := q.ApprovePendingApplicationsForUser(ctx, dbq.ApprovePendingApplicationsForUserParams{EventID: e.ID, UserID: in.UserID,
			GrantedRole: &role, DecidedBy: &a.UserID}); err != nil {
			return err
		}
		ev := e.ID
		if err := notifications.Notify(ctx, q, []uuid.UUID{in.UserID}, notifications.KindEventUpdate, e.Name,
			"Etkinliğe eklendiniz. Rolünüz: "+roleTR[in.Role]+".", map[string]any{"event_id": e.ID, "slug": e.Slug, "role": in.Role}); err != nil {
			return err
		}
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "event.member_added", TargetType: "user", TargetID: in.UserID.String(),
			EventID: &ev, Details: map[string]any{"role": in.Role}}); err != nil {
			return err
		}
		return bus.MemberChanged(ctx, q, e.ID, in.UserID)
	})
	if err != nil {
		return err
	}
	return h.writeMember(w, r, e.ID, in.UserID, http.StatusCreated)
}

func (h *Handler) patchMember(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, err := h.loadManaged(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	uid, err := uuid.Parse(chi.URLParam(r, "user_id"))
	if err != nil {
		return httpx.NotFound("")
	}
	var in struct {
		Role string `json:"role"`
	}
	if err := httpx.DecodeJSON(w, r, 4<<10, &in); err != nil {
		return err
	}
	if !authz.MemberRoles[in.Role] {
		return httpx.Validation(map[string]string{"role": "must be pilot, observer or retriever"})
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		cur, err := q.GetMember(ctx, dbq.GetMemberParams{EventID: e.ID, UserID: uid})
		if db.NotFound(err) {
			return httpx.NotFound("Not a member")
		}
		if err != nil {
			return err
		}
		if err := q.UpsertMember(ctx, dbq.UpsertMemberParams{EventID: e.ID, UserID: uid, Role: in.Role, AddedBy: &a.UserID}); err != nil {
			return err
		}
		ev := e.ID
		if cur.Role != in.Role || cur.Status != "active" {
			if err := notifications.Notify(ctx, q, []uuid.UUID{uid}, notifications.KindEventUpdate, e.Name,
				"Etkinlikteki rolünüz güncellendi: "+roleTR[in.Role]+".", map[string]any{"event_id": e.ID, "slug": e.Slug, "role": in.Role}); err != nil {
				return err
			}
		}
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "event.member_role_changed", TargetType: "user", TargetID: uid.String(),
			EventID: &ev, Details: map[string]any{"from": cur.Role, "to": in.Role, "previous_status": cur.Status}}); err != nil {
			return err
		}
		return bus.MemberChanged(ctx, q, e.ID, uid)
	})
	if err != nil {
		return err
	}
	return h.writeMember(w, r, e.ID, uid, http.StatusOK)
}

func (h *Handler) removeMember(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	e, err := h.loadManaged(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	uid, err := uuid.Parse(chi.URLParam(r, "user_id"))
	if err != nil {
		return httpx.NotFound("")
	}
	if err := h.removeMembership(r, e, uid, "event.member_removed"); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handler) removeMembership(r *http.Request, e Row, uid uuid.UUID, action string) error {
	ctx := r.Context()
	return pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		n, err := q.RemoveMember(ctx, dbq.RemoveMemberParams{EventID: e.ID, UserID: uid})
		if err != nil {
			return err
		}
		if n == 0 {
			return httpx.NotFound("Not a member")
		}
		ev := e.ID
		if err := audit.Record(ctx, q, r, audit.Entry{Action: action, TargetType: "user", TargetID: uid.String(), EventID: &ev}); err != nil {
			return err
		}
		return bus.MemberChanged(ctx, q, e.ID, uid)
	})
}

func (h *Handler) leave(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	e, acc, err := LoadVisible(ctx, h.Q, chi.URLParam(r, "id"), a)
	if err != nil {
		return err
	}
	if acc.Role == "" {
		return httpx.NotFound("Not a member of this event")
	}
	if err := h.removeMembership(r, e, a.UserID, "event.left"); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---------------------------------------------------------------- report

func (h *Handler) report(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	e, err := h.loadManaged(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	mem, err := h.Q.EventReportMembers(ctx, e.ID)
	if err != nil {
		return err
	}
	orgs, err := h.Q.CountOrganizers(ctx, e.ID)
	if err != nil {
		return err
	}
	pending, err := h.Q.CountPendingApplications(ctx, e.ID)
	if err != nil {
		return err
	}
	fl, err := h.Q.EventReportFlights(ctx, &e.ID)
	if err != nil {
		return err
	}
	ret, err := h.Q.EventReportRetrievals(ctx, e.ID)
	if err != nil {
		return err
	}
	type flightLine struct {
		FlightID       uuid.UUID `json:"flight_id"`
		PilotID        uuid.UUID `json:"pilot_id"`
		PilotName      string    `json:"pilot_name"`
		Status         string    `json:"status"`
		IsSimulated    bool      `json:"is_simulated"`
		DurationS      float64   `json:"duration_s"`
		SampleCount    int32     `json:"sample_count"`
		ExpectedCount  int64     `json:"expected_sample_count"`
		Completeness   *float64  `json:"telemetry_completeness"`
		Interruptions  int32     `json:"interruptions"`
		DistanceM      float64   `json:"distance_m"`
		MaxGPSAltitude *float64  `json:"max_gps_alt_m"`
	}
	lines := []flightLine{}
	pilots := map[uuid.UUID]bool{}
	var totalDur float64
	var totalSamples, totalExpected, totalGaps int64
	byStatus := map[string]int{}
	for _, f := range fl {
		end := time.Now()
		if f.EndedAt != nil {
			end = *f.EndedAt
		} else if f.LastSampleT != nil {
			end = *f.LastSampleT
		}
		dur := max(end.Sub(f.StartedAt).Seconds(), 0)
		exp := stats.ExpectedSamples(f.FirstSampleT, f.LastSampleT)
		var comp *float64
		if exp > 0 {
			c := min(float64(f.SampleCount)/float64(exp), 1)
			comp = &c
		}
		lines = append(lines, flightLine{FlightID: f.ID, PilotID: f.PilotID, PilotName: f.FullName, Status: f.Status, IsSimulated: f.IsSimulated,
			DurationS: dur, SampleCount: f.SampleCount, ExpectedCount: exp, Completeness: comp, Interruptions: f.GapCount,
			DistanceM: f.DistanceM, MaxGPSAltitude: f.MaxGpsAltM})
		pilots[f.PilotID] = true
		totalDur += dur
		totalSamples += int64(f.SampleCount)
		totalExpected += exp
		totalGaps += int64(f.GapCount)
		byStatus[f.Status]++
	}
	var completeness *float64
	if totalExpected > 0 {
		c := min(float64(totalSamples)/float64(totalExpected), 1)
		completeness = &c
	}
	avg := 0.0
	if len(fl) > 0 {
		avg = totalDur / float64(len(fl))
	}
	median := func(v float64) *float64 {
		if v < 0 {
			return nil
		}
		return &v
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"event_id": e.ID, "generated_at": httpx.T(time.Now()),
		"members": map[string]any{"pilots": mem.Pilots, "observers": mem.Observers, "retrievers": mem.Retrievers,
			"organizers": orgs, "removed": mem.Removed, "pending_applications": pending, "pilots_flown": len(pilots)},
		"flights": map[string]any{"count": len(fl), "by_status": byStatus, "total_duration_s": totalDur, "avg_duration_s": avg},
		"telemetry": map[string]any{"samples": totalSamples, "expected_samples": totalExpected, "completeness": completeness,
			"interruptions": totalGaps, "note": "expected samples assume a 1 Hz target between first and last sample"},
		"retrievals": map[string]any{"count": ret.Total, "simulated": ret.Simulated,
			"by_status": map[string]int32{"requested": ret.Requested, "accepted": ret.Accepted, "picked_up": ret.PickedUp,
				"delivered": ret.Delivered, "cancelled": ret.Cancelled},
			"median_request_to_accept_s":  median(ret.MedianRequestToAcceptS),
			"median_accept_to_pickup_s":   median(ret.MedianAcceptToPickupS),
			"median_pickup_to_delivery_s": median(ret.MedianPickupToDeliveryS)},
		"items": lines,
	})
	return nil
}
