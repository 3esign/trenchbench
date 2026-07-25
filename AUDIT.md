# Benchhood — product audit

Five lenses: systems auditor, computer scientist (experimental design), fintech
domain expert, product designer, engineering manager. Findings deduplicated,
ranked by impact per hour of work.

The headline: **the machine is now sound. The measurement is not yet.** Nothing
below is a crash. Everything below is a number that is wrong, unverifiable, or
means less than the page implies.

---

## Part 0 — fixed tonight, before this report

| | Evidence |
|---|---|
| **302 decisions (10.8%) were trades the model declined to make.** The prompt said "reply 0 to do nothing", the menu was shuffled, and `parseChoice` mapped every HOLD word to index 0. 66 of 73 "hold"/"do nothing" replies executed a trade. | measured across 4 sessions |
| **Silent write loss.** The flush cursor advanced *before* the insert, so one 503 permanently dropped those rounds and the summary still said OK. | `run_session.mjs:941` |
| **The Latin square wasn't one.** With 8 personas and 7 models, personas 0 and 7 collapsed onto the same model in *every* session — Value Val and Random Randy always shared a brain, and that model compounded twice per session in the ledger. | verified over all 7 rotations |
| CASHCAT: decimals defaulted to 18 on a 6-decimal token → price 537,177,355× too low → $109M mark | four guard layers now |
| Career ledger compounded per agent-row, not per session ($172,800 for one +20% session) | site fixed; SQL fix written |
| Standing table and equity chart read different tables and disagreed in public | one source now |
| 90% of decisions scored "flat" because half the roster never traded | menu now activity-filtered |

---

## Part 1 — the three things that would actually invalidate the benchmark

These are not cosmetic. Each one, unfixed, means a critic can dismiss the whole
result in one sentence.

### 1.1 There is no null model. Nothing on the board has anything to beat.

Flagged independently by both the experimental-design and fintech reviews.

"Random Randy" is described in the code as *"the control in this experiment"* —
but it is a **language model instructed to be random**, with its own risk
parameter, its own take-profit and stop-loss settings, and an exemption from the
fallback exit logic. It is a treatment arm wearing a control's name. There is no
chance-level baseline anywhere in the dataset, which means **no hit rate, edge,
or regret figure on the site can currently be interpreted at all.** 9% hit rate
against *what*?

**Fix — and this is the single highest-leverage hour available:** add three
mechanical agents to every session, none of which call a model.

- uniform-random pick from the menu (the chance line for every choice metric)
- hold cash (the do-nothing line)
- equal-weight the roster (the buy-and-hold line)

They cost nothing to run, they need no model calls, and they immediately convert
every number on the board from decoration into a comparison. **CHEAP.**

### 1.2 The harness is doing work the models are being credited for

The article's own charge against Alpha Arena is that its prompt "hardcodes the
trading strategy." Three places do the same thing here:

- **`ret` — the number the leaderboard and career ledger rank on — includes
  rule-fallback decisions.** `hit_rate` and `edge` correctly filter
  `brain === 'model'`; `ret` does not. And `ruleFallback` isn't neutral: it runs
  take-profit, stop-loss and position-limit exits that models are never offered.
  A model that times out often gets a disciplined mechanical strategy
  substituted in and credited to its name.
- **The harness resizes positions on recent performance.** Every fifth think,
  `ag.risk` is multiplied by 1.1 or 0.9 depending on whether equity is rising
  (`run_session.mjs:955`). Alpha Arena's own lesson was that Qwen won by being
  right on the *larger* positions — this hot-hand rule reproduces that artefact
  by construction.
- **The agent's "note to itself"** is written by the harness and fed back into
  the prompt as if the model had written it.

**Fix:** compute a model-only return series (replay equity counting only
`brain === 'model'` rounds), freeze `risk` per persona, and label harness-written
notes as harness-written. **CHEAP.**

### 1.3 The flagship metrics cannot be verified by anyone, including you

`priceLog` (per-round prices) and `menus` (the choice set each agent saw) exist
only in process memory. Neither is written to Supabase or to the local session
JSON. `decision_outcomes` stores the *results* — `edge`, `regret`, `was_best` —
with no record of the inputs they were computed from.

So a reader who wants to check one number pulls 4,000 rows of pre-computed edges
and can verify none of them. The article says *"You do not have to believe my
numbers. You can regenerate them."* As shipped, they cannot regenerate any.

Compounding it: the site's GitHub button points at a repo that `push_to_github.cmd`
actively forces **private**.

**Fix:** persist `priceLog` as a `price_snapshots` table and the full menu JSON
on each `decisions` row; publish per-session raw JSON. The local-JSON half is
**CHEAP**; the schema + backfill is **EXPENSIVE**. Decide the repo question
before the article ships, or delete the claim.

---

## Part 2 — cheap fixes, ranked by impact per hour

Everything here is under an hour. Roughly in the order I'd do them.

**1. Mechanical baselines** (§1.1). Nothing else changes what the numbers mean
this much for this little.

**2. Chainlink is read once per session, so every stock token is inert.**
`refreshAnchors()` is called only inside `seed()`. Tokenized equities and
stablecoins are pinned to their opening value for the entire run, never get a
`lastSwapAt`, get dropped from the active menu, and are excluded from the market
baseline. **Benchhood is currently a memecoin benchmark described as a
tokenized-equities benchmark.** Re-read Chainlink each poll.

**3. Cash is scored as if it earned the market return.** HOLD scores `0` and SELL
scores `mkt − tokenRet`, both encoding "not being in this token earns the
market" — but proceeds sit in cash earning 0%. Every non-token action carries a
bias of exactly `+mkt_ret`, whose sign flips with the market, so the ranking
between models shifts with whether the session happened to be up or down.

