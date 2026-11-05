// Command retfast-simulator flies deterministic synthetic paragliding flights
// around Denizli Teleferik through the public Retfast API. Flights are created with
// is_simulated=true. With --retrievals, landed pilots request retrievals
// (is_simulated) and simulated retrievers complete them; they never touch a
// real pilot's retrieval.
//
// Accounts come from --accounts-csv (email,password[,name]), from
// --email-pattern/--password, or are created with --register (refused against
// a production API unless --allow-prod-register). Accounts that are not yet
// members apply to the event; --approver-email/--approver-password (an
// organizer or admin of the event) approves them. In production it only flies
// in demo events (ADR-011).
package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/mdenizay/retfast/services/api/internal/sim"
)

func main() {
	fs := flag.NewFlagSet("retfast-simulator", flag.ExitOnError)
	api := fs.String("api", "http://localhost:8080/api/v1", "API base URL")
	event := fs.String("event", "cameli-paragliding-demo", "event slug or id to fly in")
	pilots := fs.Int("pilots", 20, "number of pilots (with --email-pattern / --register)")
	seed := fs.Uint64("seed", 42, "deterministic seed for routes and disturbances")
	sampleIv := fs.Duration("sample-interval", time.Second, "GPS sample interval")
	batchIv := fs.Duration("batch-interval", 5*time.Second, "upload interval")
	duration := fs.Duration("duration", 0, "stop after this long (0 = until every pilot lands)")
	accountsCSV := fs.String("accounts-csv", "", "CSV file of email,password[,name]")
	pattern := fs.String("email-pattern", "sim-%03d@sim.retfast.local", "email pattern (fmt, pilot index from 1)")
	password := fs.String("password", "", "password for --email-pattern accounts (or RETFAST_SIM_PASSWORD)")
	register := fs.Bool("register", false, "register missing --email-pattern accounts (development/staging only)")
	allowProd := fs.Bool("allow-prod-register", false, "allow --register against a production API")
	approverEmail := fs.String("approver-email", "", "organizer/admin account that approves the simulator accounts' applications")
	approverPassword := fs.String("approver-password", "", "password for --approver-email (or RETFAST_SIM_APPROVER_PASSWORD)")
	landWithin := fs.Duration("land-within", 0, "start each pilot late in its route so it lands within this duration (0 = use --start-offset-max)")
	retrievals := fs.Bool("retrievals", false, "after landing, request a retrieval; simulated retrievers accept, drive, pick up and deliver")
	nRetrievers := fs.Int("retrievers", 2, "number of simulated retrievers (with --retrievals)")
	retrieverPattern := fs.String("retriever-email-pattern", "sim-retriever-%03d@sim.retfast.local", "retriever email pattern (fmt, index from 1)")
	retrieverCSV := fs.String("retrievers-csv", "", "CSV file of retriever accounts email,password[,name] (instead of the pattern)")
	driveSpeed := fs.Float64("drive-speed", 15, "retriever road speed in m/s")
	retrieverIv := fs.Duration("retriever-interval", 3*time.Second, "retriever position interval")
	pilotPosIv := fs.Duration("pilot-position-interval", 10*time.Second, "pilot position interval while a retrieval is open")
	retrievalTimeout := fs.Duration("retrieval-timeout", 20*time.Minute, "cancel a simulated retrieval that is not delivered within this time")
	degrade := fs.Float64("gps-degrade", 0.1, "probability per minute of a 20-60 s GPS accuracy degradation")
	outage := fs.Float64("outage-prob", 0.02, "probability per minute of a network outage (samples buffered, resent after)")
	outageMin := fs.Duration("outage-min", 20*time.Second, "minimum outage length")
	outageMax := fs.Duration("outage-max", 2*time.Minute, "maximum outage length")
	inactivity := fs.Float64("inactivity-prob", 0.01, "probability per minute that the app is suspended (no samples)")
	dup := fs.Float64("dup-prob", 0.03, "probability per batch of re-sending it under a new batch id (lost response)")
	offset := fs.Duration("start-offset-max", 20*time.Minute, "start each pilot up to this far into its flight")
	load := fs.Bool("load", false, "load-test mode: no disturbances, WebSocket observers, JSON report")
	wsSubs := fs.Int("ws-subscribers", 0, "WebSocket observers measuring propagation delay (default 2 in --load)")
	forwardIP := fs.Bool("forward-ip", false, "development only: send a distinct X-Forwarded-For per pilot (server must trust this host in TRUSTED_PROXIES)")
	stagger := fs.Bool("stagger", true, "spread pilot start times across one batch interval (false = all pilots upload in lockstep, worst case)")
	reportPath := fs.String("report", "", "write the JSON report to this file")
	quiet := fs.Bool("quiet", false, "less logging")
	_ = fs.Parse(os.Args[1:])

	pw := *password
	if pw == "" {
		pw = os.Getenv("RETFAST_SIM_PASSWORD")
	}
	var accounts []sim.Account
	if *accountsCSV != "" {
		var err error
		if accounts, err = readCSV(*accountsCSV); err != nil {
			fatal(err)
		}
	} else {
		if pw == "" {
			fatal(errors.New("--password (or RETFAST_SIM_PASSWORD) is required with --email-pattern"))
		}
		for i := 1; i <= *pilots; i++ {
			accounts = append(accounts, sim.Account{Email: fmt.Sprintf(*pattern, i), Password: pw, Name: fmt.Sprintf("SIM Pilot %03d", i)})
		}
	}
	var retrieverAccounts []sim.Account
	if *retrievals {
		if *retrieverCSV != "" {
			var err error
			if retrieverAccounts, err = readCSV(*retrieverCSV); err != nil {
				fatal(err)
			}
		} else {
			if pw == "" {
				fatal(errors.New("--password (or RETFAST_SIM_PASSWORD) is required for pattern retriever accounts"))
			}
			for i := 1; i <= *nRetrievers; i++ {
				retrieverAccounts = append(retrieverAccounts, sim.Account{Email: fmt.Sprintf(*retrieverPattern, i), Password: pw, Name: fmt.Sprintf("SIM Retriever %03d", i)})
			}
		}
	}
	var approver *sim.Account
	if *approverEmail != "" {
		ap := *approverPassword
		if ap == "" {
			ap = os.Getenv("RETFAST_SIM_APPROVER_PASSWORD")
		}
		approver = &sim.Account{Email: *approverEmail, Password: ap}
	}
	cfg := sim.Config{API: strings.TrimRight(*api, "/"), Event: *event, Accounts: accounts, Register: *register, AllowProdRegister: *allowProd,
		Approver: approver, LandWithin: *landWithin, Retrievals: *retrievals, Retrievers: retrieverAccounts, DriveSpeed: *driveSpeed,
		RetrieverInterval: *retrieverIv, PilotPositionInterval: *pilotPosIv, RetrievalTimeout: *retrievalTimeout,
		Seed: *seed, SampleInterval: *sampleIv, BatchInterval: *batchIv, Duration: *duration,
		DegradeProbPerMin: *degrade, OutageProbPerMin: *outage, OutageMin: *outageMin, OutageMax: *outageMax,
		InactivityProbPerMin: *inactivity, InactivityMin: 30 * time.Second, InactivityMax: 90 * time.Second,
		DupProb: *dup, StartOffsetMax: *offset, EndOnExit: true, WSSubscribers: *wsSubs, ForwardIPs: *forwardIP, Stagger: *stagger}
	if *load {
		cfg.OutageProbPerMin, cfg.InactivityProbPerMin, cfg.DupProb = 0, 0, 0
		if *wsSubs == 0 {
			cfg.WSSubscribers = 2
		}
		if *duration == 0 {
			cfg.Duration = time.Minute
		}
	}
	if !*quiet {
		cfg.Logf = func(f string, a ...any) { fmt.Fprintf(os.Stderr, f+"\n", a...) }
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	fmt.Fprintf(os.Stderr, "retfast-simulator: %d pilots, %d retrievers, seed %d, sample %s, batch %s, event %s\n", len(accounts), len(retrieverAccounts), *seed, *sampleIv, *batchIv, *event)
	rep, err := sim.Run(ctx, cfg)
	if err != nil {
		fatal(err)
	}
	out, _ := json.MarshalIndent(rep, "", "  ")
	if *reportPath != "" {
		if err := os.WriteFile(*reportPath, out, 0o644); err != nil {
			fatal(err)
		}
	}
	fmt.Println(string(out))
}

func readCSV(path string) ([]sim.Account, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	var out []sim.Account
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(rec) < 2 || strings.EqualFold(rec[0], "email") || strings.HasPrefix(rec[0], "#") {
			continue
		}
		a := sim.Account{Email: strings.TrimSpace(rec[0]), Password: rec[1], Name: "SIM " + rec[0]}
		if len(rec) > 2 {
			a.Name = rec[2]
		}
		out = append(out, a)
	}
	if len(out) == 0 {
		return nil, errors.New("no accounts in CSV")
	}
	return out, nil
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}
