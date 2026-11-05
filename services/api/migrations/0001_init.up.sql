-- Retfast initial schema. See docs/architecture/telemetry.md and security.md.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email                citext NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 320),
    password_hash        text NOT NULL,
    full_name            text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 200),
    email_verified_at    timestamptz,
    must_change_password boolean NOT NULL DEFAULT false,
    password_changed_at  timestamptz,
    password_expires_at  timestamptz,
    disabled_at          timestamptz,
    deleted_at           timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_created_at_idx ON users (created_at);

CREATE TABLE user_roles (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role       text NOT NULL CHECK (role IN ('pilot', 'observer', 'event_organizer', 'rescue_operator', 'platform_admin')),
    granted_at timestamptz NOT NULL DEFAULT now(),
    granted_by uuid REFERENCES users (id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, role)
);
CREATE INDEX user_roles_role_idx ON user_roles (role);

-- One row per issued refresh token. Rows sharing family_id form one login session;
-- presenting a token whose row is already rotated revokes the whole family.
CREATE TABLE user_sessions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id     uuid NOT NULL,
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash    bytea NOT NULL UNIQUE,
    client        text NOT NULL CHECK (client IN ('web', 'ios')),
    device_name   text NOT NULL DEFAULT '',
    ip            text NOT NULL DEFAULT '',
    user_agent    text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    rotated_at    timestamptz,
    revoked_at    timestamptz,
    revoke_reason text NOT NULL DEFAULT ''
);
CREATE INDEX user_sessions_family_idx ON user_sessions (family_id);
CREATE INDEX user_sessions_user_idx ON user_sessions (user_id, created_at);
CREATE INDEX user_sessions_expires_idx ON user_sessions (expires_at);

CREATE TABLE password_reset_tokens (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at);
CREATE INDEX password_reset_tokens_expires_idx ON password_reset_tokens (expires_at);

CREATE TABLE email_verification_tokens (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    email      citext NOT NULL,
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);
CREATE INDEX email_verification_tokens_user_idx ON email_verification_tokens (user_id, created_at);
CREATE INDEX email_verification_tokens_expires_idx ON email_verification_tokens (expires_at);

CREATE TABLE pilot_profiles (
    user_id                 uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    public_id               text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
    display_name            text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
    bio                     text NOT NULL DEFAULT '' CHECK (length(bio) <= 2000),
    wing                    text NOT NULL DEFAULT '' CHECK (length(wing) <= 200),
    license_no              text NOT NULL DEFAULT '' CHECK (length(license_no) <= 100),
    nationality             text NOT NULL DEFAULT '' CHECK (nationality = '' OR nationality ~ '^[A-Z]{2}$'),
    emergency_contact_name  text NOT NULL DEFAULT '' CHECK (length(emergency_contact_name) <= 200),
    emergency_contact_phone text NOT NULL DEFAULT '' CHECK (length(emergency_contact_phone) <= 50),
    blood_type              text NOT NULL DEFAULT '' CHECK (length(blood_type) <= 10),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_preferences (
    user_id                   uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    units                     text NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'imperial')),
    default_flight_visibility text NOT NULL DEFAULT 'event' CHECK (default_flight_visibility IN ('private', 'event', 'public')),
    public_profile            boolean NOT NULL DEFAULT false,
    updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_id    text NOT NULL CHECK (length(device_id) BETWEEN 1 AND 200),
    platform     text NOT NULL CHECK (platform IN ('ios')),
    apns_token   text CHECK (apns_token IS NULL OR length(apns_token) <= 400),
    app_version  text NOT NULL DEFAULT '',
    os_version   text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, device_id)
);

