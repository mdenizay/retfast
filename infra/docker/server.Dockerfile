# API imajı. Derleme bağlamı: repo kökü. Cargo kayıt defteri ve target dizini BuildKit önbelleğinde tutulur.
FROM rust:1-bookworm AS build
WORKDIR /app
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/src ./src
COPY server/migrations ./migrations
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    cargo build --release --locked && cp target/release/retfast-server /retfast-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home retfast
COPY --from=build /retfast-server /usr/local/bin/retfast-server
USER retfast
ENV BIND=0.0.0.0:3001 LOG_FORMAT=json
EXPOSE 3001
CMD ["retfast-server", "serve"]
