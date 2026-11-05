package users

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/audit"
	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
)

// Handler serves /me, /me/*, /pilots.
type Handler struct {
	Pool          *pgxpool.Pool
	Q             *dbq.Queries
	DeletionGrace time.Duration
	// Hash creates a password hash (injected to avoid importing auth).
	Hash func(string) (string, error)
}

// RoutesPCR mounts endpoints allowed while a password change is pending (GET /me).
func (h *Handler) RoutesPCR(r chi.Router) {
	r.Get("/me", httpx.H(h.getMe))
}

// Routes mounts the fully-authenticated endpoints.
func (h *Handler) Routes(r chi.Router) {
	r.Patch("/me", httpx.H(h.patchMe))
	r.Patch("/me/pilot", httpx.H(h.patchPilot))
	r.Post("/me/deletion-request", httpx.H(h.requestDeletion))
	r.Delete("/me/deletion-request", httpx.H(h.cancelDeletion))
	r.Get("/me/export", httpx.H(h.export))
	r.Post("/me/devices", httpx.H(h.upsertDevice))
	r.Get("/users/search", httpx.H(h.searchUsers))
}

// PublicRoutes mounts endpoints available to guests.
func (h *Handler) PublicRoutes(r chi.Router) {
	r.Get("/pilots/{public_id}", httpx.H(h.getPilot))
}

func (h *Handler) getMe(w http.ResponseWriter, r *http.Request) error {
	me, err := LoadMe(r.Context(), h.Q, authz.ActorFrom(r.Context()).UserID)
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, me)
	return nil
}

func (h *Handler) patchMe(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		FullName    *string `json:"full_name"`
		Preferences *struct {
			Units         *string `json:"units"`
			PublicProfile *bool   `json:"public_profile"`
		} `json:"preferences"`
	}
	if err := httpx.DecodeJSON(w, r, 16<<10, &in); err != nil {
		return err
	}
	a := authz.ActorFrom(r.Context())
	details := map[string]string{}
	if in.FullName != nil {
		n := strings.TrimSpace(*in.FullName)
		if n == "" || utf8.RuneCountInString(n) > 200 {
			details["full_name"] = "must be 1-200 characters"
		}
		*in.FullName = n
	}
	prefs, err := LoadPreferences(r.Context(), h.Q, a.UserID)
	if err != nil {
		return err
	}
	if p := in.Preferences; p != nil {
		if p.Units != nil {
			if *p.Units != "metric" && *p.Units != "imperial" {
				details["preferences.units"] = "must be metric or imperial"
			}
			prefs.Units = *p.Units
		}
		if p.PublicProfile != nil {
			prefs.PublicProfile = *p.PublicProfile
		}
	}
	if len(details) > 0 {
		return httpx.Validation(details)
	}
	err = pgx.BeginFunc(r.Context(), h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if in.FullName != nil {
			if err := q.UpdateUserFullName(r.Context(), dbq.UpdateUserFullNameParams{ID: a.UserID, FullName: *in.FullName}); err != nil {
				return err
			}
		}
		if in.Preferences != nil {
			return q.UpsertPreferences(r.Context(), dbq.UpsertPreferencesParams{UserID: a.UserID, Units: prefs.Units,
				PublicProfile: prefs.PublicProfile})
		}
		return nil
	})
	if err != nil {
		return err
	}
	return h.getMe(w, r)
}

var nationalityRe = regexp.MustCompile(`^[A-Z]{2}$`)

func (h *Handler) patchPilot(w http.ResponseWriter, r *http.Request) error {
	var in map[string]json.RawMessage
	if err := httpx.DecodeJSON(w, r, 16<<10, &in); err != nil {
		return err
	}
	a := authz.ActorFrom(r.Context())
	if _, err := EnsurePilotProfile(r.Context(), h.Q, a.UserID, a.FullName, ""); err != nil {
		return err
	}
	p, err := h.Q.GetPilotProfile(r.Context(), a.UserID)
	if err != nil {
		return err
	}
	fields := map[string]struct {
		dst *string
		max int
	}{
		"display_name": {&p.DisplayName, 200}, "bio": {&p.Bio, 2000}, "wing": {&p.Wing, 200},
		"license_no": {&p.LicenseNo, 100}, "nationality": {&p.Nationality, 2}, "phone": {&p.Phone, 50},
		"emergency_contact_name": {&p.EmergencyContactName, 200}, "emergency_contact_phone": {&p.EmergencyContactPhone, 50},
	}
	details := map[string]string{}
	for k, raw := range in {
		f, ok := fields[k]
		if !ok {
			if k == "public_id" {
				details[k] = "cannot be changed"
			} else {
				details[k] = "unknown field"
			}
			continue
		}
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			details[k] = "must be a string"
			continue
		}
		s = strings.TrimSpace(s)
		if utf8.RuneCountInString(s) > f.max {
			details[k] = "too long"
			continue
		}
		*f.dst = s
	}
	p.Nationality = strings.ToUpper(p.Nationality)
	if p.Nationality != "" && !nationalityRe.MatchString(p.Nationality) {
		details["nationality"] = "must be an ISO 3166-1 alpha-2 code"
	}
	if p.DisplayName == "" {
		details["display_name"] = "must not be empty"
	}
	if len(details) > 0 {
		return httpx.Validation(details)
	}
	if err := h.Q.UpdatePilotProfile(r.Context(), dbq.UpdatePilotProfileParams{UserID: a.UserID, DisplayName: p.DisplayName,
		Bio: p.Bio, Wing: p.Wing, LicenseNo: p.LicenseNo, Nationality: p.Nationality, Phone: p.Phone,
		EmergencyContactName: p.EmergencyContactName, EmergencyContactPhone: p.EmergencyContactPhone}); err != nil {
		return err
	}
	return h.getMe(w, r)
}

