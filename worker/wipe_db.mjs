import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const ENV = {};
try { for (const l of fs.readFileSync(new URL('config.txt', ROOT), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) ENV[m[1]] = m[2].trim(); } } catch {}

const SUPA = (ENV.SUPABASE_URL || '').replace(/\/$/, '');
const ANON = ENV.SUPABASE_ANON_KEY;
const WRITE_KEY = ENV.SUPABASE_SERVICE_KEY || ANON;

if (!SUPA || !WRITE_KEY) {
  console.error("Missing Supabase credentials in config.txt!");
  process.exit(1);
}

async function sbDelete(pathq) {
  try {
    const r = await fetch(`${SUPA}/rest/v1/${pathq}`, { 
      method: 'DELETE', 
      headers: { 
        apikey: WRITE_KEY, 
        Authorization: `Bearer ${WRITE_KEY}` 
      } 
    });
    const txt = await r.text();
    console.log(`DELETE ${pathq.split('?')[0]} -> HTTP ${r.status} ${txt ? txt.slice(0, 160) : 'OK'}`);
  } catch (e) {
    console.error(`Error deleting ${pathq}:`, e.message);
  }
}

async function main() {
  console.log("Wiping all session and scoring database history...");
  // Delete outcomes first
  await sbDelete("decision_outcomes?id=not.is.null");
  // Delete decisions
  await sbDelete("decisions?id=not.is.null");
  // Delete equity points
  await sbDelete("equity_points?id=not.is.null");
  // Delete reports
  await sbDelete("agent_reports?id=not.is.null");
  // Delete memory
  await sbDelete("agent_memory?created_at=not.is.null");
  // Delete sessions
  await sbDelete("sessions?id=not.is.null");
  console.log("Database reset complete!");
}

main();