-- ---------------------------------------------------------------- events
CREATE TABLE events (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                  citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,99}$'),
    name                  text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    description           text NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
    kind                  text NOT NULL DEFAULT 'paragliding' CHECK (kind IN ('paragliding', 'hang_gliding', 'speed_flying', 'other')),
    status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'active', 'completed', 'archived')),
    is_demo               boolean NOT NULL DEFAULT false,
    visibility            text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'restricted')),
    location_name         text NOT NULL DEFAULT '' CHECK (length(location_name) <= 300),
    center_lat            double precision CHECK (center_lat BETWEEN -90 AND 90),
    center_lon            double precision CHECK (center_lon BETWEEN -180 AND 180),
    center                geography(Point, 4326) GENERATED ALWAYS AS (
                              CASE WHEN center_lat IS NULL OR center_lon IS NULL THEN NULL
                                   ELSE ST_SetSRID(ST_MakePoint(center_lon, center_lat), 4326)::geography END) STORED,
    center_is_approximate boolean NOT NULL DEFAULT false,
    starts_at             timestamptz NOT NULL,
    ends_at               timestamptz NOT NULL,
    cover_image_url       text,
    registration_open     boolean NOT NULL DEFAULT true,
    live_tracking         boolean NOT NULL DEFAULT true,
    flight_recording      boolean NOT NULL DEFAULT true,
    observers_allowed     boolean NOT NULL DEFAULT true,
    emergency_testing     boolean NOT NULL DEFAULT false,
    public_live_map       boolean NOT NULL DEFAULT false,
    organizer_id          uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at >= starts_at),
    CHECK ((center_lat IS NULL) = (center_lon IS NULL))
);
CREATE INDEX events_starts_at_idx ON events (starts_at);
CREATE INDEX events_status_idx ON events (status);
CREATE INDEX events_center_gix ON events USING gist (center);

-- Single membership table; role distinguishes organizers, participants and observers.
CREATE TABLE event_participants (
    event_id   uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role       text NOT NULL CHECK (role IN ('organizer', 'participant', 'observer')),
    status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
    joined_at  timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    added_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_participants_user_idx ON event_participants (user_id, status);

CREATE TABLE launch_sites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    lat         double precision CHECK (lat BETWEEN -90 AND 90),
    lon         double precision CHECK (lon BETWEEN -180 AND 180),
    position    geography(Point, 4326) GENERATED ALWAYS AS (
                    CASE WHEN lat IS NULL OR lon IS NULL THEN NULL
                         ELSE ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography END) STORED,
    elevation_m double precision CHECK (elevation_m BETWEEN -500 AND 9000),
    notes       text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
    is_verified boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CHECK ((lat IS NULL) = (lon IS NULL)),
    CHECK (NOT is_verified OR lat IS NOT NULL),
    UNIQUE (event_id, name)
);
CREATE INDEX launch_sites_position_gix ON launch_sites USING gist (position);

-- ---------------------------------------------------------------- flights
CREATE TABLE flight_sessions (
    id                    uuid PRIMARY KEY,
    public_id             text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z0-9]{6,16}$'),
    pilot_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    event_id              uuid REFERENCES events (id) ON DELETE SET NULL,
    status                text NOT NULL DEFAULT 'recording' CHECK (status IN ('recording', 'ended', 'abandoned')),
    visibility            text NOT NULL CHECK (visibility IN ('private', 'event', 'public')),
    is_simulated          boolean NOT NULL DEFAULT false,
    started_at            timestamptz NOT NULL,
    ended_at              timestamptz,
    device_platform       text NOT NULL DEFAULT '',
    device_app_version    text NOT NULL DEFAULT '',
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    -- latest position (highest seq), denormalised for the live map
    last_sample_id        uuid,
    last_seq              integer,
    last_t                timestamptz,
    last_lat              double precision,
    last_lon              double precision,
    last_gps_alt_m        double precision,
    last_h_acc_m          double precision,
    last_v_acc_m          double precision,
    last_speed_ms         double precision,
    last_course_deg       double precision,
    last_position_received_at timestamptz,
    last_received_at      timestamptz,
    -- running statistics (see internal/tracking/stats.go)
    sample_count          integer NOT NULL DEFAULT 0,
    distance_m            double precision NOT NULL DEFAULT 0,
    max_gps_alt_m         double precision,
    min_gps_alt_m         double precision,
    max_ground_speed_ms   double precision,
    total_ascent_m        double precision NOT NULL DEFAULT 0,
    total_descent_m       double precision NOT NULL DEFAULT 0,
    gap_count             integer NOT NULL DEFAULT 0,
    first_sample_t        timestamptz,
    last_sample_t         timestamptz,
    stats_state           jsonb NOT NULL DEFAULT '{}'::jsonb,
    stats_dirty           boolean NOT NULL DEFAULT false,
    CHECK (ended_at IS NULL OR ended_at >= started_at - interval '1 hour')
);
CREATE INDEX flight_sessions_pilot_idx ON flight_sessions (pilot_id, started_at DESC);
CREATE INDEX flight_sessions_event_idx ON flight_sessions (event_id, status, last_received_at DESC);
CREATE INDEX flight_sessions_status_idx ON flight_sessions (status, last_received_at);
CREATE INDEX flight_sessions_dirty_idx ON flight_sessions (stats_dirty) WHERE stats_dirty;

