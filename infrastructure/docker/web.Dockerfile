# syntax=docker/dockerfile:1.7
# Retfast web SPA. Build context: repository root.
#   docker build -f infrastructure/docker/web.Dockerfile --build-arg VITE_API_URL=https://api.retfast.com -t retfast-web .

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
# Design tokens are imported by the web app via a relative path (../../packages/design-tokens/dist).
COPY packages/design-tokens/dist packages/design-tokens/dist
COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/
WORKDIR /repo/apps/web
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY apps/web/ ./
ARG VITE_API_URL=https://api.retfast.com
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ARG VITE_API_URL=https://api.retfast.com
USER root
COPY infrastructure/docker/web.nginx.conf /etc/nginx/conf.d/default.conf
# Security headers (CSP allows self, the API over https+wss and OpenFreeMap tiles/styles/glyphs).
RUN set -eu; \
    mkdir -p /etc/nginx/snippets; \
    api="${VITE_API_URL%/}"; \
    ws="$(printf '%s' "$api" | sed 's#^http#ws#')"; \
    { \
      echo "add_header Content-Security-Policy \"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tiles.openfreemap.org; font-src 'self' data:; connect-src 'self' ${api} ${ws} https://tiles.openfreemap.org; worker-src 'self' blob:; child-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'\" always;"; \
      echo "add_header X-Content-Type-Options \"nosniff\" always;"; \
      echo "add_header X-Frame-Options \"DENY\" always;"; \
      echo "add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;"; \
      echo "add_header Permissions-Policy \"camera=(), microphone=(), geolocation=(), payment=()\" always;"; \
      echo "add_header Strict-Transport-Security \"max-age=31536000\" always;"; \
      echo "add_header Cross-Origin-Opener-Policy \"same-origin\" always;"; \
    } > /etc/nginx/snippets/security-headers.conf; \
    chown -R nginx:nginx /etc/nginx/snippets
COPY --from=build --chown=nginx:nginx /repo/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