func (h *Handler) requestDeletion(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Reason string `json:"reason"`
	}
	if err := httpx.DecodeOptionalJSON(w, r, 8<<10, &in); err != nil {
		return err
	}
	if utf8.RuneCountInString(in.Reason) > 2000 {
		return httpx.Validation(map[string]string{"reason": "too long"})
	}
	a := authz.ActorFrom(r.Context())
	var req dbq.AccountDeletionRequest
	err := pgx.BeginFunc(r.Context(), h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		var err error
		req, err = q.CreateDeletionRequest(r.Context(), dbq.CreateDeletionRequestParams{UserID: a.UserID,
			Reason: strings.TrimSpace(in.Reason), ScheduledFor: Now().Add(h.DeletionGrace)})
		if err != nil {
			return err
		}
		return audit.Record(r.Context(), q, r, audit.Entry{Action: "account.deletion_requested", TargetType: "user", TargetID: a.UserID.String()})
	})
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"status": "pending", "requested_at": httpx.T(req.RequestedAt),
		"scheduled_for": httpx.T(req.ScheduledFor)})
	return nil
}

func (h *Handler) cancelDeletion(w http.ResponseWriter, r *http.Request) error {
	a := authz.ActorFrom(r.Context())
	err := pgx.BeginFunc(r.Context(), h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		n, err := q.CancelDeletionRequest(r.Context(), a.UserID)
		if err != nil {
			return err
		}
		if n == 0 {
			return httpx.NotFound("No pending deletion request")
		}
		return audit.Record(r.Context(), q, r, audit.Entry{Action: "account.deletion_cancelled", TargetType: "user", TargetID: a.UserID.String()})
	})
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"status": "cancelled"})
	return nil
}

func (h *Handler) upsertDevice(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		DeviceID   string  `json:"device_id"`
		Platform   string  `json:"platform"`
		APNsToken  *string `json:"apns_token"`
		AppVersion string  `json:"app_version"`
		OSVersion  string  `json:"os_version"`
	}
	if err := httpx.DecodeJSON(w, r, 8<<10, &in); err != nil {
		return err
	}
	d := map[string]string{}
	if in.DeviceID == "" || len(in.DeviceID) > 200 {
		d["device_id"] = "required (max 200)"
	}
	if in.Platform != "ios" {
		d["platform"] = "must be ios"
	}
	if in.APNsToken != nil && (len(*in.APNsToken) > 400 || *in.APNsToken == "") {
		d["apns_token"] = "invalid"
	}
	if len(in.AppVersion) > 50 || len(in.OSVersion) > 50 {
		d["app_version"] = "too long"
	}
	if len(d) > 0 {
		return httpx.Validation(d)
	}
	if err := h.Q.UpsertDevice(r.Context(), dbq.UpsertDeviceParams{UserID: authz.ActorFrom(r.Context()).UserID,
		DeviceID: in.DeviceID, Platform: in.Platform, ApnsToken: in.APNsToken, AppVersion: in.AppVersion, OsVersion: in.OSVersion}); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// PublicPilot never includes contact, emergency or licence fields.
type PublicPilot struct {
	PublicID    string `json:"public_id"`
	DisplayName string `json:"display_name"`
	Bio         string `json:"bio"`
	Wing        string `json:"wing"`
	Nationality string `json:"nationality"`
}

