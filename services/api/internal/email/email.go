package email

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/metrics"
)

// Enqueue renders and stores an email in the outbox using q (transaction-bound
// when the email must be atomic with the triggering change).
func Enqueue(ctx context.Context, q *dbq.Queries, template, to string, d Data) (uuid.UUID, error) {
	m, err := Render(template, to, d)
	if err != nil {
		return uuid.Nil, err
	}
	return q.EnqueueEmail(ctx, dbq.EnqueueEmailParams{
		ToEmail: to, Template: template, Subject: m.Subject, TextBody: m.Text, HtmlBody: m.HTML,
	})
}

// Sender delivers one message and returns the provider message id.
type Sender interface {
	Send(ctx context.Context, m Message) (string, error)
}

// Delivery errors.
var (
	// ErrUnconfigured: no RESEND_API_KEY; the message fails immediately.
	ErrUnconfigured = errors.New("provider_unconfigured")
)

// PermanentError is a non-retryable provider rejection (e.g. 401/403/422).
type PermanentError struct {
	Reason string
	Status int
}

func (e *PermanentError) Error() string { return fmt.Sprintf("%s (http %d)", e.Reason, e.Status) }

// Resend calls the Resend HTTP API.
type Resend struct {
	APIKey  string
	From    string
	BaseURL string
	Client  *http.Client
}

// Send implements Sender.
func (r *Resend) Send(ctx context.Context, m Message) (string, error) {
	if r.APIKey == "" {
		return "", ErrUnconfigured
	}
	body, _ := json.Marshal(map[string]any{
		"from": r.From, "to": []string{m.To}, "subject": m.Subject, "text": m.Text, "html": m.HTML,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.BaseURL+"/emails", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+r.APIKey)
	req.Header.Set("Content-Type", "application/json")
	if m.ID != "" {
		req.Header.Set("Idempotency-Key", "retfast-"+m.ID)
	}
	c := r.Client
	if c == nil {
		c = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := c.Do(req)
	if err != nil {
		return "", fmt.Errorf("resend request: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		var out struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(raw, &out)
		return out.ID, nil
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return "", &PermanentError{Reason: "provider_rejected", Status: resp.StatusCode}
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return "", fmt.Errorf("resend transient http %d", resp.StatusCode)
	default:
		return "", &PermanentError{Reason: "provider_invalid_request", Status: resp.StatusCode}
	}
}

// MaxAttempts bounds delivery retries.
const MaxAttempts = 5

// Backoff returns the delay before attempt n+1 after n failed attempts.
func Backoff(n int) time.Duration {
	if n < 1 {
		n = 1
	}
	d := 30 * time.Second << (n - 1)
	if d > 30*time.Minute {
		d = 30 * time.Minute
	}
	return d
}

// Worker drains email_outbox.
type Worker struct {
	Pool    *pgxpool.Pool
	Sender  Sender
	Metrics *metrics.Metrics
	Log     *slog.Logger
	Every   time.Duration
}

// Run processes the outbox until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	every := w.Every
	if every == 0 {
		every = 2 * time.Second
	}
	t := time.NewTicker(every)
	defer t.Stop()
	warned := false
	for {
		n, unconfigured, err := w.ProcessOnce(ctx)
		if err != nil && ctx.Err() == nil {
			w.Log.Warn("email worker error", "err", err.Error())
		}
		if unconfigured && !warned {
			w.Log.Warn("email_unconfigured: RESEND_API_KEY is not set; queued emails are marked failed", "count", n)
			warned = true
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// ProcessOnce claims and sends up to 10 due emails. It reports how many were
// handled and whether the provider is unconfigured.
func (w *Worker) ProcessOnce(ctx context.Context) (int, bool, error) {
	handled, unconfigured := 0, false
	err := pgx.BeginFunc(ctx, w.Pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		rows, err := q.ClaimEmails(ctx, 10)
		if err != nil {
			return err
		}
		for _, row := range rows {
			sctx, cancel := context.WithTimeout(ctx, 15*time.Second)
			id, serr := w.Sender.Send(sctx, Message{ID: row.ID.String(), Template: row.Template, To: row.ToEmail, Subject: row.Subject, Text: row.TextBody, HTML: row.HtmlBody})
			cancel()
			handled++
			var perm *PermanentError
			switch {
			case serr == nil:
				w.Metrics.EmailSent.Inc()
				err = q.MarkEmailSent(ctx, dbq.MarkEmailSentParams{ID: row.ID, ProviderID: id})
			case errors.Is(serr, ErrUnconfigured):
				unconfigured = true
				w.Metrics.EmailFailures.WithLabelValues("provider_unconfigured").Inc()
				err = q.MarkEmailFailed(ctx, dbq.MarkEmailFailedParams{ID: row.ID, LastError: "provider_unconfigured"})
			case errors.As(serr, &perm):
				w.Metrics.EmailFailures.WithLabelValues(perm.Reason).Inc()
				w.Log.Warn("email rejected by provider", "template", row.Template, "status", perm.Status, "reason", perm.Reason)
				err = q.MarkEmailFailed(ctx, dbq.MarkEmailFailedParams{ID: row.ID, LastError: perm.Error()})
			case row.Attempts+1 >= MaxAttempts:
				w.Metrics.EmailFailures.WithLabelValues("max_attempts").Inc()
				err = q.MarkEmailFailed(ctx, dbq.MarkEmailFailedParams{ID: row.ID, LastError: "max_attempts: " + truncate(serr.Error(), 200)})
			default:
				w.Metrics.EmailFailures.WithLabelValues("transient").Inc()
				err = q.MarkEmailRetry(ctx, dbq.MarkEmailRetryParams{ID: row.ID,
					NextAttemptAt: time.Now().Add(Backoff(int(row.Attempts) + 1)), LastError: truncate(serr.Error(), 200)})
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	return handled, unconfigured, err
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
