# trenchbench — launch thread

The strongest thing you have is not "we built an AI trading benchmark." Everyone
has one of those and crypto Twitter is numb to it. The strongest thing you have
is a **war story with numbers in it** — that's what devs repost.

---

## Option A — the one I'd post (engineering hook)

**Tweet 1**

> The block explorer told me 50 tokens hadn't moved in 45 seconds.
>
> The chain was doing 1,138 swaps a minute.
>
> Every "price" I'd been feeding 7 AI trading agents was a stale cache. Here's
> what it took to get a real one 🧵

**Tweet 2**

> Fix: stream straight from PumpPortal WebSocket + Dexscreener API.
>
> Every trade updates the market price in real-time. That's a live price per
> tick — no paid RPC, no expensive subgraph.

**Tweet 3**

> Catch: RPC WebSocket limits can drop connections or stall.
>
> But PumpPortal WebSocket + Dexscreener REST fallback keep state clean. A price feed doesn't want history — it wants the next trade.

**Tweet 4**

> Second catch: a pool gives you a RATIO, not a price.
>
> GME/USDG = 24.83 is only dollars because USDG is a dollar.
>
> So: anchor to stables + Chainlink feeds, then hop. USDG prices WETH, WETH
> prices everything else. Unanchorable → left unpriced, never guessed.

**Tweet 5**

> Third catch: most swaps are multi-hop, so "read the two tokens in the receipt"
> gives you the wrong pair.
>
> The Swap event states `amount0` and `amount1` exactly. Match those against the
> Transfer logs and the real pair falls out, even mid-route.

**Tweet 6**

> Bonus discovery: there are 40+ SPL tokens called GME on Solana.
>
> One is the primary coin. The rest are clones, several with vanity
> mint addresses.
>
> Pick your roster by ticker and your agents trade a counterfeit.

**Tweet 7**

> What it's all for: 8 AI agents, 7 models, trading real Pump.fun / Solana markets.
> Every decision scored against what the market actually did next.
>
> The pairing rotates each session — otherwise "best model" and "best strategy"
> are the same number and neither means anything.
>
> trenchbench.vercel.app

**Tweet 8 — credits**

> Built on: PumpPortal WebSocket · @dexscreener API · Solana · @ollama for the models · @supabase + @vercel
>
> Independent, not affiliated with Pump.fun.

---

## Option B — single tweet, if you don't want a thread

> The block explorer said prices hadn't moved in 15 minutes.
> Solana was doing 1,138 swaps a minute.
>
> So I streamed straight from PumpPortal WebSocket + Dexscreener API instead. Live price
> per tick, no paid indexer.
>
> 8 AI agents now trade Pump.fun on it → trenchbench.vercel.app

---

## Option C — if you want the AI crowd more than the DeFi crowd

> Everyone benchmarks LLMs on tests they might have memorised.
>
> So we put 7 of them on Pump.fun / Solana memecoins — instruments
> that didn't exist when any of them were trained.
>
> No training data. No memorisation. Just judgement.
>
> trenchbench.vercel.app

---

## Who to credit, and why it's honest

| Who | What you actually used | Handle |
|---|---|---|
| **PumpPortal** | WebSocket stream for live feed & trades | `@pumpportal` |
| **Dexscreener** | real-time token pricing API | `@dexscreener` |
| **Solana** | the underlying blockchain | `@solana` |
| **Ollama** | runs all seven models | `@ollama` |
| **Supabase** | the database, which is the actual product | `@supabase` |
| **Vercel** | hosts the Arena | `@vercel` |
| **Pump.fun** | the memecoin launchpad | mention, don't imply endorsement |

Two notes on tagging:

- **Verify `@pumpportal` and `@dexscreener` before posting.**
- **Don't tag Pump.fun in the main tweet.** You're unaffiliated and the site
  says so; tagging them in a launch post reads as implying otherwise. Mention
  Pump.fun by name, credit them in the thread if at all.

---

## One piece of advice you didn't ask for

**Lead with the engineering, not the leaderboard.**

You have two counted sessions. Crypto Twitter will absolutely click through and
look at the model rankings, and right now those rankings are noise with an
honest disclaimer on them. If the tweet promises "which LLM trades best" and the
site says "too little data to call this a ranking," the disclaimer reads as a
climbdown instead of as rigour.

Post the war story now. It stands entirely on its own, it's true today, and it
makes devs trust you. Save "here's which model actually wins" for when you have
ten sessions and a result worth defending — that's a second, bigger post.
