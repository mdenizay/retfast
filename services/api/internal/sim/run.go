package sim

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"net/http"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

// Account is one simulator login.
type Account struct {
	Email    string
	Password string
	Name     string
}

// Config controls a simulation run.
type Config struct {
	API               string
	Event             string // slug or id
	Accounts          []Account
	Register          bool // create accounts that do not exist (dev/staging)
	AllowProdRegister bool
	Seed              uint64
	SampleInterval    time.Duration
	BatchInterval     time.Duration
	Duration          time.Duration // 0: until every pilot has landed
	// Approver (organizer or admin of the event) approves the simulator
	// accounts' applications; nil means the accounts must already be members.
	Approver *Account
	// LandWithin starts each pilot late in its route so it lands within this
	// duration (0: use StartOffsetMax).
	LandWithin time.Duration
	// Retrievals: after landing the pilot requests a retrieval; Retrievers
	// accept and complete simulated requests.
	Retrievals            bool
	Retrievers            []Account
	DriveSpeed            float64 // m/s
	RetrieverInterval     time.Duration
	PilotPositionInterval time.Duration
	PickupDelay           time.Duration
	DeliveryDriveMax      time.Duration
	RetrievalTimeout      time.Duration
	DegradeProbPerMin     float64
	OutageProbPerMin      float64
	OutageMin, OutageMax  time.Duration
	InactivityProbPerMin  float64
	InactivityMin         time.Duration
	InactivityMax         time.Duration
	DupProb               float64
	StartOffsetMax        time.Duration
	EndOnExit             bool
	WSSubscribers         int
	ForwardIPs            bool
	// Stagger spreads pilot start times across one batch interval (real phones
	// are not synchronised); without it every pilot uploads in the same instant.
	Stagger bool
	Logf    func(format string, args ...any)
}

// Percentiles summarises a latency distribution in milliseconds.
type Percentiles struct {
	Count int     `json:"count"`
	P50   float64 `json:"p50_ms"`
	P95   float64 `json:"p95_ms"`
	P99   float64 `json:"p99_ms"`
	Max   float64 `json:"max_ms"`
	Mean  float64 `json:"mean_ms"`
}

