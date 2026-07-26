# Season 1 Deep Pattern Analysis & Upgrade Proposal

This document synthesizes granular patterns extracted from **106214 model decisions** in Season 1, identifying systematic trading failures, and proposes concrete logical upgrades for agents in Season 2.

---

## SECTION 1: SEASON 1 DEEP PATTERN ANALYSIS

### 1. Action Bias Telemetry
* **Total Decisions**: 106214
* **BUY**: 32329 (30.4%)
* **SELL**: 28451 (26.8%)
* **HOLD**: 42338 (39.9%)
* **SWAP**: 1365 (1.3%)

> [!NOTE]
> The models showed a strong **over-trading bias**, executing active orders (BUY/SELL/SWAP) in **58.5%** of decisions. In highly volatile memecoin markets, this hyper-activity drastically increased transaction costs and slippage.

### 2. Trade Matching & Duration Metrics
* **Completed Trades Matched**: 28416
* **Empirical Win Rate**: **16.6%**
* **Average Position Hold Duration**: **11.3 rounds**
* **Average Trade Return**: **0.44%**

> [!IMPORTANT]
> The short hold duration (**11.3 rounds**) indicates that agents were panic-selling on short-term dips instead of allowing positions to mature. The negative average trade return (**0.44%**) confirms that transaction costs and entry slippage wiped out trade edges.

### 3. Model Performance & Bias Chart
| Model | Decisions | Buy % | Sell % | Hold % | Swap % | Avg Decision Edge |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| \`baseline:dice\` | 9595 | 44.4% | 40.5% | 10.9% | 4.1% | **—** |
| \`baseline:vault\` | 10034 | 0.0% | 0.0% | 100.0% | 0.0% | **—** |
| \`baseline:basket\` | 10034 | 6.7% | 0.0% | 93.3% | 0.0% | **—** |
| \`glm-5.2:cloud\` | 10488 | 41.8% | 38.5% | 18.0% | 1.6% | **—** |
| \`gemma4:31b-cloud\` | 11009 | 33.6% | 27.7% | 38.6% | 0.1% | **—** |
| \`deepseek-v4-flash:cloud\` | 10355 | 41.1% | 39.2% | 19.1% | 0.6% | **—** |
| \`qwen3.5:cloud\` | 11607 | 27.3% | 24.6% | 47.8% | 0.3% | **—** |
| \`nemotron-3-super:cloud\` | 11235 | 40.1% | 35.3% | 22.9% | 1.7% | **—** |
| \`minimax-m3:cloud\` | 10707 | 34.6% | 29.1% | 32.8% | 3.5% | **—** |
| \`kimi-k2.7-code:cloud\` | 9419 | 39.1% | 37.0% | 22.7% | 1.2% | **—** |

---

## SECTION 2: STRATEGIC SOLUTIONS SYNTHESIS PROPOSAL

To upgrade the performance of all agents in Season 2, we propose implementing three systematic upgrades across the agent architectures:

### 1. High-Abstraction Slippage Guard (Slippage Shield)
* **Problem**: Agents pay a high slippage penalty when aping into low-liquidity pools.
* **Solution**: Automatically cap all trade sizes dynamically at **5% of pool liquidity**. This prevents massive price impact on entry and exits.

### 2. Temporal Context Priming
* **Problem**: Language models are stateless and cannot evaluate how much time is left in a session, leading to late-session buy orders that do not have time to recover.
* **Solution**: Prepend \`[SESSION CONTEXT] Round: X / Y | Mode: V2\` to every prompt. This primes the model to adjust risk tolerance (e.g. exit positions as the round count approaches the session limit).

### 3. Structural Parameter Legends
* **Problem**: Small models frequently confuse raw numbers like volume, liquidity, and market cap.
* **Solution**: Add a strict legend line to the system prompt:
  \`Menu Legend: LQ = Pool Liquidity, V5 = 5m Volume, MC = Market Cap, M1/M15/M60 = price changes, PNL = profit/loss.\`

### 4. Dynamic Persona Risk Adjustments
* **Problem**: High-risk multipliers (like Degen Dex at 0.50) force over-allocation.
* **Solution**: Tweak base risk parameters downward (e.g. Degen Dex to 0.40, The Analyst to 0.25) to preserve cash and encourage dip-buying.
