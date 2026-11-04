// Package httpx holds HTTP plumbing shared by all domain handlers:
// the error envelope, JSON helpers, timestamps, pagination and middleware.
package httpx

import (
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Error is an API error rendered as {"error":{code,message,details}}.
type Error struct {
	Status     int               `json:"-"`
	Code       string            `json:"code"`
	Message    string            `json:"message"`
	Details    map[string]string `json:"details,omitempty"`
	RetryAfter int               `json:"-"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// Constructors for the contract's error codes.
func Validation(details map[string]string) *Error {
	return &Error{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "Validation failed", Details: details}
}
func BadRequest(msg string) *Error {
	return &Error{Status: http.StatusBadRequest, Code: "validation_failed", Message: msg}
}
func Unauthorized(msg string) *Error {
	return &Error{Status: http.StatusUnauthorized, Code: "unauthorized", Message: msg}
}
func TokenExpired() *Error {
	return &Error{Status: http.StatusUnauthorized, Code: "token_expired", Message: "Access token expired"}
}
func PasswordChangeRequired() *Error {
	return &Error{Status: http.StatusForbidden, Code: "password_change_required", Message: "Password change required"}
}
func Forbidden(msg string) *Error {
	if msg == "" {
		msg = "Forbidden"
	}
	return &Error{Status: http.StatusForbidden, Code: "forbidden", Message: msg}
}
func NotFound(msg string) *Error {
	if msg == "" {
		msg = "Not found"
	}
	return &Error{Status: http.StatusNotFound, Code: "not_found", Message: msg}
}
func Conflict(msg string) *Error {
	return &Error{Status: http.StatusConflict, Code: "conflict", Message: msg}
}
func RateLimited(retryAfter int) *Error {
	return &Error{Status: http.StatusTooManyRequests, Code: "rate_limited", Message: "Too many requests", RetryAfter: retryAfter}
}
func Unavailable(msg string) *Error {
	return &Error{Status: http.StatusServiceUnavailable, Code: "unavailable", Message: msg}
}

type ctxKey int

const (
	ctxRequestID ctxKey = iota
	ctxLogger
	ctxClientIP
)

// RequestID returns the request id for ctx.
func RequestID(ctx context.Context) string {
	s, _ := ctx.Value(ctxRequestID).(string)
	return s
}

// ClientIP returns the resolved client address for ctx.
func ClientIP(ctx context.Context) string {
	s, _ := ctx.Value(ctxClientIP).(string)
	return s
}

// Logger returns the request-scoped logger (falls back to slog.Default).
func Logger(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(ctxLogger).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

// WriteJSON writes v with the given status.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

// WriteError renders err; non-*Error values become 500 internal and are logged.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	var e *Error
	if !errors.As(err, &e) {
		if errors.Is(err, context.Canceled) {
			return // client went away
		}
		Logger(r.Context()).Error("internal error", "err", err.Error(), "path", r.URL.Path)
		e = &Error{Status: http.StatusInternalServerError, Code: "internal", Message: "Internal server error"}
		if errors.Is(err, context.DeadlineExceeded) {
			e = Unavailable("Request timed out")
		}
	}
	if e.RetryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(e.RetryAfter))
	}
	WriteJSON(w, e.Status, map[string]any{"error": e})
}

// HandlerFunc is an http handler that returns an error.
type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

// H adapts a HandlerFunc.
func H(f HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := f(w, r); err != nil {
			WriteError(w, r, err)
		}
	}
}

// DecodeJSON reads a JSON body (optionally gzip-encoded) into v, rejecting unknown
// trailing data. maxBytes bounds the compressed and decompressed size.
func DecodeJSON(w http.ResponseWriter, r *http.Request, maxBytes int64, v any) error {
	if r.Body == nil || r.ContentLength == 0 {
		return BadRequest("Request body required")
	}
	body := io.Reader(http.MaxBytesReader(w, r.Body, maxBytes))
	if strings.EqualFold(r.Header.Get("Content-Encoding"), "gzip") {
		gz, err := gzip.NewReader(body)
		if err != nil {
			return BadRequest("Invalid gzip body")
		}
		defer gz.Close()
		body = io.LimitReader(gz, maxBytes+1)
	}
	data, err := io.ReadAll(body)
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return &Error{Status: http.StatusRequestEntityTooLarge, Code: "validation_failed", Message: "Request body too large"}
		}
		return BadRequest("Could not read body")
	}
	if int64(len(data)) > maxBytes {
		return &Error{Status: http.StatusRequestEntityTooLarge, Code: "validation_failed", Message: "Request body too large"}
	}
	if err := json.Unmarshal(data, v); err != nil {
		var ute *json.UnmarshalTypeError
		if errors.As(err, &ute) && ute.Field != "" {
			return Validation(map[string]string{ute.Field: "invalid type"})
		}
		return BadRequest("Malformed JSON")
	}
	return nil
}

// DecodeOptionalJSON is DecodeJSON but an empty body leaves v untouched.
func DecodeOptionalJSON(w http.ResponseWriter, r *http.Request, maxBytes int64, v any) error {
	if r.Body == nil || r.ContentLength == 0 {
		return nil
	}
	return DecodeJSON(w, r, maxBytes, v)
}

// TimeFormat is RFC 3339 UTC with milliseconds.
const TimeFormat = "2006-01-02T15:04:05.000Z"

// Time is a timestamp that marshals as RFC 3339 UTC with milliseconds.
type Time struct{ time.Time }

// T wraps t.
func T(t time.Time) Time { return Time{t} }

// TP wraps an optional time.
func TP(t *time.Time) *Time {
	if t == nil {
		return nil
	}
	return &Time{*t}
}

// MarshalJSON implements json.Marshaler.
func (t Time) MarshalJSON() ([]byte, error) {
	return []byte(`"` + t.UTC().Format(TimeFormat) + `"`), nil
}

// UnmarshalJSON accepts any RFC 3339 timestamp.
func (t *Time) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	v, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return fmt.Errorf("invalid timestamp %q", s)
	}
	t.Time = v
	return nil
}

// Page is the pagination envelope.
type Page[T any] struct {
	Items      []T     `json:"items"`
	NextCursor *string `json:"next_cursor"`
}

// Limit parses ?limit= with a default and maximum.
func Limit(r *http.Request, def, max int) (int, error) {
	s := r.URL.Query().Get("limit")
	if s == "" {
		return def, nil
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 {
		return 0, Validation(map[string]string{"limit": "must be a positive integer"})
	}
	if n > max {
		n = max
	}
	return n, nil
}

// EncodeCursor makes an opaque cursor from a JSON-able value.
func EncodeCursor(v any) *string {
	b, _ := json.Marshal(v)
	s := base64.RawURLEncoding.EncodeToString(b)
	return &s
}

// DecodeCursor parses ?cursor= into v; returns false if absent.
func DecodeCursor(r *http.Request, v any) (bool, error) {
	s := r.URL.Query().Get("cursor")
	if s == "" {
		return false, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil || json.Unmarshal(b, v) != nil {
		return false, Validation(map[string]string{"cursor": "invalid"})
	}
	return true, nil
}

// Nullable distinguishes an absent field (Set=false) from an explicit null
// (Set=true, Null=true) in PATCH bodies.
type Nullable[T any] struct {
	Set  bool
	Null bool
	V    T
}

// UnmarshalJSON implements json.Unmarshaler (called for null too).
func (n *Nullable[T]) UnmarshalJSON(b []byte) error {
	n.Set = true
	if string(b) == "null" {
		n.Null = true
		return nil
	}
	return json.Unmarshal(b, &n.V)
}
