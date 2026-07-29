import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const config = Object.fromEntries(fs.readFileSync('config.txt', 'utf8').split('\n').map(l => l.split('=').map(s => s.trim())).filter(x => x[0] && x[1]));
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

async function run() {
  console.log('Fetching V2 sessions...');
  const { data: sessions } = await supabase.from('sessions').select('id, name, status').eq('season', 2).order('started_at', { ascending: false }).limit(20);
  const sessionIds = sessions.map(s => s.id);
  console.log(`Found ${sessionIds.length} V2 sessions.`);

  console.log('Fetching agent reports...');
  const { data: reports } = await supabase.from('agent_reports').select('*').in('session_id', sessionIds);
  
  console.log('Fetching decision outcomes (trades only)...');
  const { data: outcomes } = await supabase.from('decision_outcomes').select('agent_id, action, realized_pct, hold_ticks, edge, outcome, regret, was_best').in('session_id', sessionIds).not('action', 'eq', 'HOLD');

  const stats = {};
  
  for (const r of reports) {
    if (!stats[r.agent_id]) stats[r.agent_id] = { hits: [], edges: [], rets: [], pnl: 0, actions: { BUY: 0, SELL: 0 }, holdTicks: [], regrets: [], best: 0, total_decisions: 0 };
    stats[r.agent_id].rets.push(r.ret);
  }

  for (const o of outcomes) {
    if (!stats[o.agent_id]) continue;
    const st = stats[o.agent_id];
    st.total_decisions++;
    st.actions[o.action] = (st.actions[o.action] || 0) + 1;
    if (o.edge != null) st.edges.push(o.edge);
    if (o.regret != null) st.regrets.push(o.regret);
    if (o.was_best) st.best++;
    if (o.hold_ticks != null) st.holdTicks.push(o.hold_ticks);
  }

  console.log('\n--- AGENT PERSONA STATS (V2) ---');
  for (const [agent, st] of Object.entries(stats)) {
    const avgRet = st.rets.reduce((a,b)=>a+b,0)/Math.max(1, st.rets.length);
    const avgEdge = st.edges.reduce((a,b)=>a+b,0)/Math.max(1, st.edges.length);
    const avgHold = st.holdTicks.reduce((a,b)=>a+b,0)/Math.max(1, st.holdTicks.length);
    const avgRegret = st.regrets.reduce((a,b)=>a+b,0)/Math.max(1, st.regrets.length);
    const bestPct = (st.best / Math.max(1, st.total_decisions)) * 100;
    
    console.log(`Agent: ${agent}`);
    console.log(`  Avg Ret: ${avgRet.toFixed(2)}% | Avg Edge: ${avgEdge.toFixed(2)}% | Avg Regret: ${avgRegret.toFixed(2)}`);
    console.log(`  Trades: ${st.actions.BUY} BUYs, ${st.actions.SELL} SELLs | Avg Hold Ticks: ${avgHold.toFixed(1)}`);
    console.log(`  Best Pick Rate: ${bestPct.toFixed(1)}%`);
  }
}
run();
