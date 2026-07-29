-- ============================================================
--  trenchbench — database schema
--  HOW TO APPLY (one time, ~30 seconds, no coding):
--    1. open  https://supabase.com/dashboard/project/ufceqgryldskaglseqjj/sql/new
--    2. paste this whole file
--    3. click  RUN
-- ============================================================

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  name text,
  provider text,                         -- 'ollama' | 'rules'
  status text default 'running',         -- 'running' | 'stopped'
  memecoins text[],                      -- the rotating memecoin roster this session
  capital_min numeric, capital_max numeric,
  started_at timestamptz default now(),
  stopped_at timestamptz
);

create table if not exists decisions (
  id bigint generated always as identity primary key,
  session_id uuid references sessions(id) on delete cascade,
  tick int, ts timestamptz default now(),
  agent_id text, agent_name text, role text, model text,
  start_cash numeric,
  action text, sym text, qty numeric, price numeric, executed boolean,
  comment text,                          -- the model's <=8-word reason
  equity numeric
);

create table if not exists equity_points (
  id bigint generated always as identity primary key,
  session_id uuid references sessions(id) on delete cascade,
  agent_id text, tick int, ts timestamptz default now(), value numeric
);

create table if not exists agent_reports (
  id bigint generated always as identity primary key,
  session_id uuid references sessions(id) on delete cascade,
  agent_id text, agent_name text, role text, model text,
  start_cash numeric, end_value numeric, ret numeric, skill numeric, trades int,
  summary text, notes_history jsonb, created_at timestamptz default now()
);

-- ---------- GLOBAL LEADERBOARDS (read by the Arena) ----------
create or replace view lb_models as
  select model, count(*) as reports, count(distinct session_id) as sessions_played,
         round(avg(ret)::numeric,2) as avg_return, round(avg(skill)::numeric,2) as avg_skill,
         round(max(ret)::numeric,2) as best_return
  from agent_reports where model is not null group by model order by avg_return desc;

create or replace view lb_agents as
  select agent_name, role, count(*) as sessions_played,
         round(avg(ret)::numeric,2) as avg_return, round(max(ret)::numeric,2) as best_return
  from agent_reports group by agent_name, role order by avg_return desc;

create or replace view lb_tokens as
  select sym, count(*) as trades,
         count(*) filter (where action='BUY') as buys,
         count(*) filter (where action='SELL') as sells
  from decisions where sym is not null and sym <> '' and executed
  group by sym order by trades desc;

-- ---------- access (MVP: public read; anon insert so the local runner can push) ----------
alter table sessions       enable row level security;
alter table decisions      enable row level security;
alter table equity_points  enable row level security;
alter table agent_reports  enable row level security;

create policy p_read_sessions on sessions      for select using (true);
create policy p_write_sessions on sessions     for all using (true) with check (true);
create policy p_read_dec on decisions          for select using (true);
create policy p_ins_dec on decisions           for insert with check (true);
create policy p_read_eq on equity_points       for select using (true);
create policy p_ins_eq on equity_points        for insert with check (true);
create policy p_read_rep on agent_reports      for select using (true);
create policy p_ins_rep on agent_reports       for insert with check (true);
