// Package seed creates the controlled production bootstrap: the five initial
// accounts and the Çameli demo event. It is idempotent and never resets a user
// who already changed their password. It never logs the password.
package seed

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"
	_ "time/tzdata" // Europe/Istanbul in distroless images

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mdenizay/retfast/services/api/internal/auth"
	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/platform/db"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/users"
)

// User is one bootstrap account.
type User struct {
	FullName string
	Email    string
	Roles    []string
}

// Users are the bootstrap accounts.
var Users = []User{
	{"Mehmet Deniz Aydın", "deniz@retfast.com", []string{authz.RolePlatformAdmin, authz.RolePilot}},
	{"Altay Alp", "altay@retfast.com", []string{authz.RolePlatformAdmin, authz.RolePilot}},
	{"Tecelli Aydın Görgülü", "tecelli@retfast.com", []string{authz.RolePilot}},
	{"Kübra Özlem Ertilav Aydın", "kubra@retfast.com", []string{authz.RolePilot}},
	{"Emre Kutan Nural", "emre@retfast.com", []string{authz.RolePilot}},
}

// Demo event constants.
const (
	DemoSlug        = "cameli-paragliding-demo"
	DemoName        = "Çameli Paragliding Demo"
	DemoDescription = "Retfast canlı uçuş takibi, etkinlik yönetimi ve pilot konum paylaşımı özelliklerini test etmek amacıyla oluşturulan Çameli demo etkinliği."
	DemoLocation    = "Çameli, Denizli, Türkiye"
	DemoLat         = 37.0747
	DemoLon         = 29.3450
	SiteName        = "Yaylacık (Çameli)"
	SiteNotes       = "Coordinates not verified; configure before use."
)

var organizers = map[string]bool{"deniz@retfast.com": true, "altay@retfast.com": true}

// BootstrapTTL is how long the initial password stays valid.
const BootstrapTTL = 7 * 24 * time.Hour

// Options control the demo schedule.
type Options struct {
	// StartsAt overrides the demo window start (nil: today 00:00 Europe/Istanbul on creation).
	StartsAt *time.Time
	// WindowDays overrides the window length (0: 90 days on creation).
	WindowDays int
	// RenewBootstrap re-issues the initial password (+7 days) for accounts that
	// still have it and never changed their password.
	RenewBootstrap bool
	Now            func() time.Time
}

// Result counts what happened.
type Result struct {
	Users, UsersCreated, UsersRenewed      int
	Events, EventsCreated, ScheduleUpdated int
	Sites, SitesCreated                    int
	Memberships                            int
}

// Print writes counts only.
func (r Result) Print(w io.Writer) {
	fmt.Fprintf(w, "users: %d (created %d, bootstrap renewed %d)\n", r.Users, r.UsersCreated, r.UsersRenewed)
	fmt.Fprintf(w, "events: %d (created %d, schedule updated %d)\n", r.Events, r.EventsCreated, r.ScheduleUpdated)
	fmt.Fprintf(w, "launch_sites: %d (created %d)\n", r.Sites, r.SitesCreated)
	fmt.Fprintf(w, "memberships: %d\n", r.Memberships)
}

