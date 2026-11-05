// Package admin serves /admin (platform_admin only).
package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/audit"
	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/redisx"
)

// Resetter starts a password reset (auth.Service).
type Resetter interface {
	StartPasswordReset(ctx context.Context, q *dbq.Queries, u dbq.User) error
	Invalidate(userID uuid.UUID)
}

// Handler serves /admin.
type Handler struct {
	Pool   *pgxpool.Pool
	Q      *dbq.Queries
	Redis  *redisx.Client
	Auth   Resetter
	Status func(ctx context.Context) map[string]string
}

// Routes mounts endpoints behind RequireAdmin.
func (h *Handler) Routes(r chi.Router) {
	r.Use(requireAdmin)
	r.Get("/admin/users", httpx.H(h.users))
	r.Patch("/admin/users/{id}", httpx.H(h.patchUser))
	r.Post("/admin/users/{id}/reset-password", httpx.H(h.resetPassword))
	r.Get("/admin/audit", httpx.H(h.audit))
	r.Get("/admin/stats", httpx.H(h.stats))
}

func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !authz.ActorFrom(r.Context()).IsAdmin() {
			httpx.WriteError(w, r, httpx.Forbidden("Platform admins only"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// AdminUser is the admin list representation.
type AdminUser struct {
	ID                 uuid.UUID   `json:"id"`
	Email              string      `json:"email"`
	FullName           string      `json:"full_name"`
	PublicID           *string     `json:"public_id"`
	Roles              []string    `json:"roles"`
	IsPlatformAdmin    bool        `json:"is_platform_admin"`
	EmailVerified      bool        `json:"email_verified"`
	MustChangePassword bool        `json:"must_change_password"`
	Disabled           bool        `json:"disabled"`
	CreatedAt          httpx.Time  `json:"created_at"`
	DisabledAt         *httpx.Time `json:"disabled_at"`
}

func (h *Handler) users(w http.ResponseWriter, r *http.Request) error {
	lim, err := httpx.Limit(r, 50, 200)
	if err != nil {
		return err
	}
	p := dbq.SearchUsersParams{Q: strings.TrimSpace(r.URL.Query().Get("q")), Lim: int32(lim + 1)}
	var cur struct {
		N  string    `json:"n"`
		ID uuid.UUID `json:"id"`
	}
	if ok, err := httpx.DecodeCursor(r, &cur); err != nil {
		return err
	} else if ok {
		p.AfterName, p.AfterID = &cur.N, &cur.ID
	}
	rows, err := h.Q.SearchUsers(r.Context(), p)
	if err != nil {
		return err
	}
	out := httpx.Page[AdminUser]{Items: []AdminUser{}}
	for i, u := range rows {
		if i == lim {
			out.NextCursor = httpx.EncodeCursor(map[string]any{"n": rows[lim-1].FullName, "id": rows[lim-1].ID})
			break
		}
		out.Items = append(out.Items, AdminUser{ID: u.ID, Email: u.Email, FullName: u.FullName, PublicID: u.PublicID, Roles: u.Roles,
			IsPlatformAdmin: slices.Contains(u.Roles, authz.RolePlatformAdmin),
			EmailVerified:   u.EmailVerifiedAt != nil, MustChangePassword: u.MustChangePassword, Disabled: u.DisabledAt != nil,
			CreatedAt: httpx.T(u.CreatedAt), DisabledAt: httpx.TP(u.DisabledAt)})
	}
	httpx.WriteJSON(w, http.StatusOK, out)
	return nil
}

func (h *Handler) loadUser(r *http.Request) (dbq.User, error) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return dbq.User{}, httpx.NotFound("")
	}
	u, err := h.Q.GetUserByID(r.Context(), id)
	if db.NotFound(err) || (err == nil && u.DeletedAt != nil) {
		return u, httpx.NotFound("User not found")
	}
	return u, err
}

func (h *Handler) patchUser(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	u, err := h.loadUser(r)
	if err != nil {
		return err
	}
	var in struct {
		IsPlatformAdmin *bool `json:"is_platform_admin"`
		Disabled        *bool `json:"disabled"`
	}
	if err := httpx.DecodeJSON(w, r, 4<<10, &in); err != nil {
		return err
	}
	if in.IsPlatformAdmin != nil && !*in.IsPlatformAdmin && u.ID == a.UserID {
		return httpx.Validation(map[string]string{"is_platform_admin": "you cannot remove your own platform_admin role"})
	}
	if in.Disabled != nil && *in.Disabled && u.ID == a.UserID {
		return httpx.Validation(map[string]string{"disabled": "you cannot disable yourself"})
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		details := map[string]any{}
		if in.IsPlatformAdmin != nil {
			before, err := q.ListUserRoles(ctx, u.ID)
			if err != nil {
				return err
			}
			if *in.IsPlatformAdmin {
				err = q.AddUserRole(ctx, dbq.AddUserRoleParams{UserID: u.ID, Role: authz.RolePlatformAdmin, GrantedBy: &a.UserID})
			} else {
				err = q.RemoveUserRole(ctx, dbq.RemoveUserRoleParams{UserID: u.ID, Role: authz.RolePlatformAdmin})
			}
			if err != nil {
				return err
			}
			details["was_platform_admin"] = slices.Contains(before, authz.RolePlatformAdmin)
			details["is_platform_admin"] = *in.IsPlatformAdmin
		}
		if in.Disabled != nil {
			if err := q.SetUserDisabled(ctx, dbq.SetUserDisabledParams{ID: u.ID, Disabled: *in.Disabled}); err != nil {
				return err
			}
			if *in.Disabled {
				if err := q.RevokeAllUserSessions(ctx, dbq.RevokeAllUserSessionsParams{UserID: u.ID, Reason: "disabled_by_admin"}); err != nil {
					return err
				}
			}
			details["disabled"] = *in.Disabled
		}
		return audit.Record(ctx, q, r, audit.Entry{Action: "admin.user_updated", TargetType: "user", TargetID: u.ID.String(), Details: details})
	})
	if err != nil {
		return err
	}
	h.Auth.Invalidate(u.ID)
	rows, err := h.Q.SearchUsers(ctx, dbq.SearchUsersParams{Q: u.Email, Lim: 5})
	if err != nil {
		return err
	}
	for _, x := range rows {
		if x.ID == u.ID {
			httpx.WriteJSON(w, http.StatusOK, AdminUser{ID: x.ID, Email: x.Email, FullName: x.FullName, PublicID: x.PublicID, Roles: x.Roles,
				IsPlatformAdmin: slices.Contains(x.Roles, authz.RolePlatformAdmin),
				EmailVerified:   x.EmailVerifiedAt != nil, MustChangePassword: x.MustChangePassword, Disabled: x.DisabledAt != nil,
				CreatedAt: httpx.T(x.CreatedAt), DisabledAt: httpx.TP(x.DisabledAt)})
			return nil
		}
	}
	return httpx.NotFound("")
}

