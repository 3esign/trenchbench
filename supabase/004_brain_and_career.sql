-- ============================================================
--  trenchbench — migration 004: honest attribution + the career ledger
--
--  WHY THIS MATTERS
--   1. When a cloud model times out, the rule brain answers for it that round.
--      Those decisions were being stored under the model's name — so the
--      benchmark was crediting models for calls they never made. Every
--      decision now records which brain produced it, and hit rate is scored
--      only on calls the model itself made.
--   2. The career ledger: sessions keep trading from equal capital so returns
--      stay comparable, and a notional $100k is compounded across every
--      counted session. You get the long arc without ever handing one agent
--      more buying power than another.
--
--  HOW TO APPLY
--    1. open  https://supabase.com/dashboard/project/ufceqgryldskaglseqjj/sql/new
--    2. paste this whole file
--    3. click  RUN
--  Safe to run more than once. Run 002 and 003 first if you have not.
-- ============================================================

-- ---------- 1. which brain actually made the call ----------
alter table decisions          add column if not exists brain text;  -- model | timeout | error | rules
alter table decision_outcomes  add column if not exists brain text;
alter table agent_reports      add column if not exists model_calls    int;
alter table agent_reports      add column if not exists fallback_calls int;

-- Everything recorded before this migration came from a straight model call
-- or the rule brain in a no-Ollama session; treat unlabelled rows as 'model'
-- so history stays usable rather than silently dropping out of the averages.
update decisions         set brain = 'model' where brain is null;
update decision_outcomes set brain = 'model' where brain is null;

create index if not exists ix_dec_brain on decisions(brain);
create index if not exists ix_do_brain  on decision_outcomes(brain);

-- ---------- 2. the career ledger ----------
-- Compounding a series in SQL: exp(sum(ln(1+r))). greatest(...) guards a
-- -100% session, which would otherwise be ln(0).
create or replace view career_models as
  select r.model,
         count(distinct r.session_id) as sessions,
         round((100000 * exp(sum(ln(greatest(1 + r.ret/100.0, 0.0001)))))::numeric, 2) as balance,
         round(avg(r.ret)::numeric, 2)      as avg_return,
         round(avg(r.hit_rate)::numeric, 1) as avg_hit_rate
  from agent_reports r join sessions s on s.id = r.session_id
  where s.counted and r.model is not null
  group by r.model order by balance desc;

create or replace view career_agents as
  select r.agent_id, max(r.agent_name) as agent_name,
         count(distinct r.session_id) as sessions,
         count(distinct r.model)      as models_played,
         round((100000 * exp(sum(ln(greatest(1 + r.ret/100.0, 0.0001)))))::numeric, 2) as balance,
         round(avg(r.ret)::numeric, 2)      as avg_return,
         round(avg(r.hit_rate)::numeric, 1) as avg_hit_rate
  from agent_reports r join sessions s on s.id = r.session_id
  where s.counted
  group by r.agent_id order by balance desc;

-- ---------- 3. model quality, counting only what the model really did ----------
create or replace view lb_models_true as
  select o.model,
         count(*) filter (where o.brain = 'model' and o.edge is not null) as model_trades,
         count(*) filter (where o.brain <> 'model')                       as fallback_calls,
         round((count(*) filter (where o.brain = 'model' and o.outcome = 'good'))::numeric
               / nullif(count(*) filter (where o.brain = 'model' and o.edge is not null), 0) * 100, 1) as hit_rate,
         round(avg(o.edge) filter (where o.brain = 'model')::numeric, 3)  as avg_edge,
         round(sum(coalesce(o.realized_pnl, 0))::numeric, 2)              as realized_pnl
  from decision_outcomes o join sessions s on s.id = o.session_id
  where s.counted and o.model is not null
  group by o.model order by avg_edge desc nulls last;
