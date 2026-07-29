-- ============================================================
--  trenchbench — migration 003: make the benchmark actually a benchmark
--
--  WHY THIS MATTERS
--  Three things were stopping "which model trades best" from being a real
--  question you could answer:
--
--   1. A fixed model↔persona pairing meant the model table and the persona
--      table were the same ranking. You could never tell whether a model won
--      or whether its strategy won. The runner now rotates the pairing every
--      session; these columns record which scheme was used.
--   2. Randomised starting capital meant an agent on $500 could not even buy
--      a $1,400 token — barred from part of the market, not merely handicapped.
--      Capital is now equal by default; capital_mode records which was used.
--   3. A 2-round session could rank models exactly as loudly as a 400-round
--      one. Sessions now record how many rounds they ran, and short ones are
--      marked counted=false so they never move the all-time boards.
--
--  HOW TO APPLY
--    1. open  https://supabase.com/dashboard/project/ufceqgryldskaglseqjj/sql/new
--    2. paste this whole file
--    3. click  RUN
--  Safe to run more than once. Run 002 first if you have not already.
-- ============================================================

alter table sessions add column if not exists rounds       int;
alter table sessions add column if not exists counted      boolean default false;
alter table sessions add column if not exists pairing      text;     -- rotate | fixed | random
alter table sessions add column if not exists capital_mode text;     -- equal | random

-- Older sessions predate the round counter. Judge them by how many ticks of
-- decisions they actually produced, so history is classified on the same rule.
update sessions s
   set rounds = coalesce(s.rounds, sub.max_tick)
  from (select session_id, max(tick) as max_tick from decisions group by session_id) sub
 where sub.session_id = s.id and s.rounds is null;

update sessions set counted = (coalesce(rounds,0) >= 10) where counted is distinct from (coalesce(rounds,0) >= 10);

create index if not exists ix_sessions_counted on sessions(counted);

-- ---------- benchmark views: only sessions that earned a vote ----------

-- per MODEL, across every persona it played
create or replace view lb_models_ranked as
  select r.model,
         count(distinct r.session_id)            as sessions_played,
         count(distinct r.agent_id)              as personas_played,
         round(avg(r.ret)::numeric,2)            as avg_return,
         round(avg(r.skill)::numeric,2)          as avg_skill,
         round(avg(r.hit_rate)::numeric,1)       as avg_hit_rate,
         round(avg(r.avg_edge)::numeric,3)       as avg_edge,
         round(stddev_samp(r.ret)::numeric,2)    as return_sd,
         round(max(r.ret)::numeric,2)            as best_return
  from agent_reports r join sessions s on s.id = r.session_id
  where s.counted and r.model is not null
  group by r.model order by avg_return desc;

-- per PERSONA, across every model that played it
create or replace view lb_personas_ranked as
  select r.agent_id, max(r.agent_name) as agent_name, max(r.role) as role,
         count(distinct r.session_id)            as sessions_played,
         count(distinct r.model)                 as models_played,
         round(avg(r.ret)::numeric,2)            as avg_return,
         round(avg(r.hit_rate)::numeric,1)       as avg_hit_rate,
         round(avg(r.avg_edge)::numeric,3)       as avg_edge
  from agent_reports r join sessions s on s.id = r.session_id
  where s.counted
  group by r.agent_id order by avg_return desc;

-- the INTERACTION: does this model suit this strategy?
-- avg_return minus the model's own overall average = how much the pairing
-- itself is worth, separated from the model being good in general.
create or replace view lb_model_persona as
  with cell as (
    select r.model, r.agent_id, max(r.agent_name) as agent_name,
           count(*) as runs,
           avg(r.ret) as cell_return,
           avg(r.hit_rate) as cell_hit
    from agent_reports r join sessions s on s.id = r.session_id
    where s.counted and r.model is not null
    group by r.model, r.agent_id),
  base as (
    select model, avg(cell_return) as model_return from cell group by model)
  select c.model, c.agent_id, c.agent_name, c.runs,
         round(c.cell_return::numeric,2)                     as avg_return,
         round(c.cell_hit::numeric,1)                        as avg_hit_rate,
         round((c.cell_return - b.model_return)::numeric,2)  as pairing_effect
  from cell c join base b on b.model = c.model
  order by avg_return desc;

-- keep the older view name working, now filtered to counted sessions
create or replace view lb_models as
  select r.model, count(*) as reports, count(distinct r.session_id) as sessions_played,
         round(avg(r.ret)::numeric,2) as avg_return, round(avg(r.skill)::numeric,2) as avg_skill,
         round(max(r.ret)::numeric,2) as best_return,
         round(avg(r.hit_rate)::numeric,2) as avg_hit_rate,
         round(avg(r.avg_edge)::numeric,3) as avg_edge,
         round(sum(r.realized_pnl)::numeric,2) as realized_pnl
  from agent_reports r join sessions s on s.id = r.session_id
  where s.counted and r.model is not null
  group by r.model order by avg_return desc;
