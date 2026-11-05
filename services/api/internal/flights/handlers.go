package flights

import (
	"context"
	"encoding/xml"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/events"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/geo"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/slug"
	"github.com/mdenizay/retfast/services/api/internal/tracking/stats"
)

// Handler serves /flights.
type Handler struct {
	Pool *pgxpool.Pool
	Q    *dbq.Queries
}

// PublicRoutes are mounted with optional auth (flights of public_live_map events are viewable by guests).
func (h *Handler) PublicRoutes(r chi.Router) {
	r.Get("/flights/{id}", httpx.H(h.get))
	r.Get("/flights/{id}/positions", httpx.H(h.positions))
	r.Get("/flights/{id}/track.gpx", httpx.H(h.gpx))
}

// Routes are mounted with required auth.
func (h *Handler) Routes(r chi.Router) {
	r.Post("/flights", httpx.H(h.create))
	r.Get("/flights", httpx.H(h.list))
	r.Patch("/flights/{id}", httpx.H(h.patch))
	r.Post("/flights/{id}/end", httpx.H(h.end))
}

// checkEventForFlight verifies the pilot may link a flight to the event.
func checkEventForFlight(ctx context.Context, q *dbq.Queries, eventID uuid.UUID, a *authz.Actor) error {
	e, acc, err := events.LoadVisible(ctx, q, eventID.String(), a)
	if err != nil {
		return httpx.Validation(map[string]string{"event_id": "unknown event"})
	}
	if !authz.CanCreateFlightInEvent(acc) {
		return httpx.Forbidden("Only pilots of this event can record flights in it")
	}
	if e.Status == "archived" || e.Status == "completed" || e.Status == "draft" {
		return httpx.Forbidden("The event is not running")
	}
	if !e.LiveTracking {
		return httpx.Forbidden("Live tracking is disabled for this event")
	}
	return nil
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	var in struct {
		ID          uuid.UUID   `json:"id"`
		EventID     *uuid.UUID  `json:"event_id"`
		StartedAt   *httpx.Time `json:"started_at"`
		IsSimulated bool        `json:"is_simulated"`
		Device      Device      `json:"device"`
	}
	if err := httpx.DecodeJSON(w, r, 16<<10, &in); err != nil {
		return err
	}
	d := map[string]string{}
	if in.ID == uuid.Nil {
		d["id"] = "required (client-generated UUID)"
	}
	if in.StartedAt == nil {
		d["started_at"] = "required"
	} else if in.StartedAt.After(time.Now().Add(10 * time.Minute)) {
		d["started_at"] = "must not be in the future"
	}
	if in.Device.Platform == "" {
		in.Device.Platform = "ios"
	}
	if len(in.Device.Platform) > 20 || len(in.Device.AppVersion) > 50 {
		d["device"] = "invalid"
	}
	if len(d) > 0 {
		return httpx.Validation(d)
	}
	// Idempotency: an existing id owned by the caller returns 200.
	if existing, err := Get(ctx, h.Q, in.ID.String()); err == nil {
		if existing.PilotID != a.UserID {
			return httpx.Conflict("Flight id already in use")
		}
		httpx.WriteJSON(w, http.StatusOK, DTO(existing))
		return nil
	} else if !db.NotFound(err) {
		return err
	}
	if in.EventID != nil {
		if err := checkEventForFlight(ctx, h.Q, *in.EventID, a); err != nil {
			return err
		}
	}
	created := false
	err := pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		for i := 0; i < 5; i++ {
			_, err := q.InsertFlight(ctx, dbq.InsertFlightParams{ID: in.ID, PublicID: slug.Random(10), PilotID: a.UserID, EventID: in.EventID,
				IsSimulated: in.IsSimulated, StartedAt: in.StartedAt.Time, DevicePlatform: in.Device.Platform,
				DeviceAppVersion: in.Device.AppVersion})
			if db.NotFound(err) {
				return nil // concurrent insert of the same id won
			}
			if db.IsUniqueViolation(err, "flight_sessions_public_id_key") {
				continue
			}
			if err != nil {
				return err
			}
			created = true
			return PublishFlight(ctx, q, in.ID)
		}
		return fmt.Errorf("could not allocate flight public id")
	})
	if err != nil {
		return err
	}
	row, err := Get(ctx, h.Q, in.ID.String())
	if err != nil {
		return err
	}
	if row.PilotID != a.UserID {
		return httpx.Conflict("Flight id already in use")
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpx.WriteJSON(w, status, DTO(row))
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
	p := dbq.ListFlightsParams{ViewerID: a.UserID, Statuses: []string{}, Lim: int32(lim + 1)}
	if s := qs.Get("status"); s != "" {
		for _, st := range strings.Split(s, ",") {
			st = strings.TrimSpace(st)
			if st != "recording" && st != "ended" && st != "abandoned" {
				return httpx.Validation(map[string]string{"status": "unknown status " + st})
			}
			p.Statuses = append(p.Statuses, st)
		}
	}
	pilotParam, eventParam := qs.Get("pilot_id"), qs.Get("event_id")
	switch {
	case eventParam != "":
		e, acc, err := events.LoadVisible(ctx, h.Q, eventParam, a)
		if err != nil {
			return err
		}
		switch authz.LiveScopeFor(a, events.Facts(e), acc) {
		case authz.LiveFull, authz.LivePilot:
		default:
			return httpx.Forbidden("Only organizers, observers and pilots of the event can list its flights")
		}
		p.EventID = &e.ID
		p.SeeAll = a.IsAdmin()
		if pilotParam != "" {
			pid, err := uuid.Parse(pilotParam)
			if err != nil {
				return httpx.Validation(map[string]string{"pilot_id": "must be a UUID"})
			}
			p.PilotID = &pid
		}
	case pilotParam != "":
		pid, err := uuid.Parse(pilotParam)
		if err != nil {
			return httpx.Validation(map[string]string{"pilot_id": "must be a UUID"})
		}
		p.PilotID = &pid
		if pid != a.UserID {
			p.OrganizerOnly = !a.IsAdmin() // only that pilot's flights in events the caller organises
			p.SeeAll = a.IsAdmin()
		}
	default:
		p.PilotID = &a.UserID
	}
	var cur struct {
		S  time.Time `json:"s"`
		ID uuid.UUID `json:"id"`
	}
	if ok, err := httpx.DecodeCursor(r, &cur); err != nil {
		return err
	} else if ok {
		p.AfterStarted, p.AfterID = &cur.S, &cur.ID
	}
	rows, err := h.Q.ListFlights(ctx, p)
	if err != nil {
		return err
	}
	out := httpx.Page[Flight]{Items: []Flight{}}
	for i, f := range rows {
		if i == lim {
			last := rows[lim-1].FlightSession
			out.NextCursor = httpx.EncodeCursor(map[string]any{"s": last.StartedAt, "id": last.ID})
			break
		}
		out.Items = append(out.Items, DTO(Row{f.FlightSession, f.PilotName, f.PilotPublicID}))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
	return nil
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) error {
	row, guest, err := LoadVisible(r.Context(), h.Q, chi.URLParam(r, "id"), authz.ActorFrom(r.Context()))
	if err != nil {
		return err
	}
	if guest {
		httpx.WriteJSON(w, http.StatusOK, PublicDTO(r.Context(), h.Q, row))
		return nil
	}
	httpx.WriteJSON(w, http.StatusOK, DTO(row))
	return nil
}

func (h *Handler) loadOwned(ctx context.Context, id string) (Row, error) {
	a := authz.ActorFrom(ctx)
	row, _, err := LoadVisible(ctx, h.Q, id, a)
	if err != nil {
		return Row{}, err
	}
	if row.PilotID != a.UserID {
		return Row{}, httpx.Forbidden("Only the pilot can modify this flight")
	}
	return row, nil
}

func (h *Handler) patch(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	row, err := h.loadOwned(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	var raw map[string]any
	if err := httpx.DecodeJSON(w, r, 8<<10, &raw); err != nil {
		return err
	}
	for k := range raw {
		if k != "event_id" {
			return httpx.Validation(map[string]string{k: "unknown or read-only field"})
		}
	}
	v, ok := raw["event_id"]
	if !ok {
		return h.get(w, r)
	}
	if row.Status != "recording" {
		return httpx.Conflict("The event of a flight can only be changed while recording")
	}
	eventID := row.EventID
	if v == nil {
		eventID = nil
	} else {
		s, _ := v.(string)
		id, err := uuid.Parse(s)
		if err != nil {
			return httpx.Validation(map[string]string{"event_id": "must be a UUID or null"})
		}
		if row.EventID == nil || *row.EventID != id {
			if err := checkEventForFlight(ctx, h.Q, id, authz.ActorFrom(ctx)); err != nil {
				return err
			}
		}
		eventID = &id
	}
	err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if err := q.UpdateFlightEvent(ctx, dbq.UpdateFlightEventParams{ID: row.ID, EventID: eventID}); err != nil {
			return err
		}
		return PublishFlight(ctx, q, row.ID)
	})
	if err != nil {
		return err
	}
	return h.get(w, r)
}

