package events

import (
	"context"
	"net/http"
	"net/url"
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
	"github.com/mdenizay/retfast/services/api/internal/email"
	"github.com/mdenizay/retfast/services/api/internal/notifications"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/slug"
	"github.com/mdenizay/retfast/services/api/internal/realtime/bus"
)

// Handler serves /events.
type Handler struct {
	Pool      *pgxpool.Pool
	Q         *dbq.Queries
	AppWebURL string
}

// PublicRoutes are mounted with optional authentication.
func (h *Handler) PublicRoutes(r chi.Router) {
	r.Get("/events", httpx.H(h.list))
	r.Get("/events/{id}", httpx.H(h.get))
	r.Get("/events/{id}/launch-sites", httpx.H(h.listSites))
}

// Routes are mounted with required authentication.
func (h *Handler) Routes(r chi.Router) {
	r.Post("/events", httpx.H(h.create))
	r.Patch("/events/{id}", httpx.H(h.patch))
	r.Post("/events/{id}/archive", httpx.H(h.archive))
	r.Get("/events/{id}/organizers", httpx.H(h.listOrganizers))
	r.Post("/events/{id}/organizers", httpx.H(h.addOrganizer))
	r.Delete("/events/{id}/organizers/{user_id}", httpx.H(h.removeOrganizer))
	r.Post("/events/{id}/applications", httpx.H(h.apply))
	r.Get("/events/{id}/applications", httpx.H(h.listApplications))
	r.Post("/events/{id}/applications/{app_id}/approve", httpx.H(h.approve))
	r.Post("/events/{id}/applications/{app_id}/reject", httpx.H(h.reject))
	r.Post("/events/{id}/applications/{app_id}/withdraw", httpx.H(h.withdraw))
	r.Get("/events/{id}/members", httpx.H(h.members))
	r.Post("/events/{id}/members", httpx.H(h.addMember))
	r.Patch("/events/{id}/members/{user_id}", httpx.H(h.patchMember))
	r.Delete("/events/{id}/members/{user_id}", httpx.H(h.removeMember))
	r.Post("/events/{id}/leave", httpx.H(h.leave))
	r.Post("/events/{id}/launch-sites", httpx.H(h.createSite))
	r.Patch("/events/{id}/launch-sites/{site_id}", httpx.H(h.patchSite))
	r.Delete("/events/{id}/launch-sites/{site_id}", httpx.H(h.deleteSite))
	r.Get("/events/{id}/report", httpx.H(h.report))
}

var (
	kinds    = map[string]bool{"paragliding": true, "hang_gliding": true, "speed_flying": true, "other": true}
	statuses = map[string]bool{"draft": true, "published": true, "active": true, "completed": true, "archived": true}
)

