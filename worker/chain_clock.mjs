// ============================================================
//  BENCHHOOD — how fast does this chain actually tick?
//
//  Every "per hour" and "per day" number produced so far assumed 1 block per
//  second. That assumption came from me, not from the chain, and if it is
//  wrong then every launch rate, graduation age and daily volume is wrong by
//  the same factor.
//
//  This asks the chain directly: two block timestamps, one subtraction.
//  Then it recomputes the Pons figures and tells you how big a full historical
//  backfill would be.
//
//    node worker/chain_clock.mjs
// ============================================================
import fs from 'node:fs';
import { poolFromEnv } from './rpcpool.mjs';

const ROOT = new URL('../', import.meta.url);
const ENV = {};
try { for (const l of fs.readFileSync(new URL('config.txt', ROOT), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) ENV[m[1]] = m[2].trim(); } } catch {}
const rpc = poolFromEnv(ENV, () => {});

const hex = n => '0x' + Math.max(0, Math.floor(n)).toString(16);
const FACTORY_NEW_BLOCK = 8991118;      // from docs.ponsfamily.com
const FACTORY_OLD_BLOCK = 8600612;

async function ts(block) {
  const b = await rpc.call('eth_getBlockByNumber', [hex(block), false]);
  return b ? { n: Number(BigInt(b.number)), t: Number(BigInt(b.timestamp)) } : null;
}

console.log('\nBENCHHOOD — chain clock\n' + '='.repeat(60));
const head = Number(BigInt(await rpc.call('eth_blockNumber', [])));

// three spans, so a single odd interval cannot mislead us
const spans = [1000, 20000, 400000];
const rates = [];
for (const s of spans) {
  const a = await ts(head - s), b = await ts(head);
  if (!a || !b || b.t <= a.t) { console.log(`  span ${s}: no timestamp available`); continue; }
  const bps = (b.n - a.n) / (b.t - a.t);
  rates.push(bps);
  console.log(`  over the last ${String(s).padStart(6)} blocks: ${bps.toFixed(2)} blocks/sec  (${(1 / bps).toFixed(3)}s per block)`);
}
if (!rates.length) { console.log('\nCould not read block timestamps. Nothing else here is computable.\n'); process.exit(1); }

const BPS = rates[rates.length - 1];            // the longest span is the most stable
const perHour = BPS * 3600;
console.log(`\n  USE THIS: ${BPS.toFixed(2)} blocks/sec  ->  ${Math.round(perHour).toLocaleString()} blocks/hour`);
console.log(`  (the Pons scripts assumed 1.00 — they were out by ${BPS.toFixed(1)}x)\n`);

// ---- recompute the Pons numbers on the real clock -------------------------
console.log('='.repeat(60));
console.log('YOUR PONS SCAN, RECOMPUTED\n');
const SCANNED_BLOCKS = 86400;                   // what pons_rate.mjs actually covered
const LAUNCHES = 684, GATE = 17, GRADS = 5;
const realHours = SCANNED_BLOCKS / perHour;
console.log(`  it scanned ${SCANNED_BLOCKS.toLocaleString()} blocks = ${realHours.toFixed(1)} hours (not 24)`);
console.log(`  launches:            ${(LAUNCHES / realHours).toFixed(0)}/hour   ${(LAUNCHES / realHours * 24).toFixed(0)}/day`);
console.log(`  past the 0.25 gate:  ${(GATE / realHours).toFixed(1)}/hour   ${(GATE / realHours * 24).toFixed(0)}/day`);
console.log(`  graduating:          ${(GRADS / realHours).toFixed(1)}/hour   ${(GRADS / realHours * 24).toFixed(0)}/day`);
console.log(`\n  time to 30 positive examples: ${(30 / (GRADS / realHours * 24)).toFixed(1)} days`);
console.log('  (rates are unchanged — 29.4% at the gate. Only the VOLUME moves.)\n');

// ---- how big is a full backfill? -----------------------------------------
console.log('='.repeat(60));
console.log('BACKFILL — the dataset that already exists\n');
for (const [name, b0] of [['active factory', FACTORY_NEW_BLOCK], ['legacy factory', FACTORY_OLD_BLOCK]]) {
  const span = head - b0;
  const days = span / perHour / 24;
  console.log(`  ${name}: block ${b0.toLocaleString()} -> ${head.toLocaleString()}`);
  console.log(`     ${span.toLocaleString()} blocks = ${days.toFixed(1)} days of history`);
  console.log(`     at a 10,000-block window: ${Math.ceil(span / 10000).toLocaleString()} getLogs calls`);
  console.log(`     estimated launches in that history: ~${Math.round(LAUNCHES / SCANNED_BLOCKS * span).toLocaleString()}`);
  console.log(`     estimated already-resolved graduates: ~${Math.round(GRADS / SCANNED_BLOCKS * span).toLocaleString()}\n`);
}
console.log('  Every one of those outcomes is already settled and readable from');
console.log('  logs alone — no archive node needed. That is the dataset, and it');
console.log('  exists today rather than in six weeks.\n');
console.log(rpc.report() + '\n');