// RecomputeStats rebuilds a flight's statistics from all stored positions.
func RecomputeStats(ctx context.Context, q *dbq.Queries, flightID uuid.UUID) error {
	pos, err := q.ListAllPositions(ctx, flightID)
	if err != nil {
		return err
	}
	samples := make([]stats.Sample, len(pos))
	for i, p := range pos {
		samples[i] = stats.Sample{Seq: p.Seq, T: p.T, Lat: p.Lat, Lon: p.Lon, Alt: p.GpsAltM, HAcc: p.HAccM, SpeedMS: p.SpeedMs}
	}
	st := stats.Recompute(samples)
	return SaveStats(ctx, q, flightID, st, false)
}

// SaveStats persists aggregates and running state.
func SaveStats(ctx context.Context, q *dbq.Queries, flightID uuid.UUID, st stats.State, dirty bool) error {
	state, err := MarshalState(st)
	if err != nil {
		return err
	}
	return q.UpdateFlightStats(ctx, dbq.UpdateFlightStatsParams{ID: flightID, SampleCount: st.SampleCount, DistanceM: st.DistanceM,
		MaxGpsAltM: st.MaxAltM, MinGpsAltM: st.MinAltM, MaxGroundSpeedMs: st.MaxSpeedMS, TotalAscentM: st.AscentM,
		TotalDescentM: st.DescentM, GapCount: st.GapCount, FirstSampleT: st.FirstT, LastSampleT: st.LastSampleT,
		StatsState: state, StatsDirty: dirty})
}

