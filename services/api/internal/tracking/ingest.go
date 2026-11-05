// Package tracking implements telemetry ingestion (ADR-004), partition
// maintenance and background statistics recomputation.
package tracking

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/flights"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
	"github.com/mdenizay/retfast/services/api/internal/platform/ratelimit"
	"github.com/mdenizay/retfast/services/api/internal/realtime/bus"
	"github.com/mdenizay/retfast/services/api/internal/tracking/stats"
	"github.com/mdenizay/retfast/services/api/internal/users"
)

// Limits per the contract.
const (
	MaxSamples   = 500
	MaxBodyBytes = 512 << 10
)

// Rejection reasons. ReasonSampleConflict is the server's name for ADR-004's
// "sample_id reused with a different (flight_id, seq)" (client bug).
const (
	ReasonInvalidCoordinates = "invalid_coordinates"
	ReasonInvalidAccuracy    = "invalid_accuracy"
	ReasonTimestampRange     = "timestamp_out_of_range"
	ReasonFlightEnded        = "flight_ended"
	ReasonInvalidSpeed       = "invalid_speed"
	ReasonSampleConflict     = "sample_conflict"
)

// SampleIn is one submitted sample. Pointers distinguish missing from zero.
type SampleIn struct {
	ID        *uuid.UUID      `json:"id"`
	Seq       *int64          `json:"seq"`
	T         *httpx.Time     `json:"t"`
	DeviceT   *httpx.Time     `json:"device_t"`
	Lat       *float64        `json:"lat"`
	Lon       *float64        `json:"lon"`
	GPSAltM   *float64        `json:"gps_alt_m"`
	HAccM     *float64        `json:"h_acc_m"`
	VAccM     *float64        `json:"v_acc_m"`
	SpeedMS   *float64        `json:"speed_ms"`
	CourseDeg *float64        `json:"course_deg"`
	Meta      json.RawMessage `json:"meta"`
}

// BatchIn is the request body.
type BatchIn struct {
	BatchID  uuid.UUID  `json:"batch_id"`
	FlightID uuid.UUID  `json:"flight_id"`
	Samples  []SampleIn `json:"samples"`
}

// Rejection is a permanently rejected sample.
type Rejection struct {
	Seq    int64  `json:"seq"`
	Reason string `json:"reason"`
}

// BatchResult is the response body.
type BatchResult struct {
	BatchID     uuid.UUID   `json:"batch_id"`
	Accepted    []int64     `json:"accepted"`
	Duplicate   []int64     `json:"duplicate"`
	Rejected    []Rejection `json:"rejected"`
	MaxAckedSeq *int64      `json:"max_acked_seq"`
	ServerTime  httpx.Time  `json:"server_time"`
}

// valid is a sample that passed validation.
type valid struct {
	id  uuid.UUID
	seq int32
	in  *SampleIn
}

// ValidateStructure returns a 422 for batches that cannot be classified per sample.
func ValidateStructure(b *BatchIn) error {
	d := map[string]string{}
	if b.BatchID == uuid.Nil {
		d["batch_id"] = "required"
	}
	if b.FlightID == uuid.Nil {
		d["flight_id"] = "required"
	}
	if n := len(b.Samples); n < 1 || n > MaxSamples {
		d["samples"] = "must contain 1-500 samples"
	}
	for _, s := range b.Samples {
		if s.ID == nil || *s.ID == uuid.Nil {
			d["samples.id"] = "every sample needs a UUID id"
		}
		if s.Seq == nil || *s.Seq < 0 || *s.Seq > math.MaxInt32 {
			d["samples.seq"] = "every sample needs a seq in [0, 2^31)"
		}
	}
	if len(d) > 0 {
		return httpx.Validation(d)
	}
	return nil
}

