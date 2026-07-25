// ============================================================
//  BENCHHOOD — does the Pons idea survive contact with the data?
//
//  ONE question: of the tokens launched on Pons, what fraction reach the
//  4.2 ETH graduation threshold, and how long does it take?
//
//  That number decides everything. A benchmark that asks a model "will this
//  launch make it?" is only meaningful if the answer is sometimes yes. If 1%
//  graduate, a model that always says "no" scores 99% and has learned nothing,
//  and the whole idea is dead on arrival.
//
//  Read-only. Nothing is written anywhere.
//
//    node worker/pons_rate.mjs            (defaults: look back ~24h)
//    node worker/pons_rate.mjs 72         (look back 72h)
// ============================================================
import fs from 'node:fs';
import { poolFromEnv } from './rpcpool.mjs';
import { keccak256 } from './keccak.mjs';

const ROOT = new URL('../', import.meta.url);
const ENV = {};
try { for (const l of fs.readFileSync(new URL('config.txt', ROOT), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) ENV[m[1]] = m[2].trim(); } } catch {}
const rpc = poolFromEnv(ENV, m => console.log(m));

const FACTORY = ENV.PONS_FACTORY || '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const TOKEN_LAUNCHED = '0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a';
const GRAD_ETH = +(ENV.PONS_GRADUATION_ETH || 4.2);

const SEL_TOKEN0 = '0x0dfe1681', SEL_SYMBOL = '0x95d89b41', SEL_BALANCEOF = '0x70a08231';
const SEL_GRADSTATUS = keccak256('graduationStatus(address)').slice(0, 10);

const HOURS = +(process.argv[2] || 24);
const BLOCKS_PER_SEC = +(ENV.PONS_BLOCKS_PER_SEC || 1);

const hex = n => '0x' + Math.max(0, Math.floor(n)).toString(16);
const addrOf = w => '0x' + String(w || '').slice(-40).toLowerCase();
const pad = a => '0'.repeat(24) + String(a).replace(/^0x/, '').toLowerCase();
const bar = (v, mx, w = 24) => '█'.repeat(Math.round((v / (mx || 1)) * w)).padEnd(w, '·');

async function ecall(to, data) { try { const r = await rpc.call('eth_call', [{ to, data }, 'latest']); return (r && r !== '0x') ? r : null; } catch { return null; } }
async function symbolOf(a) {
  const h = await ecall(a, SEL_SYMBOL); if (!h) return null;
  try { const b = h.slice(2); if (b.length <= 64) return null;
    const len = parseInt(b.slice(64, 128), 16); if (!len || len > 64) return null;
    return Buffer.from(b.slice(128, 128 + len * 2), 'hex').toString('utf8').replace(/[^\x20-\x7e]/g, '') || null; } catch { return null; }
}

// ---------- how big a getLogs range will each endpoint actually allow? -------
// Free tiers differ wildly and it is the single thing that decides whether this
// scan takes 30 seconds or 30 minutes. Measure it instead of assuming 10.
async function maxRange(head) {
  for (const span of [10000, 5000, 2000, 1000, 500, 200, 100, 50, 10]) {
    try {
      await rpc.call('eth_getLogs', [{ address: FACTORY, topics: [TOKEN_LAUNCHED], fromBlock: hex(head - span), toBlock: hex(head) }]);
      return span;
    } catch { /* too wide for every endpoint — try smaller */ }
  }
  return 10;
}

console.log('\nBENCHHOOD — Pons graduation rate\n' + '='.repeat(66));
const head = Number(BigInt(await rpc.call('eth_blockNumber', [])));
const span = Math.round(HOURS * 3600 * BLOCKS_PER_SEC);
const from = Math.max(0, head - span);

process.stdout.write('measuring the widest allowed log range... ');
const STEP = await maxRange(head);
console.log(`${STEP} blocks`);
const calls = Math.ceil(span / STEP);
console.log(`scanning blocks ${from}..${head}  (~${HOURS}h)  in ${calls} request(s)\n`);
if (calls > 900) { console.log(`  that is a lot of requests. Re-run with fewer hours, e.g.\n     node worker/pons_rate.mjs ${Math.max(1, Math.floor(HOURS * 900 / calls))}\n`); process.exit(1); }

// ---------- 1. every launch in the window ----------------------------------
const logs = [];
let done = 0;
for (let lo = from; lo <= head; lo += STEP) {
  const hi = Math.min(head, lo + STEP - 1);
  try { const got = await rpc.call('eth_getLogs', [{ address: FACTORY, topics: [TOKEN_LAUNCHED], fromBlock: hex(lo), toBlock: hex(hi) }]); if (got) logs.push(...got); }
  catch (e) { /* one bad window must not end the scan */ }
  if (++done % 25 === 0 || lo + STEP > head) process.stdout.write(`\r  ${done}/${calls} windows · ${logs.length} launches found   `);
}
console.log('\n');
if (!logs.length) { console.log('No launches in that window. Try a longer lookback.\n'); process.exit(0); }

// ---------- 2. learn the event layout ONCE, then apply it ------------------
// Probing every candidate address on every log would be hundreds of eth_calls.
// The event layout is fixed, so find which slot holds the pool once.
const slotsOf = lg => [...(lg.topics || []).slice(1), ...(String(lg.data || '0x').slice(2).match(/.{64}/g) || [])].map(addrOf);
let poolSlot = -1, tokenSlot = -1;
{
  const s = slotsOf(logs[logs.length - 1]);
  for (let i = 0; i < s.length; i++) {
    if (!/^0x[0-9a-f]{40}$/.test(s[i]) || /^0x0+$/.test(s[i])) continue;
    if (poolSlot < 0 && await ecall(s[i], SEL_TOKEN0)) { poolSlot = i; continue; }
    if (tokenSlot < 0 && s[i] !== WETH.toLowerCase() && await symbolOf(s[i])) tokenSlot = i;
  }
}
if (poolSlot < 0) { console.log('Could not locate the pool address in the TokenLaunched event.\nThe event layout may have changed — send me this output.\n'); process.exit(1); }

