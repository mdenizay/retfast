# syntax=docker/dockerfile:1.7
# Retfast API image. Build context: repository root.
#   docker build -f infrastructure/docker/api.Dockerfile --build-arg VERSION=$(git rev-parse --short HEAD) -t retfast-api .
# Contains /usr/local/bin/retfast-api (serve | migrate | seed | healthcheck | reset-link)
# and /usr/local/bin/retfast-simulator. Runs as non-root (distroless nonroot, uid 65532).

FROM golang:1.27.3-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOOS=linux GOTOOLCHAIN=local
COPY services/api/go.mod services/api/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download && go mod verify
COPY services/api/ ./
ARG VERSION=dev
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags "-s -w -X github.com/mdenizay/retfast/services/api/internal/app.Version=${VERSION}" \
      -o /out/retfast-api ./cmd/api && \
    go build -trimpath -ldflags "-s -w" -o /out/retfast-simulator ./cmd/simulator

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/retfast-api /usr/local/bin/retfast-api
COPY --from=build /out/retfast-simulator /usr/local/bin/retfast-simulator
USER nonroot:nonroot
ENV HTTP_ADDR=:8080 METRICS_ADDR=:9090 APP_ENV=production
EXPOSE 8080
# 9090 serves /metrics; keep it on the internal network only.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 CMD ["/usr/local/bin/retfast-api", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/retfast-api"]
CMD ["serve"]