// ValidateSample returns "" or a rejection reason. Core Location's negative
// sentinels for speed/course are normalised to null (not rejected).
func ValidateSample(s *SampleIn, now time.Time, startedAt time.Time, endedAt *time.Time) string {
	if s.Lat == nil || s.Lon == nil || math.IsNaN(*s.Lat) || math.IsNaN(*s.Lon) ||
		*s.Lat < -90 || *s.Lat > 90 || *s.Lon < -180 || *s.Lon > 180 || (*s.Lat == 0 && *s.Lon == 0) {
		return ReasonInvalidCoordinates
	}
	if s.GPSAltM != nil && (*s.GPSAltM < -1000 || *s.GPSAltM > 15000) {
		return ReasonInvalidCoordinates
	}
	if s.HAccM == nil || *s.HAccM <= 0 || *s.HAccM > 10000 {
		return ReasonInvalidAccuracy
	}
	if s.VAccM != nil && *s.VAccM < 0 {
		s.VAccM = nil
	}
	if s.VAccM != nil && *s.VAccM > 10000 {
		return ReasonInvalidAccuracy
	}
	if s.T == nil || s.T.After(now.Add(10*time.Minute)) || s.T.Before(startedAt.Add(-time.Hour)) {
		return ReasonTimestampRange
	}
	if endedAt != nil && s.T.After(endedAt.Add(10*time.Minute)) {
		return ReasonFlightEnded
	}
	if s.SpeedMS != nil {
		switch {
		case *s.SpeedMS < 0:
			s.SpeedMS = nil
		case *s.SpeedMS > 150:
			return ReasonInvalidSpeed
		}
	}
	if s.CourseDeg != nil && (*s.CourseDeg < 0 || *s.CourseDeg > 360) {
		s.CourseDeg = nil
	}
	if len(s.Meta) > 2048 {
		s.Meta = nil
	}
	return ""
}

// Ingestor processes batches.
type Ingestor struct {
	Pool    *pgxpool.Pool
	Metrics *metrics.Metrics
	Log     *slog.Logger
	Now     func() time.Time
}

// ErrNotOwner is returned when the caller does not own the flight.
var ErrNotOwner = httpx.Forbidden("Only the flight's pilot can upload telemetry")

