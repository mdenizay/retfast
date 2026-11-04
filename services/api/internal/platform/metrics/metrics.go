// Package metrics defines the Prometheus collectors served on METRICS_ADDR.
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics groups every collector. Each server instance owns its own registry so
// tests can run several in one process.
type Metrics struct {
	Registry *prometheus.Registry

	HTTPDuration      *prometheus.HistogramVec
	TelemetrySamples  *prometheus.CounterVec
	TelemetryBatches  *prometheus.CounterVec
	TelemetryLatency  prometheus.Histogram
	OutboxDepth       prometheus.Gauge
	OutboxRelayed     prometheus.Counter
	OutboxRelayErrors prometheus.Counter
	WSConnections     prometheus.Gauge
	WSDropped         *prometheus.CounterVec
	WSMessages        prometheus.Counter
	EmailSent         prometheus.Counter
	EmailFailures     *prometheus.CounterVec
	RateLimited       *prometheus.CounterVec
	RateLimitFallback prometheus.Counter
	PushUnconfigured  prometheus.Counter
	PartitionErrors   prometheus.Counter
}

// New registers all collectors on a fresh registry.
func New() *Metrics {
	r := prometheus.NewRegistry()
	r.MustRegister(collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	f := func(c prometheus.Collector) { r.MustRegister(c) }
	m := &Metrics{Registry: r}
	m.HTTPDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name: "retfast_http_request_duration_seconds", Help: "HTTP request latency by route.",
		Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
	}, []string{"method", "route", "status"})
	m.TelemetrySamples = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "retfast_telemetry_samples_total", Help: "Telemetry samples by classification.",
	}, []string{"result"})
	m.TelemetryBatches = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "retfast_telemetry_batches_total", Help: "Telemetry batches by outcome (processed|replayed|error).",
	}, []string{"outcome"})
	m.TelemetryLatency = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name: "retfast_telemetry_ingest_seconds", Help: "Batch ingestion transaction latency.",
		Buckets: []float64{.002, .005, .01, .025, .05, .1, .25, .5, 1, 2.5},
	})
	m.OutboxDepth = prometheus.NewGauge(prometheus.GaugeOpts{Name: "retfast_outbox_depth", Help: "Rows waiting in realtime_outbox."})
	m.OutboxRelayed = prometheus.NewCounter(prometheus.CounterOpts{Name: "retfast_outbox_relayed_total", Help: "Outbox rows published to Redis."})
	m.OutboxRelayErrors = prometheus.NewCounter(prometheus.CounterOpts{Name: "retfast_outbox_relay_errors_total", Help: "Failed outbox relay attempts."})
	m.WSConnections = prometheus.NewGauge(prometheus.GaugeOpts{Name: "retfast_ws_connections", Help: "Open WebSocket connections."})
	m.WSDropped = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "retfast_ws_dropped_total", Help: "WebSocket connections closed by the server, by reason.",
	}, []string{"reason"})
	m.WSMessages = prometheus.NewCounter(prometheus.CounterOpts{Name: "retfast_ws_messages_sent_total", Help: "Messages queued to WebSocket clients."})
	m.EmailSent = prometheus.NewCounter(prometheus.CounterOpts{Name: "retfast_email_sent_total", Help: "Emails accepted by the provider."})
	m.EmailFailures = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "retfast_email_failures_total", Help: "Email delivery failures by reason.",
	}, []string{"reason"})
	m.RateLimited = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "retfast_rate_limited_total", Help: "Requests rejected by rate limiting.",
	}, []string{"rule"})
	m.RateLimitFallback = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "retfast_ratelimit_fallback_total", Help: "Rate-limit decisions made in memory because Redis was unavailable.",
	})
	m.PushUnconfigured = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "retfast_push_unconfigured_total", Help: "Push notifications not sent because APNs is not configured.",
	})
	m.PartitionErrors = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "retfast_partition_maintenance_errors_total", Help: "flight_positions partition maintenance failures.",
	})
	for _, c := range []prometheus.Collector{m.HTTPDuration, m.TelemetrySamples, m.TelemetryBatches, m.TelemetryLatency,
		m.OutboxDepth, m.OutboxRelayed, m.OutboxRelayErrors, m.WSConnections, m.WSDropped, m.WSMessages,
		m.EmailSent, m.EmailFailures, m.RateLimited, m.RateLimitFallback, m.PushUnconfigured, m.PartitionErrors} {
		f(c)
	}
	return m
}

// Handler serves the registry.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.Registry, promhttp.HandlerOpts{Registry: m.Registry})
}
