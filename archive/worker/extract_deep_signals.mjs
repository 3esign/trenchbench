import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESS_DIR = path.join(__dirname, '..', 'sessions');
const REPORT_PATH = path.join(__dirname, '..', 'signals_report.txt');

function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n === 0) return 0;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXSq = x.reduce((a, b) => a + b * b, 0);
  const sumYSq = y.reduce((a, b) => a + b * b, 0);
  const sumXY = x.map((val, idx) => val * y[idx]).reduce((a, b) => a + b, 0);
  
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumXSq - sumX * sumX) * (n * sumYSq - sumY * sumY));
  if (den === 0) return 0;
  return num / den;
}

async function analyze() {
  if (!fs.existsSync(SESS_DIR)) {
    console.error('Sessions directory not found.');
    return;
  }

  const files = fs.readdirSync(SESS_DIR).filter(f => f.endsWith('.json'));
  
  const sessionStats = [];
  const allCompletedTrades = [];
  const personaMetrics = {};
  const tokenMetrics = {};

  for (const file of files) {
    const filePath = path.join(SESS_DIR, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      
      const realMode = data.real || false;
      const reports = data.reports || [];
      const decisions = data.decisions || [];

      // Group decisions by agent
      const agentDecisions = {};
      for (const d of decisions) {
        if (!d.agent_id) continue;
        if (!agentDecisions[d.agent_id]) agentDecisions[d.agent_id] = [];
        agentDecisions[d.agent_id].push(d);
      }

      for (const rep of reports) {
        if (rep.is_baseline) continue;

        const agentId = rep.agent_id;
        const pnl = rep.ret || 0;
        const tradeCount = rep.trades || 0;

        const decs = agentDecisions[agentId] || [];
        const totalDecs = decs.length;
        const activeDecs = decs.filter(d => ['BUY', 'SELL', 'SWAP'].includes(d.action)).length;
        const holdDecs = decs.filter(d => d.action === 'HOLD').length;
        const holdRatio = totalDecs > 0 ? holdDecs / totalDecs : 0;

        sessionStats.push({
          session_id: data.session_id,
          agent_id: agentId,
          model: rep.model,
          pnl,
          tradeCount,
          totalDecs,
          holdRatio,
          realMode
        });

        // Initialize Persona Metrics
        if (!personaMetrics[agentId]) {
          personaMetrics[agentId] = { runs: 0, totalPnl: 0, pnls: [], tradeCounts: [], holdRatios: [] };
        }
        personaMetrics[agentId].runs++;
        personaMetrics[agentId].totalPnl += pnl;
        personaMetrics[agentId].pnls.push(pnl);
        personaMetrics[agentId].tradeCounts.push(tradeCount);
        personaMetrics[agentId].holdRatios.push(holdRatio);
      }

      // Reconstruct completed trades for hold duration & slippage analysis
      const openPositions = {}; // key: agent_id + '|' + symbol -> { buyTick: number, buyPrice: number, buyQty: number }
      
      for (const d of decisions) {
        if (!d.action || !d.agent_id || !d.sym) continue;
        const posKey = `${d.agent_id}|${d.sym}`;
        const act = d.action.toUpperCase();

        if (act === 'BUY' || act === 'SWAP') {
          openPositions[posKey] = {
            buyTick: d.tick,
            buyPrice: d.price || 0,
            buyQty: d.qty || 0,
            symbol: d.sym,
            agent_id: d.agent_id,
            model: d.model
          };
        } else if (act === 'SELL' && openPositions[posKey]) {
          const buy = openPositions[posKey];
          const sellPrice = d.price || 0;
          const holdTime = d.tick - buy.buyTick;
          const tradePnl = buy.buyPrice > 0 ? (sellPrice / buy.buyPrice - 1) * 100 : 0;

          allCompletedTrades.push({
            symbol: buy.symbol,
            agent_id: buy.agent_id,
            model: buy.model,
            holdTime,
            pnl: tradePnl,
            realMode
          });

          // Token Metrics
          if (!tokenMetrics[buy.symbol]) {
            tokenMetrics[buy.symbol] = { buys: 0, sells: 0, totalPnl: 0, tradeCount: 0 };
          }
          tokenMetrics[buy.symbol].buys++;
          tokenMetrics[buy.symbol].sells++;
          tokenMetrics[buy.symbol].totalPnl += tradePnl;
          tokenMetrics[buy.symbol].tradeCount++;

          delete openPositions[posKey];
        }
      }

    } catch (e) {
      console.error(`Error processing ${file}: ${e.message}`);
    }
  }

  // Generate output
  let out = '';
  
  // 1. Overall Correlations
  const pnls = sessionStats.map(s => s.pnl);
  const tradeCounts = sessionStats.map(s => s.tradeCount);
  const holdRatios = sessionStats.map(s => s.holdRatio);

  const corrPnlTradeCount = pearsonCorrelation(pnls, tradeCounts);
  const corrPnlHoldRatio = pearsonCorrelation(pnls, holdRatios);

  out += `=== OVERALL S1 CORRELATIONS ===\n`;
  out += `P&L vs. Trade Count Correlation:  ${corrPnlTradeCount.toFixed(4)}\n`;
  out += `P&L vs. Hold Ratio Correlation:   ${corrPnlHoldRatio.toFixed(4)}\n\n`;

  // 2. Persona Deep Dive
  out += `=== PERSONA CORRELATION METRICS ===\n`;
  out += `Persona | Runs | Avg P&L | Avg Trades | Avg Hold % | P&L vs Trades Corr | P&L vs Hold % Corr\n`;
  out += `---|---|---|---|---|---|---\n`;
  
  for (const [id, m] of Object.entries(personaMetrics)) {
    const corrPnlTc = pearsonCorrelation(m.pnls, m.tradeCounts);
    const corrPnlHr = pearsonCorrelation(m.pnls, m.holdRatios);
    const avgPnl = m.totalPnl / m.runs;
    const avgTc = m.tradeCounts.reduce((a,b)=>a+b,0) / m.runs;
    const avgHr = m.holdRatios.reduce((a,b)=>a+b,0) / m.runs;

    out += `${id} | ${m.runs} | ${avgPnl.toFixed(2)}% | ${avgTc.toFixed(1)} | ${(avgHr * 100).toFixed(1)}% | ${corrPnlTc.toFixed(4)} | ${corrPnlHr.toFixed(4)}\n`;
  }
  out += `\n`;

  // 3. Trade Hold Duration vs. Trade Return
  out += `=== TRADE HOLD DURATION DISTRIBUTION ===\n`;
  out += `Hold Duration | Trades | Avg Return\n`;
  out += `---|---|---\n`;
  
  const durationBuckets = {
    '1-2 ticks': { count: 0, totalPnl: 0 },
    '3-5 ticks': { count: 0, totalPnl: 0 },
    '6-10 ticks': { count: 0, totalPnl: 0 },
    '11-20 ticks': { count: 0, totalPnl: 0 },
    '21-50 ticks': { count: 0, totalPnl: 0 },
    '50+ ticks': { count: 0, totalPnl: 0 }
  };

  for (const t of allCompletedTrades) {
    let bucket = '50+ ticks';
    if (t.holdTime <= 2) bucket = '1-2 ticks';
    else if (t.holdTime <= 5) bucket = '3-5 ticks';
    else if (t.holdTime <= 10) bucket = '6-10 ticks';
    else if (t.holdTime <= 20) bucket = '11-20 ticks';
    else if (t.holdTime <= 50) bucket = '21-50 ticks';

    durationBuckets[bucket].count++;
    durationBuckets[bucket].totalPnl += t.pnl;
  }

  for (const [b, data] of Object.entries(durationBuckets)) {
    out += `${b} | ${data.count} | ${data.count > 0 ? (data.totalPnl / data.count).toFixed(2) + '%' : '0%'}\n`;
  }
  out += `\n`;

  // 4. Token Profitability Analysis
  out += `=== TOP 10 TOKENS BY LOSS (PNL SUM) ===\n`;
  out += `Symbol | Trades | Avg Return per Trade | Total Summed Return\n`;
  out += `---|---|---|---\n`;
  
  const worstTokens = Object.entries(tokenMetrics)
    .map(([sym, m]) => ({
      Symbol: sym,
      Trades: m.tradeCount,
      'Avg Return per Trade': (m.totalPnl / m.tradeCount).toFixed(2) + '%',
      'Total Summed Return': m.totalPnl
    }))
    .sort((a,b) => a['Total Summed Return'] - b['Total Summed Return'])
    .slice(0, 10);
    
  for (const w of worstTokens) {
    out += `${w.Symbol} | ${w.Trades} | ${w['Avg Return per Trade']} | ${w['Total Summed Return'].toFixed(2)}%\n`;
  }

  fs.writeFileSync(REPORT_PATH, out, 'utf8');
  console.log(`Successfully wrote report to ${REPORT_PATH}`);
}

analyze();
