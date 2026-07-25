# Benchhood — what to run, in order

Everything from tonight's audit is applied. This is the sequence.

---

## Once — before the next session

**1. `emergency_stop.cmd`**
Stops anything still running under the old code.

**2. Supabase SQL editor → paste all of `supabase/005_baselines_and_provenance.sql` → Run.**
Additive and safe on a live database: adds two columns, replaces five views,
touches no rows. This is what makes the baselines and the fixed career ledger
work. *(If you would rather wipe and start clean instead, run
`SETUP_FROM_SCRATCH.sql` — it now contains all of this already, and you can skip
005.)*

**3. `check_rpc.cmd`**
Should show 2 endpoints, Alchemy first. Alchemy is the only one with
`eth_newFilter`; the public node is the fallback for everything else.

**4. Rotate your keys.** Still outstanding, still the one real hole: the Supabase
DB password, the Vercel token and the Alchemy key were all pasted into chat, and
the Supabase project ref is published on the site. The password alone permits
`update agent_reports set ret = …` with no audit trail.

---

## Every session

**`start_session.cmd`** → let it run → **`stop_session.cmd`**

Aim for **100–150 rounds** (~50–75 min) and do **seven** of them. Seven completes
one full model↔persona rotation; that is when the leaderboard starts meaning
something. Longer sessions do not help — the scarce resource is sessions, not
rounds.

Vary the market: `start_session` (mixed) · `start_stocks` · `start_memes` ·
`start_fresh`.

### What to watch for in the log

```
[feed]  N price(s) confirmed on a second reading     <- the price gate
[menu]  14/29 token(s) traded in the last 20 min     <- the activity filter
[risk]  SYM delisted mid-session                     <- quarantine firing (good)
[pools] N swaps · N price(s) moved
```

At the end:

```
benchmark: COUNTED — N rounds
rpc: N request(s) across 2 endpoint(s)               <- where your quota went
quarantined: ...                                     <- only if it fired
```

**If `[menu]` says "too few, offering the full roster"** the chain is too quiet
for the filter to help. That is a weekend problem more than a code problem.

---

## Publishing

**`update_website.cmd`** — pushes the Arena.
**`push_to_github.cmd`** — the secret guard now matches the *shape* of a secret
(`config*.txt`, `*.bak`, anything with secret/credential/token/password in the
name, and `sessions_archive/`) rather than one exact filename.

---

## Diagnostics, when something looks wrong

| Script | Answers |
|---|---|
| `check_rpc.cmd` | which endpoints are alive and which support filters |
| `check_prices.cmd` | are Chainlink feeds fresh, what are they saying |
| `check_pools.cmd` | can we read swap logs, are pairs resolving |
| `chain_clock.cmd` | real block time, and how big a Pons backfill would be |
| `check_pons.cmd` | Pons factory: is it live, V3 or V4, a real launch inspected |
| `check_pons_rate.cmd [hours]` | Pons graduation rate — the number that decides Launchbench |
| `diagnose.cmd` | end-to-end: config, database, models, chain |

---

## What changed tonight, and why it matters

**The measurement, not the machine.** Nothing below was a crash — every one was
a number that was wrong, unverifiable, or meant less than the page implied.

### Corrections to the data itself

- **302 decisions (10.8%) were trades the model declined to make.** The prompt
  said "reply 0 to do nothing", the menu was shuffled, and every HOLD word
  mapped to index 0. 66 of 73 "hold"/"do nothing" replies executed a trade.
- **The Latin square was not one.** Personas 0 and 7 collapsed onto the same
  model in *every* session, so Value Val and Random Randy always shared a brain
  and that model compounded twice in the ledger.
- **Silent write loss** — the flush cursor advanced before the insert, so one
  503 dropped those rounds permanently and the summary still said OK.
- **Chainlink was read once per session**, pinning every tokenized equity to its
  opening value. Benchhood was a memecoin benchmark describing itself as an
  equities one.

### Things that made the numbers meaningless

- **There was no null model.** "Random Randy" is an LLM *told* to be random — a
  treatment arm wearing a control's name. Three mechanical agents now ride along
  in every session calling no model at all: `dice` (random pick), `vault` (never
  trades), `basket` (equal weight, then holds). **A 9% hit rate now has
  something to be 9% against.**
- **The harness was trading.** `ret` counted rule-fallback decisions, and the
  fallback runs stops and take-profits the models are never offered. Position
  size was multiplied by 1.1/0.9 on recent performance — the exact artefact
  Alpha Arena was criticised for. Risk is now frozen; `model_share` records what
  fraction of an agent's calls the model actually made.
- **Cash was scored as if it earned the market return.** HOLD scored 0, putting
  a bias of exactly +mkt_ret on every non-token action — a bias whose sign flips
  with the market, so the ranking between models shifted with whether the
  session was up or down.
- **Fills used a price the poller moved mid-round**, so a slow model filled at a
  later price than a fast one. One price per round now, frozen at the open, used
  for fills, marks and scoring alike.
- **Memory leaked between models** — lessons were retrieved by persona, so under
  rotation every model was fed another model's self-narration. Now keyed on
  `(persona, model)`.
- **The inputs were never saved.** `edge` and `regret` were published with no
  record of the prices or menus they came from, so nobody could recompute one —
  including us. Session files now carry `price_log`, `menus` and `provenance`
  (full config + the exact pairing used).

### The page

- It now states its own question, with the sample size in large type, because
  sample size is the argument.
- OG tags and a favicon — it previewed as a blank grey card on X.
- Baselines render as reference rows, visually distinct, never ranked as models.
- Developer TODO strings ("run supabase/002…") are gone from public view.
- The 10-vs-30 round threshold is stated once, correctly. It used to label any
  short session as *"excluded for an untrustworthy price"* — a public accusation
  of corruption against sessions that merely ran short.

---

## Still open

1. **Reproducibility is now local only.** Session JSONs carry the inputs; the
   database does not. A `price_snapshots` table is the remaining piece — and the
   site's GitHub link points at a repo `push_to_github.cmd` forces private.
   Decide that before the article ships.
2. **Regret is confounded with menu size** — the max of N draws grows with N,
   and menu length varies with the agent's cash. Normalise by `menu_size`.
3. **The market baseline is still ex-post** ("tokens that moved"). The activity
   filter is the mechanism to replace it with an ex-ante one.
4. **No confidence intervals.** Eight agents share one price path and rounds
   overlap, so effective N is far below the row count. Every number wants a
   session-clustered interval before it is a ranking.