func (h *Handler) writeEvent(w http.ResponseWriter, r *http.Request, status int, id uuid.UUID) error {
	e, err := h.Q.GetEventByID(r.Context(), id)
	if err != nil {
		return err
	}
	dtos, err := BuildDTOs(r.Context(), h.Q, authz.ActorFrom(r.Context()), []Row{e})
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, status, dtos[0])
	return nil
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	qs := r.URL.Query()
	lim, err := httpx.Limit(r, 50, 200)
	if err != nil {
		return err
	}
	p := dbq.ListEventsParams{IsAdmin: a.IsAdmin(), Statuses: []string{}, Q: strings.TrimSpace(qs.Get("q")), Lim: int32(lim + 1),
		Mine: qs.Get("mine") == "true"}
	if a.Authenticated() {
		id := a.UserID
		p.ViewerID = &id
	}
	d := map[string]string{}
	if s := qs.Get("status"); s != "" {
		for _, st := range strings.Split(s, ",") {
			if st = strings.TrimSpace(st); !statuses[st] {
				d["status"] = "unknown status " + st
			}
			p.Statuses = append(p.Statuses, strings.TrimSpace(st))
		}
	} else {
		p.Statuses = []string{"published", "active", "completed"}
		if a.Authenticated() {
			p.Statuses = append(p.Statuses, "draft")
		}
	}
	parseT := func(k string) *time.Time {
		v := qs.Get(k)
		if v == "" {
			return nil
		}
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			d[k] = "must be RFC 3339"
			return nil
		}
		return &t
	}
	p.FromT, p.ToT = parseT("from"), parseT("to")
	if near := qs.Get("near"); near != "" {
		parts := strings.Split(near, ",")
		if len(parts) != 2 {
			d["near"] = "must be lat,lon"
		} else {
			lat, e1 := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
			lon, e2 := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
			if e1 != nil || e2 != nil || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
				d["near"] = "must be lat,lon"
			} else {
				p.NearLat, p.NearLon = &lat, &lon
			}
		}
		p.RadiusM = 50_000
		if rs := qs.Get("radius_km"); rs != "" {
			km, err := strconv.ParseFloat(rs, 64)
			if err != nil || km <= 0 || km > 5000 {
				d["radius_km"] = "must be in (0, 5000]"
			}
			p.RadiusM = km * 1000
		}
	}
	var cur struct {
		S  time.Time `json:"s"`
		ID uuid.UUID `json:"id"`
	}
	if ok, err := httpx.DecodeCursor(r, &cur); err != nil {
		return err
	} else if ok {
		p.AfterStarts, p.AfterID = &cur.S, &cur.ID
	}
	if p.Mine && !a.Authenticated() {
		return httpx.Unauthorized("Sign in to list your events")
	}
	if len(d) > 0 {
		return httpx.Validation(d)
	}
	rows, err := h.Q.ListEvents(ctx, p)
	if err != nil {
		return err
	}
	out := httpx.Page[Event]{Items: []Event{}}
	page := make([]Row, 0, len(rows))
	for i, e := range rows {
		if i == lim {
			out.NextCursor = httpx.EncodeCursor(map[string]any{"s": rows[lim-1].StartsAt, "id": rows[lim-1].ID})
			break
		}
		page = append(page, Row(e))
	}
	if out.Items, err = BuildDTOs(ctx, h.Q, a, page); err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, out)
	return nil
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) error {
	e, _, err := LoadVisible(r.Context(), h.Q, chi.URLParam(r, "id"), authz.ActorFrom(r.Context()))
	if err != nil {
		return err
	}
	return h.writeEvent(w, r, http.StatusOK, e.ID)
}

// eventInput is shared by create and patch; nil fields are left unchanged.
type eventInput struct {
	Slug                *string                `json:"slug"`
	Name                *string                `json:"name"`
	Description         *string                `json:"description"`
	Kind                *string                `json:"kind"`
	Status              *string                `json:"status"`
	Visibility          *string                `json:"visibility"`
	LocationName        *string                `json:"location_name"`
	Center              httpx.Nullable[LatLon] `json:"center"`
	CenterIsApproximate *bool                  `json:"center_is_approximate"`
	StartsAt            *httpx.Time            `json:"starts_at"`
	EndsAt              *httpx.Time            `json:"ends_at"`
	CoverImageURL       httpx.Nullable[string] `json:"cover_image_url"`
	Settings            *struct {
		ApplicationsOpen   *bool `json:"applications_open"`
		LiveTracking       *bool `json:"live_tracking"`
		PublicLiveMap      *bool `json:"public_live_map"`
		PilotsSeeEachOther *bool `json:"pilots_see_each_other"`
		LandingPrompt      *bool `json:"landing_prompt"`
	} `json:"settings"`
}

