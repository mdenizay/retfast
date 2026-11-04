// Package audit records security-relevant actions in audit_logs.
package audit

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
)

// Entry is one audit record. Details must never contain secrets, tokens,
// passwords or precise coordinates.
type Entry struct {
	ActorID    *uuid.UUID
	Action     string
	TargetType string
	TargetID   string
	EventID    *uuid.UUID
	Details    map[string]any
}

// Record writes e using q (pass a transaction-bound Queries to make the audit
// row atomic with the action). Request metadata is taken from ctx/r when given.
func Record(ctx context.Context, q *dbq.Queries, r *http.Request, e Entry) error {
	if e.ActorID == nil {
		if a := authz.ActorFrom(ctx); a.Authenticated() {
			id := a.UserID
			e.ActorID = &id
		}
	}
	details := []byte("{}")
	if len(e.Details) > 0 {
		b, err := json.Marshal(e.Details)
		if err != nil {
			return err
		}
		details = b
	}
	ua := ""
	if r != nil {
		ua = r.UserAgent()
		if len(ua) > 300 {
			ua = ua[:300]
		}
	}
	return q.InsertAudit(ctx, dbq.InsertAuditParams{
		ActorID: e.ActorID, Action: e.Action, TargetType: e.TargetType, TargetID: e.TargetID,
		EventID: e.EventID, Ip: httpx.ClientIP(ctx), UserAgent: ua, Details: details,
	})
}
