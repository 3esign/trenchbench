-- ============================================================
--  trenchbench — 004: the career views had the $172,800 bug too
--
--  career_models compounded one gain factor per agent_reports ROW:
--
--      100000 * exp(sum(ln(1 + ret/100)))
--
--  When there are fewer models than personas — the normal case, 7 models
--  driving 8 agents — a model runs two or three personas in the SAME session
--  and gets two or three rows for it. Three personas at +20% in one session
--  compounded to $172,800 next to a "sessions: 1" count, a return no single
--  session could have produced.
--
--  Fixed the same way the site was: average the returns WITHIN a session
--  first, then compound the per-session averages across sessions.
--
--  Also floors the per-session factor at 0.01 so a -100% wipeout cannot pin a
--  career balance at exactly $0 forever, where every later session multiplies
--  zero and the model can never recover.
--
--  Safe to run on a live database. Only replaces two views; touches no data.
-- ============================================================

drop view if exists career_models;
create view career_models as
  with per_session as (
    select r.model, r.session_id, avg(r.ret) as ret, avg(r.hit_rate) as hit_rate
    from agent_reports r
    join sessions s on s.id = r.session_id
    where s.counted and r.model is not null and r.ret is not null
    group by r.model, r.session_id
  )
  select model,
         count(*) as sessions,
         round((100000 * exp(sum(ln(greatest(1 + ret/100.0, 0.01)))))::numeric, 2) as balance,
         round(avg(ret)::numeric, 2)      as avg_return,
         round(avg(hit_rate)::numeric, 1) as avg_hit_rate
  from per_session
  group by model
  order by balance desc;

drop view if exists career_agents;
create view career_agents as
  with per_session as (
    select r.agent_id, max(r.agent_name) as agent_name, r.session_id,
           avg(r.ret) as ret, avg(r.hit_rate) as hit_rate,
           count(distinct r.model) as models
    from agent_reports r
    join sessions s on s.id = r.session_id
    where s.counted and r.ret is not null
    group by r.agent_id, r.session_id
  )
  select agent_id,
         max(agent_name) as agent_name,
         count(*)        as sessions,
         sum(models)     as models_played,
         round((100000 * exp(sum(ln(greatest(1 + ret/100.0, 0.01)))))::numeric, 2) as balance,
         round(avg(ret)::numeric, 2)      as avg_return,
         round(avg(hit_rate)::numeric, 1) as avg_hit_rate
  from per_session
  group by agent_id
  order by balance desc;

-- ---------- what the site was missing entirely ----------
-- regret, edge and best-pick rate are computed for every decision and stored,
-- and none of them were ever displayed. This is the shape the page needs:
-- one row per model, counting ONLY the calls the model itself made.
drop view if exists lb_model_quality;
create view lb_model_quality as
  select o.model,
         count(*) filter (where o.brain = 'model' and o.edge is not null)      as scored_calls,
         count(*) filter (where o.brain <> 'model')                            as fallback_calls,
         round((avg(o.edge)   filter (where o.brain = 'model'))::numeric, 3)   as avg_edge,
         round((avg(o.regret) filter (where o.brain = 'model'))::numeric, 3)   as avg_regret,
         round((count(*) filter (where o.brain = 'model' and o.was_best))::numeric
               / nullif(count(*) filter (where o.brain = 'model' and o.regret is not null), 0) * 100, 1) as best_pick_rate,
         round((count(*) filter (where o.brain = 'model' and o.outcome = 'good'))::numeric
               / nullif(count(*) filter (where o.brain = 'model' and o.outcome in ('good','bad','flat')), 0) * 100, 1) as hit_rate
  from decision_outcomes o
  join sessions s on s.id = o.session_id
  where s.counted and o.model is not null and coalesce(o.outcome,'') <> 'void'
  group by o.model
  order by avg_edge desc nulls last;

grant select on career_models, career_agents, lb_model_quality to anon;
