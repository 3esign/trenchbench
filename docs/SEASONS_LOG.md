# Trenchbench Seasons Log (`docs/SEASONS_LOG.md`)

This log tracks the empirical test outcomes, analyses, and transition plans for each testing season.

---

## [Season 2a (s2a)] - Upcoming
*   **Target Codebase**: `v2.0.1` (optimized)
*   **Status**: Planning & Prep
*   **Objective**: Implement prompt adjustments, expose token age/mean-reversion parameters, and minimize formatting fallbacks to improve agent alpha.

### Transition Roadmap (s2 ➔ s2a)
1.  **Review Analysis Findings**: Read the detailed [SEASON2_ANALYSIS_REPORT.md](file:///d:/Work/Software_Projects/pumpmind/docs/SEASON2_ANALYSIS_REPORT.md).
2.  **Engine Adjustments**:
    *   Expose memecoin lifetime age and mean-reversion gravitation coefficients in the state vectors.
    *   Enforce structured formatting prompts and larger token counts to decrease fallback rates.
3.  **Prompt Adjustments**: Teach agents about bonding curve price slippage mechanics and transaction size scaling (1% vs 5%).
4.  **Execute Batches**: Run s2a test cycles.

---

## [Season 2 (s2)] - Concluding
*   **Codebase Version**: `v2.0.0`
*   **Status**: Complete (133 sessions run)
*   **Detailed Results**: See [SEASON2_ANALYSIS_REPORT.md](file:///d:/Work/Software_Projects/pumpmind/docs/SEASON2_ANALYSIS_REPORT.md)
*   **Key Conclusions**:
    *   **Advanced Models Underperformed**: All active LLMs lost money (averaging -46.88% to -57.62% returns), performing no better than random trading (`baseline:dice` at -57.37%).
    *   **Baseline Dominance**: The cash baseline (`baseline:vault`) outperformed all contenders, losing only -2.52% on average.
    *   **Negative Alpha**: Advanced models consistently chased momentum spikes, buying at local tops right before gravitational reversion ($\kappa=0.20$) pulled prices back down.
    *   **Only One Model showing Edge**: `glm-5.2:cloud` was the only model with a positive average edge (+0.003), though transaction cost friction dragged its net returns negative.

---

## [Season 1 (s1)] - Archived
*   **Codebase Version**: `v1.0.0`
*   **Status**: Completed & Archived
*   **Summary**: Baseline heuristics test runs. Legacy logs moved to `archive/v1_legacy/docs/`.