-- Partitioned by server receive time (ADR-004). Partitions are created by the API.
CREATE TABLE flight_positions (
    flight_id   uuid NOT NULL REFERENCES flight_sessions (id) ON DELETE CASCADE,
    seq         integer NOT NULL CHECK (seq >= 0),
    sample_id   uuid NOT NULL,
    batch_id    uuid,
    t           timestamptz NOT NULL,
    device_t    timestamptz,
    received_at timestamptz NOT NULL DEFAULT now(),
    lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon         double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
    geog        geography(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED,
    gps_alt_m   double precision,
    h_acc_m     double precision NOT NULL,
    v_acc_m     double precision,
    speed_ms    double precision,
    course_deg  double precision,
    meta        jsonb
) PARTITION BY RANGE (received_at);
CREATE INDEX flight_positions_flight_seq_idx ON flight_positions (flight_id, seq);
CREATE INDEX flight_positions_geog_gix ON flight_positions USING gist (geog);
CREATE INDEX flight_positions_received_brin ON flight_positions USING brin (received_at);
CREATE TABLE flight_positions_default PARTITION OF flight_positions DEFAULT;

-- Global de-duplication: unpartitioned, so (flight_id, seq) and sample_id are unique across partitions.
CREATE TABLE telemetry_sample_keys (
    flight_id   uuid NOT NULL REFERENCES flight_sessions (id) ON DELETE CASCADE,
    seq         integer NOT NULL,
    sample_id   uuid NOT NULL UNIQUE,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (flight_id, seq)
);

-- Classification of each processed batch for idempotent replay; pruned after 7 days.
CREATE TABLE telemetry_batches (
    batch_id   uuid PRIMARY KEY,
    flight_id  uuid NOT NULL REFERENCES flight_sessions (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    response   jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telemetry_batches_created_idx ON telemetry_batches (created_at);

-- ---------------------------------------------------------------- realtime outbox
CREATE TABLE realtime_outbox (
    id         bigserial PRIMARY KEY,
    kind       text NOT NULL CHECK (kind IN ('position', 'flight', 'incident')),
    event_id   uuid,
    flight_id  uuid,
    payload    jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX realtime_outbox_created_idx ON realtime_outbox (created_at);

-- ---------------------------------------------------------------- emergencies
CREATE TABLE emergency_incidents (
    id                uuid PRIMARY KEY,
    kind              text NOT NULL DEFAULT 'sos' CHECK (kind IN ('sos')),
    is_test           boolean NOT NULL DEFAULT false,
    status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'responding', 'resolved', 'cancelled')),
    pilot_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    flight_id         uuid REFERENCES flight_sessions (id) ON DELETE SET NULL,
    event_id          uuid REFERENCES events (id) ON DELETE SET NULL,
    lat               double precision CHECK (lat BETWEEN -90 AND 90),
    lon               double precision CHECK (lon BETWEEN -180 AND 180),
    gps_alt_m         double precision,
    h_acc_m           double precision,
    position_t        timestamptz,
    message           text NOT NULL DEFAULT '' CHECK (length(message) <= 2000),
    created_at_device timestamptz NOT NULL,
    received_at       timestamptz NOT NULL DEFAULT now(),
    acknowledged_at   timestamptz,
    acknowledged_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    resolved_at       timestamptz,
    cancelled_at      timestamptz,
    cancel_reason     text NOT NULL DEFAULT '',
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CHECK ((lat IS NULL) = (lon IS NULL))
);
CREATE INDEX emergency_incidents_status_idx ON emergency_incidents (status, received_at DESC);
CREATE INDEX emergency_incidents_event_idx ON emergency_incidents (event_id, status);
CREATE INDEX emergency_incidents_pilot_idx ON emergency_incidents (pilot_id, received_at DESC);
CREATE INDEX emergency_incidents_flight_open_idx ON emergency_incidents (flight_id) WHERE status IN ('open', 'acknowledged', 'responding');

CREATE TABLE emergency_updates (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id uuid NOT NULL REFERENCES emergency_incidents (id) ON DELETE CASCADE,
    kind        text NOT NULL CHECK (kind IN ('created', 'acknowledged', 'status_changed', 'note', 'assigned', 'assignment_status', 'position')),
    actor_id    uuid REFERENCES users (id) ON DELETE SET NULL,
    body        text NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
    status      text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX emergency_updates_incident_idx ON emergency_updates (incident_id, created_at);

CREATE TABLE rescue_responders (
    user_id      uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    availability text NOT NULL DEFAULT 'unavailable' CHECK (availability IN ('available', 'unavailable')),
    last_lat     double precision CHECK (last_lat BETWEEN -90 AND 90),
    last_lon     double precision CHECK (last_lon BETWEEN -180 AND 180),
    last_h_acc_m double precision,
    last_t       timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rescue_assignments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id  uuid NOT NULL REFERENCES emergency_incidents (id) ON DELETE CASCADE,
    responder_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status       text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'en_route', 'on_scene', 'completed', 'withdrawn')),
    assigned_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    assigned_at  timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (incident_id, responder_id)
);
CREATE INDEX rescue_assignments_responder_idx ON rescue_assignments (responder_id, status);

-- ---------------------------------------------------------------- notifications and email
CREATE TABLE notification_records (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind              text NOT NULL CHECK (kind IN ('event_update', 'flight', 'emergency_alert', 'rescue_ack', 'system')),
    title             text NOT NULL,
    body              text NOT NULL DEFAULT '',
    data              jsonb NOT NULL DEFAULT '{}'::jsonb,
    read_at           timestamptz,
    push_status       text NOT NULL DEFAULT 'pending' CHECK (push_status IN ('pending', 'sent', 'unconfigured', 'no_device', 'failed')),
    push_attempted_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_records_user_idx ON notification_records (user_id, created_at DESC);
CREATE INDEX notification_records_push_idx ON notification_records (created_at) WHERE push_status = 'pending';

CREATE TABLE email_outbox (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    to_email        citext NOT NULL,
    template        text NOT NULL CHECK (template IN ('welcome', 'password_reset', 'email_verification', 'security_notification', 'event_update')),
    subject         text NOT NULL,
    text_body       text NOT NULL,
    html_body       text NOT NULL,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    attempts        integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error      text NOT NULL DEFAULT '',
    provider_id     text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_outbox_pending_idx ON email_outbox (next_attempt_at) WHERE status = 'pending';
CREATE INDEX email_outbox_created_idx ON email_outbox (created_at);

-- ---------------------------------------------------------------- audit and privacy
CREATE TABLE audit_logs (
    id          bigserial PRIMARY KEY,
    actor_id    uuid REFERENCES users (id) ON DELETE SET NULL,
    action      text NOT NULL,
    target_type text NOT NULL DEFAULT '',
    target_id   text NOT NULL DEFAULT '',
    event_id    uuid,
    ip          text NOT NULL DEFAULT '',
    user_agent  text NOT NULL DEFAULT '',
    details     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

CREATE TABLE account_deletion_requests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reason        text NOT NULL DEFAULT '' CHECK (length(reason) <= 2000),
    status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed')),
    requested_at  timestamptz NOT NULL DEFAULT now(),
    scheduled_for timestamptz NOT NULL,
    cancelled_at  timestamptz,
    completed_at  timestamptz
);
CREATE UNIQUE INDEX account_deletion_requests_pending_uq ON account_deletion_requests (user_id) WHERE status = 'pending';
CREATE INDEX account_deletion_requests_due_idx ON account_deletion_requests (scheduled_for) WHERE status = 'pending';
