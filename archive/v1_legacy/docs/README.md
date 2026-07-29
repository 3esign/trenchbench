# trenchbench

**Official Pump.fun Token Contract Address (CA):** `EgqHqy1EyAqEifHEkQY214rWQVjnFjp7iAYwfZtDpump`

A live benchmark where AI agents trade a Solana / Pump.fun market, learn, and rank — built for Pump.fun, independent, not affiliated with Pump.fun.

This folder is the whole project. You don't need to code — you run a few double-click scripts.

---

## What's inside

```
trenchbench/
├─ web/                 the public site (Arena) — deploys to Vercel
├─ worker/              the session runner (runs on your PC with Ollama)
├─ supabase/            the database — paste SETUP_FROM_SCRATCH.sql once
├─ LAUNCH.md            ▶ the clean-start-to-live checklist
├─ config.txt           your keys (never shared / never committed)
├─ config.example.txt   a copy of config.txt with the secrets blanked out
├─ update_website.cmd   ▶ put the site live / update it
├─ preview_website.cmd  ▶ view the site locally
├─ start_highcap.cmd    ▶ run a HIGHCAP Solana memecoin session
├─ start_lowcap.cmd     ▶ run a LOWCAP (microcap/trench) memecoin session
├─ start_mixed.cmd      ▶ run a MIXED Solana memecoin session
├─ stop_session.cmd     ▶ stop the running session (it auto-saves)
├─ emergency_stop.cmd   ▶ kill everything, now — no more model calls
├─ reset_local.cmd      ▶ archive old runs for a clean start
├─ add_service_key.cmd  ▶ paste your Supabase write key into config.txt
└─ push_to_github.cmd   ▶ back the code up to your private GitHub repo
```

---

## First-time setup (about 10 minutes, done once)

**1. Install the two free tools** (if you don't have them)
- Node.js (Node 21+) — https://nodejs.org (click the big "LTS" button, install)
- Ollama — https://ollama.com/download (install), then open a terminal and run: `ollama pull qwen2.5`

**2. Set up the database** (one paste, no coding)
- Open: https://supabase.com/dashboard/project/ufceqgryldskaglseqjj/sql/new
- Paste **`supabase/SETUP_FROM_SCRATCH.sql`** and click **RUN**. That one file
  builds everything.
- Then double-click **`add_service_key.cmd`** and paste your Supabase
  **service_role** key. The site reads with the anon key; only you write.

The runner checks the schema before it calls a single model, so a missed step
costs a second rather than a whole session.

**Going live for the first time? Follow `LAUNCH.md` instead — it's the full
checklist.**

**3. Put the site live**
- Double-click **update_website.cmd**. It prints your live URL when done.
- One-time: on vercel.com, open the new project's Settings and rename it to **trenchbench** so the address becomes **trenchbench.vercel.app**.

---

## Everyday use

- **Run a session:** with Ollama running, double-click **start_session.cmd** (or
  `start_stocks` / `start_memes` / `start_fresh` for a different roster). All eight
  agents start on equal capital, the model↔persona pairing rotates from last time,
  and prices come live from the Pump.fun feed. It runs **until you press Stop** —
  `SESSION_SECONDS` is only a safety cap.
- **Stop it:** **stop_session.cmd**. It finishes the round, scores every decision
  and saves. **emergency_stop.cmd** is the harder version if you're unsure what's
  still running.
- **Spend is capped.** `MAX_MODEL_CALLS` in `config.txt` is a hard ceiling on paid
  model calls, and usage prints as the session runs. Two runners can't start at once.
- **Every session is saved** twice: a local file in `sessions/`, and to Supabase so
  the live site shows it.
- **Update the live site:** double-click **update_website.cmd**.

---

## Backing the code up to GitHub (private)

Double-click **push_to_github.cmd**. It pushes to `github.com/3esign/trenchbench`.

It will **not** push `config.txt`, any `.env`, `.vercel`, `.deploy`, or your
`sessions/` folder — your keys and your data stay on this machine. If a secret
ever does end up staged, the script stops before pushing and tells you.

The repo is **private**. The code, the personas and prompts, the scoring
methodology and every session you generate are proprietary — see `LICENSE`.

---

## What the database records

Each session logs *what every agent did* **and whether it worked**:

- `decisions` — the raw call: observation, action, symbol, size, the model's reason.
- `decision_outcomes` — the label: the token's move over the next N rounds *signed
  by direction*, what the market did over the same window, the **edge** (the two
  subtracted — the alpha of that specific call), and FIFO realised P&L on every
  round-trip that closed.
- `decisions_labeled` — a view joining the two. This is the sellable shape.
- `agent_reports` — per agent per session: return, risk-adjusted skill, **hit rate**
  (share of calls that beat the market) and **average edge**.

Hit rate and return are deliberately separate numbers. An agent can be right most
of the time and still lose money — that gap is the interesting part of the dataset.

---

## Notes

- **Your keys** live only in `config.txt` (git-ignored). They were shared in chat,
  so **rotate them** — Vercel token, Supabase password.
- **Prices are real.** Every price comes from PumpPortal + Dexscreener and is
  refreshed during the session. `PRICE_MODE=sim` exists for offline testing only.
- **Costs:** Vercel and Supabase free tiers are plenty. Ollama Cloud models are the
  only thing that costs money — hence the call ceiling.
- **Only you can write.** The site ships the anon key publicly and can only read;
  writes need the `service_role` key, which stays in `config.txt`.
- If a session prints `[db]` errors it stops before calling any model and tells you
  which SQL to run. Your local copy is safe regardless.

## Benchmark rules

Three things make this a benchmark rather than a leaderboard of noise:

1. **The model↔persona pairing rotates every session.** With a fixed pairing the
   model ranking and the strategy ranking are the same numbers, and you can never
   tell which one you're measuring.
2. **Equal starting capital.** Randomised capital isn't a difficulty setting — an
   agent with $500 literally cannot buy a $1,400 token.
3. **Short sessions don't count.** Under `MIN_BENCH_ROUNDS` a session is saved and
   viewable but can't move the all-time boards. Two rounds is not evidence.

Fallback calls — where a model timed out and the rule brain covered the round —
are recorded separately and never credited to the model.
