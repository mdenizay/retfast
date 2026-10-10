-- Etkinlik duyuruları. Yayınlanınca tüm aktif üyelere uygulama içi bildirim gider.
create table announcements (
    id         uuid primary key,
    event_id   uuid not null references events (id) on delete cascade,
    author_id  uuid not null references users (id),
    title      text not null check (char_length(title) between 1 and 120),
    body       text not null default '' check (char_length(body) <= 4000),
    created_at timestamptz not null default now()
);
create index announcements_event_idx on announcements (event_id, created_at desc);
