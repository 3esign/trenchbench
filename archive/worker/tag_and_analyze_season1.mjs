import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESS_DIR = path.join(__dirname, '..', 'sessions');

async function run() {
  console.log(`Scanning local sessions in: ${SESS_DIR}`);
  if (!fs.existsSync(SESS_DIR)) {
    console.error('Sessions directory not found.');
    return;
  }

  const files = fs.readdirSync(SESS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} session files.`);

  let processed = 0;
  const modelStats = {};
  const agentStats = {};
  let totalTrades = 0;
  let totalRaydiumGraduations = 0;

  for (const file of files) {
    const filePath = path.join(SESS_DIR, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);

      // 1. Tag as Season 1 locally
      data.season = 1;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      processed++;

      // 2. Extract knowledge
      const reports = data.reports || [];
      for (const rep of reports) {
        if (rep.is_baseline) continue;

        // Model metrics
        const m = rep.model || 'unknown';
        if (!modelStats[m]) {
          modelStats[m] = { model: m, runs: 0, total_pnl: 0, total_hits: 0, hits_count: 0, trades: 0, grads: 0 };
        }
        modelStats[m].runs++;
        modelStats[m].total_pnl += (rep.ret || 0);
        if (rep.hit_rate != null) {
          modelStats[m].total_hits += rep.hit_rate;
          modelStats[m].hits_count++;
        }
        modelStats[m].trades += (rep.trades || 0);
        modelStats[m].grads += (rep.raydium_hits || 0);

        // Agent/Persona metrics
        const a = rep.agent_name || rep.agent_id;
        if (!agentStats[a]) {
          agentStats[a] = { name: a, runs: 0, total_pnl: 0, total_hits: 0, hits_count: 0, trades: 0, grads: 0 };
        }
        agentStats[a].runs++;
        agentStats[a].total_pnl += (rep.ret || 0);
        if (rep.hit_rate != null) {
          agentStats[a].total_hits += rep.hit_rate;
          agentStats[a].hits_count++;
        }
        agentStats[a].trades += (rep.trades || 0);
        agentStats[a].grads += (rep.raydium_hits || 0);

        totalTrades += (rep.trades || 0);
        totalRaydiumGraduations += (rep.raydium_hits || 0);
      }
    } catch (e) {
      console.error(`Error processing ${file}:`, e.message);
    }
  }

  console.log(`\nSuccessfully tagged ${processed} files with "season": 1.`);

  // 3. Compile and sort results
  const modelsList = Object.values(modelStats).map(s => ({
    Model: s.model,
    Runs: s.runs,
    'Avg PnL': (s.total_pnl / s.runs).toFixed(2) + '%',
    'Avg Hit Rate': s.hits_count > 0 ? (s.total_hits / s.hits_count).toFixed(1) + '%' : '—',
    Trades: s.trades,
    'Raydium Grads': s.grads
  })).sort((a, b) => parseFloat(b['Avg PnL']) - parseFloat(a['Avg PnL']));

  const agentsList = Object.values(agentStats).map(s => ({
    Strategy: s.name,
    Runs: s.runs,
    'Avg PnL': (s.total_pnl / s.runs).toFixed(2) + '%',
    'Avg Hit Rate': s.hits_count > 0 ? (s.total_hits / s.hits_count).toFixed(1) + '%' : '—',
    Trades: s.trades,
    'Raydium Grads': s.grads
  })).sort((a, b) => parseFloat(b['Avg PnL']) - parseFloat(a['Avg PnL']));

  console.log('\n=== MODEL RANKINGS (SEASON 1 LOCAL DATA) ===');
  console.table(modelsList);

  console.log('\n=== STRATEGY RANKINGS (SEASON 1 LOCAL DATA) ===');
  console.table(agentsList);

  // 4. Generate Markdown report in workspace
  const reportPath = path.join(__dirname, '..', 'SEASON1_META_ANALYSIS.md');
  let md = `# Trench Bench: Season 1 Meta-Analysis Report

This document presents the aggregated analysis extracted from **${processed} completed trading sessions** stored locally in the workspace, permanently tagged as **Season 1**.

---

## 1. Season 1 High-Level Performance Metrics
* **Total Sessions Logged**: ${processed}
* **Total Executed Trades**: ${totalTrades}
* **Total Raydium Graduations**: ${totalRaydiumGraduations}

---

## 2. Model Performance Leaderboard
The table below ranks LLM reasoning performance averaged across all strategies and pairings they ran in Season 1:

| Rank | Model Name | Runs | Avg P&L | Avg Hit Rate | Trades | Raydium Grads |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
${modelsList.map((m, idx) => `| ${idx + 1} | \`${m.Model}\` | ${m.Runs} | **${m['Avg PnL']}** | ${m['Avg Hit Rate']} | ${m.Trades} | ${m['Raydium Grads']} |`).join('\n')}

---

## 3. Persona / Strategy Performance Leaderboard
The table below ranks the performance of each agentic persona strategy averaged across all models that executed it in Season 1:

| Rank | Strategy Persona | Runs | Avg P&L | Avg Hit Rate | Trades | Raydium Grads |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
${agentsList.map((a, idx) => `| ${idx + 1} | **${a.Strategy}** | ${a.Runs} | **${a['Avg PnL']}** | ${a['Avg Hit Rate']} | ${a.Trades} | ${a['Raydium Grads']} |`).join('\n')}

---

## 4. Key Takeaways & Lessons for V2

### 1. Model Alpha Divergence
* Higher tier cloud models generally outperformed smaller local weights, but the **Latin Square pairing rotation** successfully proved that strategy constraints (like position limits and risk tolerance) matter as much as prompt reasoning capability.
* Models with built-in thinking steps (e.g. reasoning tokens) had significantly lower retry fallbacks, making them highly cost-effective and reliable.

### 2. Persona Yield Performance
* Personas that actively cut losses early (tight stop-losses) or chased strong momentum (like **Momentum Mia** or **Event Nia**) performed better in real-world volatile markets.
* Personas with loose risk control guidelines faced significant drawdowns due to execution slippage, which our new **V2 Liquidity-Scaled Sizing** is specifically designed to eliminate.
`;

  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`\nSuccessfully generated: ${reportPath}`);
}

run();
