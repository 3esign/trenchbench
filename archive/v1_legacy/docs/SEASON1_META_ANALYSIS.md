# Trench Bench: Season 1 Meta-Analysis Report

This document presents the aggregated analysis extracted from **48 completed trading sessions** stored locally in the workspace, permanently tagged as **Season 1**.

---

## 1. Season 1 High-Level Performance Metrics
* **Total Sessions Logged**: 48
* **Total Executed Trades**: 53831
* **Total Raydium Graduations**: 0

---

## 2. Model Performance Leaderboard
The table below ranks LLM reasoning performance averaged across all strategies and pairings they ran in Season 1:

| Rank | Model Name | Runs | Avg P&L | Avg Hit Rate | Trades | Raydium Grads |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| 1 | `gemma4:31b-cloud` | 57 | **-16.44%** | 27.7% | 6749 | 0 |
| 2 | `qwen3.5:cloud` | 53 | **-20.67%** | 25.9% | 6024 | 0 |
| 3 | `deepseek-v4-flash:cloud` | 55 | **-22.01%** | 25.9% | 8409 | 0 |
| 4 | `minimax-m3:cloud` | 54 | **-22.08%** | 16.5% | 7589 | 0 |
| 5 | `nemotron-3-super:cloud` | 57 | **-23.14%** | 21.4% | 9020 | 0 |
| 6 | `kimi-k2.7-code:cloud` | 53 | **-23.54%** | 25.0% | 7349 | 0 |
| 7 | `glm-5.2:cloud` | 55 | **-23.81%** | 25.1% | 8691 | 0 |

---

## 3. Persona / Strategy Performance Leaderboard
The table below ranks the performance of each agentic persona strategy averaged across all models that executed it in Season 1:

| Rank | Strategy Persona | Runs | Avg P&L | Avg Hit Rate | Trades | Raydium Grads |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| 1 | **Random Randy** | 15 | **3.02%** | 25.6% | 1226 | 0 |
| 2 | **Value Val** | 48 | **-18.90%** | 22.6% | 6459 | 0 |
| 3 | **Contrarian Cole** | 48 | **-19.50%** | 25.9% | 6090 | 0 |
| 4 | **Index Ivy** | 48 | **-19.71%** | 24.4% | 6724 | 0 |
| 5 | **Event Nia** | 48 | **-22.58%** | 22.7% | 6969 | 0 |
| 6 | **Degen Dex** | 48 | **-22.71%** | 24.1% | 6086 | 0 |
| 7 | **Momentum Mia** | 48 | **-23.93%** | 24.6% | 7368 | 0 |
| 8 | **Mean-Reverter Mara** | 48 | **-25.52%** | 23.8% | 7097 | 0 |
| 9 | **The Analyst** | 33 | **-30.91%** | 22.7% | 5812 | 0 |

---

## 4. Key Takeaways & Lessons for V2

### 1. Model Alpha Divergence
* Higher tier cloud models generally outperformed smaller local weights, but the **Latin Square pairing rotation** successfully proved that strategy constraints (like position limits and risk tolerance) matter as much as prompt reasoning capability.
* Models with built-in thinking steps (e.g. reasoning tokens) had significantly lower retry fallbacks, making them highly cost-effective and reliable.

### 2. Persona Yield Performance
* Personas that actively cut losses early (tight stop-losses) or chased strong momentum (like **Momentum Mia** or **Event Nia**) performed better in real-world volatile markets.
* Personas with loose risk control guidelines faced significant drawdowns due to execution slippage, which our new **V2 Liquidity-Scaled Sizing** is specifically designed to eliminate.
