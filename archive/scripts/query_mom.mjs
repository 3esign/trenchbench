import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const config = Object.fromEntries(fs.readFileSync('config.txt', 'utf8').split('\n').map(l => l.split('=').map(s => s.trim())).filter(x => x[0] && x[1]));
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

async function run() {
  const sessionId = 'c3609b75-9276-4b4a-a080-0b3b17c0af68';
  
  console.log('Fetching decisions for agent mom...');
  const { data: decs } = await supabase.from('decisions').select('*').eq('session_id', sessionId).eq('agent_id', 'mom').order('tick', { ascending: true }).limit(5);
  console.log(decs);
}
run();