**4. The fill price isn't the scored price, and slow models fill later.**
Outcomes read a round-open snapshot; `execute` fills at live `M[sym].price`,
which the poller mutates while agents are still awaiting their models. Response
latency is a stable per-model property, so this injects a model-correlated
execution advantage unrelated to judgement. Freeze fills to the round-open snapshot.

**5. Memory leaks between models.** Session-end lessons are retrieved by persona,
not by model — so a model's prompt is seeded with text written by *different*
models that previously played that persona. Under rotation this is guaranteed.
Key `agent_memory` on `(agent_id, model)`.

**6. Regret is confounded with menu size.** Regret is the max of N option edges,
and the max of N draws grows with N. Menu length varies 4–15 and depends on the
agent's cash and positions — so **winning agents mechanically accrue more
regret**. Normalise by menu size (already stored as `decisions.menu_size`) and
publish the chance baseline `mean(1/menu_size)` next to every best-pick rate.

**7. The page says 10 rounds; the code says 30.** Every public surface states the
old threshold, and the site classifies any uncounted session that ran ≥10 rounds
as **"excluded for an untrustworthy price"** — a public accusation of data
corruption against sessions that merely ran short.

**8. The market strip divides an explorer price by a pool price.** During a live
session the tile uses Blockscout's `exchange_rate` — the stale cache the article
says it abandoned — over an open price from swap logs or Chainlink. The
percentage published corresponds to no event.

**9. `SETUP_FROM_SCRATCH.sql` still installs the buggy career views**, and
`LAUNCH.md` says it's the only file needed. The runner's console ledger has the
same bug. Three implementations, two of them wrong, and the SQL one is what an
outsider querying the public API will hit.

**10. Rotate the credentials.** The Supabase DB password, Vercel token and
Alchemy key were pasted into chat and are still live. The project ref is
published on the site, so the password alone permits `update agent_reports set
ret = …` with no audit trail. Also broaden the push guard beyond literal
`config.txt` (a `config.txt.bak` sails through) and add `sessions_archive/` to
`.gitignore`.

---

## Part 3 — the site, as a product

A stranger arrives from a link on X. Here's what the design review found.

**It never states its own question.** The only positioning copy is an 11px
muted line: *"AI agents trading on Robinhood Chain."* Everything interesting —
that it's a benchmark, that the models are open-weight, that the rankings are
deliberately provisional — is locked in a modal most visitors won't open.
**Add a hero: "Which open-weight model actually trades best?"** with the sample
size beneath it. The `.hero` class already exists.

**The most prominent element is the least important one.** A 112px monospace
console showing `"still watching · last activity 43s ago"` sits above the race
chart and the standing table. Meanwhile the most credibility-bearing fact on the
page — `built from N counted sessions` — renders at 10.5px in the muted grey.
**Sample size is the argument. Set it at 28px, not 10.5.**

**Developer TODOs are shipped to the public.** Three strings tell the visitor to
run SQL migrations: *"run supabase/SETUP_FROM_SCRATCH.sql so short runs stop
counting"*, *"run supabase/002 to rank by profit instead"*, *"Run one from your
machine and it appears here."* On a page selling methodological rigour, this
reads as an unfinished localhost demo.

**The link preview on X will be blank.** `<head>` has three tags. No `og:title`,
no `og:image`, no description, no favicon — for a product whose entire
distribution channel is a link on X. **Cheapest high-impact fix on the list.**

**Every definition is mouse-only,** and the copy literally says *"hover a name."*
Most X traffic is mobile. And below ~820px the header overflows, the chart
renders text at ~6px, and the decision tape clips the model's stated reasoning —
the single most shareable content on the page.

---

## Part 4 — preparing for Pons

The value of this audit is that Launchbench can start with these lessons
already applied. Six things to build in from day one:

1. **Baselines before models.** Random, highest-WETH, most-buyers,
   lowest-concentration, logistic regression — running *before* any LLM is
   asked anything. Benchhood's deepest problem is that it has no null model;
   don't repeat it.
2. **Persist the inputs, not just the outputs.** Snapshot the exact feature
   vector at the gate-crossing block and store it on the row. Every metric must
   be recomputable by a stranger from published data.
3. **Everything ex-ante.** Features computed at the gate block, never after.
   Benchhood is still retrofitting this.
4. **One aggregation, server-side.** Benchhood has the same numbers computed
   three ways — SQL views, browser JS, runner console — and they disagree. Pick
   one, put it in SQL, have every surface read it.
5. **Record the provenance.** Git SHA, model digests, the full scoring config,
   on every row. Benchhood cannot currently prove which code produced which
   session, or that a re-quantised model wasn't silently averaged with its
   predecessor.
6. **Right-censoring is not a negative.** A candidate that hasn't resolved is
   unresolved. Counting it as a failure understates every model.

And the one product lesson: **decide the headline question before building the
page.** Benchhood's site is six panels of roughly equal weight with no single
takeaway, because the question was never written down in a font larger than 11px.

---

## The manager's read

Nothing here blocks running sessions — keep going, the data is now clean.

What blocks *publishing* is Part 1. Specifically §1.1: without a chance
baseline, every number on the leaderboard is uninterpretable, and that is the
first thing a serious reader will ask about. It is also the cheapest item on
this list.

If you only do three things: **mechanical baselines, model-only returns, and the
OG tags.** The first two make the benchmark defensible; the third makes anyone
see it.
