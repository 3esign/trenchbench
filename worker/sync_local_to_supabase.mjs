import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Read Supabase configuration from config.txt
const CONFIG_PATH = path.join(__dirname, '..', 'config.txt');
let SUPA = '';
let ANON = '';

try {
  const content = fs.readFileSync(CONFIG_PATH, 'utf8');
  for (const line of content.split('\n')) {
    const clean = line.trim();
    if (clean.startsWith('SUPABASE_URL=')) SUPA = clean.split('=')[1].trim();
    if (clean.startsWith('SUPABASE_ANON_KEY=')) ANON = clean.split('=')[1].trim();
  }
} catch (e) {
  console.error('Error reading config.txt:', e.message);
  process.exit(1);
}

if (!SUPA || !ANON) {
  console.error('Supabase URL or Key missing from config.txt.');
  process.exit(1);
}

// REST wrapper for Supabase PostgREST
async function sb(endpoint, method = 'POST', body = null) {
  const url = `${SUPA}/rest/v1/${endpoint}`;
  const options = {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates' // Enables upsert (merge) behaviour
    }
  };
  if (body) options.body = JSON.stringify(body);

  const r = await fetch(url, options);
  if (!r.ok) {
    throw new Error(`Supabase Error (${r.status}): ${await r.text()}`);
  }
  try {
    return await r.json();
  } catch {
    return null;
  }
}

const SESS_DIR = path.join(__dirname, '..', 'sessions');

async function sync() {
  console.log(`Supabase URL: ${SUPA}`);
  console.log(`Scanning local sessions directory: ${SESS_DIR}`);
  
  if (!fs.existsSync(SESS_DIR)) {
    console.error('Sessions directory does not exist.');
    return;
  }

  const files = fs.readdirSync(SESS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} local session files to sync.`);

  for (const file of files) {
    const filePath = path.join(SESS_DIR, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      const sessionId = data.session_id;
      
      console.log(`\n--------------------------------------------------`);
      console.log(`Syncing Session: ${sessionId} (${file})`);

      // 1. Upsert Session Metadata
      const sessionRow = {
        id: sessionId,
        name: data.name || `Session ${sessionId.slice(0,6)}`,
        status: data.status || 'stopped',
        started_at: data.started_at || new Date().toISOString(),
        stopped_at: data.stopped_at || null,
        memecoins: data.memecoins || data.roster || [],
        season: data.season || 1,
        counted: data.counted ?? true,
        rounds: data.rounds || 0
      };
      
      try {
        await sb('sessions', 'POST', sessionRow);
        console.log('  [+] Session metadata upserted successfully.');
      } catch (err) {
        if (err.message.includes('season')) {
          // Fallback if the season column migration hasn't been run on Supabase
          console.warn('  [-] DB missing "season" column. Retrying insert without it...');
          const { season, ...fallbackRow } = sessionRow;
          await sb('sessions', 'POST', fallbackRow);
          console.log('  [+] Session metadata upserted (without season column).');
        } else {
          throw err;
        }
      }

      // 2. Sync decisions (bulk chunked to prevent payload size limits)
      if (Array.isArray(data.decisions) && data.decisions.length > 0) {
        const decisions = data.decisions.map(d => ({
          session_id: sessionId,
          tick: d.tick,
          ts: d.ts || new Date().toISOString(),
          agent_id: d.agent_id,
          agent_name: d.agent_name,
          role: d.role,
          model: d.model,
          start_cash: d.start_cash,
          action: d.action,
          sym: d.sym || '',
          qty: d.qty || 0,
          price: d.price || 0,
          executed: d.executed ?? true,
          comment: d.comment || '',
          brain: d.brain || 'model',
          choice: d.choice,
          reply: d.reply,
          menu_size: d.menu_size || 0,
          token_class: d.token_class || null,
          equity: d.equity || 0
        }));

        console.log(`  [~] Syncing ${decisions.length} decisions...`);
        const chunkSize = 200;
        for (let i = 0; i < decisions.length; i += chunkSize) {
          const chunk = decisions.slice(i, i + chunkSize);
          await sb('decisions', 'POST', chunk);
        }
        console.log(`  [+] All ${decisions.length} decisions synced.`);
      }

      // 3. Sync equity points
      if (Array.isArray(data.equity) && data.equity.length > 0) {
        const equity = data.equity.map(e => ({
          session_id: sessionId,
          agent_id: e.agent_id,
          tick: e.tick,
          ts: e.ts || new Date().toISOString(),
          value: e.value
        }));
        
        console.log(`  [~] Syncing ${equity.length} equity points...`);
        const chunkSize = 200;
        for (let i = 0; i < equity.length; i += chunkSize) {
          const chunk = equity.slice(i, i + chunkSize);
          await sb('equity_points', 'POST', chunk);
        }
        console.log(`  [+] All ${equity.length} equity points synced.`);
      }

      // 4. Sync reports
      if (Array.isArray(data.reports) && data.reports.length > 0) {
        const reports = data.reports.map(r => ({
          session_id: sessionId,
          agent_id: r.agent_id,
          agent_name: r.agent_name,
          role: r.role,
          model: r.model,
          start_cash: r.start_cash,
          end_value: r.end_value,
          ret: r.ret,
          skill: r.skill || 0,
          trades: r.trades || 0,
          hit_rate: r.hit_rate,
          avg_edge: r.avg_edge,
          realized_pnl: r.realized_pnl || 0,
          closed_trades: r.closed_trades || 0,
          model_calls: r.model_calls || 0,
          fallback_calls: r.fallback_calls || 0,
          model_share: r.model_share || 0,
          is_baseline: r.is_baseline ?? false,
          raydium_hits: r.raydium_hits || 0
        }));

        await sb('agent_reports', 'POST', reports);
        console.log(`  [+] Synced ${reports.length} agent reports.`);
      }

    } catch (e) {
      console.error(`  [!] Failed to sync ${file}:`, e.message);
    }
  }

  console.log(`\n--------------------------------------------------`);
  console.log('Synchronization completed successfully!');
}

sync();
