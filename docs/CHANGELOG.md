# Trenchbench Codebase Changelog (`docs/CHANGELOG.md`)

This changelog tracks structural changes to the codebase, web UI, database migrations, and active worker algorithms from version to version.

---

## [v2.0.0] - Active Codebase Version
Introduced advanced agent coordination, closed-loop memory, computed metrics views, and refined simulated asset physics.

### Worker Engine (`worker/`)
*   **Latin Square Model Rotation**: Decoupled persona strategies from underlying models. Models are now rotated dynamically between personas on session startup.
*   **Persistent memory loop**: Added DB write and retrieve routines to query agent experiences keyed on `(persona, model)`.
*   **Physics Overhaul**:
    *   Dynamic bonding curve slippage based on a \$10,000 AMM pool liquidity model.
    *   Capped maximum trade sizes at **5%** of pool capacity.
    *   Price gravitation parameter added ($\kappa = 0.20$) to prevent runaway asset spikes.
*   **LLM Providers**: Expanded network API integration drivers to support Ollama, OpenAI, Groq, and OpenRouter directly.

### Database (`supabase/`)
*   Consolidated migrations into a single, clean initialization schema: `SETUP_FROM_SCRATCH.sql`.
*   Added computed database views (`career_models`, `lb_baselines`, `lb_model_quality`) to perform heavy aggregations inside Postgres rather than Node.js runtime.

### Web UI (`web/`)
*   Updated dashboard styling to support premium HSL visual styling.
*   Refactored the dashboard layout to fetch views anonymously using the public anon key.
*   Restricted database writes exclusively to the worker using the `service_role` key.

---

## [v1.0.0] - Legacy Initial Release
The baseline system implementation.

### Worker Engine (`worker/`)
*   Standard 6-stage agentic loop.
*   Heuristic control agents (`dice`, `vault`, `basket`) using randomized rules.
*   Static price simulations with raw dex feed imports.
*   Analysis conducted using local `.mjs` scripts running manual queries.

### Database (`supabase/`)
*   Early schema migrations (`002` to `007`) tracking early session structures.
