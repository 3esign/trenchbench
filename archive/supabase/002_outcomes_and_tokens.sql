-- ============================================================
--  trenchbench — migration 002: outcome labels + live token colours
--
--  WHY THIS MATTERS
--  Until now the database stored what each agent DID, but not whether it
--  WORKED. A decision log without outcome labels is barely a dataset — you
--  cannot train on it, benchmark on it, or sell it. This migration adds the
--  labels, so every decision becomes a (situation → action → result) row.
--
--  HOW TO APPLY (one time, ~20 seconds)
--    1. open  https://supabase.com/dashboard/project/ufceqgryldskaglseqjj/sql/new
--    2. paste this whole file
--    3. click  RUN
--  Safe to run more than once.
-- ============================================================

-- ---------- 0. prerequisite from the earlier migration ----------
-- included here so this file works on its own, in any order, run twice, whatever.
alter table decisions add column if not exists token_class text;

-- ---------- 1. session token roster, with opening prices ----------
-- lets the Arena colour every token red/green against the session's own open,
-- instead of only the handful of tokens an agent happened to trade.
alter table sessions add column if not exists tokens jsonb;

-- ---------- 2. the labels ----------
create table if not exists decision_outcomes (
  id bigint generated always as identity primary key,
  session_id uuid references sessions(id) on delete cascade,
  tick int,
  agent_id text,
  model text,
  action text,
  sym text,
  horizon int,            -- how many rounds ahead this was judged over
  fwd_ret numeric,        -- token move over the horizon, SIGNED by direction
                          --   (a SELL before a drop scores positive)
  fwd_ret_end numeric,    -- same, measured to the end of the session
  mkt_ret numeric,        -- equal-weight roster move over the same window
  edge numeric,           -- fwd_ret - market = the alpha of the call itself
  agent_edge numeric,     -- the agent's own equity move vs market (judges HOLDs)
  realized_pnl numeric,   -- FIFO realised $ on a SELL — the hard ground truth
  realized_pct numeric,
  hold_ticks int,         -- how long the position was held
  outcome text,           -- 'good' | 'bad' | 'flat' | 'na'
  created_at timestamptz default now()
);

create index if not exists ix_do_session on decision_outcomes(session_id);
create index if not exists ix_do_model   on decision_outcomes(model);
create index if not exists ix_do_lookup  on decision_outcomes(session_id, tick, agent_id);

-- ---------- 3. per-agent aggregates on the session report ----------
alter table agent_reports add column if not exists hit_rate      numeric; -- % of scored calls that beat the market
alter table agent_reports add column if not exists avg_edge      numeric; -- average alpha per call
alter table agent_reports add column if not exists realized_pnl  numeric; -- $ locked in on closed round-trips
alter table agent_reports add column if not exists closed_trades int;

-- ---------- 4. the sellable shape: log + label in one row ----------
create or replace view decisions_labeled as
  select d.session_id, d.tick, d.ts, d.agent_id, d.agent_name, d.role, d.model,
         d.start_cash, d.action, d.sym, d.qty, d.price, d.executed, d.comment,
         d.token_class, d.equity,
         o.horizon, o.fwd_ret, o.fwd_ret_end, o.mkt_ret, o.edge, o.agent_edge,
         o.realized_pnl, o.realized_pct, o.hold_ticks, o.outcome
  from decisions d
  left join decision_outcomes o
    on o.session_id = d.session_id and o.tick = d.tick and o.agent_id = d.agent_id;

-- ---------- 5. leaderboards that measure skill, not luck ----------
-- avg_return over 1-2 sessions is noise. These add sample size and hit rate
-- so a model that won once cannot outrank one that wins consistently.
create or replace view lb_models as
  select model, count(*) as reports, count(distinct session_id) as sessions_played,
         round(avg(ret)::numeric,2) as avg_return, round(avg(skill)::numeric,2) as avg_skill,
         round(max(ret)::numeric,2) as best_return,
         round(avg(hit_rate)::numeric,2) as avg_hit_rate,
         round(avg(avg_edge)::numeric,3) as avg_edge,
         round(sum(realized_pnl)::numeric,2) as realized_pnl
  from agent_reports where model is not null group by model order by avg_return desc;

-- which token actually PAID, not just which was clicked most
create or replace view lb_token_pnl as
  select sym,
         count(*) as calls,
         count(*) filter (where outcome='good') as good_calls,
         round((count(*) filter (where outcome='good'))::numeric
               / nullif(count(*) filter (where outcome in ('good','bad','flat')),0) * 100, 1) as hit_rate,
         round(avg(edge)::numeric,3) as avg_edge,
         round(sum(coalesce(realized_pnl,0))::numeric,2) as realized_pnl
  from decision_outcomes
  where sym is not null and sym <> ''
  group by sym order by realized_pnl desc nulls last;

-- does a model's edge come from stocks or from memecoins?
create or replace view lb_model_by_class as
  select o.model, d.token_class,
         count(*) as calls,
         round(avg(o.edge)::numeric,3) as avg_edge,
         round((count(*) filter (where o.outcome='good'))::numeric
               / nullif(count(*) filter (where o.outcome in ('good','bad','flat')),0) * 100, 1) as hit_rate
  from decision_outcomes o
  join decisions d
    on d.session_id = o.session_id and d.tick = o.tick and d.agent_id = o.agent_id
  where d.token_class is not null
  group by o.model, d.token_class order by avg_edge desc nulls last;

-- ---------- 6. access ----------
alter table decision_outcomes enable row level security;

do $$ begin
  create policy p_read_out on decision_outcomes for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy p_ins_out on decision_outcomes for insert with check (true);
exception when duplicate_object then null; end $$;