func (h *Handler) getPilot(w http.ResponseWriter, r *http.Request) error {
	p, err := h.Q.GetPilotProfileByPublicID(r.Context(), chi.URLParam(r, "public_id"))
	if db.NotFound(err) {
		return httpx.NotFound("")
	}
	if err != nil {
		return err
	}
	a := authz.ActorFrom(r.Context())
	public := p.PublicProfile != nil && *p.PublicProfile
	if (!public && !a.Is(p.UserID)) || p.DeletedAt != nil || p.DisabledAt != nil {
		return httpx.NotFound("")
	}
	httpx.WriteJSON(w, http.StatusOK, PublicPilot{PublicID: p.PublicID, DisplayName: p.DisplayName, Bio: p.Bio, Wing: p.Wing, Nationality: p.Nationality})
	return nil
}

// searchUsers serves GET /users/search for organizers and admins (adding
// organizers and members). It never returns contact data beyond the email.
func (h *Handler) searchUsers(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	organizes, err := h.Q.UserOrganizesAny(ctx, a.UserID)
	if err != nil {
		return err
	}
	if !authz.CanSearchUsers(a, organizes) {
		return httpx.Forbidden("Only organizers and admins can search users")
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(q) > 100 {
		return httpx.Validation(map[string]string{"q": "too long"})
	}
	lim, err := httpx.Limit(r, 20, 50)
	if err != nil {
		return err
	}
	rows, err := h.Q.SearchUsersBasic(ctx, dbq.SearchUsersBasicParams{Q: q, Lim: int32(lim)})
	if err != nil {
		return err
	}
	type item struct {
		ID       uuid.UUID `json:"id"`
		FullName string    `json:"full_name"`
		Email    string    `json:"email"`
		PublicID *string   `json:"public_id"`
	}
	out := make([]item, 0, len(rows))
	for _, u := range rows {
		out = append(out, item{ID: u.ID, FullName: u.FullName, Email: u.Email, PublicID: u.PublicID})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": out})
	return nil
}

// export streams the caller's data as one JSON document.
func (h *Handler) export(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	me, err := LoadMe(ctx, h.Q, a.UserID)
	if err != nil {
		return err
	}
	devs, err := h.Q.ListDevicesForUser(ctx, a.UserID)
	if err != nil {
		return err
	}
	flights, err := h.Q.ListFlights(ctx, dbq.ListFlightsParams{PilotID: &a.UserID, ViewerID: a.UserID, Statuses: []string{}, Lim: 100000})
	if err != nil {
		return err
	}
	type device struct {
		DeviceID   string     `json:"device_id"`
		Platform   string     `json:"platform"`
		HasAPNs    bool       `json:"has_push_token"`
		AppVersion string     `json:"app_version"`
		OSVersion  string     `json:"os_version"`
		LastSeenAt httpx.Time `json:"last_seen_at"`
	}
	ds := []device{}
	for _, d := range devs {
		ds = append(ds, device{d.DeviceID, d.Platform, d.ApnsToken != nil, d.AppVersion, d.OsVersion, httpx.T(d.LastSeenAt)})
	}
	rets, err := h.Q.ListRetrievalsForPilot(ctx, a.UserID)
	if err != nil {
		return err
	}
	type retrieval struct {
		ID          uuid.UUID   `json:"id"`
		EventID     uuid.UUID   `json:"event_id"`
		FlightID    *uuid.UUID  `json:"flight_id"`
		Status      string      `json:"status"`
		PickupLat   float64     `json:"pickup_lat"`
		PickupLon   float64     `json:"pickup_lon"`
		PickupT     httpx.Time  `json:"pickup_t"`
		Note        string      `json:"note"`
		RequestedAt httpx.Time  `json:"requested_at"`
		AcceptedAt  *httpx.Time `json:"accepted_at"`
		PickedUpAt  *httpx.Time `json:"picked_up_at"`
		DeliveredAt *httpx.Time `json:"delivered_at"`
		CancelledAt *httpx.Time `json:"cancelled_at"`
		IsSimulated bool        `json:"is_simulated"`
	}
	rs := make([]retrieval, 0, len(rets))
	for _, x := range rets {
		rs = append(rs, retrieval{x.ID, x.EventID, x.FlightID, x.Status, x.PickupLat, x.PickupLon, httpx.T(x.PickupT), x.Note,
			httpx.T(x.RequestedAt), httpx.TP(x.AcceptedAt), httpx.TP(x.PickedUpAt), httpx.TP(x.DeliveredAt), httpx.TP(x.CancelledAt), x.IsSimulated})
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="retfast-export.json"`)
	enc := json.NewEncoder(w)
	write := func(s string) { _, _ = w.Write([]byte(s)) }
	write(`{"exported_at":`)
	_ = enc.Encode(httpx.T(Now()))
	write(`,"me":`)
	_ = enc.Encode(me)
	write(`,"devices":`)
	_ = enc.Encode(ds)
	write(`,"retrievals":`)
	_ = enc.Encode(rs)
	write(`,"flights":[`)
	for i, f := range flights {
		if i > 0 {
			write(",")
		}
		pos, err := h.Q.ListAllPositions(ctx, f.FlightSession.ID)
		if err != nil {
			slog.Default().Error("export positions", "err", err.Error())
			break
		}
		type p struct {
			Seq      int32      `json:"seq"`
			T        httpx.Time `json:"t"`
			Lat      float64    `json:"lat"`
			Lon      float64    `json:"lon"`
			GPSAlt   *float64   `json:"gps_alt_m"`
			HAcc     float64    `json:"h_acc_m"`
			SpeedMS  *float64   `json:"speed_ms"`
			Course   *float64   `json:"course_deg"`
			Received httpx.Time `json:"received_at"`
		}
		ps := make([]p, 0, len(pos))
		for _, x := range pos {
			ps = append(ps, p{x.Seq, httpx.T(x.T), x.Lat, x.Lon, x.GpsAltM, x.HAccM, x.SpeedMs, x.CourseDeg, httpx.T(x.ReceivedAt)})
		}
		fs := f.FlightSession
		_ = enc.Encode(map[string]any{"id": fs.ID, "public_id": fs.PublicID, "event_id": fs.EventID, "status": fs.Status,
			"is_simulated": fs.IsSimulated, "started_at": httpx.T(fs.StartedAt),
			"ended_at": httpx.TP(fs.EndedAt), "positions": ps})
	}
	write("]}")
	return nil
}

// DeletionWorker completes account deletion requests whose grace period passed.
type DeletionWorker struct {
	Pool *pgxpool.Pool
	Hash func(string) (string, error)
	Log  *slog.Logger
}

// Run processes due deletions every minute.
func (d *DeletionWorker) Run(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		if n, err := d.ProcessOnce(ctx); err != nil && ctx.Err() == nil {
			d.Log.Error("account deletion worker", "err", err.Error())
		} else if n > 0 {
			d.Log.Info("accounts deleted", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// ProcessOnce anonymises due accounts: credentials, profile and contact data are
// wiped, sessions revoked, devices and notifications deleted, flights and their
// positions deleted, retriever positions and retrieval position history deleted,
// memberships/organizer assignments removed. Retrieval records are kept (event
// record) but reference the anonymised user.
func (d *DeletionWorker) ProcessOnce(ctx context.Context) (int, error) {
	n := 0
	err := pgx.BeginFunc(ctx, d.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		due, err := q.ListDueDeletions(ctx)
		if err != nil {
			return err
		}
		for _, req := range due {
			var b [32]byte
			_, _ = rand.Read(b[:])
			hash, err := d.Hash(hex.EncodeToString(b[:]))
			if err != nil {
				return err
			}
			steps := []func() error{
				func() error {
					return q.RevokeAllUserSessions(ctx, dbq.RevokeAllUserSessionsParams{UserID: req.UserID, Reason: "account_deleted"})
				},
				func() error { return q.DeleteUserDevices(ctx, req.UserID) },
				func() error { return q.DeleteUserNotifications(ctx, req.UserID) },
				func() error { _, err := q.DeleteUserFlights(ctx, req.UserID); return err },
				func() error { return q.AnonymizePilotProfile(ctx, req.UserID) },
				func() error { return q.SetPublicProfileOff(ctx, req.UserID) },
				func() error { return q.RemoveUserMemberships(ctx, req.UserID) },
				func() error { return q.RemoveUserOrganizerships(ctx, req.UserID) },
				func() error { return q.WithdrawUserApplications(ctx, req.UserID) },
				func() error { return q.DeleteUserRetrieverData(ctx, req.UserID) },
				func() error { return q.DeleteUserRetrieverStates(ctx, req.UserID) },
				func() error { return q.DeleteUserRetrievalPositions(ctx, req.UserID) },
				func() error { return q.DeleteUserRoles(ctx, req.UserID) },
				func() error { return q.AnonymizeUser(ctx, dbq.AnonymizeUserParams{ID: req.UserID, PasswordHash: hash}) },
				func() error { return q.CompleteDeletionRequest(ctx, req.ID) },
				func() error {
					uid := req.UserID
					return audit.Record(ctx, q, nil, audit.Entry{ActorID: &uid, Action: "account.deleted", TargetType: "user", TargetID: uid.String()})
				},
			}
			for _, s := range steps {
				if err := s(); err != nil {
					return err
				}
			}
			n++
		}
		return nil
	})
	return n, err
}