// apply merges in into e, returning validation details.
func (in *eventInput) apply(e *Row) map[string]string {
	d := map[string]string{}
	str := func(k string, src *string, dst *string, min, max int) {
		if src == nil {
			return
		}
		v := strings.TrimSpace(*src)
		if n := utf8.RuneCountInString(v); n < min || n > max {
			d[k] = "must be " + strconv.Itoa(min) + "-" + strconv.Itoa(max) + " characters"
		}
		*dst = v
	}
	str("name", in.Name, &e.Name, 1, 200)
	str("description", in.Description, &e.Description, 0, 10000)
	str("location_name", in.LocationName, &e.LocationName, 0, 300)
	if in.Slug != nil {
		s := slug.Make(*in.Slug, 100)
		if s != *in.Slug || len(s) < 2 {
			d["slug"] = "must be lowercase letters, digits and dashes"
		}
		e.Slug = s
	}
	if in.Kind != nil {
		if !kinds[*in.Kind] {
			d["kind"] = "unknown kind"
		}
		e.Kind = *in.Kind
	}
	if in.Status != nil {
		if !statuses[*in.Status] {
			d["status"] = "unknown status"
		}
		e.Status = *in.Status
	}
	if in.Visibility != nil {
		if *in.Visibility != authz.EventPublic && *in.Visibility != authz.EventRestrict {
			d["visibility"] = "must be public or restricted"
		}
		e.Visibility = *in.Visibility
	}
	if in.Center.Set {
		if in.Center.Null {
			e.CenterLat, e.CenterLon = nil, nil
		} else if c := in.Center.V; c.Lat < -90 || c.Lat > 90 || c.Lon < -180 || c.Lon > 180 {
			d["center"] = "must be {lat, lon} in WGS84"
		} else {
			e.CenterLat, e.CenterLon = &c.Lat, &c.Lon
		}
	}
	if in.CenterIsApproximate != nil {
		e.CenterIsApproximate = *in.CenterIsApproximate
	}
	if in.StartsAt != nil {
		e.StartsAt = in.StartsAt.Time
	}
	if in.EndsAt != nil {
		e.EndsAt = in.EndsAt.Time
	}
	if e.EndsAt.Before(e.StartsAt) {
		d["ends_at"] = "must not be before starts_at"
	}
	if in.CoverImageURL.Set {
		if in.CoverImageURL.Null {
			e.CoverImageUrl = nil
		} else if u, err := url.Parse(in.CoverImageURL.V); err != nil || u.Scheme != "https" || u.Host == "" || len(in.CoverImageURL.V) > 1000 {
			d["cover_image_url"] = "must be an https URL"
		} else {
			v := in.CoverImageURL.V
			e.CoverImageUrl = &v
		}
	}
	if st := in.Settings; st != nil {
		set := func(src *bool, dst *bool) {
			if src != nil {
				*dst = *src
			}
		}
		set(st.ApplicationsOpen, &e.ApplicationsOpen)
		set(st.LiveTracking, &e.LiveTracking)
		set(st.PublicLiveMap, &e.PublicLiveMap)
		set(st.PilotsSeeEachOther, &e.PilotsSeeEachOther)
		set(st.LandingPrompt, &e.LandingPrompt)
	}
	return d
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	if !authz.CanCreateEvent(a) {
		return httpx.Forbidden("Only platform admins can create events")
	}
	var in struct {
		eventInput
		Organizers []uuid.UUID `json:"organizers"`
	}
	if err := httpx.DecodeJSON(w, r, 64<<10, &in); err != nil {
		return err
	}
	e := Row{Kind: "paragliding", Status: "draft", Visibility: authz.EventPublic, ApplicationsOpen: true, LiveTracking: true,
		PublicLiveMap: false, PilotsSeeEachOther: true, LandingPrompt: true}
	d := map[string]string{}
	if in.Name == nil {
		d["name"] = "required"
	}
	if in.StartsAt == nil {
		d["starts_at"] = "required"
	}
	if in.EndsAt == nil {
		d["ends_at"] = "required"
	}
	if len(d) > 0 {
		return httpx.Validation(d)
	}
	if d = in.apply(&e); len(d) > 0 {
		return httpx.Validation(d)
	}
	var id uuid.UUID
	err := pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if in.Slug == nil {
			s, err := UniqueSlug(ctx, q, e.Name)
			if err != nil {
				return err
			}
			e.Slug = s
		}
		uid := a.UserID
		var err error
		id, err = q.CreateEvent(ctx, dbq.CreateEventParams{Slug: e.Slug, Name: e.Name, Description: e.Description, Kind: e.Kind,
			Status: e.Status, Visibility: e.Visibility, LocationName: e.LocationName, CenterLat: e.CenterLat, CenterLon: e.CenterLon,
			CenterIsApproximate: e.CenterIsApproximate, StartsAt: e.StartsAt, EndsAt: e.EndsAt, CoverImageUrl: e.CoverImageUrl,
			ApplicationsOpen: e.ApplicationsOpen, LiveTracking: e.LiveTracking, PublicLiveMap: e.PublicLiveMap,
			PilotsSeeEachOther: e.PilotsSeeEachOther, LandingPrompt: e.LandingPrompt, CreatedBy: &uid})
		if db.IsUniqueViolation(err, "") {
			return httpx.Conflict("Slug already in use")
		}
		if err != nil {
			return err
		}
		for _, oid := range in.Organizers {
			if err := addOrganizerTx(ctx, q, r, id, oid, uid); err != nil {
				return err
			}
		}
		return audit.Record(ctx, q, r, audit.Entry{Action: "event.created", TargetType: "event", TargetID: id.String(), EventID: &id})
	})
	if err != nil {
		return err
	}
	return h.writeEvent(w, r, http.StatusCreated, id)
}

