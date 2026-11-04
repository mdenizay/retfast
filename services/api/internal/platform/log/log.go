// Package log configures structured JSON logging (log/slog).
//
// Rules: never log secrets, tokens, passwords or precise coordinates at info level.
package log

import (
	"io"
	"log/slog"
	"os"
	"strings"
)

// New returns a JSON logger writing to w at the given level name.
func New(w io.Writer, level string) *slog.Logger {
	var lvl slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	if w == nil {
		w = os.Stdout
	}
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: lvl})).With("service", "retfast-api")
}

// Discard is a logger that drops everything (tests).
func Discard() *slog.Logger { return slog.New(slog.NewJSONHandler(io.Discard, nil)) }