func (h *Handler) end(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	row, err := h.loadOwned(ctx, chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	var in struct {
		EndedAt *httpx.Time `json:"ended_at"`
	}
	if err := httpx.DecodeOptionalJSON(w, r, 4<<10, &in); err != nil {
		return err
	}
	endedAt := time.Now()
	if in.EndedAt != nil {
		endedAt = in.EndedAt.Time
	}
	if endedAt.Before(row.StartedAt.Add(-time.Hour)) || endedAt.After(time.Now().Add(10*time.Minute)) {
		return httpx.Validation(map[string]string{"ended_at": "out of range"})
	}
	if row.Status == "recording" {
		err = pgx.BeginFunc(ctx, h.Pool, func(tx pgx.Tx) error {
			q := dbq.New(tx)
			if _, err := q.LockFlight(ctx, row.ID); err != nil {
				return err
			}
			if err := q.EndFlight(ctx, dbq.EndFlightParams{ID: row.ID, EndedAt: &endedAt}); err != nil {
				return err
			}
			if err := RecomputeStats(ctx, q, row.ID); err != nil {
				return err
			}
			return PublishFlight(ctx, q, row.ID)
		})
		if err != nil {
			return err
		}
	}
	return h.get(w, r)
}

func (h *Handler) positions(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	row, _, err := LoadVisible(ctx, h.Q, chi.URLParam(r, "id"), authz.ActorFrom(ctx))
	if err != nil {
		return err
	}
	qs := r.URL.Query()
	if qs.Get("simplify") == "true" {
		all, err := h.Q.ListAllPositions(ctx, row.ID)
		if err != nil {
			return err
		}
		tol := 5.0
		if s := qs.Get("tolerance_m"); s != "" {
			if v, err := strconv.ParseFloat(s, 64); err == nil && v > 0 && v <= 1000 {
				tol = v
			}
		}
		good := make([]dbq.ListAllPositionsRow, 0, len(all))
		for _, p := range all {
			if p.HAccM <= stats.MaxHAcc {
				good = append(good, p)
			}
		}
		pts := make([]geo.Point, len(good))
		for i, p := range good {
			pts[i] = geo.Point{Lat: p.Lat, Lon: p.Lon}
		}
		idx := geo.SimplifyMax(pts, tol, 5000)
		out := httpx.Page[Position]{Items: make([]Position, 0, len(idx))}
		for _, i := range idx {
			out.Items = append(out.Items, PositionFromRow(dbq.ListPositionsRow(good[i])))
		}
		httpx.WriteJSON(w, http.StatusOK, out)
		return nil
	}
	lim, err := httpx.Limit(r, 1000, 5000)
	if err != nil {
		return err
	}
	after := int32(-1)
	if s := qs.Get("after_seq"); s != "" {
		v, err := strconv.ParseInt(s, 10, 32)
		if err != nil {
			return httpx.Validation(map[string]string{"after_seq": "must be an integer"})
		}
		after = int32(v)
	}
	var cur struct {
		Seq int32 `json:"seq"`
	}
	if ok, err := httpx.DecodeCursor(r, &cur); err != nil {
		return err
	} else if ok {
		after = cur.Seq
	}
	rows, err := h.Q.ListPositions(ctx, dbq.ListPositionsParams{FlightID: row.ID, AfterSeq: after, Lim: int32(lim + 1)})
	if err != nil {
		return err
	}
	out := httpx.Page[Position]{Items: make([]Position, 0, len(rows))}
	for i, p := range rows {
		if i == lim {
			out.NextCursor = httpx.EncodeCursor(map[string]any{"seq": rows[lim-1].Seq})
			break
		}
		out.Items = append(out.Items, PositionFromRow(p))
	}
	httpx.WriteJSON(w, http.StatusOK, out)
	return nil
}

func (h *Handler) gpx(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	row, guest, err := LoadVisible(ctx, h.Q, chi.URLParam(r, "id"), authz.ActorFrom(ctx))
	if err != nil {
		return err
	}
	if guest {
		row.PilotName = displayName(ctx, h.Q, row)
	}
	all, err := h.Q.ListAllPositions(ctx, row.ID)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/gpx+xml; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="retfast-%s.gpx"`, row.PublicID))
	return WriteGPX(w, row, all)
}

// WriteGPX writes a GPX 1.1 document. It is an export, not a certified flight log.
func WriteGPX(w interface{ Write([]byte) (int, error) }, row Row, pos []dbq.ListAllPositionsRow) error {
	esc := func(s string) string {
		var b strings.Builder
		_ = xml.EscapeText(&b, []byte(s))
		return b.String()
	}
	name := fmt.Sprintf("%s – %s", row.PilotName, row.StartedAt.UTC().Format("2006-01-02 15:04"))
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<gpx version="1.1" creator="Retfast" xmlns="http://www.topografix.com/GPX/1/1">` + "\n")
	fmt.Fprintf(&b, "<metadata><name>%s</name><desc>%s</desc><time>%s</time></metadata>\n", esc(name),
		esc("Retfast GPS track export. Not a certified flight log."+map[bool]string{true: " SIMULATED FLIGHT.", false: ""}[row.IsSimulated]),
		row.StartedAt.UTC().Format(time.RFC3339))
	fmt.Fprintf(&b, "<trk><name>%s</name><trkseg>\n", esc(name))
	if _, err := w.Write([]byte(b.String())); err != nil {
		return err
	}
	var line strings.Builder
	for i, p := range pos {
		fmt.Fprintf(&line, `<trkpt lat="%.7f" lon="%.7f">`, p.Lat, p.Lon)
		if p.GpsAltM != nil {
			fmt.Fprintf(&line, "<ele>%.1f</ele>", *p.GpsAltM)
		}
		fmt.Fprintf(&line, "<time>%s</time></trkpt>\n", p.T.UTC().Format("2006-01-02T15:04:05.000Z"))
		if i%500 == 499 || i == len(pos)-1 {
			if _, err := w.Write([]byte(line.String())); err != nil {
				return err
			}
			line.Reset()
		}
	}
	_, err := w.Write([]byte("</trkseg></trk>\n</gpx>\n"))
	return err
}
