// ============================================================
//  BENCHHOOD — which RPC endpoints actually work right now
//
//  Run this when a session complains about quota, or before a long run.
//  It pings every endpoint the session would use, in the order it would use
//  them, and reports latency and whether the expensive calls are allowed.
//
//    node worker/check_rpc.mjs        (or double-click check_rpc.cmd)
// ============================================================
import fs from 'node:fs';
import { poolFromEnv, PUBLIC_RPCS } from './rpcpool.mjs';

const ROOT = new URL('../', import.meta.url);
const ENV = {};
try {
  for (const line of fs.readFileSync(new URL('config.txt', ROOT), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) ENV[m[1]] = m[2].trim();
  }
} catch { console.log('  (no config.txt found — testing the free public endpoints only)'); }

const POOL_MANAGER = ENV.POOL_MANAGER || '0x8366a39CC670B4001A1121B8F6A443A643e40951';
const SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';

const urls = [ENV.ALCHEMY_RPC_URL, ...String(ENV.RPC_URLS || '').split(',').map(s => s.trim()).filter(Boolean), ...PUBLIC_RPCS].filter(Boolean);
const seen = new Set(); const list = urls.filter(u => !seen.has(u) && seen.add(u));

const mask = u => u.replace(/\/(v2|v1)\/[A-Za-z0-9_-]{8,}/, '/$1/<key>');
const ms = t => `${String(Math.round(t)).padStart(5)}ms`;

async function one(url, method, params, timeout = 12000) {
  const c = new AbortController(); const timer = setTimeout(() => c.abort(), timeout);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: c.signal });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { return { ok: false, t: Date.now() - t0, why: `HTTP ${r.status}: ${txt.slice(0, 60)}` }; }
    if (j.error) return { ok: false, t: Date.now() - t0, why: (j.error.message || 'rpc error').slice(0, 70) };
    return { ok: true, t: Date.now() - t0, v: j.result };
  } catch (e) { return { ok: false, t: Date.now() - t0, why: String(e.message).slice(0, 70) }; }
  finally { clearTimeout(timer); }
}

console.log(`\nBENCHHOOD — RPC health\n${'='.repeat(64)}`);
console.log(`${list.length} endpoint(s) configured, tried in this order:\n`);

let head = 0, anyGood = 0;
for (const url of list) {
  console.log(`  ${mask(url)}`);
  const b = await one(url, 'eth_blockNumber', []);
  if (!b.ok) { console.log(`     ${ms(b.t)}  DEAD — ${b.why}\n`); continue; }
  const blk = Number(BigInt(b.v)); if (blk > head) head = blk;
  console.log(`     ${ms(b.t)}  alive · block ${blk}`);

  // the two calls a session actually leans on
  const f = await one(url, 'eth_newFilter', [{ address: POOL_MANAGER, topics: [SWAP_TOPIC] }]);
  console.log(`     ${ms(f.t)}  eth_newFilter    ${f.ok ? 'OK — live price feed works here' : 'NO — ' + f.why}`);
  const g = await one(url, 'eth_getLogs', [{ address: POOL_MANAGER, topics: [SWAP_TOPIC], fromBlock: '0x' + (blk - 9).toString(16), toBlock: '0x' + blk.toString(16) }]);
  console.log(`     ${ms(g.t)}  eth_getLogs(10)  ${g.ok ? `OK — ${(g.v || []).length} swaps in the last 10 blocks` : 'NO — ' + g.why}`);
  if (f.ok || g.ok) anyGood++;
  console.log('');
}

console.log('='.repeat(64));
if (!anyGood) {
  console.log('NO endpoint can read swap logs. Sessions will fall back to explorer\nprices, which do not move. Add a working RPC before running.');
} else {
  console.log(`${anyGood} of ${list.length} endpoint(s) can serve the live price feed.`);
  console.log('A session uses them in the order above and moves down the list\nautomatically when one runs out of quota.');
}
if (list.length < 2) console.log('\nOnly one endpoint configured. Add more in config.txt:\n  RPC_URLS=https://your-second-provider,https://your-third');
console.log('');
