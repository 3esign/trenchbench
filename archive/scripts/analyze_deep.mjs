import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const config = Object.fromEntries(fs.readFileSync('config.txt', 'utf8').split('\n').map(l => l.split('=').map(s => s.trim())).filter(x => x[0] && x[1]));
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

async function run() {
  console.log('Fetching V2 sessions...');
  const { data: sessions } = await supabase.from('sessions').select('id, name').eq('season', 2).order('started_at', { ascending: false });
  const sessionIds = sessions.map(s => s.id);
  console.log(`Found ${sessionIds.length} V2 sessions.`);

  if (sessionIds.length === 0) {
    console.log('No V2 sessions found.');
    return;
  }

  console.log('Fetching agent reports...');
  const { data: reports } = await supabase.from('agent_reports').select('*').in('session_id', sessionIds);
  
  console.log('Fetching decisions (both trades and holds)...');
  // We will fetch in chunks if it is too big, but let's query decisions with limit
  const { data: decisions } = await supabase.from('decisions').select('agent_id, model, action, sym, qty, price, comment, tick').in('session_id', sessionIds);
  
  console.log('Fetching decision outcomes...');
  const { data: outcomes } = await supabase.from('decision_outcomes').select('agent_id, model, action, realized_pnl, realized_pct, hold_ticks, edge, outcome, regret, was_best').in('session_id', sessionIds);

  console.log('Processing stats...');
  
  const personaStats = {};
  const modelStats = {};
  const interactionStats = {}; // persona + model

  // Initialize
  const initGroup = () => ({
    rets: [],
    trades: 0,
    buys: 0,
    sells: 0,
    holds: 0,
    swaps: 0,
    rebalances: 0,
    edges: [],
    regrets: [],
    holdTicks: [],
    bestPicks: 0,
    totalScored: 0,
    realizedPnlSum: 0,
    realizedPctSum: 0,
    realizedCount: 0,
    comments: []
  });

  for (const r of (reports || [])) {
    const p = r.agent_id;
    const m = r.model || 'unknown';
    const pm = `${p}::${m}`;

    if (!personaStats[p]) personaStats[p] = initGroup();
    if (!modelStats[m]) modelStats[m] = initGroup();
    if (!interactionStats[pm]) interactionStats[pm] = initGroup();

    personaStats[p].rets.push(r.ret);
    modelStats[m].rets.push(r.ret);
    interactionStats[pm].rets.push(r.ret);
  }

  for (const d of (decisions || [])) {
    const p = d.agent_id;
    const m = d.model || 'unknown';
    const pm = `${p}::${m}`;

    const groups = [personaStats[p], modelStats[m], interactionStats[pm]].filter(Boolean);

    for (const g of groups) {
      if (d.action === 'BUY') { g.buys++; g.trades++; }
      else if (d.action === 'SELL') { g.sells++; g.trades++; }
      else if (d.action === 'HOLD') g.holds++;
      else if (d.action === 'SWAP') { g.swaps++; g.trades++; }
      else if (d.action === 'REBALANCE') { g.rebalances++; g.trades++; }
      
      if (d.comment && d.comment.trim()) {
        g.comments.push(d.comment.trim());
      }
    }
  }

  for (const o of (outcomes || [])) {
    const p = o.agent_id;
    const m = o.model || 'unknown';
    const pm = `${p}::${m}`;

    const groups = [personaStats[p], modelStats[m], interactionStats[pm]].filter(Boolean);

    for (const g of groups) {
      if (o.edge != null) g.edges.push(o.edge);
      if (o.regret != null) g.regrets.push(o.regret);
      if (o.was_best) g.bestPicks++;
      if (o.edge != null || o.regret != null) g.totalScored++;
      if (o.hold_ticks != null) g.holdTicks.push(o.hold_ticks);
      if (o.realized_pnl != null) {
        g.realizedPnlSum += o.realized_pnl;
        g.realizedPctSum += (o.realized_pct || 0);
        g.realizedCount++;
      }
    }
  }

  const printGroup = (name, g) => {
    const avgRet = g.rets.reduce((a,b)=>a+b,0)/Math.max(1, g.rets.length);
    const avgEdge = g.edges.reduce((a,b)=>a+b,0)/Math.max(1, g.edges.length);
    const avgRegret = g.regrets.reduce((a,b)=>a+b,0)/Math.max(1, g.regrets.length);
    const avgHold = g.holdTicks.reduce((a,b)=>a+b,0)/Math.max(1, g.holdTicks.length);
    const bestPct = (g.bestPicks / Math.max(1, g.totalScored)) * 100;
    const totalActs = g.buys + g.sells + g.holds + g.swaps + g.rebalances;
    const tradeFreq = (g.trades / Math.max(1, totalActs)) * 100;

    console.log(`\n=== ${name} ===`);
    console.log(`  Sessions Counted: ${g.rets.length}`);
    console.log(`  Average Return:   ${avgRet.toFixed(2)}%`);
    console.log(`  Average Edge:     ${avgEdge.toFixed(2)}%`);
    console.log(`  Average Regret:   ${avgRegret.toFixed(2)}`);
    console.log(`  Best Pick Rate:   ${bestPct.toFixed(1)}%`);
    console.log(`  Average Hold:     ${avgHold.toFixed(1)} ticks`);
    console.log(`  Action Mix:       BUY:${g.buys} | SELL:${g.sells} | HOLD:${g.holds} | SWAP:${g.swaps} | REB:${g.rebalances}`);
    console.log(`  Trade Frequency:  ${tradeFreq.toFixed(1)}% of decision points`);
    console.log(`  Total Realized:   $${g.realizedPnlSum.toFixed(2)} across ${g.realizedCount} closed positions (Avg PNL%: ${(g.realizedPctSum / Math.max(1, g.realizedCount)).toFixed(2)}%)`);
  };

  console.log('\n=============================================');
  console.log('          DEEP DIVE REPORT: MODEL STATS      ');
  console.log('=============================================');
  for (const m of Object.keys(modelStats).sort()) {
    printGroup(`MODEL: ${m}`, modelStats[m]);
  }

  console.log('\n=============================================');
  console.log('         DEEP DIVE REPORT: PERSONA STATS     ');
  console.log('=============================================');
  for (const p of Object.keys(personaStats).sort()) {
    printGroup(`PERSONA: ${p}`, personaStats[p]);
  }

  console.log('\n=============================================');
  console.log('   DEEP DIVE REPORT: TOP INTERACTION STATS   ');
  console.log('=============================================');
  const sortedInteractions = Object.entries(interactionStats)
    .map(([k, v]) => ({ key: k, ret: v.rets.reduce((a,b)=>a+b,0)/Math.max(1, v.rets.length), data: v }))
    .sort((a, b) => b.ret - a.ret);

  for (const entry of sortedInteractions.slice(0, 10)) {
    printGroup(`INTERACTION (Top 10): ${entry.key}`, entry.data);
  }
  for (const entry of sortedInteractions.slice(-5)) {
    printGroup(`INTERACTION (Bottom 5): ${entry.key}`, entry.data);
  }
}
run();
