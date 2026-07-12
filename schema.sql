-- Pitchline AI — Neon Postgres schema
-- Run once against your Neon database:  psql "$DATABASE_URL" -f schema.sql

create table if not exists leagues (
  id            text primary key,        -- e.g. 'mls', 'epl', 'ucl'
  name          text not null,
  country       text,
  region        text,
  tier          text,
  provider_id   text,                    -- the ID your data provider uses for this league
  season_start  date,
  season_end    date,
  updated_at    timestamptz default now()
);

create table if not exists teams (
  id            text primary key,        -- 'mls-nsh', 'epl-mci', etc
  league_id     text references leagues(id),
  name          text not null,
  short_name    text not null,
  provider_id   text,
  crest_url     text,
  updated_at    timestamptz default now()
);

create table if not exists matches (
  id              text primary key,      -- provider's event id, keep as text
  league_id       text references leagues(id),
  home_team_id    text references teams(id),
  away_team_id    text references teams(id),
  status          text not null,         -- upcoming | live | half_time | finished | postponed
  kickoff         timestamptz not null,
  minute          int,
  home_score      int,
  away_score      int,
  venue           text,
  referee         text,
  home_red_cards  int default 0,
  away_red_cards  int default 0,
  stats           jsonb,                 -- {possession:[h,a], shots:[h,a], onTarget:[h,a], corners:[h,a], xg:[h,a]}
  timeline        jsonb,                 -- [{minute, type, detail}]
  last_polled_at  timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_matches_status on matches(status);
create index if not exists idx_matches_kickoff on matches(kickoff);
create index if not exists idx_matches_league on matches(league_id);

create table if not exists standings (
  league_id     text references leagues(id),
  team_id       text references teams(id),
  group_name    text default 'overall',  -- supports conference/group splits
  rank          int,
  played        int,
  wins          int,
  draws         int,
  losses        int,
  points        int,
  season_label  text,                    -- e.g. '2026' or '2025-26' — lets you show a past season
  is_current    boolean default true,
  updated_at    timestamptz default now(),
  primary key (league_id, team_id, group_name, season_label)
);

-- Every AI prediction ever generated is stored here — never overwritten, so
-- post-match you can compare predicted vs actual (the accuracy-tracking loop
-- from the spec). New predictions for the same match get a fresh row.
create table if not exists predictions (
  id              bigserial primary key,
  match_id        text references matches(id),
  generated_at    timestamptz default now(),
  trigger         text,                  -- 'pre_24h' | 'pre_3h' | 'live_event' | 'kickoff'
  model_version   text default 'v1-statistical',
  home_win_pct    numeric,
  draw_pct        numeric,
  away_win_pct    numeric,
  btts_yes_pct    numeric,
  over25_pct      numeric,
  corners_line    numeric,
  corners_over_pct numeric,
  correct_scores  jsonb,                 -- [{score:'2-1', pct: 18}, ...]
  confidence      int,
  data_quality    int,
  reasoning       text
);
create index if not exists idx_predictions_match on predictions(match_id, generated_at desc);

-- Tracks AI token spend so the AI Activation Controller can throttle itself.
create table if not exists ai_usage_log (
  id           bigserial primary key,
  day          date default current_date,
  tokens_used  int,
  operation    text,
  match_id     text,
  created_at   timestamptz default now()
);
