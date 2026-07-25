-- ============================================================
--  BENCHHOOD — FULL SETUP, FROM ZERO
--
--  This ONE file replaces schema.sql + add_token_class + 002 + 003 + 004.
--  It DELETES every session, decision, outcome and report, then rebuilds
--  the whole database correctly.
--
--  ⚠ DESTRUCTIVE. Everything recorded so far is wiped. That is the point —
--    all existing data was produced against a synthetic price walk, so it
--    cannot be the first rows of a benchmark you intend to sell.
--    Your local sessions/*.json copies are untouched.
--
--  HOW TO APPLY
--    1. open  https://supabase.com/dashboard/project/ufceqgryldskaglseqjj/sql/new
--    2. paste this whole file
--    3. click  RUN
--  Safe to run again later if you ever want another clean slate.
-- ============================================================

-- ---------- 0. tear down ----------
drop view if exists decisions_labeled     cascade;
drop view if exists lb_models             cascade;
drop view if exists lb_models_ranked      cascade;
drop view if exists lb_models_true        cascade;
drop view if exists lb_personas_ranked    cascade;
drop view if exists lb_model_persona      cascade;
drop view if exists lb_model_by_class     cascade;
drop view if exists lb_token_pnl          cascade;
drop view if exists lb_tokens             cascade;
drop view if exists lb_agents             cascade;
drop view if exists career_models         cascade;
drop view if exists career_agents         cascade;

drop table if exists agent_memory      cascade;
drop table if exists decision_outcomes cascade;
drop table if exists agent_reports     cascade;
drop table if exists equity_points     cascade;
drop table if exists decisions         cascade;
drop table if exists sessions          cascade;

-- ---------- 1. tables ----------
create table sessions (
  id uuid primary key default gen_random_uuid(),
  name text,
  provider text,                       -- 'ollama' | 'rules'
  status text default 'running',       -- 'running' | 'stopped'
  memecoins text[],                    -- the token roster this session
  tokens jsonb,                        -- [{sym, addr, cat, fresh, open, last}] — opening prices
  capital_min numeric, capital_max numeric,
  capital_mode text,                   -- 'equal' | 'random'
  pairing text,                        -- 'rotate' | 'fixed' | 'random'
  rounds int,
  counted boolean default false,       -- may this session move the all-time boards?
  started_at timestamptz default now(),
  stopped_at timestamptz
);

create table decisions (
  id bigint generated always as identity primary key,
  session_id uuid references sessions(id) on delete cascade,
  tick int, ts timestamptz default now(),
  agent_id text, agent_name text, role text, model text,
  brain text,                          -- model | timeout | error | rules
  start_cash numeric,
  action text, sym text, qty numeric, price numeric, executed boolean,
  comment text,                        -- the model's own <=8-word reason
  choice int,                          -- which option it picked off the menu
  reply text,                          -- the model's literal words, for audit
  menu_size int,                       -- how many legal moves were on offer
  token_class text,                    -- stock | memecoin | stable
  equity numeric
);

create table equity_points (
  id bigint generated always as identity primary key,
  session_id uuid references sessions(id) on delete cascade,
  agent_id text, tick int, ts timestamptz default now(), value numeric
);

create table agent_reports (
  id bigint generated always as identity primary key,
  session_id uuid references sessions(id) on delete cascade,
  agent_id text, agent_name text, role text, model text,
  start_cash numeric, end_value numeric, ret numeric, skill numeric, trades int,
  hit_rate numeric,                    -- % of this agent's MODEL-made trades that beat the market
  avg_edge numeric,                    -- average alpha per call
  realized_pnl numeric, closed_trades int,
  raydium_hits int default 0,          -- how many of this agent's picks successfully migrated to Raydium
  model_calls int, fallback_calls int,
  model_share numeric,                 -- %% of this agent's calls the MODEL actually made
  is_baseline boolean default false,   -- true for the mechanical null models
  summary text, notes_history jsonb, created_at timestamptz default now()
);

create table decision_outcomes (
  id bigint generated always as identity primary key,
  session_id uuid references sessions(id) on delete cascade,
  tick int, agent_id text, model text, brain text, action text, sym text,
  horizon int,          -- rounds ahead this was judged over
  fwd_ret numeric,      -- token move over the horizon, SIGNED by direction
  fwd_ret_end numeric,  -- same, measured to the end of the session
  mkt_ret numeric,      -- equal-weight roster move over the same window
  edge numeric,         -- fwd_ret - market = the alpha of the call itself
  agent_edge numeric,   -- the agent's own equity vs market (this is how HOLDs are judged)
  realized_pnl numeric, -- FIFO realised $ on a SELL — the hard ground truth
  realized_pct numeric,
  hold_ticks int,
  regret numeric,       -- gap to the BEST move that was available that round
  was_best boolean,     -- did it pick the best option on the table?
  outcome text,         -- good | bad | flat | na | void (token delisted mid-session; unscoreable)
  created_at timestamptz default now()
);

-- ---------- what each agent learned, carried into later sessions ----------
-- Keyed to the PERSONA, not the model. The pairing rotates, so these are the
-- strategy's accumulated notes and every model inherits the same ones — which
-- keeps the model comparison fair while still letting the agents improve.
create table agent_memory (
  id bigint generated always as identity primary key,
  session_id uuid references sessions(id) on delete cascade,
  agent_id text, agent_name text, model text,
  ret numeric,
  lesson text,
  created_at timestamptz default now()
);
create index ix_mem_agent on agent_memory(agent_id, created_at desc);

create index ix_dec_session   on decisions(session_id);
create index ix_dec_brain     on decisions(brain);
create index ix_eq_session    on equity_points(session_id);
create index ix_rep_session   on agent_reports(session_id);
create index ix_do_session    on decision_outcomes(session_id);
create index ix_do_model      on decision_outcomes(model);
create index ix_do_lookup     on decision_outcomes(session_id, tick, agent_id);
create index ix_sess_counted  on sessions(counted);

-- ---------- 2. the sellable shape: raw log + label in one row ----------
create view decisions_labeled as
  select d.session_id, d.tick, d.ts, d.agent_id, d.agent_name, d.role, d.model, d.brain,
         d.start_cash, d.action, d.sym, d.qty, d.price, d.executed, d.comment,
         d.token_class, d.reply, d.equity,
         o.horizon, o.fwd_ret, o.fwd_ret_end, o.mkt_ret, o.edge, o.agent_edge,
         o.realized_pnl, o.realized_pct, o.hold_ticks, o.regret, o.was_best, o.outcome
  from decisions d
  left join decision_outcomes o
    on o.session_id = d.session_id and o.tick = d.tick and o.agent_id = d.agent_id;

-- ---------- 3. benchmark views (counted sessions only) ----------
create view lb_models as
  select r.model, count(*) as reports, count(distinct r.session_id) as sessions_played,
         count(distinct r.agent_id) as personas_played,
         round(avg(r.ret)::numeric,2) as avg_return, round(avg(r.skill)::numeric,2) as avg_skill,
         round(max(r.ret)::numeric,2) as best_return,
         round(avg(r.hit_rate)::numeric,2) as avg_hit_rate,
         round(avg(r.avg_edge)::numeric,3) as avg_edge,
         round(sum(r.realized_pnl)::numeric,2) as realized_pnl,
         sum(coalesce(r.raydium_hits, 0)) as total_raydium_hits
  from agent_reports r join sessions s on s.id = r.session_id
  where s.counted and r.model is not null
  group by r.model order by avg_return desc;

create view lb_personas_ranked as
  select r.agent_id, max(r.agent_name) as agent_name, max(r.role) as role,
         count(distinct r.session_id) as sessions_played,
         count(distinct r.model)      as models_played,
         round(avg(r.ret)::numeric,2) as avg_return,
         round(avg(r.hit_rate)::numeric,1) as avg_hit_rate,
         round(avg(r.avg_edge)::numeric,3) as avg_edge,
         sum(coalesce(r.raydium_hits, 0)) as total_raydium_hits
  from agent_reports r join sessions s on s.id = r.session_id
  where s.counted
  group by r.agent_id order by avg_return desc;

-- does this brain suit this strategy, separated from the model being good generally
create view lb_model_persona as
  with cell as (
    select r.model, r.agent_id, max(r.agent_name) as agent_name, count(*) as runs,
           avg(r.ret) as cell_return, avg(r.hit_rate) as cell_hit
    from agent_reports r join sessions s on s.id = r.session_id
    where s.counted and r.model is not null
    group by r.model, r.agent_id),
  base as (select model, avg(cell_return) as model_return from cell group by model)
  select c.model, c.agent_id, c.agent_name, c.runs,
         round(c.cell_return::numeric,2) as avg_return,
         round(c.cell_hit::numeric,1)    as avg_hit_rate,
         round((c.cell_return - b.model_return)::numeric,2) as pairing_effect
  from cell c join base b on b.model = c.model
  order by avg_return desc;

-- model quality counting ONLY calls the model itself made
create view lb_models_true as
  select o.model,
         count(*) filter (where o.brain = 'model' and o.edge is not null) as model_trades,
         count(*) filter (where o.brain <> 'model')                       as fallback_calls,
         round((count(*) filter (where o.brain = 'model' and o.outcome = 'good'))::numeric
               / nullif(count(*) filter (where o.brain = 'model' and o.edge is not null),0) * 100, 1) as hit_rate,
         round((avg(o.edge) filter (where o.brain = 'model'))::numeric, 3) as avg_edge,
         round(sum(coalesce(o.realized_pnl,0))::numeric, 2)                as realized_pnl,
         round(avg(o.regret) filter (where o.brain = 'model')::numeric, 3)  as avg_regret,
         round((count(*) filter (where o.brain = 'model' and o.was_best))::numeric
               / nullif(count(*) filter (where o.brain = 'model' and o.regret is not null),0) * 100, 1) as best_pick_rate
  from decision_outcomes o join sessions s on s.id = o.session_id
  where s.counted and o.model is not null
  group by o.model order by avg_edge desc nulls last;

create view lb_token_pnl as
  select o.sym, count(*) as calls,
         count(*) filter (where o.outcome='good') as good_calls,
         round((count(*) filter (where o.outcome='good'))::numeric
               / nullif(count(*) filter (where o.outcome in ('good','bad','flat')),0) * 100, 1) as hit_rate,
         round(avg(o.edge)::numeric,3) as avg_edge,
         round(sum(coalesce(o.realized_pnl,0))::numeric,2) as realized_pnl
  from decision_outcomes o
  where o.sym is not null and o.sym <> ''
  group by o.sym order by realized_pnl desc nulls last;

create view lb_model_by_class as
  select o.model, d.token_class, count(*) as calls,
         round(avg(o.edge)::numeric,3) as avg_edge,
         round((count(*) filter (where o.outcome='good'))::numeric
               / nullif(count(*) filter (where o.outcome in ('good','bad','flat')),0) * 100, 1) as hit_rate
  from decision_outcomes o
  join decisions d on d.session_id=o.session_id and d.tick=o.tick and d.agent_id=o.agent_id
  where d.token_class is not null
  group by o.model, d.token_class order by avg_edge desc nulls last;

-- ---------- 4. career ledger: $100k compounded through counted sessions ----------
create view career_models as
  -- ONE gain factor per SESSION, not per agent_reports row. With 7 models and 8
  -- personas a model drives two agents in the same session and used to compound
  -- twice for it: three personas at +20% in one session showed a career of
  -- $172,800 next to "sessions: 1". Baselines are excluded — they are the
  -- reference line, not contenders.
  with per_session as (
    select r.model, r.session_id, avg(r.ret) as ret, avg(r.hit_rate) as hit_rate, sum(coalesce(r.raydium_hits, 0)) as raydium_hits
    from agent_reports r join sessions s on s.id = r.session_id
    where s.counted and r.model is not null and r.ret is not null
      and coalesce(r.is_baseline,false) = false and r.model not like 'baseline:%'
    group by r.model, r.session_id)
  select model, count(*) as sessions,
         round((100000 * exp(sum(ln(greatest(1 + ret/100.0, 0.01)))))::numeric,2) as balance,
         round(avg(ret)::numeric,2) as avg_return,
         round(avg(hit_rate)::numeric,1) as avg_hit_rate,
         sum(raydium_hits) as total_raydium_hits
  from per_session group by model order by balance desc;

create view career_agents as
  with per_session as (
    select r.agent_id, max(r.agent_name) as agent_name, r.session_id,
           avg(r.ret) as ret, avg(r.hit_rate) as hit_rate, count(distinct r.model) as models,
           sum(coalesce(r.raydium_hits, 0)) as raydium_hits
    from agent_reports r join sessions s on s.id = r.session_id
    where s.counted and r.ret is not null
    group by r.agent_id, r.session_id)
  select agent_id, max(agent_name) as agent_name, count(*) as sessions, sum(models) as models_played,
         round((100000 * exp(sum(ln(greatest(1 + ret/100.0, 0.01)))))::numeric,2) as balance,
         round(avg(ret)::numeric,2) as avg_return,
         round(avg(hit_rate)::numeric,1) as avg_hit_rate,
         sum(raydium_hits) as total_raydium_hits
  from per_session group by agent_id order by balance desc;

-- ---------- the null models: what every model number is read against ----------
create view lb_baselines as
  select r.model as baseline, count(distinct r.session_id) as sessions,
         round(avg(r.ret)::numeric,2)      as avg_return,
         round(avg(r.hit_rate)::numeric,1) as avg_hit_rate,
         round(avg(r.avg_edge)::numeric,3) as avg_edge
  from agent_reports r join sessions s on s.id = r.session_id
  where s.counted and (coalesce(r.is_baseline,false) or r.model like 'baseline:%')
  group by r.model order by avg_return desc;

-- ============================================================
--  5. ACCESS — this is the part that matters before you publish
--
--  The public site ships your anon key in its JavaScript, where anyone can
--  read it. Previously the policies allowed anon INSERT, which means a
--  stranger could have written fake sessions into your benchmark. The
--  database IS the product, so that had to go.
--
--  Now: the world can READ. Only the service_role key can WRITE, and that
--  key lives in config.txt on your machine (git-ignored, never published).
-- ============================================================
alter table sessions          enable row level security;
alter table decisions         enable row level security;
alter table equity_points     enable row level security;
alter table agent_reports     enable row level security;
alter table decision_outcomes enable row level security;
alter table agent_memory      enable row level security;

create policy p_read_sessions on sessions          for select using (true);
create policy p_read_dec      on decisions         for select using (true);
create policy p_read_eq       on equity_points     for select using (true);
create policy p_read_rep      on agent_reports     for select using (true);
create policy p_read_out      on decision_outcomes for select using (true);
create policy p_read_mem      on agent_memory      for select using (true);
-- deliberately no INSERT/UPDATE policies: service_role bypasses RLS entirely,
-- so the local runner still writes fine and nobody else can.
