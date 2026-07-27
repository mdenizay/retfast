CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE global_role AS ENUM ('user', 'superadmin');
CREATE TYPE event_role AS ENUM ('manager', 'pilot', 'retriever', 'observer');
CREATE TYPE membership_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE event_visibility AS ENUM ('public', 'unlisted', 'private');
CREATE TYPE event_status AS ENUM ('draft', 'published', 'active', 'completed', 'cancelled');
CREATE TYPE tracking_status AS ENUM ('active', 'completed', 'cancelled', 'interrupted');
CREATE TYPE connectivity_status AS ENUM ('online', 'limited', 'offline', 'unknown');
CREATE TYPE retriever_availability AS ENUM ('available', 'busy', 'inactive', 'offline');
CREATE TYPE retrieval_status AS ENUM ('searching', 'offered', 'assigned', 'picked_up', 'delivered', 'cancelled');
CREATE TYPE retrieval_urgency AS ENUM ('normal', 'emergency');

CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 80),
  locale text NOT NULL DEFAULT 'tr' CHECK (locale IN ('tr', 'en')),
  global_role global_role NOT NULL DEFAULT 'user',
  radio_callsign text CHECK (radio_callsign IS NULL OR char_length(radio_callsign) <= 24),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));

CREATE TABLE events (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 100),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1200),
  venue text NOT NULL CHECK (char_length(venue) BETWEEN 2 AND 120),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Istanbul',
  visibility event_visibility NOT NULL DEFAULT 'public',
  status event_status NOT NULL DEFAULT 'draft',
  manager_user_id text NOT NULL REFERENCES users(id),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX events_starts_at_idx ON events (starts_at DESC);
CREATE INDEX events_manager_idx ON events (manager_user_id);

CREATE TABLE event_memberships (
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role event_role,
  status membership_status NOT NULL DEFAULT 'pending',
  invited_by text REFERENCES users(id),
  reviewed_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_memberships_user_idx ON event_memberships (user_id, status);

CREATE TABLE tracking_sessions (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  role event_role NOT NULL CHECK (role IN ('pilot', 'retriever')),
  display_name text NOT NULL,
  radio_callsign text,
  status tracking_status NOT NULL DEFAULT 'active',
  device_id text NOT NULL CHECK (char_length(device_id) BETWEEN 8 AND 128),
  started_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  stopped_by text REFERENCES users(id),
  point_count integer NOT NULL DEFAULT 0,
  last_recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tracking_one_active_per_event_user
  ON tracking_sessions (event_id, user_id) WHERE status = 'active';
CREATE INDEX tracking_sessions_event_idx ON tracking_sessions (event_id, started_at DESC);

CREATE TABLE tracking_batches (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  point_count integer NOT NULL CHECK (point_count BETWEEN 1 AND 100),
  first_recorded_at timestamptz NOT NULL,
  last_recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, id)
);

CREATE TABLE tracking_points (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id text NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  recorded_at timestamptz NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy double precision CHECK (accuracy BETWEEN 0 AND 5000),
  altitude double precision CHECK (altitude BETWEEN -1000 AND 20000),
  altitude_accuracy double precision CHECK (altitude_accuracy BETWEEN 0 AND 5000),
  speed double precision CHECK (speed BETWEEN 0 AND 200),
  heading double precision CHECK (heading BETWEEN 0 AND 360),
  battery_level double precision CHECK (battery_level BETWEEN 0 AND 1),
  is_charging boolean,
  connectivity connectivity_status NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, sequence)
);
CREATE INDEX tracking_points_replay_idx ON tracking_points (session_id, recorded_at);

CREATE TABLE live_locations (
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  role event_role NOT NULL CHECK (role IN ('pilot', 'retriever')),
  display_name text NOT NULL,
  radio_callsign text,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy double precision,
  altitude double precision,
  speed double precision,
  heading double precision,
  battery_level double precision,
  is_charging boolean,
  connectivity connectivity_status NOT NULL,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  online boolean NOT NULL DEFAULT true,
  last_disconnected_at timestamptz,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX live_locations_fresh_idx ON live_locations (event_id, received_at DESC);

CREATE TABLE retriever_states (
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 20),
  assigned_count integer NOT NULL DEFAULT 0 CHECK (assigned_count >= 0),
  availability retriever_availability NOT NULL DEFAULT 'inactive',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id),
  CHECK (assigned_count <= capacity)
);

CREATE TABLE retrieval_jobs (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  session_id text NOT NULL UNIQUE REFERENCES tracking_sessions(id),
  pilot_id text NOT NULL REFERENCES users(id),
  pilot_name text NOT NULL,
  urgency retrieval_urgency NOT NULL DEFAULT 'normal',
  status retrieval_status NOT NULL DEFAULT 'searching',
  offered_retriever_id text REFERENCES users(id),
  offered_retriever_name text,
  assigned_retriever_id text REFERENCES users(id),
  assigned_retriever_name text,
  offer_expires_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retrieval_jobs_event_status_idx ON retrieval_jobs (event_id, status);
CREATE INDEX retrieval_jobs_retriever_idx ON retrieval_jobs (assigned_retriever_id, status);
CREATE TABLE messages (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES users(id),
  recipient_id text REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX messages_event_created_idx ON messages (event_id, created_at DESC);

CREATE TABLE push_devices (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text REFERENCES events(id) ON DELETE SET NULL,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_event_created_idx ON audit_logs (event_id, created_at DESC);
