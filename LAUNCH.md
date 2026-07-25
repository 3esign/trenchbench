# Benchhood — clean start to live product

Work top to bottom. Nothing here needs code. Roughly 30 minutes, most of it
waiting for sessions to run.

---

## Part 1 · Wipe and rebuild (about 5 minutes)

**1. Archive the old runs** — double-click **`reset_local.cmd`**.
Moves every old `sessions/*.json` into `sessions_archive\` and clears any stale
flags. Nothing is deleted.

**2. Rebuild the database** — open the
[Supabase SQL editor](https://supabase.com/dashboard/project/ufceqgryldskaglseqjj/sql/new),
paste **all of `supabase/SETUP_FROM_SCRATCH.sql`**, click **RUN**.

This is the only SQL file you need now — it replaces all five of the older ones.
It drops every table, rebuilds them with every column, creates the benchmark and
career views, and locks writes to your service key.

⚠ It deletes every session recorded so far. That is deliberate, and there are
now two reasons for it. The oldest runs were produced against a synthetic price
walk. The recent ones were corrupted by a price fault: CASHCAT was priced
537,177,355× too low because `decimals()` defaulted to 18 on a 6-decimal token,
an agent bought 2.1bn units for 20 cents, and when the price corrected its bag
marked at $109m — which then set the all-time model ranking.

Neither can be the first rows of a benchmark you intend to sell.

*(You do not need `003_void_corrupted_sessions.sql`. That file surgically voids
the bad sessions while keeping the rest; wiping does the same job and more.)*

**3. Add your service key** — double-click **`add_service_key.cmd`**.
It tells you exactly where to find the key, you paste it, and it writes the line
into `config.txt` for you. The key goes clipboard → file and nowhere else.

(By hand if you prefer: Supabase → Project Settings → API → copy the
**`service_role`** key → add `SUPABASE_SERVICE_KEY=...` to `config.txt`.)

Why: the public site ships your anon key in its JavaScript where anyone can read
it. Until now that key could also *write*, meaning a stranger could have injected
fake sessions into your benchmark. Now the world reads, only you write.
`config.txt` is git-ignored — the key never leaves your machine.

**4. Rotate the old keys.** Everything in `config.txt` was pasted into a chat.
Before anything is public, regenerate: the Vercel token, the Alchemy key, and the
Supabase database password. Ten minutes, and it closes the one real hole.

---

## Part 2 · Generate a real dataset (about 20 minutes)

**5. Run 3 to 5 sessions.** Double-click **`start_session.cmd`**, let it run
about 10 minutes, then **`stop_session.cmd`**. Repeat.

Vary the roster so the benchmark isn't one market: `start_session` (mixed),
`start_stocks`, `start_memes`, `start_fresh`.

Check each one **starts** with the price feed vetting itself:

```
[feed] N price(s) confirmed on a second reading
```

That line is the new guard reporting in. A token gets no price until the same
number comes back twice, so nothing an agent trades is a one-off reading from a
thin pool.

Check each one **ends** with:

```
benchmark: COUNTED — N rounds, this run moves the all-time model rankings.
Supabase writes: decisions OK · equity OK · reports OK · outcomes OK
```

**If you see `[risk] SYM delisted mid-session`** — that is working as intended,
not a failure. A token's price moved more than 5× in an hour, which is a data
correction rather than a market move, so it was frozen, any open position was
held at what the agent paid for it, and it was excluded from scoring and from
the market benchmark. The session still counts. The line is there so you can see
it happen instead of finding out from the leaderboard.

**Why three to five and not one:** the model↔persona pairing rotates every
session, so after one run each model has played exactly one strategy and the
board honestly tells you it isn't a ranking yet. By session three the career
ledger has a shape, and by seven every model has played every strategy — a
complete Latin square. Three is presentable. Seven is defensible.

**If a session ends `NOT COUNTED`,** it ran under 10 rounds. It's saved and
viewable, it just can't move the rankings.

---

## Part 3 · Publish (about 5 minutes)

**6. `update_website.cmd`** — pushes the Arena to benchhood.vercel.app.

**7. `push_to_github.cmd`** — backs the code up to your private repo.

**8. Look at the site as a stranger would.** Open it in a private window.
Check: does the market strip have colour? Do the boards have numbers rather than
dashes? Does hovering a term explain it? Is a Hit column populated?

---

## What you can claim when this is done

- **Real prices, and vetted ones.** Every price is read from `sqrtPriceX96` in
  Uniswap v4 `Swap` logs and anchored to stables and Chainlink feeds. No
  synthetic movement anywhere. A token with unconfirmed decimals is left
  unpriced rather than guessed at, a price must reproduce on a second reading
  before an agent may trade it, and anything that moves more than 5× inside a
  session is delisted and held at cost.
- **Every decision labelled.** What each agent did *and whether it worked* —
  forward return signed by direction, the market over the same window, the edge
  between them, and FIFO realised P&L on closed round-trips.
- **A benchmark that survives scrutiny.** Rotating model↔persona pairing so
  model skill is separable from strategy, equal starting capital, short sessions
  excluded, and fallback calls never credited to a model.
- **A public read-only Arena** over a database only you can write to.

## What not to claim yet

- That any model is better than any other. Until each has several counted
  sessions, the differences are noise, and the site says so on your behalf.
- Anything resembling advice. It's a benchmark and a dataset. That framing is
  also what keeps you clear of investment-adviser regulation.

---

## If something goes wrong

| Symptom | Fix |
|---|---|
| `STOPPED BEFORE STARTING` | The SQL didn't fully run. Paste `SETUP_FROM_SCRATCH.sql` again. |
| `Supabase writes: … FAILED` | Missing or wrong `SUPABASE_SERVICE_KEY` in `config.txt`. |
| `ALREADY RUNNING` | A session is still live. `stop_session.cmd`, or `emergency_stop.cmd` to kill everything. |
| Not sure what's running | **`emergency_stop.cmd`** — stops everything, no further model calls can be billed. |
| Site shows old data | Hard refresh (Ctrl+F5); the page caches for a few seconds. |
| `no price moved all session` | The chain was quiet. Real, not a bug — but the labels will mostly read "flat". |
| `[risk] SYM delisted mid-session` | Working as intended. A bad price was caught and quarantined. Session still counts. |
| An agent finishes at a silly number | Can't happen silently any more — the session prints `!! NOT COUNTED` and stays out of the ledger. |
| Far fewer tokens priced than before | Expected. Tokens with unconfirmed decimals are now withheld instead of mispriced. |