// Run seeds inside one transaction.
func Run(ctx context.Context, pool *pgxpool.Pool, o Options) (Result, error) {
	now := time.Now
	if o.Now != nil {
		now = o.Now
	}
	var res Result
	hash, err := auth.HashPassword(auth.BootstrapPassword)
	if err != nil {
		return res, err
	}
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('retfast-seed:' || current_schema(), 0))`); err != nil {
			return err
		}
		q := dbq.New(tx)
		ids := map[string]dbq.User{}
		for _, su := range Users {
			u, err := q.GetUserByEmail(ctx, su.Email)
			switch {
			case db.NotFound(err):
				t := now()
				exp := t.Add(BootstrapTTL)
				u, err = q.CreateUser(ctx, dbq.CreateUserParams{Email: su.Email, PasswordHash: hash, FullName: su.FullName,
					EmailVerifiedAt: &t, MustChangePassword: true, PasswordExpiresAt: &exp})
				if err != nil {
					return err
				}
				res.UsersCreated++
			case err != nil:
				return err
			default:
				if o.RenewBootstrap && u.MustChangePassword && u.PasswordChangedAt == nil {
					exp := now().Add(BootstrapTTL)
					if err := q.UpdateUserPassword(ctx, dbq.UpdateUserPasswordParams{ID: u.ID, PasswordHash: hash, MustChangePassword: true,
						PasswordExpiresAt: &exp}); err != nil {
						return err
					}
					res.UsersRenewed++
				}
			}
			for _, role := range su.Roles {
				if err := q.AddUserRole(ctx, dbq.AddUserRoleParams{UserID: u.ID, Role: role}); err != nil {
					return err
				}
			}
			if _, err := users.EnsurePilotProfile(ctx, q, u.ID, su.FullName, strings.SplitN(su.Email, "@", 2)[0]); err != nil {
				return err
			}
			if err := q.EnsurePreferences(ctx, u.ID); err != nil {
				return err
			}
			ids[su.Email] = u
			res.Users++
		}

		deniz := ids["deniz@retfast.com"].ID
		ev, err := q.GetEventBySlug(ctx, DemoSlug)
		var eventID = ev.ID
		switch {
		case db.NotFound(err):
			start := dayStart(now())
			if o.StartsAt != nil {
				start = *o.StartsAt
			}
			days := o.WindowDays
			if days <= 0 {
				days = 90
			}
			lat, lon := DemoLat, DemoLon
			eventID, err = q.CreateEvent(ctx, dbq.CreateEventParams{Slug: DemoSlug, Name: DemoName, Description: DemoDescription,
				Kind: "paragliding", Status: "active", IsDemo: true, Visibility: authz.EventPublic, LocationName: DemoLocation,
				CenterLat: &lat, CenterLon: &lon, CenterIsApproximate: true, StartsAt: start, EndsAt: start.AddDate(0, 0, days),
				RegistrationOpen: true, LiveTracking: true, FlightRecording: true, ObserversAllowed: true, EmergencyTesting: true,
				PublicLiveMap: true, OrganizerID: &deniz})
			if err != nil {
				return err
			}
			res.EventsCreated++
		case err != nil:
			return err
		default:
			if o.StartsAt != nil || o.WindowDays > 0 {
				start := ev.StartsAt
				if o.StartsAt != nil {
					start = *o.StartsAt
				}
				days := o.WindowDays
				if days <= 0 {
					days = int(ev.EndsAt.Sub(ev.StartsAt).Hours()/24 + 0.5)
				}
				if err := q.UpdateEventSchedule(ctx, dbq.UpdateEventScheduleParams{ID: ev.ID, StartsAt: start, EndsAt: start.AddDate(0, 0, days)}); err != nil {
					return err
				}
				res.ScheduleUpdated++
			}
		}
		res.Events = 1

		for _, su := range Users {
			role := authz.MemberParticipant
			if organizers[su.Email] {
				role = authz.MemberOrganizer
			}
			if err := q.EnsureParticipant(ctx, dbq.EnsureParticipantParams{EventID: eventID, UserID: ids[su.Email].ID, Role: role, AddedBy: &deniz}); err != nil {
				return err
			}
			res.Memberships++
		}

		if _, err := q.GetLaunchSiteByName(ctx, dbq.GetLaunchSiteByNameParams{EventID: eventID, Name: SiteName}); db.NotFound(err) {
			if _, err := q.CreateLaunchSite(ctx, dbq.CreateLaunchSiteParams{EventID: eventID, Name: SiteName, Notes: SiteNotes}); err != nil {
				return err
			}
			res.SitesCreated++
		} else if err != nil {
			return err
		}
		res.Sites = 1
		return nil
	})
	return res, err
}

func dayStart(t time.Time) time.Time {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.UTC
	}
	t = t.In(loc)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
}