func percentiles(v []float64) Percentiles {
	if len(v) == 0 {
		return Percentiles{}
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	at := func(q float64) float64 { return s[int(math.Min(float64(len(s)-1), math.Ceil(q*float64(len(s)))-1))] }
	sum := 0.0
	for _, x := range s {
		sum += x
	}
	r := func(x float64) float64 { return math.Round(x*10) / 10 }
	return Percentiles{Count: len(s), P50: r(at(0.50)), P95: r(at(0.95)), P99: r(at(0.99)), Max: r(s[len(s)-1]), Mean: r(sum / float64(len(s)))}
}

// Report is the run summary.
type Report struct {
	API                  string          `json:"api"`
	Environment          string          `json:"environment"`
	Event                string          `json:"event"`
	Pilots               int             `json:"pilots"`
	PilotsStarted        int             `json:"pilots_started"`
	PilotsLanded         int             `json:"pilots_landed"`
	Seed                 uint64          `json:"seed"`
	StartedAt            time.Time       `json:"started_at"`
	DurationS            float64         `json:"duration_s"`
	SampleIntervalS      float64         `json:"sample_interval_s"`
	BatchIntervalS       float64         `json:"batch_interval_s"`
	SamplesGenerated     int64           `json:"samples_generated"`
	Batches              int64           `json:"batches_ok"`
	BatchFailures        int64           `json:"batch_failures"`
	Retries              int64           `json:"retries"`
	Accepted             int64           `json:"accepted"`
	Duplicates           int64           `json:"duplicates"`
	Rejected             int64           `json:"rejected"`
	InjectedDuplicates   int64           `json:"injected_duplicate_resends"`
	Outages              int64           `json:"network_outages_simulated"`
	ThroughputSamplesS   float64         `json:"throughput_acked_samples_per_s"`
	ThroughputBatchesS   float64         `json:"throughput_batches_per_s"`
	IngestLatency        Percentiles     `json:"ingest_latency"`
	WSSubscribers        int             `json:"ws_subscribers"`
	WSMessages           int64           `json:"ws_position_messages"`
	WSDelayFromServer    Percentiles     `json:"ws_delay_server_receive_to_client"`
	WSDelayFromSample    Percentiles     `json:"ws_delay_sample_t_to_client"`
	Errors               map[string]int  `json:"errors"`
	ClientCPUs           int             `json:"client_cpus"`
	ClientGOOS           string          `json:"client_goos"`
	ClientGOARCH         string          `json:"client_goarch"`
	ServerOutboxNote     string          `json:"note,omitempty"`
	RejectedReasons      map[string]int  `json:"rejected_reasons"`
	WSDisconnects        int64           `json:"ws_disconnects"`
	SetupFailures        int64           `json:"setup_failures"`
	BufferedAtEnd        int64           `json:"samples_unsent_at_end"`
	FlightsEnded         int64           `json:"flights_ended"`
	MaxBufferedPerPilot  int64           `json:"max_buffered_samples_per_pilot"`
	Staggered            bool            `json:"staggered_start"`
	Retrievers           int             `json:"retrievers,omitempty"`
	Retrievals           *RetrievalStats `json:"retrievals,omitempty"`
	LatencySamplesWindow string          `json:"latency_window"`
}

type collector struct {
	mu                        sync.Mutex
	lat                       []float64
	wsServer, wsSample        []float64
	errors                    map[string]int
	reasons                   map[string]int
	generated, batches, fails atomic.Int64
	retries, acc, dup, rej    atomic.Int64
	injected, outages, wsMsgs atomic.Int64
	wsDisc, setupFail, unsent atomic.Int64
	landed, started, ended    atomic.Int64
	maxBuf                    atomic.Int64
	ret                       retCounters
}

func (c *collector) err(k string) {
	c.mu.Lock()
	c.errors[k]++
	c.mu.Unlock()
}

type wireSample struct {
	ID        uuid.UUID      `json:"id"`
	Seq       int64          `json:"seq"`
	T         string         `json:"t"`
	DeviceT   string         `json:"device_t"`
	Lat       float64        `json:"lat"`
	Lon       float64        `json:"lon"`
	GPSAltM   float64        `json:"gps_alt_m"`
	HAccM     float64        `json:"h_acc_m"`
	VAccM     float64        `json:"v_acc_m"`
	SpeedMS   float64        `json:"speed_ms"`
	CourseDeg float64        `json:"course_deg"`
	Meta      map[string]any `json:"meta"`
}

const tsFormat = "2006-01-02T15:04:05.000Z"

// Run executes the simulation and returns a report. It only creates simulated
// flights and retrievals and never acts on a real pilot's retrieval.
func Run(ctx context.Context, cfg Config) (*Report, error) {
	if cfg.SampleInterval <= 0 {
		cfg.SampleInterval = time.Second
	}
	if cfg.BatchInterval <= 0 {
		cfg.BatchInterval = 5 * time.Second
	}
	if cfg.DriveSpeed <= 0 {
		cfg.DriveSpeed = 15
	}
	if cfg.RetrieverInterval <= 0 {
		cfg.RetrieverInterval = 3 * time.Second
	}
	if cfg.PilotPositionInterval <= 0 {
		cfg.PilotPositionInterval = 10 * time.Second
	}
	if cfg.PickupDelay <= 0 {
		cfg.PickupDelay = 10 * time.Second
	}
	if cfg.DeliveryDriveMax <= 0 {
		cfg.DeliveryDriveMax = 3 * time.Minute
	}
	if cfg.RetrievalTimeout <= 0 {
		cfg.RetrievalTimeout = 20 * time.Minute
	}
	if cfg.Logf == nil {
		cfg.Logf = func(string, ...any) {}
	}
	hc := NewHTTPClient()
	meta, err := GetMeta(ctx, hc, cfg.API)
	if err != nil {
		return nil, fmt.Errorf("GET /meta: %w", err)
	}
	if cfg.Register && meta.Environment == "production" && !cfg.AllowProdRegister {
		return nil, errors.New("refusing --register against a production API (pass --allow-prod-register to override)")
	}
	if len(cfg.Accounts) == 0 {
		return nil, errors.New("no accounts configured")
	}
	col := &collector{errors: map[string]int{}, reasons: map[string]int{}}
	rep := &Report{API: cfg.API, Environment: meta.Environment, Event: cfg.Event, Pilots: len(cfg.Accounts), Seed: cfg.Seed,
		StartedAt: time.Now().UTC(), SampleIntervalS: cfg.SampleInterval.Seconds(), BatchIntervalS: cfg.BatchInterval.Seconds(),
		ClientCPUs: runtime.NumCPU(), ClientGOOS: runtime.GOOS, ClientGOARCH: runtime.GOARCH}

	runCtx := ctx
	var cancel context.CancelFunc
	if cfg.Duration > 0 {
		runCtx, cancel = context.WithTimeout(ctx, cfg.Duration)
		defer cancel()
	}

	// setup: sign in (or register) and become a member (apply → approve), with bounded concurrency
	var approver *Client
	if cfg.Approver != nil {
		approver = &Client{Base: cfg.API, HTTP: hc, Email: cfg.Approver.Email, Password: cfg.Approver.Password}
		if err := approver.Login(ctx); err != nil {
			return nil, fmt.Errorf("approver login: %w", err)
		}
	}
	clients := make([]*Client, len(cfg.Accounts))
	retrievers := make([]*Client, len(cfg.Retrievers))
	var eventID string
	var evMu sync.Mutex
	sem := make(chan struct{}, 32)
	var wg sync.WaitGroup
	setup := func(i int, acc Account, role string, out []*Client, ipBase int) {
		defer wg.Done()
		sem <- struct{}{}
		defer func() { <-sem }()
		c := &Client{Base: cfg.API, HTTP: hc, Email: acc.Email, Password: acc.Password}
		if cfg.ForwardIPs {
			c.ForwardIP = fmt.Sprintf("10.%d.%d.%d", ipBase, (i>>8)&255, i&255)
		}
		err := c.Login(ctx)
		var ae *APIError
		if cfg.Register && errors.As(err, &ae) && ae.Status == 401 {
			err = c.Register(ctx, acc.Name)
			if errors.As(err, &ae) && ae.Status == 409 {
				err = fmt.Errorf("account %s exists but the password does not match", acc.Email)
			}
		}
		if err != nil {
			col.setupFail.Add(1)
			col.err("setup: " + short(err))
			cfg.Logf("%s %d (%s): setup failed: %v", role, i, acc.Email, err)
			return
		}
		var ev Event
		if err := c.Call(ctx, "GET", "/events/"+cfg.Event, nil, &ev); err != nil {
			col.setupFail.Add(1)
			col.err("event: " + short(err))
			return
		}
		if meta.Environment == "production" && !ev.IsDemo {
			col.setupFail.Add(1)
			col.err("refusing to simulate in a non-demo event in production")
			return
		}
		if ev, err = EnsureMember(ctx, c, approver, ev.ID, role); err != nil {
			col.setupFail.Add(1)
			col.err("membership: " + short(err))
			cfg.Logf("%s %d (%s): %v", role, i, acc.Email, err)
			return
		}
		evMu.Lock()
		eventID = ev.ID
		evMu.Unlock()
		out[i] = c
	}
	for i, acc := range cfg.Accounts {
		wg.Add(1)
		go setup(i, acc, "pilot", clients, 77)
	}
	if cfg.Retrievals {
		for i, acc := range cfg.Retrievers {
			wg.Add(1)
			go setup(i, acc, "retriever", retrievers, 78)
		}
	}
	wg.Wait()
	if eventID == "" {
		return rep, fmt.Errorf("no pilot could be set up: %v", col.errors)
	}
	simPilots := map[string]bool{}
	for _, c := range clients {
		if c != nil {
			simPilots[c.UserID] = true
		}
	}
	retCtx, retCancel := context.WithCancel(ctx)
	var rw sync.WaitGroup
	for i, c := range retrievers {
		if c == nil {
			continue
		}
		rw.Add(1)
		go func(i int, c *Client) {
			defer rw.Done()
			runRetriever(retCtx, cfg, i, c, eventID, simPilots, col)
		}(i, c)
	}

	// WebSocket observers measure propagation delay
	var wsWG sync.WaitGroup
	wsCtx, wsCancel := context.WithCancel(ctx)
	for k := 0; k < cfg.WSSubscribers; k++ {
		var token string
		for j := range clients {
			if c := clients[(k+j)%len(clients)]; c != nil {
				token = c.Access()
				break
			}
		}
		wsWG.Add(1)
		go func() {
			defer wsWG.Done()
			observe(wsCtx, cfg.API, token, eventID, col)
		}()
	}
	if cfg.WSSubscribers > 0 {
		time.Sleep(500 * time.Millisecond) // let subscriptions settle before traffic
	}

	start := time.Now()
	var pw sync.WaitGroup
	for i, c := range clients {
		if c == nil {
			continue
		}
		pw.Add(1)
		col.started.Add(1)
		go func(i int, c *Client) {
			defer pw.Done()
			runPilot(runCtx, ctx, cfg, i, c, eventID, col)
		}(i, c)
	}
	pw.Wait()
	retCancel()
	rw.Wait()
	elapsed := time.Since(start)
	wsCancel()
	wsWG.Wait()

	rep.PilotsStarted = int(col.started.Load())
	rep.PilotsLanded = int(col.landed.Load())
	rep.DurationS = math.Round(elapsed.Seconds()*10) / 10
	rep.SamplesGenerated = col.generated.Load()
	rep.Batches, rep.BatchFailures, rep.Retries = col.batches.Load(), col.fails.Load(), col.retries.Load()
	rep.Accepted, rep.Duplicates, rep.Rejected = col.acc.Load(), col.dup.Load(), col.rej.Load()
	rep.InjectedDuplicates, rep.Outages = col.injected.Load(), col.outages.Load()
	rep.ThroughputSamplesS = math.Round(float64(rep.Accepted+rep.Duplicates)/elapsed.Seconds()*10) / 10
	rep.ThroughputBatchesS = math.Round(float64(rep.Batches)/elapsed.Seconds()*10) / 10
	col.mu.Lock()
	rep.IngestLatency = percentiles(col.lat)
	rep.WSDelayFromServer = percentiles(col.wsServer)
	rep.WSDelayFromSample = percentiles(col.wsSample)
	rep.Errors = col.errors
	rep.RejectedReasons = col.reasons
	col.mu.Unlock()
	rep.WSSubscribers = cfg.WSSubscribers
	rep.WSMessages = col.wsMsgs.Load()
	rep.WSDisconnects = col.wsDisc.Load()
	rep.SetupFailures = col.setupFail.Load()
	rep.BufferedAtEnd = col.unsent.Load()
	rep.FlightsEnded = col.ended.Load()
	rep.MaxBufferedPerPilot = col.maxBuf.Load()
	rep.Staggered = cfg.Stagger
	if cfg.Retrievals {
		st := col.ret.stats()
		rep.Retrievals = &st
		rep.Retrievers = len(cfg.Retrievers)
	}
	rep.LatencySamplesWindow = "client-measured round trip of POST /telemetry/batches, including retries' final attempt only"
	return rep, nil
}

func short(err error) string {
	s := err.Error()
	if i := strings.Index(s, ":"); i > 0 && i < 40 {
		var ae *APIError
		if errors.As(err, &ae) {
			return fmt.Sprintf("http %d %s", ae.Status, ae.Code)
		}
	}
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}

// window is a [from, to) interval relative to the pilot's start.
type window struct{ from, to time.Duration }

func schedule(rng *rand.Rand, probPerMin float64, minD, maxD, horizon time.Duration) []window {
	var out []window
	if probPerMin <= 0 {
		return out
	}
	for m := time.Duration(0); m < horizon; m += time.Minute {
		if rng.Float64() < probPerMin {
			start := m + time.Duration(rng.Float64()*float64(time.Minute))
			d := minD + time.Duration(rng.Float64()*float64(maxD-minD))
			out = append(out, window{start, start + d})
		}
	}
	return out
}

func in(ws []window, d time.Duration) bool {
	for _, w := range ws {
		if d >= w.from && d < w.to {
			return true
		}
	}
	return false
}

// runPilot records and uploads one synthetic flight. runCtx bounds the
// simulated recording; baseCtx is used for the final flush and flight end.
func runPilot(runCtx, baseCtx context.Context, cfg Config, idx int, c *Client, eventID string, col *collector) {
	rng := rand.New(rand.NewPCG(cfg.Seed^0xA5A5, uint64(idx)+7))
	route := NewRoute(RouteConfig{Seed: cfg.Seed, Pilot: idx, Interval: cfg.SampleInterval, DegradeProbPerMin: cfg.DegradeProbPerMin})
	skip := 0
	if cfg.LandWithin > 0 {
		skip = skipForLanding(RouteConfig{Seed: cfg.Seed, Pilot: idx, Interval: cfg.SampleInterval, DegradeProbPerMin: cfg.DegradeProbPerMin}, rng, cfg.LandWithin)
	} else if cfg.StartOffsetMax > 0 {
		skip = rng.IntN(int(cfg.StartOffsetMax/cfg.SampleInterval) + 1)
	}
	for i := 0; i < skip && !route.Done(); i++ {
		route.Next()
	}
	horizon := 6 * time.Hour
	outages := schedule(rng, cfg.OutageProbPerMin, cfg.OutageMin, cfg.OutageMax, horizon)
	inactive := schedule(rng, cfg.InactivityProbPerMin, cfg.InactivityMin, cfg.InactivityMax, horizon)

	if cfg.Stagger {
		select {
		case <-time.After(time.Duration(rng.Float64() * float64(cfg.BatchInterval))):
		case <-runCtx.Done():
			return
		}
	}
	flightID := uuid.New()
	started := time.Now().Add(-time.Duration(skip) * cfg.SampleInterval)
	if err := c.Call(baseCtx, "POST", "/flights", map[string]any{"id": flightID, "event_id": eventID, "started_at": started.UTC().Format(tsFormat),
		"is_simulated": true, "device": map[string]any{"platform": "ios", "app_version": "simulator"}}, nil); err != nil {
		col.err("create flight: " + short(err))
		col.setupFail.Add(1)
		return
	}
	var buf []wireSample
	var last []wireSample // last successfully sent batch, for duplicate injection
	seq := int64(0)
	begin := time.Now()
	tick := time.NewTicker(cfg.SampleInterval)
	defer tick.Stop()
	nextBatch := begin.Add(cfg.BatchInterval)
	wasOut := false
	var lastFix *Point

	flush := func(ctx context.Context) {
		for len(buf) > 0 {
			n := min(len(buf), 500)
			batch := buf[:n]
			res, ok := sendBatch(ctx, c, flightID, uuid.New(), batch, col)
			if !ok {
				return // keep buffered; retry at the next batch tick
			}
			done := map[int64]bool{}
			for _, s := range res.Accepted {
				done[s] = true
			}
			for _, s := range res.Duplicate {
				done[s] = true
			}
			for _, r := range res.Rejected {
				done[r.Seq] = true // permanent: keep locally, never retry (here: drop from the send buffer)
			}
			kept := buf[:0:0]
			for _, s := range buf {
				if !done[s.Seq] {
					kept = append(kept, s)
				}
			}
			if len(kept) == len(buf) {
				return
			}
			last = append(last[:0], batch...)
			buf = kept
			// duplicate re-send: the "response was lost" case, same samples under a new batch id
			if cfg.DupProb > 0 && rng.Float64() < cfg.DupProb && len(last) > 0 {
				col.injected.Add(1)
				sendBatch(ctx, c, flightID, uuid.New(), last, col)
			}
		}
	}

	for {
		select {
		case <-runCtx.Done():
			flush(baseCtx)
			col.unsent.Add(int64(len(buf)))
			if cfg.EndOnExit {
				endFlight(baseCtx, c, flightID, col)
			}
			return
		case now := <-tick.C:
			rel := now.Sub(begin)
			if !in(inactive, rel) {
				p := route.Next()
				lastFix = &p
				t := now.UTC()
				buf = append(buf, wireSample{ID: uuid.New(), Seq: seq, T: t.Format(tsFormat), DeviceT: t.Add(time.Duration(rng.IntN(80)) * time.Millisecond).Format(tsFormat),
					Lat: round6(p.Lat), Lon: round6(p.Lon), GPSAltM: round1(p.AltM), HAccM: p.HAccM, VAccM: p.VAccM, SpeedMS: p.SpeedMS, CourseDeg: p.Course,
					Meta: map[string]any{"profile": p.Phase, "battery": p.Battery, "low_power": false, "simulated": true}})
				seq++
				col.generated.Add(1)
				if b := int64(len(buf)); b > col.maxBuf.Load() {
					col.maxBuf.Store(b)
				}
			}
			out := in(outages, rel)
			if out && !wasOut {
				col.outages.Add(1)
			}
			wasOut = out
			if !now.Before(nextBatch) {
				nextBatch = nextBatch.Add(cfg.BatchInterval)
				if !out {
					flush(baseCtx)
				}
			}
			if route.Done() {
				flush(baseCtx)
				col.unsent.Add(int64(len(buf)))
				endFlight(baseCtx, c, flightID, col)
				col.landed.Add(1)
				if cfg.Retrievals && lastFix != nil {
					pilotRetrieval(baseCtx, cfg, idx, c, eventID, flightID, lastFix.Lat, lastFix.Lon, lastFix.AltM, col)
				}
				return
			}
		}
	}
}

func endFlight(ctx context.Context, c *Client, id uuid.UUID, col *collector) {
	if err := c.Call(ctx, "POST", "/flights/"+id.String()+"/end", map[string]any{"ended_at": time.Now().UTC().Format(tsFormat)}, nil); err != nil {
		col.err("end flight: " + short(err))
		return
	}
	col.ended.Add(1)
}

// sendBatch posts one batch, retrying the same batch id (idempotent) on
// network errors, 5xx and 429.
func sendBatch(ctx context.Context, c *Client, flightID, batchID uuid.UUID, samples []wireSample, col *collector) (BatchResult, bool) {
	body := map[string]any{"batch_id": batchID, "flight_id": flightID, "samples": samples}
	var res BatchResult
	for attempt := 0; attempt < 5; attempt++ {
		t0 := time.Now()
		err := c.Call(ctx, "POST", "/telemetry/batches", body, &res)
		ms := float64(time.Since(t0).Microseconds()) / 1000
		if err == nil {
			col.batches.Add(1)
			col.acc.Add(int64(len(res.Accepted)))
			col.dup.Add(int64(len(res.Duplicate)))
			col.rej.Add(int64(len(res.Rejected)))
			col.mu.Lock()
			col.lat = append(col.lat, ms)
			for _, r := range res.Rejected {
				col.reasons[r.Reason]++
			}
			col.mu.Unlock()
			return res, true
		}
		var ae *APIError
		wait := time.Duration(250*(1<<attempt)) * time.Millisecond
		switch {
		case errors.As(err, &ae) && ae.Status == http.StatusTooManyRequests:
			col.err("http 429")
			if ae.RetryAfter > 0 {
				wait = ae.RetryAfter
			}
		case errors.As(err, &ae) && ae.Status < 500:
			col.err(fmt.Sprintf("http %d %s", ae.Status, ae.Code))
			col.fails.Add(1)
			return res, false
		default:
			col.err("transient: " + short(err))
		}
		col.retries.Add(1)
		select {
		case <-ctx.Done():
			col.fails.Add(1)
			return res, false
		case <-time.After(wait):
		}
	}
	col.fails.Add(1)
	return res, false
}

func round6(v float64) float64 { return math.Round(v*1e6) / 1e6 }

// observe subscribes to the event channel and records propagation delays.
func observe(ctx context.Context, api, token, eventID string, col *collector) {
	wsURL := "ws" + strings.TrimPrefix(api, "http") + "/realtime"
	for ctx.Err() == nil {
		c, _, err := websocket.Dial(ctx, wsURL, nil)
		if err != nil {
			col.err("ws dial: " + short(err))
			time.Sleep(time.Second)
			continue
		}
		c.SetReadLimit(8 << 20)
		send := func(v any) { b, _ := json.Marshal(v); _ = c.Write(ctx, websocket.MessageText, b) }
		if token != "" {
			send(map[string]any{"type": "auth", "access_token": token})
		}
		send(map[string]any{"type": "subscribe", "channel": "event:" + eventID})
		for {
			_, b, err := c.Read(ctx)
			if err != nil {
				if ctx.Err() == nil {
					col.wsDisc.Add(1)
					col.err(fmt.Sprintf("ws closed %d", websocket.CloseStatus(err)))
				}
				break
			}
			recv := time.Now()
			var m struct {
				Type  string `json:"type"`
				SrvMS int64  `json:"server_received_ms"`
				Data  struct {
					Position struct {
						T string `json:"t"`
					} `json:"position"`
				} `json:"data"`
			}
			if json.Unmarshal(b, &m) != nil {
				continue
			}
			switch m.Type {
			case "ping":
				send(map[string]string{"type": "pong"})
			case "position":
				col.wsMsgs.Add(1)
				col.mu.Lock()
				if m.SrvMS > 0 {
					col.wsServer = append(col.wsServer, float64(recv.UnixMicro()-m.SrvMS*1000)/1000)
				}
				if t, err := time.Parse(time.RFC3339Nano, m.Data.Position.T); err == nil {
					col.wsSample = append(col.wsSample, float64(recv.Sub(t).Microseconds())/1000)
				}
				col.mu.Unlock()
			}
		}
		c.CloseNow()
	}
}
