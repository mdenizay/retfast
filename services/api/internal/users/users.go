// Package users owns profiles, preferences, devices, data export and account
// deletion, and builds the `Me` representation used across the API.
package users

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/slug"
)

// PilotProfile per the contract.
type PilotProfile struct {
	PublicID              string `json:"public_id"`
	DisplayName           string `json:"display_name"`
	Bio                   string `json:"bio"`
	Wing                  string `json:"wing"`
	LicenseNo             string `json:"license_no"`
	Nationality           string `json:"nationality"`
	Phone                 string `json:"phone"`
	EmergencyContactName  string `json:"emergency_contact_name"`
	EmergencyContactPhone string `json:"emergency_contact_phone"`
}

// Preferences per the contract.
type Preferences struct {
	Units         string `json:"units"`
	PublicProfile bool   `json:"public_profile"`
}

// Me per the contract.
type Me struct {
	ID                 uuid.UUID     `json:"id"`
	Email              string        `json:"email"`
	EmailVerified      bool          `json:"email_verified"`
	FullName           string        `json:"full_name"`
	Roles              []string      `json:"roles"`
	MustChangePassword bool          `json:"must_change_password"`
	CreatedAt          httpx.Time    `json:"created_at"`
	Pilot              *PilotProfile `json:"pilot"`
	Preferences        Preferences   `json:"preferences"`
}

// DefaultPreferences are applied when no row exists.
var DefaultPreferences = Preferences{Units: "metric", PublicProfile: false}

// ProfileFromRow converts a DB row.
func ProfileFromRow(p dbq.PilotProfile) *PilotProfile {
	return &PilotProfile{PublicID: p.PublicID, DisplayName: p.DisplayName, Bio: p.Bio, Wing: p.Wing, LicenseNo: p.LicenseNo,
		Nationality: p.Nationality, Phone: p.Phone, EmergencyContactName: p.EmergencyContactName,
		EmergencyContactPhone: p.EmergencyContactPhone}
}

// LoadPreferences returns stored or default preferences.
func LoadPreferences(ctx context.Context, q *dbq.Queries, userID uuid.UUID) (Preferences, error) {
	p, err := q.GetPreferences(ctx, userID)
	if db.NotFound(err) {
		return DefaultPreferences, nil
	}
	if err != nil {
		return Preferences{}, err
	}
	return Preferences{Units: p.Units, PublicProfile: p.PublicProfile}, nil
}

// LoadMe builds the Me document for a user.
func LoadMe(ctx context.Context, q *dbq.Queries, userID uuid.UUID) (*Me, error) {
	u, err := q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	roles, err := q.ListUserRoles(ctx, userID)
	if err != nil {
		return nil, err
	}
	me := &Me{ID: u.ID, Email: u.Email, EmailVerified: u.EmailVerifiedAt != nil, FullName: u.FullName, Roles: roles,
		MustChangePassword: u.MustChangePassword, CreatedAt: httpx.T(u.CreatedAt)}
	if p, err := q.GetPilotProfile(ctx, userID); err == nil {
		me.Pilot = ProfileFromRow(p)
	} else if !db.NotFound(err) {
		return nil, err
	}
	if me.Preferences, err = LoadPreferences(ctx, q, userID); err != nil {
		return nil, err
	}
	return me, nil
}

// EnsurePilotProfile creates a profile with a unique public id derived from
// preferred (or the name) if the user has none. It returns the public id.
func EnsurePilotProfile(ctx context.Context, q *dbq.Queries, userID uuid.UUID, displayName, preferred string) (string, error) {
	if p, err := q.GetPilotProfile(ctx, userID); err == nil {
		return p.PublicID, nil
	} else if !db.NotFound(err) {
		return "", err
	}
	base := slug.Make(preferred, 24)
	if len(base) < 2 {
		first := strings.Fields(displayName)
		if len(first) > 0 {
			base = slug.Make(first[0], 16)
		}
	}
	if len(base) < 2 {
		base = "pilot"
	}
	candidates := []string{}
	if preferred != "" {
		candidates = append(candidates, base)
	}
	for i := 0; i < 8; i++ {
		candidates = append(candidates, fmt.Sprintf("%s-%s", base, slug.Random(4)))
	}
	for _, c := range candidates {
		exists, err := q.PilotPublicIDExists(ctx, c)
		if err != nil {
			return "", err
		}
		if exists {
			continue
		}
		if err := q.CreatePilotProfile(ctx, dbq.CreatePilotProfileParams{UserID: userID, PublicID: c, DisplayName: displayName}); err != nil {
			if db.IsUniqueViolation(err, "") {
				continue
			}
			return "", err
		}
		return c, nil
	}
	return "", fmt.Errorf("could not allocate pilot public id")
}

// PilotRef is the compact pilot reference used in flights and retrievals.
type PilotRef struct {
	UserID   uuid.UUID `json:"user_id"`
	FullName string    `json:"full_name"`
	PublicID string    `json:"public_id"`
}

// UserRef is {user_id, full_name}.
type UserRef struct {
	UserID   uuid.UUID `json:"user_id"`
	FullName string    `json:"full_name"`
}

// Now is overridable in tests.
var Now = time.Now