// Ingest processes one batch for userID. The result is durable when returned.
func (ing *Ingestor) Ingest(ctx context.Context, userID uuid.UUID, b *BatchIn) (*BatchResult, error) {
	start := time.Now()
	nowFn := ing.Now
	if nowFn == nil {
		nowFn = time.Now
	}
	var res *BatchResult
	replayed := false
	err := pgx.BeginFunc(ctx, ing.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		fr, err := q.LockFlightWithPilot(ctx, b.FlightID)
		if db.NotFound(err) {
			return httpx.NotFound("Flight not found")
		}
		if err != nil {
			return err
		}
		f := fr.FlightSession
		if f.PilotID != userID {
			return ErrNotOwner
		}
		if _, err := q.ClaimBatch(ctx, dbq.ClaimBatchParams{BatchID: b.BatchID, FlightID: b.FlightID, UserID: userID}); db.NotFound(err) {
			prev, err := q.GetBatch(ctx, b.BatchID)
			if err != nil {
				return err
			}
			if prev.FlightID != b.FlightID || prev.UserID != userID {
				return httpx.Conflict("batch_id already used for another flight")
			}
			res = &BatchResult{}
			if err := json.Unmarshal(prev.Response, res); err != nil {
				return err
			}
			replayed = true
			return nil
		} else if err != nil {
			return err
		}
		now := nowFn()
		res = &BatchResult{BatchID: b.BatchID, Accepted: []int64{}, Duplicate: []int64{}, Rejected: []Rejection{}}

		// 1. validate; resolve in-batch repeats
		var cands []valid
		bySeq := map[int32]uuid.UUID{}
		byID := map[uuid.UUID]int32{}
		for i := range b.Samples {
			s := &b.Samples[i]
			seq := int32(*s.Seq)
			if prevID, ok := bySeq[seq]; ok {
				if prevID == *s.ID {
					res.Duplicate = append(res.Duplicate, int64(seq))
				} else {
					res.Rejected = append(res.Rejected, Rejection{int64(seq), ReasonSampleConflict})
				}
				continue
			}
			if prevSeq, ok := byID[*s.ID]; ok && prevSeq != seq {
				res.Rejected = append(res.Rejected, Rejection{int64(seq), ReasonSampleConflict})
				continue
			}
			if reason := ValidateSample(s, now, f.StartedAt, f.EndedAt); reason != "" {
				res.Rejected = append(res.Rejected, Rejection{int64(seq), reason})
				continue
			}
			bySeq[seq], byID[*s.ID] = *s.ID, seq
			cands = append(cands, valid{id: *s.ID, seq: seq, in: s})
		}

		// 2. global de-duplication through the unpartitioned key table
		var inserted []valid
		if len(cands) > 0 {
			seqs := make([]int32, len(cands))
			ids := make([]uuid.UUID, len(cands))
			for i, c := range cands {
				seqs[i], ids[i] = c.seq, c.id
			}
			got, err := q.InsertSampleKeys(ctx, dbq.InsertSampleKeysParams{FlightID: f.ID, Seqs: seqs, SampleIds: ids, ReceivedAt: now})
			if err != nil {
				return err
			}
			ok := make(map[int32]bool, len(got))
			for _, s := range got {
				ok[s] = true
			}
			var missing []int32
			for _, c := range cands {
				if ok[c.seq] {
					inserted = append(inserted, c)
				} else {
					missing = append(missing, c.seq)
				}
			}
			if len(missing) > 0 {
				existing, err := q.GetSampleKeysBySeq(ctx, dbq.GetSampleKeysBySeqParams{FlightID: f.ID, Seqs: missing})
				if err != nil {
					return err
				}
				have := make(map[int32]uuid.UUID, len(existing))
				for _, e := range existing {
					have[e.Seq] = e.SampleID
				}
				for _, c := range cands {
					if ok[c.seq] {
						continue
					}
					if id, found := have[c.seq]; found && id == c.id {
						res.Duplicate = append(res.Duplicate, int64(c.seq))
					} else {
						res.Rejected = append(res.Rejected, Rejection{int64(c.seq), ReasonSampleConflict})
					}
				}
			}
		}

		// 3. store originals
		if len(inserted) > 0 {
			rows := make([]dbq.CopyPositionsParams, len(inserted))
			for i, c := range inserted {
				var dt *time.Time
				if c.in.DeviceT != nil {
					t := c.in.DeviceT.Time
					dt = &t
				}
				var meta []byte
				if len(c.in.Meta) > 0 && json.Valid(c.in.Meta) && string(c.in.Meta) != "null" {
					meta = c.in.Meta
				}
				bid := b.BatchID
				rows[i] = dbq.CopyPositionsParams{FlightID: f.ID, Seq: c.seq, SampleID: c.id, BatchID: &bid, T: c.in.T.Time, DeviceT: dt,
					ReceivedAt: now, Lat: *c.in.Lat, Lon: *c.in.Lon, GpsAltM: c.in.GPSAltM, HAccM: *c.in.HAccM, VAccM: c.in.VAccM,
					SpeedMs: c.in.SpeedMS, CourseDeg: c.in.CourseDeg, Meta: meta}
			}
			if _, err := q.CopyPositions(ctx, rows); err != nil {
				return err
			}
			for _, c := range inserted {
				res.Accepted = append(res.Accepted, int64(c.seq))
			}
		}

		// 4. running stats and last position
		if len(inserted) > 0 {
			st := flights.StateFromRow(f)
			samples := make([]stats.Sample, len(inserted))
			for i, c := range inserted {
				samples[i] = stats.Sample{Seq: c.seq, T: c.in.T.Time, Lat: *c.in.Lat, Lon: *c.in.Lon, Alt: c.in.GPSAltM, HAcc: *c.in.HAccM, SpeedMS: c.in.SpeedMS}
			}
			dirty := st.Apply(samples) || f.StatsDirty
			stateJSON, err := flights.MarshalState(st)
			if err != nil {
				return err
			}
			latest := inserted[0]
			for _, c := range inserted[1:] {
				if c.seq > latest.seq {
					latest = c
				}
			}
			p := dbq.UpdateFlightAfterIngestParams{ID: f.ID, LastReceivedAt: &now, SampleCount: st.SampleCount, DistanceM: st.DistanceM,
				MaxGpsAltM: st.MaxAltM, MinGpsAltM: st.MinAltM, MaxGroundSpeedMs: st.MaxSpeedMS, TotalAscentM: st.AscentM,
				TotalDescentM: st.DescentM, GapCount: st.GapCount, FirstSampleT: st.FirstT, LastSampleT: st.LastSampleT,
				StatsState: stateJSON, StatsDirty: dirty,
				LastSampleID: f.LastSampleID, LastSeq: f.LastSeq, LastT: f.LastT, LastLat: f.LastLat, LastLon: f.LastLon,
				LastGpsAltM: f.LastGpsAltM, LastHAccM: f.LastHAccM, LastVAccM: f.LastVAccM, LastSpeedMs: f.LastSpeedMs,
				LastCourseDeg: f.LastCourseDeg, LastPositionReceivedAt: f.LastPositionReceivedAt}
			newLatest := f.LastSeq == nil || latest.seq > *f.LastSeq
			if newLatest {
				id, seq, t := latest.id, latest.seq, latest.in.T.Time
				p.LastSampleID, p.LastSeq, p.LastT = &id, &seq, &t
				p.LastLat, p.LastLon, p.LastGpsAltM = latest.in.Lat, latest.in.Lon, latest.in.GPSAltM
				p.LastHAccM, p.LastVAccM, p.LastSpeedMs, p.LastCourseDeg = latest.in.HAccM, latest.in.VAccM, latest.in.SpeedMS, latest.in.CourseDeg
				p.LastPositionReceivedAt = &now
			}
			if err := q.UpdateFlightAfterIngest(ctx, p); err != nil {
				return err
			}
			// 5. realtime outbox (same transaction)
			if newLatest {
				pos := flights.Position{ID: latest.id, Seq: latest.seq, T: httpx.T(latest.in.T.Time), ReceivedAt: httpx.T(now),
					Lat: *latest.in.Lat, Lon: *latest.in.Lon, GPSAltM: latest.in.GPSAltM, HAccM: *latest.in.HAccM, VAccM: latest.in.VAccM,
					SpeedMS: latest.in.SpeedMS, CourseDeg: latest.in.CourseDeg}
				type posData struct {
					FlightID    uuid.UUID        `json:"flight_id"`
					Pilot       users.PilotRef   `json:"pilot"`
					IsSimulated bool             `json:"is_simulated"`
					Status      string           `json:"status"`
					Position    flights.Position `json:"position"`
				}
				pilot := users.PilotRef{UserID: f.PilotID, FullName: fr.PilotName, PublicID: fr.PilotPublicID}
				data, _ := json.Marshal(posData{f.ID, pilot, f.IsSimulated, "recording", pos})
				pilot.FullName = fr.PilotDisplayName
				pub, _ := json.Marshal(posData{f.ID, pilot, f.IsSimulated, "recording", pos})
				fid, owner := f.ID, f.PilotID
				if err := bus.Write(ctx, q, bus.Envelope{Type: bus.TypePosition, EventID: f.EventID, FlightID: &fid, OwnerID: &owner,
					Data: data, PublicData: pub, ServerReceivedMS: now.UnixMilli()}); err != nil {
					return err
				}
			}
		}

		sortInts(res.Accepted)
		sortInts(res.Duplicate)
		sort.Slice(res.Rejected, func(i, j int) bool { return res.Rejected[i].Seq < res.Rejected[j].Seq })
		for _, s := range append(append([]int64{}, res.Accepted...), res.Duplicate...) {
			if res.MaxAckedSeq == nil || s > *res.MaxAckedSeq {
				v := s
				res.MaxAckedSeq = &v
			}
		}
		res.ServerTime = httpx.T(now)
		stored, err := json.Marshal(res)
		if err != nil {
			return err
		}
		return q.SetBatchResponse(ctx, dbq.SetBatchResponseParams{BatchID: b.BatchID, Response: stored})
	})
	if err != nil {
		var he *httpx.Error
		if !errors.As(err, &he) {
			ing.Metrics.TelemetryBatches.WithLabelValues("error").Inc()
		}
		return nil, err
	}
	ing.Metrics.TelemetryLatency.Observe(time.Since(start).Seconds())
	if replayed {
		ing.Metrics.TelemetryBatches.WithLabelValues("replayed").Inc()
		res.ServerTime = httpx.T(nowFn())
		return res, nil
	}
	ing.Metrics.TelemetryBatches.WithLabelValues("processed").Inc()
	ing.Metrics.TelemetrySamples.WithLabelValues("accepted").Add(float64(len(res.Accepted)))
	ing.Metrics.TelemetrySamples.WithLabelValues("duplicate").Add(float64(len(res.Duplicate)))
	ing.Metrics.TelemetrySamples.WithLabelValues("rejected").Add(float64(len(res.Rejected)))
	return res, nil
}

func sortInts(s []int64) { sort.Slice(s, func(i, j int) bool { return s[i] < s[j] }) }

// Handler serves POST /telemetry/batches.
type Handler struct {
	Ingestor *Ingestor
	Limiter  *ratelimit.Limiter
}

// Routes mounts the endpoint (required auth).
func (h *Handler) Routes(r chi.Router) {
	r.Post("/telemetry/batches", httpx.H(h.post))
}

func (h *Handler) post(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	a := authz.ActorFrom(ctx)
	if ok, retry := h.Limiter.Allow(ctx, ratelimit.Telemetry, a.UserID.String()); !ok {
		return httpx.RateLimited(retry)
	}
	var b BatchIn
	if err := httpx.DecodeJSON(w, r, MaxBodyBytes, &b); err != nil {
		return err
	}
	if err := ValidateStructure(&b); err != nil {
		return err
	}
	res, err := h.Ingestor.Ingest(ctx, a.UserID, &b)
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, res)
	return nil
}
