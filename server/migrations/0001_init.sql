-- Retfast v3 – başlangıç şeması.
-- Zaman: timestamptz (UTC). ID: UUID v7 (uygulama üretir). Enum'lar text + CHECK (migration'ı kolay).

create extension if not exists citext;

-- ── Kullanıcılar ve oturumlar ───────────────────────────────────────────────
create table users (
    id                      uuid primary key,
    email                   citext not null unique,
    password_hash           text,                       -- sosyal girişle açılan hesapta null
    first_name              text not null,
    last_name               text not null,
    phone                   text,
    country                 text,                       -- ISO 3166-1 alpha-2
    locale                  text not null default 'en' check (locale in ('en', 'tr')),
    avatar_url              text,
    emergency_contact_name  text,
    emergency_contact_phone text,
    is_system_admin         boolean not null default false,
    email_verified_at       timestamptz,
    location_consent_at     timestamptz,                -- konum paylaşımı açık rızası
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    deleted_at              timestamptz
);

-- Google / Apple girişi için hazır; v1'de yalnızca şema.
create table user_identities (
    provider   text not null check (provider in ('google', 'apple')),
    subject    text not null,
    user_id    uuid not null references users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (provider, subject)
);

-- Opak oturum belirteci; yalnızca SHA-256 özeti saklanır.
create table sessions (
    id           uuid primary key,
    user_id      uuid not null references users (id) on delete cascade,
    token_hash   bytea not null unique,
    platform     text not null default 'web' check (platform in ('web', 'ios', 'android')),
    device_name  text,
    push_token   text,
    created_at   timestamptz not null default now(),
    last_used_at timestamptz not null default now(),
    expires_at   timestamptz not null,
    revoked_at   timestamptz
);
create index sessions_user_idx on sessions (user_id) where revoked_at is null;

-- ── Etkinlikler ────────────────────────────────────────────────────────────
create table events (
    id                    uuid primary key,
    slug                  text not null unique,
    name                  text not null,
    description           text not null default '',
    image_url             text,
    starts_at             timestamptz not null,
    ends_at               timestamptz not null,
    timezone              text not null default 'Europe/Istanbul',
    country               text,
    city                  text,
    region                text,
    center_lat            double precision,
    center_lon            double precision,
    visibility            text not null default 'public' check (visibility in ('public', 'private')),
    -- draft: yalnız adminler görür · published: başvuruya açık · active: operasyon/takip açık
    status                text not null default 'draft'
                          check (status in ('draft', 'published', 'active', 'completed', 'archived')),
    applications_open_at  timestamptz,
    applications_close_at timestamptz,
    applications_closed   boolean not null default false,
    invite_code           text unique,
    contact               jsonb not null default '{}',
    rules_md              text not null default '',
    settings              jsonb not null default '{}',   -- konum saklama süresi vb.
    created_by            uuid not null references users (id),
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    check (ends_at > starts_at)
);
create index events_listing_idx on events (status, starts_at);

create table event_points (
    id           uuid primary key,
    event_id     uuid not null references events (id) on delete cascade,
    kind         text not null check (kind in
                 ('takeoff', 'landing', 'alt_landing', 'emergency_landing', 'meeting', 'hazard')),
    name         text not null,
    lat          double precision not null check (lat between -90 and 90),
    lon          double precision not null check (lon between -180 and 180),
    altitude_m   real,
    description  text not null default '',
    instructions text not null default '',
    created_at   timestamptz not null default now()
);
create index event_points_event_idx on event_points (event_id);

create table event_zones (
    id         uuid primary key,
    event_id   uuid not null references events (id) on delete cascade,
    kind       text not null check (kind in ('boundary', 'hazard', 'flight_area')),
    name       text not null,
    geojson    jsonb not null,
    created_at timestamptz not null default now()
);
create index event_zones_event_idx on event_zones (event_id);

create table vehicles (
    id         uuid primary key,
    event_id   uuid not null references events (id) on delete cascade,
    name       text not null,
    plate      text,
    capacity   smallint not null default 4 check (capacity between 1 and 60),
    created_at timestamptz not null default now()
);
create index vehicles_event_idx on vehicles (event_id);

-- Kullanıcının bir etkinlikteki tek rolü. Etkinlik admini operasyonel olarak observer yetkilerini de taşır.
create table event_members (
    event_id     uuid not null references events (id) on delete cascade,
    user_id      uuid not null references users (id) on delete cascade,
    role         text not null check (role in ('event_admin', 'pilot', 'retriever', 'observer')),
    status       text not null default 'active' check (status in ('active', 'left', 'removed')),
    bib          text,                                  -- yarışma numarası
    vehicle_id   uuid references vehicles (id) on delete set null,
    is_available boolean not null default false,        -- retriever müsaitliği
    joined_at    timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    primary key (event_id, user_id)
);
create index event_members_user_idx on event_members (user_id) where status = 'active';

create table applications (
    id             uuid primary key,
    event_id       uuid not null references events (id) on delete cascade,
    user_id        uuid not null references users (id) on delete cascade,
    requested_role text check (requested_role in ('pilot', 'retriever', 'observer')),
    message        text not null default '',
    status         text not null default 'pending'
                   check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
    decided_role   text check (decided_role in ('pilot', 'retriever', 'observer')),
    decided_by     uuid references users (id),
    decided_at     timestamptz,
    decision_note  text,
    created_at     timestamptz not null default now()
);
create unique index applications_one_pending on applications (event_id, user_id) where status = 'pending';
create index applications_event_idx on applications (event_id, status, created_at);

