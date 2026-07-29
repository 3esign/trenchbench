# Trench Bench: Season 2 Strategy & Tweak Proposal

This document outlines the data-driven rationales for the V2 upgrades, analyzing the historical Season 1 results and explaining how the new V2 mechanics will improve performance.

---

## 1. Season 1 Core Diagnostic: Why the LLMs Lost Money

The **[Season 1 Meta-Analysis Report](file:///d:/Work/Software_Projects/pumpmind/SEASON1_META_ANALYSIS.md)** reveals a significant paradox:
* **LLM Average Returns**: -15% to -30.5% P&L.
* **Baseline Dice (Random)**: +3.02% P&L.

### The Slippage Erosion Loop (Our Diagnostic)
In Season 1, LLMs operated under a **Stateless Slippage Trap**:
1. An agent observes a coin pumping and decides to buy.
2. Under the old execution model, they deployed a flat `risk * cash` size. For Degens, this was 50% of cash (e.g. $12,500).
3. They entered this order into small liquidity pools (often $5,000 - $10,000 total liquidity).
4. This resulted in **40% to 60% instant buy slippage**.
5. On the very next round, the position's valuation was updated to the spot price, showing an **instant -40% unrealized return**.
6. The Risk Guard auto-liquidated the position under the forced stop-loss rules, paying *another* round of sell slippage.
7. **Result**: LLMs were trapped in a loop of buying high (paying slippage) and panic-selling low, while the random baseline survived by taking tiny, passive positions.

---

## 2. V2 Architectural Fixes (Slippage Shield & Spot Bankruptcy)

To break this loop, we implemented three structural upgrades:

### 1. Slippage Shield (Liquidity-Scaled Trade Sizing)
* **Tweak**: Cap buy size at 5% of target token pool liquidity (min $100 safeguard).
* **Expected Result**: LLMs will no longer pay high slippage premiums. If a pool is small ($10k), their buy order is capped at $500, preventing self-reinforcing losses.

### 2. Spot Bankruptcy Rules (No Forced Bottom Liquidation)
* **Tweak**: Removed forced liquidations of remaining assets. Agents are only marked as bankrupt if total portfolio equity falls below $10.
* **Expected Result**: Allows agents to hold through temporary drawdowns and wait for market bounces (essential for volatile memecoin markets).

### 3. Prompt Telemetry Legend & Session Context
* **Tweak**: Added `[SESSION CONTEXT]` (Round / Market) and a parameter legend (`LQ`, `V5`, `MC`, `PNL`) to the system prompt.
* **Expected Result**: Models now have structural time awareness (knowing if they are at Round 5 or Round 100) and understand telemetry variables, preventing blind allocation.

---

## 3. Tweak Recommendations for Season 2 Personas

We recommend the following adjustments to the `PERSONAS` array in `worker/run_session.mjs` to optimize them for Season 2:

### 1. Re-align Degen Dex's Risk Appetite
* **Change**: Reduce `Degen Dex`'s base `risk` from `0.50` to `0.40`.
* **Rationale**: A `0.50` risk multiplier is too high for a portfolio of 5 positions, forcing it to hit the 5% liquidity cap on almost every buy. Capping its entry size to `0.40` leaves a cash buffer to buy dips.

### 2. Tighten Momentum Mia's Take-Profit
* **Change**: Reduce `Momentum Mia`'s `tp` from `20` to `15`, and tighten `sl` from `-10` to `-8`.
* **Rationale**: Momentum in memecoin markets decays rapidly. Locking in profits at `+15%` and cutting at `-8%` matches the short-lived nature of pump-and-dump candles.

### 3. Buff the Analyst Persona Prompt
* **Change**: Rewrite `The Analyst`'s description to instruct it how to use `[ARENA_KNOWLEDGE]` and coordinate strategies.
* **Rationale**: The Analyst was our worst performer (-30.5%) in Season 1 due to over-reactivity. Instructing it to act as a *conservative* meta-trader will stabilize its output.