func (h *Handler) resetPassword(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	u, err := h.loadUser(r)
	if err != nil {
		return err
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if err := h.Auth.StartPasswordReset(ctx, q, u); err != nil {
			return err
		}
		return audit.Record(ctx, q, r, audit.Entry{Action: "admin.password_reset_sent", TargetType: "user", TargetID: u.ID.String()})
	})
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
	return nil
}

func (h *Handler) audit(w http.ResponseWriter, r *http.Request) error {
	qs := r.URL.Query()
	lim, err := httpx.Limit(r, 100, 500)
	if err != nil {
		return err
	}
	p := dbq.ListAuditParams{Action: qs.Get("action"), Lim: int32(lim + 1)}
	if s := qs.Get("actor_id"); s != "" {
		id, err := uuid.Parse(s)
		if err != nil {
			return httpx.Validation(map[string]string{"actor_id": "must be a UUID"})
		}
		p.ActorID = &id
	}
	var cur struct {
		ID int64 `json:"id"`
	}
	if ok, err := httpx.DecodeCursor(r, &cur); err != nil {
		return err
	} else if ok {
		p.BeforeID = &cur.ID
	}
	rows, err := h.Q.ListAudit(r.Context(), p)
	if err != nil {
		return err
	}
	type entry struct {
		ID         string          `json:"id"`
		Actor      *map[string]any `json:"actor"`
		Action     string          `json:"action"`
		TargetType string          `json:"target_type"`
		TargetID   string          `json:"target_id"`
		EventID    *uuid.UUID      `json:"event_id"`
		IP         string          `json:"ip"`
		Details    json.RawMessage `json:"details"`
		CreatedAt  httpx.Time      `json:"created_at"`
	}
	out := httpx.Page[entry]{Items: []entry{}}
	for i, x := range rows {
		if i == lim {
			out.NextCursor = httpx.EncodeCursor(map[string]any{"id": rows[lim-1].ID})
			break
		}
		e := entry{ID: strconv.FormatInt(x.ID, 10), Action: x.Action, TargetType: x.TargetType, TargetID: x.TargetID, EventID: x.EventID,
			IP: x.Ip, Details: x.Details, CreatedAt: httpx.T(x.CreatedAt)}
		if x.ActorID != nil {
			m := map[string]any{"user_id": *x.ActorID, "full_name": x.ActorName}
			e.Actor = &m
		}
		out.Items = append(out.Items, e)
	}
	httpx.WriteJSON(w, http.StatusOK, out)
	return nil
}

func (h *Handler) stats(w http.ResponseWriter, r *http.Request) error {
	s, err := h.Q.AdminStats(r.Context())
	if err != nil {
		return err
	}
	status := map[string]string{}
	if h.Status != nil {
		status = h.Status(r.Context())
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"generated_at": httpx.T(time.Now()), "active_events": s.ActiveEvents, "pilots_in_air": s.TrackingPilots,
		"stale_sessions": s.StaleSessions, "open_retrievals": s.OpenRetrievals, "pending_applications": s.PendingApplications,
		"recent_flights": s.RecentFlights,
		"users":          s.Users, "system_status": map[string]any{"checks": status, "outbox_depth": s.OutboxDepth,
			"email_pending": s.EmailPending, "email_failed_24h": s.EmailFailed24h},
	})
	return nil
}
