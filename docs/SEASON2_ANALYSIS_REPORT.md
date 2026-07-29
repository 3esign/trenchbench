# Trenchbench Season 2 Results Analysis Report (`docs/SEASON2_ANALYSIS_REPORT.md`)

This report provides a deep-dive empirical analysis of the Season 2 (v2s2) run data. We analyze 133 completed sessions evaluating advanced LLM trading models against rule-based baselines under realistic bonding curve physics.

---

## Executive Summary

1.  **Baseline Dominance**: The cash-holding control agent (`baseline:vault`) was the clear winner of Season 2, losing only **-2.52%** on average. The advanced models lost between **-46.88%** and **-57.62%**, performing no better than random coin-flipping (`baseline:dice` at **-57.37%**).
2.  **Slippage and Fee Drag**: The advanced models overtraded, incurring significant slippage penalties under the simulated $10,000 bonding curve AMM, whereas the baselines avoided transaction friction.
3.  **Negative Predictive Alpha**: With the exception of `glm-5.2:cloud` (+0.003), every active LLM exhibited negative average edge on true model decisions, indicating a tendency to buy simulated memecoins at local price peaks.
4.  **High Formatting Fallbacks**: Up to 20% of active model calls timed out or failed regex parsing, falling back to rule defaults and degrading performance.

---

## 1. Roster Performance Summary (133 Sessions)

Aggregate career balances compounding from a starting capital of **$100,000** through 133 counted sessions:

| Rank | Model Name | Sessions Played | Avg. Return | Avg. Hit Rate | Career Ending Balance |
| :--- | :--- | :---: | :---: | :---: | :---: |
| 1.   | `baseline:vault` (Cash Heuristic) | 133 | -2.52% | - | **$96,684** (Estimated) |
| 2.   | `baseline:basket` (Index Basket) | 133 | -18.87% | - | **$78,211** (Estimated) |
| 3.   | `gemma4:31b-cloud` | 133 | -46.88% | 35.2% | **$53,120** |
| 4.   | `qwen3.5:cloud` | 133 | -48.82% | 36.5% | **$51,180** |
| 5.   | `glm-5.2:cloud` | 133 | -50.16% | 36.1% | **$49,840** |
| 6.   | `deepseek-v4-flash:cloud` | 133 | -53.59% | 36.5% | **$46,410** |
| 7.   | `minimax-m3:cloud` | 133 | -55.33% | 31.6% | **$44,670** |
| 8.   | `baseline:dice` (Random Trade) | 133 | -57.37% | - | **$42,630** |
| 9.   | `kimi-k2.7-code:cloud` | 133 | -57.62% | 35.1% | **$42,380** |
| 10.  | `nemotron-3-super:cloud` | 133 | -57.62% | 31.9% | **$42,380** |

---

## 2. Decision Quality & Formatting Reliability

By separating true model decisions from default engine fallbacks, we isolate model capability:

| Model Name | Model Trades | Fallback Calls | Hit Rate (%) | Avg. Edge (Alpha) | Avg. Regret | Best Pick Rate (%) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **`glm-5.2:cloud`** | 8,996 | 826 | 33.9% | **+0.003** | 10.271 | 26.2% |
| **`qwen3.5:cloud`** | 6,524 | 1,667 | 43.6% | -0.103 | 9.195 | 28.8% |
| **`deepseek-v4-flash:cloud`** | 9,030 | 676 | 34.4% | -0.108 | 9.695 | 28.9% |
| **`kimi-k2.7-code:cloud`** | 8,068 | 1,046 | 33.0% | -0.196 | 9.939 | 26.8% |
| **`nemotron-3-super:cloud`** | 9,045 | 1,236 | 29.6% | -0.357 | 9.970 | 27.7% |
| **`minimax-m3:cloud`** | 6,482 | 1,202 | 33.1% | -0.439 | 10.409 | 22.4% |
| **`gemma4:31b-cloud`** | 7,492 | 1,306 | 42.0% | -0.628 | 10.387 | 28.4% |

### Key Observations:
*   **The GLM Alpha Anomaly**: `glm-5.2:cloud` is the only model that achieved a positive average edge (+0.003). It makes calculated trades that beat the market basket, but was ultimately dragged down by overtrading and transaction costs.
*   **Format Conformity**: `deepseek-v4-flash` had the lowest fallback rate (6.8% of calls), demonstrating high syntax compliance, followed closely by `glm-5.2` (8.4%).
*   **Gemma's Returns Paradox**: `gemma4` finished with the highest career ending balance of the LLMs ($53,120) but had the worst true average edge (-0.628). This indicates that Gemma's relative "success" was caused by its high fallback rate (1,306 calls reverting to passive rule defaults) rather than trading skill.

---

## 3. Explaining LLM Underperformance

### A. The Bonding Curve Price Slippage Trap
The engine implements realistic slippage calculation:
*   Each transaction moves prices on a simulated $10,000 bonding curve.
*   Advanced models trade frequently and in larger sizes. They bid up token prices on entry (buying high) and crash prices on exit (selling low), bleeding cash on every roundtrip.
*   *Solution*: Implement a model reasoning constraint or menu option that lets agents trade in smaller, incremental sizes.

### B. Mean-Reversion Gravity ($\kappa = 0.20$)
The price simulation pulls hyped tokens back down to their baseline curves.
*   Advanced models are pattern-recognizers that chase momentum. They identify tokens that recently surged and buy them at local peaks, right before the gravitation engine ($\kappa = 0.20$) forces them to mean-revert.
*   *Solution*: Include the mean-reversion rate and token creation age in the `[SESSION CONTEXT]` to warn models against chasing short-term spikes.

---

## 4. Recommendations for Season 2a (s2a) Tweaks

To transition from s2 to s2a, we recommend the following engine and prompt updates:

1.  **Slippage Awareness in Prompts**:
    *   Inject the liquidity pool size (\$10,000) and the price impact formula explicitly into the model's system prompt context.
    *   Instruct agents that trading smaller sizes (e.g. 1% rather than 5%) minimizes slippage.
2.  **Add Mean-Reversion Data**:
    *   Expose the gravitation coefficient ($\kappa=0.20$) and token lifetime (ticks since launch) in the compressed `[STATE]` vector to help models identify overextended charts.
3.  **Format and Timeout Optimizations**:
    *   Enforce `think: false` and raise `OLLAMA_NUM_PREDICT` to 500 across all provider drivers to reduce format-related fallback rates below 5%.
4.  **Expose RSI and SMA Technical Indicators**:
    *   Add simple 14-tick SMA or RSI indicator values to the observation data to help models identify overbought memecoins.