// UniqueSlug derives a free slug from name.
func UniqueSlug(ctx context.Context, q *dbq.Queries, name string) (string, error) {
	base := slug.Make(name, 80)
	if len(base) < 2 {
		base = "event"
	}
	cand := base
	for i := 0; i < 10; i++ {
		exists, err := q.EventSlugExists(ctx, cand)
		if err != nil {
			return "", err
		}
		if !exists {
			return cand, nil
		}
		cand = base + "-" + slug.Random(4)
	}
	return "", httpx.Conflict("Could not allocate a slug")
}

// loadManaged loads an event the caller may manage (404 if invisible, 403 if not organizer).
func (h *Handler) loadManaged(ctx context.Context, idOrSlug string) (Row, error) {
	a := authz.ActorFrom(ctx)
	e, acc, err := LoadVisible(ctx, h.Q, idOrSlug, a)
	if err != nil {
		return Row{}, err
	}
	if !authz.CanManageEvent(a, acc) {
		return Row{}, httpx.Forbidden("Only event organizers can do this")
	}
	return e, nil
}

func (h *Handler) patch(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	e, err := h.loadManaged(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	before := e
	var in eventInput
	if err := httpx.DecodeJSON(w, r, 64<<10, &in); err != nil {
		return err
	}
	if d := in.apply(&e); len(d) > 0 {
		return httpx.Validation(d)
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		err := q.UpdateEvent(ctx, dbq.UpdateEventParams{ID: e.ID, Slug: e.Slug, Name: e.Name, Description: e.Description, Kind: e.Kind,
			Status: e.Status, Visibility: e.Visibility, LocationName: e.LocationName, CenterLat: e.CenterLat, CenterLon: e.CenterLon,
			CenterIsApproximate: e.CenterIsApproximate, StartsAt: e.StartsAt, EndsAt: e.EndsAt, CoverImageUrl: e.CoverImageUrl,
			ApplicationsOpen: e.ApplicationsOpen, LiveTracking: e.LiveTracking, PublicLiveMap: e.PublicLiveMap,
			PilotsSeeEachOther: e.PilotsSeeEachOther, LandingPrompt: e.LandingPrompt})
		if db.IsUniqueViolation(err, "") {
			return httpx.Conflict("Slug already in use")
		}
		if err != nil {
			return err
		}
		id := e.ID
		if err := audit.Record(ctx, q, r, audit.Entry{Action: "event.updated", TargetType: "event", TargetID: id.String(), EventID: &id,
			Details: map[string]any{"status": e.Status}}); err != nil {
			return err
		}
		if err := bus.EventChanged(ctx, q, Facts(e)); err != nil {
			return err
		}
		if before.Status != e.Status || !before.StartsAt.Equal(e.StartsAt) || !before.EndsAt.Equal(e.EndsAt) {
			return h.notifyMembers(ctx, q, e, "Etkinlik güncellendi", eventChangeText(before, e))
		}
		return nil
	})
	if err != nil {
		return err
	}
	return h.writeEvent(w, r, http.StatusOK, e.ID)
}

var statusTR = map[string]string{"draft": "taslak", "published": "yayında", "active": "aktif", "completed": "tamamlandı", "archived": "arşivlendi"}

func eventChangeText(before, after Row) string {
	var parts []string
	if before.Status != after.Status {
		parts = append(parts, "Durum: "+statusTR[after.Status])
	}
	if !before.StartsAt.Equal(after.StartsAt) || !before.EndsAt.Equal(after.EndsAt) {
		parts = append(parts, "Program: "+after.StartsAt.UTC().Format("2006-01-02 15:04")+" – "+after.EndsAt.UTC().Format("2006-01-02 15:04")+" UTC")
	}
	return strings.Join(parts, "\n")
}

