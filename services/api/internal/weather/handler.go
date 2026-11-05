package weather

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/mdenizay/retfast/services/api/internal/authz"
	"github.com/mdenizay/retfast/services/api/internal/events"
	"github.com/mdenizay/retfast/services/api/internal/platform/db/dbq"
	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
	"github.com/mdenizay/retfast/services/api/internal/platform/redisx"
)

const (
	cacheTTL = 10 * time.Minute
	hours    = 12
)

// Handler serves GET /events/{id}/weather.
type Handler struct {
	Q      *dbq.Queries
	Redis  *redisx.Client
	Client *Client
	Log    *slog.Logger
}

// Routes are mounted with optional authentication (event visibility applies).
func (h *Handler) Routes(r chi.Router) {
	r.Get("/events/{id}/weather", httpx.H(h.get))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	e, _, err := events.LoadVisible(ctx, h.Q, chi.URLParam(r, "id"), authz.ActorFrom(ctx))
	if err != nil {
		return err
	}
	if e.CenterLat == nil || e.CenterLon == nil {
		return httpx.NotFound("Event has no location")
	}
	// ~1 km grid so nearby events share the cache entry.
	lat, lon := math.Round(*e.CenterLat*100)/100, math.Round(*e.CenterLon*100)/100
	key := h.Redis.Key("wx", fmt.Sprintf("%.2f,%.2f", lat, lon))
	if b, err := h.Redis.Get(ctx, key).Bytes(); err == nil && len(b) > 0 {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=300")
		_, _ = w.Write(b)
		return nil
	}
	f, err := h.Client.Fetch(ctx, lat, lon, hours)
	if err != nil {
		if h.Log != nil {
			h.Log.Warn("weather fetch failed", "err", err.Error())
		}
		return httpx.Unavailable("Weather is temporarily unavailable")
	}
	if b, err := json.Marshal(f); err == nil {
		_ = h.Redis.Set(ctx, key, b, cacheTTL).Err()
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	httpx.WriteJSON(w, http.StatusOK, f)
	return nil
}
