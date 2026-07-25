-- ============================================================
--  BENCHHOOD — 003: void the sessions a price fault corrupted
--
--  WHY THIS EXISTS
--  CASHCAT was priced at 9.4e-11 instead of 0.0505 — a factor of 537 million,
--  caused by decimals() defaulting to 18 on a 6-decimal token, so the WETH hop
--  came out 10^12 too small. An agent bought 2,162,894,945 units for about 20
--  cents on tick 1. On tick 12 the price resolved correctly and it sold for
--  $109,038,557. That one bag then set the all-time model ranking.
--
--  The runner now blocks this in four places (unconfirmed decimals are never
--  priced; a price must reproduce on a second reading; a >5x intra-session move
--  delists the token; and an implausible final return refuses to count). This
--  file cleans up what the old build already wrote.
--
--  NOTHING IS DELETED. Sessions stay browsable; they just stop voting on which
--  model is best. That is the honest treatment: the session happened, the
--  result is not evidence.
--
--  RUN THE SECTIONS IN ORDER. Read section 1 before running section 2.
-- ============================================================


-- ---------- 1. LOOK FIRST ----------------------------------------------
-- What is about to be voided, and why. Expect the c3822a2f session and any
-- other run where an agent finished past +5,000% or below -99%.

select s.id,
       s.started_at,
       s.rounds,
       s.counted,
       round(max(abs(r.ret))::numeric, 1) as wildest_agent_return_pct,
       max(r.end_value)                   as biggest_end_value,
       count(*)                           as agents
from sessions s
join agent_reports r on r.session_id = s.id
group by s.id, s.started_at, s.rounds, s.counted
having max(abs(r.ret)) > 5000
order by s.started_at desc;


-- ---------- 2. VOID THEM -----------------------------------------------
-- Any session where an agent's return is beyond what a real market delivers in
-- an hour is a data fault. Marked not-counted, kept intact.

update sessions s
set counted = false
where exists (
  select 1 from agent_reports r
  where r.session_id = s.id
    and abs(r.ret) > 5000
);


-- ---------- 3. VOID THE OUTCOME ROWS THEY POISONED ----------------------
-- Edge of +48,515 and average regret of 18,369pp came from these rows. Any
-- per-model average that touches them is wrong even if the session is no
-- longer counted, because some views read outcomes directly.

update decision_outcomes o
set outcome = 'void'
where o.session_id in (select id from sessions where counted = false)
  and (abs(coalesce(o.edge, 0))    > 5000
    or abs(coalesce(o.regret, 0))  > 5000
    or abs(coalesce(o.fwd_ret, 0)) > 5000);


-- ---------- 4. CHECK IT TOOK -------------------------------------------
-- The career ledger, rebuilt. gemma4:31b-cloud should be back to a human
-- number; anything still in the millions means a session slipped through.

select model,
       count(distinct session_id) as counted_sessions,
       round(avg(ret)::numeric, 2) as avg_return_pct,
       round(max(end_value)::numeric, 0) as best_end_value
from agent_reports r
where r.session_id in (select id from sessions where counted = true)
group by model
order by avg_return_pct desc;

-- And confirm nothing absurd survives anywhere in the counted set:
select count(*) as should_be_zero
from agent_reports r
join sessions s on s.id = r.session_id
where s.counted = true and abs(r.ret) > 5000;
