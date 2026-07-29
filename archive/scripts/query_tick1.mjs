import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const config = Object.fromEntries(fs.readFileSync('config.txt', 'utf8').split('\n').map(l => l.split('=').map(s => s.trim())).filter(x => x[0] && x[1]));
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

async function run() {
  const sessionId = 'c3609b75-9276-4b4a-a080-0b3b17c0af68';
  
  console.log('Fetching decisions for tick 1...');
  const { data: decs } = await supabase.from('decisions').select('*').eq('session_id', sessionId).eq('tick', 1);
  console.log(decs);

  console.log('\nFetching memecoins for session...');
  const { data: sessions } = await supabase.from('sessions').select('memecoins').eq('id', sessionId);
  const memecoins = sessions[0]?.memecoins;
  console.log('Memecoins at tick 1:', memecoins);
}
run();
