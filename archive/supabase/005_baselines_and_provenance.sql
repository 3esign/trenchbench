-- ============================================================
--  trenchbench — 005: baselines, model share, and the fixed career ledger
--
--  Run this ONCE on an existing database. It is additive and safe: it adds
--  columns, replaces views, and touches no rows.
--
--  WHAT IT SUPPORTS
--
--  1. NULL MODELS. Three mechanical agents now ride along in every session on
--     the same capital, the same menu and the same prices, calling no model:
--        baseline:dice    picks uniformly at random   (the chance line)
--        baseline:vault   never trades                (the do-nothing line)
--        baseline:basket  equal-weight, then holds    (the buy-and-hold line)
--     Until these existed there was nothing on the board to compare against,
--     so a 9% hit rate meant nothing: 9% versus what?
--
--  2. MODEL SHARE. `ret` — the number every ranking is built on — used to
--     include rule-fallback decisions, and the fallback is not neutral: it runs
--     take-profit and stop-loss exits the models are never offered. A model
--     that timed out often got a disciplined mechanical strategy credited to
--     its name. model_share records what fraction of an agent's decisions the
--     model actually made, so the ledger can require a threshold.
--
--  3. THE CAREER LEDGER FIX from 004, folded in here so there is one file to
--     run. Safe to run even if 004 already went in.
-- ============================================================

-- ---------- 1. new columns ----------
alter table agent_reports add column if not exists model_share numeric;   -- % of this agent's calls the model made
alter table agent_reports add column if not exists is_baseline boolean default false;

-- retrieving a persona's past lessons must not hand one model another model's
-- self-narration; the runner now filters on (agent_id, model)
create index if not exists ix_mem_agent_model on agent_memory(agent_id, model, created_at desc);


-- ---------- 2. the career ledger, per session and excluding baselines ----------
drop view if exists career_models;
create view career_models as
  with per_session as (
    select r.model, r.session_id, avg(r.ret) as ret, avg(r.hit_rate) as hit_rate
    from agent_reports r join sessions s on s.id = r.session_id
    where s.counted and r.model is not null and r.ret is not null
      and coalesce(r.is_baseline, false) = false
      and r.model not like 'baseline:%'
    group by r.model, r.session_id
  )
  select model, count(*) as sessions,
         round((100000 * exp(sum(ln(greatest(1 + ret/100.0, 0.01)))))::numeric, 2) as balance,
         round(avg(ret)::numeric, 2) as avg_return,
         round(avg(hit_rate)::numeric, 1) as avg_hit_rate
  from per_session group by model order by balance desc;

drop view if exists career_agents;
create view career_agents as
  with per_session as (
    select r.agent_id, max(r.agent_name) as agent_name, r.session_id,
           avg(r.ret) as ret, avg(r.hit_rate) as hit_rate, count(distinct r.model) as models
    from agent_reports r join sessions s on s.id = r.session_id
    where s.counted and r.ret is not null
    group by r.agent_id, r.session_id
  )
  select agent_id, max(agent_name) as agent_name, count(*) as sessions, sum(models) as models_played,
         round((100000 * exp(sum(ln(greatest(1 + ret/100.0, 0.01)))))::numeric, 2) as balance,
         round(avg(ret)::numeric, 2) as avg_return,
         round(avg(hit_rate)::numeric, 1) as avg_hit_rate
  from per_session group by agent_id order by balance desc;


-- ---------- 3. THE BASELINE BOARD ----------
-- Every model number should be read against this. If a model cannot beat
-- baseline:dice, it has not demonstrated anything, and this view is how that
-- becomes visible instead of arguable.
drop view if exists lb_baselines;
create view lb_baselines as
  select r.model as baseline,
         count(distinct r.session_id) as sessions,
         round(avg(r.ret)::numeric, 2)       as avg_return,
         round(avg(r.hit_rate)::numeric, 1)  as avg_hit_rate,
         round(avg(r.avg_edge)::numeric, 3)  as avg_edge,
         round(sum(r.realized_pnl)::numeric, 2) as realized_pnl
  from agent_reports r join sessions s on s.id = r.session_id
  where s.counted and (coalesce(r.is_baseline, false) or r.model like 'baseline:%')
  group by r.model order by avg_return desc;


-- ---------- 4. model quality: regret, edge, best-pick — none of it was shown ----------
drop view if exists lb_model_quality;
create view lb_model_quality as
  select o.model,
         count(*) filter (where o.brain = 'model' and o.edge is not null)    as scored_calls,
         count(*) filter (where o.brain <> 'model')                          as other_calls,
         round((avg(o.edge)   filter (where o.brain = 'model'))::numeric, 3) as avg_edge,
         round((avg(o.regret) filter (where o.brain = 'model'))::numeric, 3) as avg_regret,
         round((count(*) filter (where o.brain = 'model' and o.was_best))::numeric
               / nullif(count(*) filter (where o.brain = 'model' and o.regret is not null), 0) * 100, 1) as best_pick_rate,
         round((count(*) filter (where o.brain = 'model' and o.outcome = 'good'))::numeric
               / nullif(count(*) filter (where o.brain = 'model' and o.outcome in ('good','bad','flat')), 0) * 100, 1) as hit_rate
  from decision_outcomes o join sessions s on s.id = o.session_id
  where s.counted and o.model is not null and coalesce(o.outcome,'') <> 'void'
  group by o.model order by avg_edge desc nulls last;


-- ---------- 5. token board: counted sessions only, void rows excluded ----------
drop view if exists lb_token_pnl;
create view lb_token_pnl as
  select o.sym, count(*) as calls,
         count(*) filter (where o.outcome='good') as good_calls,
         round((count(*) filter (where o.outcome='good'))::numeric
               / nullif(count(*) filter (where o.outcome in ('good','bad','flat')),0) * 100, 1) as hit_rate,
         round(avg(o.edge)::numeric,3) as avg_edge,
         round(sum(coalesce(o.realized_pnl,0))::numeric,2) as realized_pnl
  from decision_outcomes o join sessions s on s.id = o.session_id
  where s.counted and o.sym is not null and o.sym <> '' and coalesce(o.outcome,'') <> 'void'
  group by o.sym order by realized_pnl desc nulls last;


grant select on career_models, career_agents, lb_baselines, lb_model_quality, lb_token_pnl to anon;

-- ---------- check ----------
-- after your next session, this should list three rows:
--   select * from lb_baselines;