// notifyMembers stores an in-app notification and queues an event_update email for active members.
func (h *Handler) notifyMembers(ctx context.Context, q *dbq.Queries, e Row, title, body string) error {
	ids, err := q.ListActiveMemberIDs(ctx, e.ID)
	if err != nil {
		return err
	}
	orgs, err := q.ListOrganizerIDs(ctx, e.ID)
	if err != nil {
		return err
	}
	ids = append(ids, orgs...)
	if err := notifications.Notify(ctx, q, ids, notifications.KindEventUpdate, e.Name+": "+title, body,
		map[string]any{"event_id": e.ID, "slug": e.Slug}); err != nil {
		return err
	}
	seen := map[uuid.UUID]bool{}
	for _, uid := range ids {
		if seen[uid] {
			continue
		}
		seen[uid] = true
		u, err := q.GetUserByID(ctx, uid)
		if err != nil || u.DeletedAt != nil || u.EmailVerifiedAt == nil {
			continue
		}
		if _, err := email.Enqueue(ctx, q, email.TplEventUpdate, u.Email, email.Data{Name: u.FullName, EventName: e.Name, Title: title,
			Body: body, Link: h.AppWebURL + "/app/events/" + e.Slug, AppURL: h.AppWebURL}); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) archive(w http.ResponseWriter, r *http.Request) error {
	const status = "archived"
	ctx := r.Context()
	e, err := h.loadManaged(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	if e.Status != status {
		before := e
		e.Status = status
		err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
			q := dbq.New(tx)
			if err := q.UpdateEvent(ctx, dbq.UpdateEventParams{ID: e.ID, Slug: e.Slug, Name: e.Name, Description: e.Description, Kind: e.Kind,
				Status: e.Status, Visibility: e.Visibility, LocationName: e.LocationName, CenterLat: e.CenterLat, CenterLon: e.CenterLon,
				CenterIsApproximate: e.CenterIsApproximate, StartsAt: e.StartsAt, EndsAt: e.EndsAt, CoverImageUrl: e.CoverImageUrl,
				ApplicationsOpen: e.ApplicationsOpen, LiveTracking: e.LiveTracking, PublicLiveMap: e.PublicLiveMap,
				PilotsSeeEachOther: e.PilotsSeeEachOther, LandingPrompt: e.LandingPrompt}); err != nil {
				return err
			}
			id := e.ID
			if err := audit.Record(ctx, q, r, audit.Entry{Action: "event.archived", TargetType: "event", TargetID: id.String(), EventID: &id}); err != nil {
				return err
			}
			if err := bus.EventChanged(ctx, q, Facts(e)); err != nil {
				return err
			}
			return h.notifyMembers(ctx, q, e, "Etkinlik arşivlendi", eventChangeText(before, e))
		})
		if err != nil {
			return err
		}
	}
	return h.writeEvent(w, r, http.StatusOK, e.ID)
}

// LaunchSite per the contract.
type LaunchSite struct {
	ID         uuid.UUID `json:"id"`
	EventID    uuid.UUID `json:"event_id"`
	Name       string    `json:"name"`
	Position   *LatLon   `json:"position"`
	ElevationM *float64  `json:"elevation_m"`
	Notes      string    `json:"notes"`
	IsVerified bool      `json:"is_verified"`
}

// SiteDTO converts a launch site row.
func SiteDTO(s dbq.GetLaunchSiteRow) LaunchSite {
	out := LaunchSite{ID: s.ID, EventID: s.EventID, Name: s.Name, ElevationM: s.ElevationM, Notes: s.Notes, IsVerified: s.IsVerified}
	if s.Lat != nil && s.Lon != nil {
		out.Position = &LatLon{Lat: *s.Lat, Lon: *s.Lon}
	}
	return out
}

