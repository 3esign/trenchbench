import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const config = Object.fromEntries(fs.readFileSync('config.txt', 'utf8').split('\n').map(l => l.split('=').map(s => s.trim())).filter(x => x[0] && x[1]));
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

async function run() {
  const { data: sessions } = await supabase.from('sessions').select('id, name').order('started_at', { ascending: false }).limit(1);
  if (!sessions || sessions.length === 0) {
    console.log('No sessions found');
    return;
  }
  const sess = sessions[0];
  console.log(`Latest session: ${sess.name} (${sess.id})`);

  const { data: pts } = await supabase.from('equity_points').select('agent_id, tick, value').eq('session_id', sess.id).order('tick', { ascending: true });
  console.log(`Found ${pts.length} equity points.`);

  // Find max and min values
  let maxVal = -Infinity, minVal = Infinity;
  let maxPt = null, minPt = null;
  for (const p of pts) {
    if (p.value > maxVal) { maxVal = p.value; maxPt = p; }
    if (p.value < minVal) { minVal = p.value; minPt = p; }
  }
  console.log(`Max value: ${maxVal} at tick ${maxPt?.tick} for agent ${maxPt?.agent_id}`);
  console.log(`Min value: ${minVal} at tick ${minPt?.tick} for agent ${minPt?.agent_id}`);

  // Let's print some points for the agent that had the max value
  if (maxPt) {
    const { data: agentPts } = await supabase.from('equity_points').select('tick, value').eq('session_id', sess.id).eq('agent_id', maxPt.agent_id).order('tick', { ascending: true }).limit(20);
    console.log(`First 20 points for agent ${maxPt.agent_id}:`);
    console.log(agentPts);
  }
}
run();
