# Trench Bench V3: Design & Architecture Document

This document outlines the major architectural improvements planned for V3 of Trench Bench, specifically focusing on enriching the agents' ability to reason, trace, and predict.

## 1. The Observation Pipeline

In V2, agents are forced to instantly pick a menu option (Buy, Sell, Hold) by outputting a single integer. They do not have a dedicated mechanism to write down their thoughts, trace tokens, evaluate their holdings, or predict future market moves.

V3 will enrich the system with an observation pipeline that allows models to observe tokens before picking, and observe others while holding (tracing, tracking, measuring, evaluation, and prediction).

### Proposed Approaches

We have a few ways to implement this observation pipeline. 

#### Option 1: Chain-of-Thought "Scratchpad" (Recommended)
Instead of forcing the model to output *only* an integer, we change the system prompt to explicitly require the model to write an observation/prediction block first, and *then* output its final integer choice.
- **How it works:** The model receives the board state and is instructed: "First, write a brief OBSERVATION block where you evaluate your holdings, track moving tokens, and predict what will happen next. Then, output your final integer choice."
- **Pros:** Fast (only 1 API call per agent per tick), gives the model room to reason before acting, naturally scales with the context window, and creates an audit trail of the agent's thought process.
- **Cons:** Models might occasionally format the output wrong, though we can make our parser robust to extract the integer.

#### Option 2: Two-Stage Pipeline (Analyze -> Decide)
Every single round, we make two separate API calls for each agent.
- **Stage 1 (Observer):** The model gets the market state and writes a "Market Observation & Prediction" report.
- **Stage 3 (Trader):** The model receives the menu AND its own observation report from Stage 1, and picks an integer.
- **Pros:** Completely separates the reasoning from the mechanical selection.
- **Cons:** Doubles the number of API calls per session, significantly slowing down the simulation.

#### Option 3: Explicit "OBSERVE" Menu Options
We add new options to the menu. E.g., `4) OBSERVE #CHILLGUY`.
- **How it works:** If the agent chooses to "OBSERVE", they don't buy or sell that round. Instead, the system triggers an analysis call where the agent evaluates that specific token. The resulting analysis is pinned to the agent's memory for the next rounds.
- **Pros:** Agents must weigh the opportunity cost of observing vs. trading.
- **Cons:** Doesn't guarantee they observe before their first buy.

### Implementation Steps (Assuming Option 1)

1. **Agent Prompt:** Update the `sys` and `usr` prompts in the `think()` function to remove the "Reply with its integer number and NOTHING else" directive. Replace it with instructions to write a `<scratchpad>` or `[OBSERVATION]` block first.
2. **Parser (`parseChoice`):** Update the regex and parsing logic to cleanly extract the integer choice from the end of the response, safely ignoring the observation text.
3. **State Tracking:** Extract the observation text and save it to the agent's `hist` (recent memory) so they can read their own previous predictions in the next round.
4. **UI Data:** Save the observation text into the `decision` logs so we can display the agent's thoughts on the frontend tape, making the arena much more engaging to watch.
