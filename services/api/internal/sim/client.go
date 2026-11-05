package sim

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// APIError is a non-2xx API response.
type APIError struct {
	Status     int
	Code       string
	Body       string
	RetryAfter time.Duration
}

func (e *APIError) Error() string { return fmt.Sprintf("http %d %s: %s", e.Status, e.Code, e.Body) }

// Client talks to the Retfast API as one account (iOS client semantics:
// refresh token in the body, refresh on token_expired, honour Retry-After).
type Client struct {
	Base      string
	HTTP      *http.Client
	Email     string
	Password  string
	ForwardIP string // dev only: X-Forwarded-For when the server trusts this host as a proxy

	mu      sync.Mutex
	access  string
	refresh string
	UserID  string
}

// NewHTTPClient returns a pooled client sized for many pilots.
func NewHTTPClient() *http.Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.MaxIdleConns = 2000
	tr.MaxIdleConnsPerHost = 2000
	tr.IdleConnTimeout = 90 * time.Second
	return &http.Client{Transport: tr, Timeout: 30 * time.Second}
}

func (c *Client) do(ctx context.Context, method, path string, body any, auth bool, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.Base+path, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("User-Agent", "retfast-simulator")
	if c.ForwardIP != "" {
		req.Header.Set("X-Forwarded-For", c.ForwardIP)
	}
	if auth {
		c.mu.Lock()
		req.Header.Set("Authorization", "Bearer "+c.access)
		c.mu.Unlock()
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 300 {
		ae := &APIError{Status: resp.StatusCode, Body: string(raw)}
		var env struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if json.Unmarshal(raw, &env) == nil {
			ae.Code = env.Error.Code
		}
		if s := resp.Header.Get("Retry-After"); s != "" {
			if n, err := strconv.Atoi(s); err == nil {
				ae.RetryAfter = time.Duration(n) * time.Second
			}
		}
		return ae
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}

type authResp struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	User         struct {
		ID                 string `json:"id"`
		MustChangePassword bool   `json:"must_change_password"`
	} `json:"user"`
}

func (c *Client) store(a authResp) {
	c.mu.Lock()
	c.access, c.refresh, c.UserID = a.AccessToken, a.RefreshToken, a.User.ID
	c.mu.Unlock()
}

// ErrMustChangePassword means the account still has its bootstrap password.
var ErrMustChangePassword = errors.New("account must change its initial password before it can be used by the simulator")

// Login signs in as an iOS client.
func (c *Client) Login(ctx context.Context) error {
	var a authResp
	if err := c.do(ctx, "POST", "/auth/login", map[string]any{"email": c.Email, "password": c.Password, "client": "ios",
		"device_name": "retfast-simulator"}, false, &a); err != nil {
		return err
	}
	c.store(a)
	if a.User.MustChangePassword {
		return ErrMustChangePassword
	}
	return nil
}

// Register creates the account (409 if it exists).
func (c *Client) Register(ctx context.Context, name string) error {
	var a authResp
	if err := c.do(ctx, "POST", "/auth/register", map[string]any{"email": c.Email, "password": c.Password, "full_name": name,
		"client": "ios", "device_name": "retfast-simulator"}, false, &a); err != nil {
		return err
	}
	c.store(a)
	return nil
}

func (c *Client) refreshTokens(ctx context.Context) error {
	c.mu.Lock()
	rt := c.refresh
	c.mu.Unlock()
	var a authResp
	if err := c.do(ctx, "POST", "/auth/refresh", map[string]any{"refresh_token": rt}, false, &a); err != nil {
		return c.Login(ctx) // family revoked or expired: sign in again
	}
	c.store(a)
	return nil
}

// Access returns the current access token.
func (c *Client) Access() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.access
}

// Call performs an authenticated request, refreshing once on token_expired.
func (c *Client) Call(ctx context.Context, method, path string, body, out any) error {
	err := c.do(ctx, method, path, body, true, out)
	var ae *APIError
	if errors.As(err, &ae) && ae.Status == 401 {
		if rerr := c.refreshTokens(ctx); rerr != nil {
			return rerr
		}
		return c.do(ctx, method, path, body, true, out)
	}
	return err
}

// Meta is GET /meta.
type Meta struct {
	Environment string `json:"environment"`
	Version     string `json:"version"`
}

// GetMeta fetches server metadata (unauthenticated).
func GetMeta(ctx context.Context, h *http.Client, base string) (Meta, error) {
	c := &Client{Base: base, HTTP: h}
	var m Meta
	err := c.do(ctx, "GET", "/meta", nil, false, &m)
	return m, err
}

// Event is the subset of the event representation the simulator needs.
type Event struct {
	ID     string `json:"id"`
	Slug   string `json:"slug"`
	IsDemo bool   `json:"is_demo"`
	Me     struct {
		Role        *string `json:"role"`
		Application *struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"application"`
	} `json:"me"`
}

// EnsureMember makes c a member of event with role. It applies (or reuses a
// pending application) and, when approver is set (an organizer or admin of
// the event), approves it or changes an existing role. Without an approver
// the account must already hold the role.
func EnsureMember(ctx context.Context, c, approver *Client, event, role string) (Event, error) {
	var ev Event
	if err := c.Call(ctx, "GET", "/events/"+event, nil, &ev); err != nil {
		return ev, fmt.Errorf("event: %w", err)
	}
	if ev.Me.Role != nil && *ev.Me.Role == role {
		return ev, nil
	}
	if approver == nil {
		return ev, fmt.Errorf("%s is not a %s of the event and no --approver is configured", c.Email, role)
	}
	if ev.Me.Role != nil {
		if err := approver.Call(ctx, "PATCH", "/events/"+ev.ID+"/members/"+c.UserID, map[string]any{"role": role}, nil); err != nil {
			return ev, fmt.Errorf("change role: %w", err)
		}
		return ev, nil
	}
	appID := ""
	if ev.Me.Application != nil && ev.Me.Application.Status == "pending" {
		appID = ev.Me.Application.ID
	} else {
		var app struct {
			ID string `json:"id"`
		}
		if err := c.Call(ctx, "POST", "/events/"+ev.ID+"/applications", map[string]any{"message": "retfast-simulator account"}, &app); err != nil {
			return ev, fmt.Errorf("apply: %w", err)
		}
		appID = app.ID
	}
	if err := approver.Call(ctx, "POST", "/events/"+ev.ID+"/applications/"+appID+"/approve", map[string]any{"role": role,
		"note": "retfast-simulator"}, nil); err != nil {
		return ev, fmt.Errorf("approve: %w", err)
	}
	return ev, nil
}

// BatchResult mirrors POST /telemetry/batches.
type BatchResult struct {
	Accepted  []int64 `json:"accepted"`
	Duplicate []int64 `json:"duplicate"`
	Rejected  []struct {
		Seq    int64  `json:"seq"`
		Reason string `json:"reason"`
	} `json:"rejected"`
	MaxAckedSeq *int64 `json:"max_acked_seq"`
}
