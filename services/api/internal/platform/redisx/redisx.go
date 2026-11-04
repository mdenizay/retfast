// Package redisx wraps go-redis with Retfast key naming.
package redisx

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type quietLogger struct{}

func (quietLogger) Printf(context.Context, string, ...interface{}) {}

func init() {
	// go-redis logs dial failures in plain text; Retfast logs Redis problems
	// itself (JSON, rate-limited) so the library logger is silenced.
	redis.SetLogger(quietLogger{})
}

// Client is a Redis client plus the key prefix used for every Retfast key.
type Client struct {
	*redis.Client
	Prefix string
}

// New parses url and returns a client. It does not fail if Redis is unreachable:
// Redis is a cache and fan-out bus, never the source of truth.
func New(url, prefix string) (*Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse REDIS_URL: %w", err)
	}
	opt.DialTimeout = 2 * time.Second
	opt.ReadTimeout = 2 * time.Second
	opt.WriteTimeout = 2 * time.Second
	opt.MaxRetries = 1
	opt.ContextTimeoutEnabled = true // blocking XREAD returns promptly on shutdown
	opt.PoolSize = 50
	return &Client{Client: redis.NewClient(opt), Prefix: prefix}, nil
}

// Key builds a prefixed key.
func (c *Client) Key(parts ...string) string {
	k := c.Prefix
	for i, p := range parts {
		if i > 0 {
			k += ":"
		}
		k += p
	}
	return k
}

// StreamKey is the realtime stream (ADR-005).
func (c *Client) StreamKey() string { return c.Key("rt") }

// LatestKey is the per-event latest-position hash.
func (c *Client) LatestKey(eventID string) string { return c.Key("latest", eventID) }

// Healthy pings Redis with a short timeout.
func (c *Client) Healthy(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	return c.Ping(ctx).Err()
}
