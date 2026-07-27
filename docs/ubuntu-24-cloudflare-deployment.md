# RETFAST API — Ubuntu 24.04, PostgreSQL and Cloudflare

This deployment runs Express and PostgreSQL on one Ubuntu 24.04 server. Neither service publishes a host port. A Cloudflare Tunnel container makes only the API reachable at `https://api.retfast.com`; PostgreSQL stays on the private Docker network.

> “Cloudflare PostgreSQL” is not a hosted PostgreSQL product used by this stack. Cloudflare Hyperdrive is intended to connect Cloudflare Workers to an existing database. Because RETFAST Express runs beside PostgreSQL on Ubuntu, a direct private Docker connection is simpler and avoids an unnecessary service layer.

## 1. Prepare the server

Use a non-root sudo user. Install updates and keep SSH open:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw
sudo ufw allow OpenSSH
sudo ufw enable
```

No inbound HTTP, HTTPS or PostgreSQL firewall rule is needed. Cloudflare Tunnel establishes an outbound connection.

Install Docker Engine from Docker's official Ubuntu repository:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"${UBUNTU_CODENAME:-$VERSION_CODENAME}\") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and back in once, then verify with `docker version` and `docker compose version`.

## 2. Clone and configure RETFAST

```bash
sudo mkdir -p /opt/retfast
sudo chown "$USER":"$USER" /opt/retfast
git clone https://github.com/mdenizay/retfast.git /opt/retfast
cd /opt/retfast
cp deploy/.env.example deploy/.env
```

Generate an URL-safe database password and place the same value in both `POSTGRES_PASSWORD` and `DATABASE_URL`:

```bash
openssl rand -hex 32
nano deploy/.env
```

Keep these production values:

- `FIREBASE_PROJECT_ID=retfast-ab7ca`
- `SUPERADMIN_EMAILS=medenizay@gmail.com`
- `CORS_ORIGINS=https://retfast.com,https://www.retfast.com`
- `DATABASE_SSL=false` because the database traffic never leaves the private Docker network

## 3. Add Firebase server credentials

In Firebase Console open **Project settings → Service accounts → Generate new private key** for `retfast-ab7ca`. Transfer the JSON to the server without committing it:

```bash
mkdir -p deploy/secrets
nano deploy/secrets/firebase-service-account.json
chmod 600 deploy/.env deploy/secrets/firebase-service-account.json
```

The credential is mounted read-only into the API. It is required because the API verifies token revocation and the migration command reads existing Firestore data.

## 4. Create the Cloudflare Tunnel

1. Open Cloudflare Zero Trust → **Networks → Tunnels**.
2. Create a Cloudflared tunnel named `retfast-api` and choose the Docker connector.
3. Copy only the token value from the shown Docker command into `CLOUDFLARE_TUNNEL_TOKEN` in `deploy/.env`.
4. Add a public hostname:
   - Subdomain: `api`
   - Domain: `retfast.com`
   - Service type: `HTTP`
   - URL: `api:3000`
5. In the Cloudflare zone, leave WebSockets enabled. RETFAST sends heartbeat frames, while REST polling remains a fallback on unstable mobile networks.

The hostname target must be `api:3000`, not `localhost:3000`, because Cloudflared reaches Express by its Docker service name.

## 5. Start PostgreSQL and the API

```bash
cd /opt/retfast
docker compose --env-file deploy/.env -f deploy/compose.production.yml build
docker compose --env-file deploy/.env -f deploy/compose.production.yml up -d
docker compose --env-file deploy/.env -f deploy/compose.production.yml ps
```

The one-shot `migrate` service applies versioned SQL migrations before the API starts. Confirm readiness:

```bash
curl --fail https://api.retfast.com/healthz
curl --fail https://api.retfast.com/readyz
docker compose --env-file deploy/.env -f deploy/compose.production.yml logs --tail=100 api cloudflared
```

Both HTTP checks should return a JSON status. `/readyz` proves that Express can query PostgreSQL.

## 6. Import the current Firebase dataset

Run this once after the first healthy startup, before deploying the new web bundle:

```bash
docker compose --env-file deploy/.env -f deploy/compose.production.yml run --rm api node dist/db/import-firebase.js
```

The import is idempotent. It preserves Firebase user IDs and event IDs, so existing accounts and links continue to work. Live-location records are not copied; a fresh tracking session repopulates them.

Check the imported row counts:

```bash
docker compose --env-file deploy/.env -f deploy/compose.production.yml exec -T postgres \
  psql -U retfast -d retfast -c "SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM events) events, (SELECT count(*) FROM event_memberships) memberships;"
```

## 7. Switch the clients

Only after the API and import checks succeed:

```bash
# Run from the development Mac, inside the repository.
npm --prefix web run build:production
firebase deploy --only hosting --project retfast-ab7ca

# Ad hoc iOS build; this profile already uses APP_ENV=production.
cd mobile
npx eas-cli build --platform ios --profile testing
```

The installed iOS build sends foreground and background batches to `https://api.retfast.com`; it does not depend on Metro. For testing a different server without changing code, set `API_URL` in the EAS environment.

Recommended cutover order:

1. Start API/PostgreSQL/Tunnel.
2. Import Firebase data and validate row counts.
3. Deploy the web build.
4. Install the new iOS ad hoc build.
5. Keep the old Firebase Functions/data temporarily for rollback; disable them only after field testing.

## 8. Backups

Create an on-server PostgreSQL backup:

```bash
cd /opt/retfast
./deploy/scripts/backup.sh
```

The dump is written under the git-ignored `deploy/backups/` directory. Copy backups to a separate machine or encrypted object store; a backup on the same disk does not protect against server loss.

To restore a selected dump into a maintenance instance, first stop API traffic and then run the destructive restore deliberately:

```bash
docker compose --env-file deploy/.env -f deploy/compose.production.yml stop api cloudflared
docker compose --env-file deploy/.env -f deploy/compose.production.yml exec -T postgres \
  pg_restore --clean --if-exists -U retfast -d retfast < deploy/backups/SELECTED.dump
docker compose --env-file deploy/.env -f deploy/compose.production.yml start api cloudflared
```

## 9. Updates and rollback

Update the application:

```bash
cd /opt/retfast
./deploy/scripts/backup.sh
git pull --ff-only
docker compose --env-file deploy/.env -f deploy/compose.production.yml build
docker compose --env-file deploy/.env -f deploy/compose.production.yml up -d --remove-orphans
```

Inspect `docker compose ... logs api` after every migration. For application rollback, check out the previous known-good commit and rebuild. Database migrations are forward-only; restore the pre-deploy dump if a database rollback is truly required.

## Operational notes

- Do not expose ports `5432` or `3000` in Compose or UFW.
- Rotate the Cloudflare Tunnel token and Firebase service-account key if either is disclosed.
- Use `docker compose ... logs --since=30m api` for request failures; authorization headers are redacted.
- Set an uptime check on `https://api.retfast.com/readyz` after launch.
- Cloudflare supports proxied WebSockets; mobile and web also poll, so a socket reconnect does not stop operations.

References: [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [Cloudflare Tunnel setup](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/), [Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/), [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/get-started/).
