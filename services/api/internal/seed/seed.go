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

// User is one bootstrap account with its demo-event roles.
type User struct {
	FullName  string
	Email     string
	Admin     bool   // platform_admin
	Organizer bool   // organizer of the demo event
	Member    string // member role in the demo event
}

// Users are the bootstrap accounts (ADR-012).
var Users = []User{
	{"Mehmet Deniz Aydın", "deniz@retfast.com", true, true, authz.MemberPilot},
	{"Altay Alp", "altay@retfast.com", true, true, authz.MemberObserver},
	{"Tecelli Aydın Görgülü", "tecelli@retfast.com", false, false, authz.MemberPilot},
	{"Kübra Özlem Ertilav Aydın", "kubra@retfast.com", false, false, authz.MemberRetriever},
	{"Emre Kutan Nural", "emre@retfast.com", false, false, authz.MemberPilot},
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
	Organizers, OrganizersCreated          int
	Memberships, MembershipsCreated        int
}

// Print writes counts only.
func (r Result) Print(w io.Writer) {
	fmt.Fprintf(w, "users: %d (created %d, bootstrap renewed %d)\n", r.Users, r.UsersCreated, r.UsersRenewed)
	fmt.Fprintf(w, "events: %d (created %d, schedule updated %d)\n", r.Events, r.EventsCreated, r.ScheduleUpdated)
	fmt.Fprintf(w, "launch_sites: %d (created %d)\n", r.Sites, r.SitesCreated)
	fmt.Fprintf(w, "organizers: %d (created %d)\n", r.Organizers, r.OrganizersCreated)
	fmt.Fprintf(w, "memberships: %d (created %d)\n", r.Memberships, r.MembershipsCreated)
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
			if su.Admin {
				if err := q.AddUserRole(ctx, dbq.AddUserRoleParams{UserID: u.ID, Role: authz.RolePlatformAdmin}); err != nil {
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
				ApplicationsOpen: true, LiveTracking: true, PublicLiveMap: false, PilotsSeeEachOther: true, LandingPrompt: true,
				CreatedBy: &deniz})
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

		// Existing assignments are never overwritten, so changes made in the app survive re-seeding.
		for _, su := range Users {
			uid := ids[su.Email].ID
			if su.Organizer {
				n, err := q.AddOrganizer(ctx, dbq.AddOrganizerParams{EventID: eventID, UserID: uid, AssignedBy: &deniz})
				if err != nil {
					return err
				}
				res.Organizers++
				res.OrganizersCreated += int(n)
			}
			if su.Member != "" {
				n, err := q.EnsureMember(ctx, dbq.EnsureMemberParams{EventID: eventID, UserID: uid, Role: su.Member, AddedBy: &deniz})
				if err != nil {
					return err
				}
				res.Memberships++
				res.MembershipsCreated += int(n)
			}
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