-- ── Konum ──────────────────────────────────────────────────────────────────
create table tracking_sessions (
    id         uuid primary key,
    event_id   uuid not null references events (id) on delete cascade,
    user_id    uuid not null references users (id) on delete cascade,
    platform   text,
    app_version text,
    started_at timestamptz not null default now(),
    ended_at   timestamptz,
    end_reason text check (end_reason in ('user', 'event_ended', 'left_event', 'superseded', 'admin'))
);
create unique index tracking_sessions_one_open on tracking_sessions (event_id, user_id) where ended_at is null;

-- Birincil anahtar hem tekrar gönderimde çoğaltmayı önler (aynı cihaz aynı anda iki fix üretmez)
-- hem de "etkinlik + kullanıcı + zaman aralığı" sorgusunun indeksidir.
create table location_points (
    event_id    uuid not null,
    user_id     uuid not null,
    recorded_at timestamptz not null,
    session_id  uuid not null,
    lat         double precision not null,
    lon         double precision not null,
    accuracy_m  real,
    altitude_m  real,
    speed_mps   real,
    heading_deg real,
    battery_pct smallint,
    received_at timestamptz not null default now(),
    primary key (event_id, user_id, recorded_at)
);

-- ── Uçuş, retrieve, SOS ────────────────────────────────────────────────────
create table flights (
    id           uuid primary key,
    event_id     uuid not null references events (id) on delete cascade,
    pilot_id     uuid not null references users (id) on delete cascade,
    status       text not null default 'preparing'
                 check (status in ('preparing', 'flying', 'landed', 'completed', 'cancelled')),
    takeoff_at   timestamptz,
    landed_at    timestamptz,
    landed_lat   double precision,
    landed_lon   double precision,
    completed_at timestamptz,
    created_at   timestamptz not null default now()
);
create unique index flights_one_open on flights (event_id, pilot_id)
    where status in ('preparing', 'flying', 'landed');
create index flights_event_idx on flights (event_id, created_at);

-- Her talep, retriever için bir "durak"tır; bir retriever'ın birden çok açık talebi olabilir.
create table retrieve_requests (
    id            uuid primary key,
    event_id      uuid not null references events (id) on delete cascade,
    pilot_id      uuid not null references users (id) on delete cascade,
    flight_id     uuid references flights (id) on delete set null,
    status        text not null default 'open'
                  check (status in ('open', 'assigned', 'arrived', 'picked_up', 'completed', 'cancelled')),
    lat           double precision not null,
    lon           double precision not null,
    note          text not null default '',
    retriever_id  uuid references users (id),
    vehicle_id    uuid references vehicles (id) on delete set null,
    assigned_by   uuid references users (id),
    stop_order    smallint,
    requested_at  timestamptz not null default now(),
    assigned_at   timestamptz,
    arrived_at    timestamptz,
    picked_up_at  timestamptz,
    completed_at  timestamptz,
    cancelled_at  timestamptz,
    cancel_reason text,
    check ((status = 'open') = (retriever_id is null) or status = 'cancelled')
);
create unique index retrieve_one_active_per_pilot on retrieve_requests (event_id, pilot_id)
    where status in ('open', 'assigned', 'arrived', 'picked_up');
create index retrieve_event_idx on retrieve_requests (event_id, status);
create index retrieve_retriever_idx on retrieve_requests (retriever_id)
    where status in ('assigned', 'arrived', 'picked_up');

create table sos_alerts (
    id              uuid primary key,
    event_id        uuid not null references events (id) on delete cascade,
    user_id         uuid not null references users (id) on delete cascade,
    status          text not null default 'active' check (status in ('active', 'acknowledged', 'resolved')),
    lat             double precision,
    lon             double precision,
    message         text not null default '',
    created_at      timestamptz not null default now(),
    acknowledged_by uuid references users (id),
    acknowledged_at timestamptz,
    resolved_by     uuid references users (id),
    resolved_at     timestamptz,
    resolution_note text
);
create index sos_event_idx on sos_alerts (event_id, status);

-- ── Olay günlüğü, denetim, bildirim ────────────────────────────────────────
-- Etkinliğin sıralı operasyon günlüğü: canlı yayının kaynağı, yeniden bağlanınca
-- kaçan olayların eşitlenmesi ve operasyon zaman çizelgesi. Konum noktaları buraya yazılmaz.
create table event_log (
    seq        bigint generated always as identity primary key,
    event_id   uuid not null references events (id) on delete cascade,
    type       text not null,
    actor_id   uuid references users (id),
    subject_id uuid,                       -- ilgili kullanıcı (pilot/retriever)
    payload    jsonb not null default '{}',
    created_at timestamptz not null default now()
);
create index event_log_event_idx on event_log (event_id, seq);

-- Yönetim işlemleri (rol değişikliği, başvuru kararı, observer'ın pilot adına işlemi...).
create table audit_log (
    id          uuid primary key,
    actor_id    uuid references users (id),
    event_id    uuid references events (id) on delete set null,
    action      text not null,
    target_type text,
    target_id   uuid,
    detail      jsonb not null default '{}',
    ip          text,
    created_at  timestamptz not null default now()
);
create index audit_event_idx on audit_log (event_id, created_at desc);
create index audit_actor_idx on audit_log (actor_id, created_at desc);

create table notifications (
    id         uuid primary key,
    user_id    uuid not null references users (id) on delete cascade,
    event_id   uuid references events (id) on delete cascade,
    kind       text not null,
    critical   boolean not null default false,
    payload    jsonb not null default '{}',
    read_at    timestamptz,
    created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
