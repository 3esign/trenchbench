# trenchbench — Plan to Live

*The path from today's prototype to a live version, with the operating model locked in. trenchbench = a session-based benchmark where AI agents trade a real-price mirror of Pump.fun / Solana, learn within each run, and produce a dataset we can turn into products.*

---

## What we've agreed (locked)

- **Session-based, not continuous.** You open Ollama, run the local script, hit **Start** → agents trade → hit **Stop**. That start→stop run is one **session**: named, acknowledged, fully recorded. No always-on trading.
- **Dashboard is local, not online.** The Control Room runs on your machine (it controls the run). **Vercel serves only the public Arena** (`/`) — read-only.
- **Each agent** has three things: a **thinking mechanism**, a **self-learning / changing mechanism**, and a **report**.
- **Pump.fun / Solana branding + focus** — green brand accent, Pump.fun assets, "built for Pump.fun · independent, not affiliated with Pump.fun."
- **The database is the product.** Everything is logged to sell later.

---

## 1. The session model (the heart of it)

A **session** is the unit of everything:

- **Start** → a fresh arena: agents reset to $10k, models assigned, a new `session_id` opens.
- **Run** → the loop ticks; every decision, trade, and equity point is written under that session.
- **Stop** → the session closes; each agent emits its **report**; session-level results (winners, model leaderboard) are frozen and stored.

Why sessions beat continuous: each one is a clean, comparable, immutable **benchmark run**. You can line up "Session 14 vs 15," aggregate model performance across all sessions, and sell the set. It also means *nothing has to be online 24/7* — you run a session when you want data.

---

## 2. What runs where (updated)

```
YOUR PC (a session runs here)
  Ollama ──► Agent thinking (each agent = its own model)
  Session runner (Node script: Start / Stop)
  Local Control Room dashboard (observe + control the run)
        │ writes each session ▼
SUPABASE  ── sessions · decisions · trades · equity · agent_reports · model_stats
        │ read ▼
VERCEL (public "/")  ── the Arena: live/last session + all-time model leaderboard (read-only)
```

The dashboard and the runner are the same local app; Vercel is just the shop window.

---

## 3. Each agent = thinking + self-learning + report

**Thinking mechanism.** Persona (system prompt) + its assigned model, called each time it wakes: observe the market + its portfolio → decide one action (BUY/SELL/HOLD + symbol + size) → give a one-line reason + when to wake next. Structured JSON so it's reliable and loggable.

**Self-learning / changing mechanism** (within a session):
- **Memory** — before deciding, it's shown its own recent trades + outcomes.
- **Reflection** — periodically it writes itself a lesson ("memes fade late; stop chasing").
- **Adaptation** — it adjusts risk appetite and strategy from its own results.
- **Change** — optionally swaps model or mutates parameters mid-session (the "changing mechanism").

**Report** — at Stop, each agent produces a **session report**: final P&L, risk-adjusted skill, all its trades, the *evolution* of its strategy notes, best and worst calls, and a one-paragraph self-summary of what it learned. Stored per-agent-per-session, and exportable — a clean artifact (and a sellable one).

---

## 4. Data model (sessions-first)

`sessions` (id, name, started, stopped, ruleset, provider) · `agents` (id, persona, model) · `decisions` ⭐ (session_id, agent_id, tick, observation, action, sym, qty, price, reason, **model, prompt_version**, outcome) · `trades` · `equity` (session_id, agent_id, ts, value) · `agent_reports` (session_id, agent_id, pnl, skill, notes_history, summary) · `model_stats` (model, sessions, avg_return, avg_skill, wins) — the benchmark aggregate.

---

## 5. Products from the database (you asked — here's the menu)

**For humans:**
- **The Model Benchmark** *(flagship)* — "which LLM trades best on real markets," a public leaderboard + a paid deep report / API. Buyers: AI labs, researchers, media, curious traders.
- **Licensed research dataset** — the decisions + reasoning + outcomes, versioned by model/prompt, for quant + academic + AI-lab research. It's uniquely yours because you generated it.
- **Eval-as-a-service** — someone brings *their* model/agent; you run it through trenchbench and hand back a scored report card. B2B.
- **Strategy insight reports** — periodic "what the winning agents/models are doing" research notes (framed as research, never as "buy this").

**For agents / developers (machine buyers):**
- **Experience / memory API** — other autonomous agents query your store ("how did agents handle an NVDA shock?") to inform their own trading.
- **Benchmark API** — devs test their own strategy against the arena and fetch performance baselines.
- **Training-data feed** — the decision→outcome dataset as fuel for training/fine-tuning trading agents.
- **A portable "trenchbench score"** — a verifiable credential an agent carries as proof it can trade.

One rule across all of them: sell **research / benchmark / dataset**, not "signals" or advice — that keeps you clear of investment-adviser regulation and liability.

---

## 6. Design language — for your sign-off

The prototype you're holding *is* the proposal:
- **Terminal-grade dark** UI; **Pump.fun green** (`#00d21e`) as the brand accent — logo, live pulse, active states, chips, links — used on *chrome only*.
- **Validated data colors** for the chart series (blue/orange/aqua/…), deliberately *different* from the brand, so brand ≠ data and the charts stay colorblind-safe.
- System sans, tabular numerals, hairline-bordered cards, generous dark space.
- "Pump.fun · Solana" chip + "built for Pump.fun · independent, not affiliated with Pump.fun" — the Pump.fun-style honest positioning.

**Your call:** ship this direction, or push it warmer / more playful / more minimal / more "Bloomberg terminal"? This is the one thing to lock before I build the real UI.

---

## 7. Path to live — milestones + what I need from you

| # | Milestone | Result |
|---|---|---|
| M1 | Repo scaffold + Supabase schema + Vercel Arena reading the DB | the pipe works end-to-end |
| M2 | Local session runner (rule-brains) + Start/Stop + writes sessions | you can run & record a session |
| M3 | Real prices (PumpPortal / Dexscreener) replace the sim | real market |
| M4 | Real brains: Ollama multi-model | real intelligence, real benchmark |
| M5 | Per-agent memory + reflection + reports | agents that learn + session reports |
| M6 | Cross-session model leaderboard + dataset export/API | the products |

**What I need from you to finish:**
1. **Confirm the design direction** (§6) — the only true blocker for the UI.
2. A free **Supabase** project → paste its 2 keys into `.env` (I'll give exact steps).
3. Run ~5 **copy-paste commands** locally (Ollama + the runner) — I'll make them foolproof.
4. Connect the repo to **Vercel** (one click, you already use it).

Everything else — all the code (runner, agents, dashboard, Arena, schema, reports, export) — I write into `D:\Work\Software_Projects\trenchbench`.

---

*Say the word on §6 and I start scaffolding M1.*
