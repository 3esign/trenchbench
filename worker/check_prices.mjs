// ============================================================
//  BENCHHOOD — compare every free price source, side by side.
//  Samples twice so you can see which sources actually MOVE.
//  Reads nothing but public data. Costs nothing. Changes nothing.
// ============================================================
import fs from 'node:fs';
import { readChainlink, chainHead, fmtAge } from './prices.mjs';

const ROOT = new URL('..', import.meta.url);
const ENV = {};
try { for (const l of fs.readFileSync(new URL('config.txt', ROOT), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) ENV[m[1]] = m[2].trim(); } } catch {}
const RPC = ENV.ALCHEMY_RPC_URL || '';
const EXPLORER = (ENV.EXPLORER_API || 'https://robinhoodchain.blockscout.com/api/v2').replace(/\/$/, '');
const WAIT = +(ENV.PRICE_CHECK_WAIT || 40);
let FEEDS = {};
try { FEEDS = JSON.parse(fs.readFileSync(new URL('worker/feeds.json', ROOT), 'utf8')); } catch (e) { console.log('could not read worker/feeds.json:', e.message); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const line = () => console.log('  ' + '-'.repeat(72));
const px = v => v == null ? '        -' : (v >= 1 ? '$' + v.toFixed(2) : '$' + (+v).toPrecision(4)).padStart(9);

console.log('\n============================================================');
console.log(' BENCHHOOD — where can we get prices that actually move?');
console.log('============================================================\n');

// ---------- 1. is the RPC alive ----------
console.log('[1] Alchemy RPC');
if (!RPC) { console.log('    no ALCHEMY_RPC_URL in config.txt — skipping the on-chain sources.\n'); }
else {
  const h1 = await chainHead(RPC);
  console.log('    ' + (h1 == null ? 'UNREACHABLE' : `connected · block ${h1}`));
  if (h1 != null) {
    await sleep(6000);
    const h2 = await chainHead(RPC);
    console.log(`    6s later: block ${h2} — ${h2 > h1 ? `chain is producing blocks (+${h2 - h1})` : 'no new blocks in 6s'}`);
  }
}
line();

async function explorerSnap() {
  try {
    const r = await fetch(`${EXPLORER}/tokens?type=ERC-20`);
    if (!r.ok) return null;
    const j = await r.json(); const items = j.items || j.data || [];
    const m = {};
    for (const t of items) { const s = (t.symbol || '').trim(); if (s && t.exchange_rate) m[s] = +t.exchange_rate; }
    return m;
  } catch { return null; }
}

// ---------- 2. first sample from both sources ----------
console.log('\n[2] Sampling both sources...');
const [cl1, ex1] = await Promise.all([
  RPC ? readChainlink(RPC, FEEDS).catch(e => { console.log('    chainlink error: ' + e.message); return {}; }) : {},
  explorerSnap()
]);
const nFeeds = Object.keys(FEEDS).filter(k => !k.startsWith('_')).length;
console.log(`    Chainlink: ${Object.keys(cl1).length}/${nFeeds} configured feeds answered`);
console.log(`    Explorer : ${ex1 ? Object.keys(ex1).length : 0} tokens with a price`);

console.log(`\n    waiting ${WAIT}s to see what moves...`);
await sleep(WAIT * 1000);
const [cl2, ex2] = await Promise.all([
  RPC ? readChainlink(RPC, FEEDS).catch(() => ({})) : {},
  explorerSnap()
]);
line();

// ---------- 3. side by side ----------
console.log('\n[3] Same token, both sources\n');
console.log('    ' + 'TOKEN'.padEnd(8) + 'CHAINLINK'.padStart(10) + '  ' + 'last update'.padEnd(13) + 'EXPLORER'.padStart(10) + '  ' + 'moved?');
const syms = [...new Set([...Object.keys(cl1), ...Object.keys(FEEDS).filter(k => !k.startsWith('_'))])].sort();
let clMoved = 0, exMoved = 0;
for (const s of syms) {
  const a = cl1[s], b = cl2[s], e1 = ex1 && ex1[s], e2 = ex2 && ex2[s];
  const cm = a && b && a.price !== b.price, em = e1 != null && e2 != null && e1 !== e2;
  if (cm) clMoved++; if (em) exMoved++;
  const drift = (a && e1) ? ` (${(((e1 / a.price) - 1) * 100).toFixed(1)}% apart)` : '';
  console.log('    ' + s.padEnd(8) + px(a && a.price) + '  ' + (a ? fmtAge(a.ageSec).padEnd(13) : '-'.padEnd(13)) + px(e1) + '  ' + (cm ? 'chainlink' : em ? 'explorer' : 'neither') + drift);
}
if (ex1) {
  const extra = Object.keys(ex1).filter(s => !cl1[s]);
  let m = 0; for (const s of extra) if (ex2 && ex2[s] != null && ex2[s] !== ex1[s]) m++;
  console.log(`\n    plus ${extra.length} tokens with no Chainlink feed (memecoins etc): ${m} of them moved in ${WAIT}s`);
}
line();

// ---------- 4. what to do ----------
console.log('\n VERDICT\n');
const anyFeed = Object.keys(cl1).length > 0;
if (!anyFeed && RPC) console.log('   No Chainlink feed answered. Check the addresses in worker/feeds.json.');
if (anyFeed) {
  const ages = Object.values(cl1).map(v => v.ageSec).filter(v => v != null).sort((a, b) => a - b);
  const med = ages.length ? ages[Math.floor(ages.length / 2)] : null;
  console.log(`   Chainlink feeds are readable. Median last-update: ${fmtAge(med)}.`);
  if (med != null && med > 3600) {
    console.log('   They are holding their last price — this is what 24/5 feeds do when US');
    console.log('   equity markets are shut. They will start moving again when the market');
    console.log('   reopens; nothing here needs fixing.');
  } else {
    console.log('   The market is open and these are ticking. Use them as the primary source.');
  }
}
console.log(`   In this ${WAIT}s window: chainlink moved ${clMoved}, explorer moved ${exMoved}.`);
console.log('\n   Order to use: Chainlink first (canonical, free), explorer only as fallback');
console.log('   for tokens with no feed. For memecoins that trade around the clock the');
console.log('   next step is reading Uniswap v4 pool state over the same RPC.');
console.log('\n============================================================\n');