// ---------- 3. how much WETH sits in each pool now? ------------------------
// Docs: "a launch graduates once the WETH paired in its locked pool reaches
// the threshold", and trading stays in the same pool. So the pool's WETH
// balance IS the progress bar, and reading it now tells us the outcome.
console.log(`inspecting ${logs.length} launch(es)...\n`);
const rows = [];
for (const lg of logs) {
  const s = slotsOf(lg);
  const pool = s[poolSlot], token = tokenSlot >= 0 ? s[tokenSlot] : null;
  if (!/^0x[0-9a-f]{40}$/.test(pool)) continue;
  const balHex = await ecall(WETH, SEL_BALANCEOF + pad(pool));
  const weth = balHex ? Number(BigInt(balHex)) / 1e18 : 0;
  let graduated = weth >= GRAD_ETH;
  const st = await ecall(FACTORY, SEL_GRADSTATUS + pad(token || pool));   // if the view exists, prefer it
  if (st) { const v = BigInt(st); if (v === 1n || v === 2n) graduated = true; }
  rows.push({ blk: parseInt(lg.blockNumber, 16), token, pool, weth, graduated,
              sym: null, ageH: (head - parseInt(lg.blockNumber, 16)) / 3600 / BLOCKS_PER_SEC });
}
// symbols only for the interesting ones, to save calls
for (const r of rows.filter(x => x.graduated).concat(rows.filter(x => !x.graduated).sort((a, b) => b.weth - a.weth).slice(0, 5)))
  if (r.token) r.sym = await symbolOf(r.token);

// ---------- 4. the answer --------------------------------------------------
const n = rows.length, g = rows.filter(r => r.graduated).length;
const dead = rows.filter(r => r.weth < 0.01).length;
const rate = n ? g / n * 100 : 0;
const buckets = [[0, .01, 'no liquidity at all'], [.01, .25, 'under 0.25 ETH'], [.25, 1, '0.25 – 1 ETH'], [1, GRAD_ETH, `1 – ${GRAD_ETH} ETH`], [GRAD_ETH, 1e9, `GRADUATED (${GRAD_ETH}+ ETH)`]];
const mxB = Math.max(...buckets.map(([lo, hi]) => rows.filter(r => r.weth >= lo && r.weth < hi).length));

console.log('='.repeat(66));
console.log(`RESULT — ${n} launches over ~${HOURS}h  (~${(n / HOURS).toFixed(1)}/hour, ~${(n / HOURS * 24).toFixed(0)}/day)\n`);
for (const [lo, hi, label] of buckets) {
  const c = rows.filter(r => r.weth >= lo && r.weth < hi).length;
  console.log(`  ${label.padEnd(28)} ${String(c).padStart(4)}  ${bar(c, mxB)} ${(c / n * 100).toFixed(1)}%`);
}
console.log(`\n  graduation rate: ${g}/${n} = ${rate.toFixed(1)}%`);
console.log(`  never funded:    ${dead}/${n} = ${(dead / n * 100).toFixed(1)}%`);

const top = rows.filter(r => !r.graduated).sort((a, b) => b.weth - a.weth).slice(0, 5);
if (g) { console.log('\n  graduated:'); for (const r of rows.filter(r => r.graduated)) console.log(`    ${(r.sym || r.token || '').padEnd(12)} ${r.weth.toFixed(2)} ETH   launched ${r.ageH.toFixed(1)}h ago   ${r.pool}`); }
if (top.length) { console.log('\n  closest that did not:'); for (const r of top) console.log(`    ${(r.sym || r.token || '').padEnd(12)} ${r.weth.toFixed(3)} ETH   ${(r.weth / GRAD_ETH * 100).toFixed(0)}% of the way`); }

// ---------- 5. what it means ----------------------------------------------
console.log('\n' + '='.repeat(66));
console.log('IS A PREDICTION BENCHMARK VIABLE HERE?\n');
const perDay = n / HOURS * 24, posDay = perDay * rate / 100;
console.log(`  positive class ("graduates"):  ~${posDay.toFixed(1)} per day`);
console.log(`  always-say-no baseline scores: ${(100 - rate).toFixed(1)}% accuracy\n`);
if (n < 25) console.log('  ! Too few launches sampled to trust this. Re-run with more hours.');
else if (rate < 2) console.log(`  VERDICT: hostile. At ${rate.toFixed(1)}%, "no" is right ${(100 - rate).toFixed(0)}% of the time and\n  accuracy is meaningless. Only worth doing scored on calibration and\n  precision-at-k — "of your 10 most confident picks, how many graduated"\n  — never on raw accuracy.`);
else if (rate < 15) console.log(`  VERDICT: workable, carefully. ${rate.toFixed(1)}% is a real but rare event.\n  Score with precision/recall against the ${(100 - rate).toFixed(0)}% base rate, and expect\n  to need ~${Math.ceil(30 / (posDay || 1))} days to collect 30 positives.`);
else console.log(`  VERDICT: healthy. ${rate.toFixed(1)}% is a genuinely uncertain call, which is\n  exactly what makes a prediction worth scoring.`);
console.log('\n' + rpc.report() + '\n');
