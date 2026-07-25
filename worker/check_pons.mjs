// ============================================================
//  BENCHHOOD — what is actually happening on Pons
//
//  Answers, from the chain rather than from a blog post:
//    · is the Pons factory live, and which one
//    · how many tokens are launching per hour
//    · are the pools Uniswap V3 or V4        <- decides whether Benchhood
//    · how many have graduated                  can see them at all
//    · what a graduated token's price looks like
//
//    node worker/check_pons.mjs
// ============================================================
import fs from 'node:fs';
import { poolFromEnv } from './rpcpool.mjs';
import { keccak256 } from './keccak.mjs';

const ROOT = new URL('../', import.meta.url);
const ENV = {};
try { for (const l of fs.readFileSync(new URL('config.txt', ROOT), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) ENV[m[1]] = m[2].trim(); } } catch {}

const rpc = poolFromEnv(ENV, () => {});

// from docs.ponsfamily.com
const FACTORY_NEW = '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB';
const FACTORY_OLD = '0x0c37a24F5D23A486FA692d1500881d698B1F77a4';
const TOKEN_LAUNCHED = '0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a';

const V3_SWAP = keccak256('Swap(address,address,int256,int256,uint160,uint128,int24)');
const V4_SWAP = keccak256('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)');
const SEL = { token0: '0x0dfe1681', token1: '0xd21220a7', slot0: '0x3850c7bd', symbol: '0x95d89b41', decimals: '0x313ce567' };

const hex = n => '0x' + Math.max(0, n).toString(16);
const addrFromWord = w => '0x' + String(w || '').slice(-40);

async function call(to, data) { try { return await rpc.call('eth_call', [{ to, data }, 'latest']); } catch { return null; } }
async function str(to, sel) {
  const h = await call(to, sel); if (!h || h === '0x') return null;
  try { const b = h.slice(2); const len = parseInt(b.slice(64, 128), 16); return Buffer.from(b.slice(128, 128 + len * 2), 'hex').toString('utf8').replace(/\0/g, '') || null; }
  catch { return null; }
}

console.log('\nBENCHHOOD — Pons reconnaissance\n' + '='.repeat(64));
const head = Number(BigInt(await rpc.call('eth_blockNumber', [])));
console.log(`head block ${head}\n`);

// ---- 1. launches ---------------------------------------------------------
// free tiers cap getLogs at 10 blocks, so we sample windows rather than scan
async function sampleLaunches(factory, windows = 30) {
  let found = [], scanned = 0;
  for (let i = 0; i < windows; i++) {
    const hi = head - i * 10, lo = hi - 9;
    if (lo < 0) break;
    try {
      const got = await rpc.call('eth_getLogs', [{ address: factory, fromBlock: hex(lo), toBlock: hex(hi), topics: [TOKEN_LAUNCHED] }]);
      if (got && got.length) found.push(...got);
      scanned += 10;
    } catch (e) { return { err: String(e.message).slice(0, 70), found, scanned }; }
  }
  return { found, scanned };
}

for (const [name, f] of [['ACTIVE', FACTORY_NEW], ['LEGACY', FACTORY_OLD]]) {
  const code = await call(f, '0x');
  const r = await sampleLaunches(f);
  if (r.err) { console.log(`${name} factory ${f}\n   getLogs refused: ${r.err}\n`); continue; }
  const perHr = r.scanned ? (r.found.length / r.scanned) * 3600 : 0;   // ~1 block/sec
  console.log(`${name} factory ${f}`);
  console.log(`   ${r.found.length} TokenLaunched in the last ${r.scanned} blocks  ->  ~${perHr.toFixed(0)}/hour at 1 block/s`);
  if (name === 'ACTIVE') global.__launches = r.found;
  console.log('');
}

// ---- 2. V3 or V4? --------------------------------------------------------
const launches = global.__launches || [];
console.log('-'.repeat(64));
if (!launches.length) {
  console.log('No launches in the sampled window — try again, or widen the sample.');
} else {
  const lg = launches[launches.length - 1];
  console.log(`inspecting the most recent launch, block ${parseInt(lg.blockNumber, 16)}`);
  // candidate addresses out of the event: topics then data words
  const cands = [...(lg.topics || []).slice(1), ...(String(lg.data || '0x').slice(2).match(/.{64}/g) || [])]
    .map(addrFromWord).filter(a => /^0x[0-9a-f]{40}$/i.test(a) && !/^0x0{40}$/.test(a));
  let poolAddr = null, tokAddr = null;
  for (const a of [...new Set(cands)]) {
    const t0 = await call(a, SEL.token0);
    if (t0 && t0 !== '0x' && !/^0x0+$/.test(t0)) { poolAddr = a; continue; }   // answers token0() -> it is a V3 pool
    const sym = await str(a, SEL.symbol);
    if (sym && !tokAddr) tokAddr = a;
  }
  console.log(`   token   ${tokAddr || '(not identified)'}${tokAddr ? '  ' + (await str(tokAddr, SEL.symbol)) : ''}`);
  console.log(`   pool    ${poolAddr || '(not identified)'}`);

  if (poolAddr) {
    const t0 = addrFromWord(await call(poolAddr, SEL.token0));
    const t1 = addrFromWord(await call(poolAddr, SEL.token1));
    const s0 = await call(poolAddr, SEL.slot0);
    console.log(`   token0  ${t0}  ${await str(t0, SEL.symbol) || ''}`);
    console.log(`   token1  ${t1}  ${await str(t1, SEL.symbol) || ''}`);
    console.log(`   slot0   ${s0 ? 'answers -> this is a Uniswap V3 style pool contract' : 'no answer'}`);
    if (s0) {
      const sqrt = BigInt('0x' + s0.slice(2, 66));
      const d0 = Number(BigInt(await call(t0, SEL.decimals) || '0x12'));
      const d1 = Number(BigInt(await call(t1, SEL.decimals) || '0x12'));
      const r = Number(sqrt) / 2 ** 96;
      console.log(`   sqrtPriceX96 -> ratio ${(r * r * Math.pow(10, d0 - d1)).toPrecision(6)} (token1 per token0, decimals applied)`);
    }
    // which Swap event does this pool actually emit?
    try {
      const v3 = await rpc.call('eth_getLogs', [{ address: poolAddr, fromBlock: hex(head - 200), toBlock: hex(head), topics: [V3_SWAP] }]);
      console.log(`   V3 Swap logs in last 200 blocks: ${(v3 || []).length}`);
    } catch (e) { console.log('   V3 log query refused: ' + String(e.message).slice(0, 50)); }
  }
}

console.log('\n' + '='.repeat(64));
console.log('WHAT THIS MEANS');
console.log(`  Benchhood reads only  ${V4_SWAP}`);
console.log(`  (Uniswap V4 singleton). Pons pools emit`);
console.log(`                        ${V3_SWAP}`);
console.log('  (Uniswap V3, one contract per pool). If the pool above answered');
console.log('  slot0() and emitted V3 Swap logs, then Benchhood cannot see any');
console.log('  Pons token today, and a V3 reader is needed.');
console.log('\n' + rpc.report() + '\n');