func (h *Handler) listSites(w http.ResponseWriter, r *http.Request) error {
	e, _, err := LoadVisible(r.Context(), h.Q, chi.URLParam(r, "id"), authz.ActorFrom(r.Context()))
	if err != nil {
		return err
	}
	rows, err := h.Q.ListLaunchSites(r.Context(), e.ID)
	if err != nil {
		return err
	}
	out := []LaunchSite{}
	for _, s := range rows {
		out = append(out, SiteDTO(dbq.GetLaunchSiteRow(s)))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": out})
	return nil
}

type siteInput struct {
	Name       *string                 `json:"name"`
	Position   httpx.Nullable[LatLon]  `json:"position"`
	ElevationM httpx.Nullable[float64] `json:"elevation_m"`
	Notes      *string                 `json:"notes"`
	IsVerified *bool                   `json:"is_verified"`
}

func (in *siteInput) apply(s *dbq.GetLaunchSiteRow) map[string]string {
	d := map[string]string{}
	if in.Name != nil {
		n := strings.TrimSpace(*in.Name)
		if n == "" || utf8.RuneCountInString(n) > 200 {
			d["name"] = "must be 1-200 characters"
		}
		s.Name = n
	}
	if in.Position.Set {
		if in.Position.Null {
			s.Lat, s.Lon = nil, nil
		} else if c := in.Position.V; c.Lat < -90 || c.Lat > 90 || c.Lon < -180 || c.Lon > 180 {
			d["position"] = "must be {lat, lon} or null"
		} else {
			s.Lat, s.Lon = &c.Lat, &c.Lon
		}
	}
	if in.ElevationM.Set {
		if in.ElevationM.Null {
			s.ElevationM = nil
		} else if v := in.ElevationM.V; v < -500 || v > 9000 {
			d["elevation_m"] = "must be between -500 and 9000 or null"
		} else {
			s.ElevationM = &v
		}
	}
	if in.Notes != nil {
		if utf8.RuneCountInString(*in.Notes) > 2000 {
			d["notes"] = "too long"
		}
		s.Notes = *in.Notes
	}
	if in.IsVerified != nil {
		s.IsVerified = *in.IsVerified
	}
	if s.IsVerified && s.Lat == nil {
		d["is_verified"] = "a site without a position cannot be verified"
	}
	return d
}

func (h *Handler) createSite(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	e, err := h.loadManaged(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	var in siteInput
	if err := httpx.DecodeJSON(w, r, 16<<10, &in); err != nil {
		return err
	}
	if in.Name == nil {
		return httpx.Validation(map[string]string{"name": "required"})
	}
	s := dbq.GetLaunchSiteRow{}
	if d := in.apply(&s); len(d) > 0 {
		return httpx.Validation(d)
	}
	row, err := h.Q.CreateLaunchSite(ctx, dbq.CreateLaunchSiteParams{EventID: e.ID, Name: s.Name, Lat: s.Lat, Lon: s.Lon,
		ElevationM: s.ElevationM, Notes: s.Notes, IsVerified: s.IsVerified})
	if db.IsUniqueViolation(err, "") {
		return httpx.Conflict("A launch site with this name exists")
	}
	if err != nil {
		return err
	}
	id := e.ID
	_ = audit.Record(ctx, h.Q, r, audit.Entry{Action: "event.launch_site_created", TargetType: "launch_site", TargetID: row.ID.String(), EventID: &id})
	httpx.WriteJSON(w, http.StatusCreated, SiteDTO(dbq.GetLaunchSiteRow(row)))
	return nil
}

func (h *Handler) patchSite(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	e, err := h.loadManaged(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	sid, err := uuid.Parse(chi.URLParam(r, "site_id"))
	if err != nil {
		return httpx.NotFound("")
	}
	s, err := h.Q.GetLaunchSite(ctx, dbq.GetLaunchSiteParams{ID: sid, EventID: e.ID})
	if db.NotFound(err) {
		return httpx.NotFound("")
	}
	if err != nil {
		return err
	}
	var in siteInput
	if err := httpx.DecodeJSON(w, r, 16<<10, &in); err != nil {
		return err
	}
	if d := in.apply(&s); len(d) > 0 {
		return httpx.Validation(d)
	}
	err = h.Q.UpdateLaunchSite(ctx, dbq.UpdateLaunchSiteParams{ID: sid, EventID: e.ID, Name: s.Name, Lat: s.Lat, Lon: s.Lon,
		ElevationM: s.ElevationM, Notes: s.Notes, IsVerified: s.IsVerified})
	if db.IsUniqueViolation(err, "") {
		return httpx.Conflict("A launch site with this name exists")
	}
	if err != nil {
		return err
	}
	id := e.ID
	_ = audit.Record(ctx, h.Q, r, audit.Entry{Action: "event.launch_site_updated", TargetType: "launch_site", TargetID: sid.String(), EventID: &id})
	httpx.WriteJSON(w, http.StatusOK, SiteDTO(s))
	return nil
}

func (h *Handler) deleteSite(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	e, err := h.loadManaged(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	sid, err := uuid.Parse(chi.URLParam(r, "site_id"))
	if err != nil {
		return httpx.NotFound("")
	}
	n, err := h.Q.DeleteLaunchSite(ctx, dbq.DeleteLaunchSiteParams{ID: sid, EventID: e.ID})
	if err != nil {
		return err
	}
	if n == 0 {
		return httpx.NotFound("")
	}
	id := e.ID
	_ = audit.Record(ctx, h.Q, r, audit.Entry{Action: "event.launch_site_deleted", TargetType: "launch_site", TargetID: sid.String(), EventID: &id})
	w.WriteHeader(http.StatusNoContent)
	return nil
}
