// ============================================================
//  BENCHHOOD — is there a live, tradeable market on this chain?
//  Reads Uniswap v4 Swap and Initialize logs straight from the
//  PoolManager over your Alchemy RPC. Free, read-only, changes nothing.
// ============================================================
import fs from 'node:fs';
import { keccak256 } from './keccak.mjs';
import { readDecimals, ratioFromSqrt, priceFromPools, pairFromSwapTx, pairFromSwapLog } from './pools.mjs';
import { readChainlink } from './prices.mjs';

const ROOT = new URL('..', import.meta.url);
const ENV = {};
try { for (const l of fs.readFileSync(new URL('config.txt', ROOT), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) ENV[m[1]] = m[2].trim(); } } catch {}
const RPC = ENV.ALCHEMY_RPC_URL || '';
const POOL_MANAGER = (ENV.POOL_MANAGER || '0x8366a39CC670B4001A1121B8F6A443A643e40951');
// Alchemy's free tier caps eth_getLogs at a 10-BLOCK range, so wide scans are
// impossible. That is fine — a live price does not need history, only the most
// recent swap. Small recent window here; the runner will use a filter, which
// has no range limit at all.
const LOOKBACK = +(ENV.POOL_LOOKBACK_BLOCKS || 400);
const CHUNK = +(ENV.POOL_LOG_CHUNK || 10);
const WATCH_SECONDS = +(ENV.POOL_WATCH_SECONDS || 30);

const SWAP_SIG = 'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)';
const INIT_SIG = 'Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)';
const SWAP_T = keccak256(SWAP_SIG), INIT_T = keccak256(INIT_SIG);

const line = () => console.log('  ' + '-'.repeat(72));
const addrOf = topic => '0x' + topic.slice(26);
const wordAt = (data, i) => data.slice(2 + i * 64, 2 + (i + 1) * 64);

async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j.result;
}
const hex = n => '0x' + n.toString(16);

async function getLogsChunked(topic0, fromBlock, toBlock, label) {
  const out = [];
  let hits = 0, tried = 0;
  for (let end = toBlock; end > fromBlock; end -= CHUNK) {
    const start = Math.max(fromBlock, end - CHUNK + 1);
    tried++;
    try {
      const logs = await rpc('eth_getLogs', [{ address: POOL_MANAGER, topics: [topic0], fromBlock: hex(start), toBlock: hex(end) }]);
      out.push(...logs); hits += logs.length;
    } catch (e) {
      if (!getLogsChunked._warned) { console.log(`\n    eth_getLogs unavailable here: ${String(e.message).slice(0, 110)}`); console.log('    (falling through to the live filter, which has no range limit)'); getLogsChunked._warned = true; }
      if (tried > 3) break;   // no point hammering a method the plan will not serve
    }
    if (out.length > 400) break;
    process.stdout.write(`\r    ${label}: scanned ${tried} chunk(s), ${hits} event(s)   `);
  }
  process.stdout.write('\n');
  return out;
}

console.log('\n============================================================');
console.log(' BENCHHOOD — Uniswap v4 pool activity on Robinhood Chain');
console.log('============================================================\n');
if (!RPC) { console.log(' No ALCHEMY_RPC_URL in config.txt. Nothing to do.\n'); process.exit(1); }

console.log('[0] Event topics (computed, not guessed)');
console.log('    Swap       ' + SWAP_T);
console.log('    Initialize ' + INIT_T);
console.log('    PoolManager ' + POOL_MANAGER);
line();

const head = Number(BigInt(await rpc('eth_blockNumber', [])));
const from = Math.max(0, head - LOOKBACK);
console.log(`\n[1] Scanning the last ${LOOKBACK} blocks (${Math.round(LOOKBACK / 10)}s of chain time) in ${CHUNK}-block steps\n`);

const swaps = await getLogsChunked(SWAP_T, from, head, 'swaps');
if (!swaps.length) {
  console.log('\n    No swaps in that short window — trying a live filter instead.\n');
}

// ---------- the approach the runner will actually use ----------
// eth_newFilter + eth_getFilterChanges streams new logs as they land and is
// NOT subject to the 10-block range cap. One filter, polled every few seconds.
console.log(`[1b] Live filter — watching for ${WATCH_SECONDS}s\n`);
let live = [];
try {
  const fid = await rpc('eth_newFilter', [{ address: POOL_MANAGER, topics: [SWAP_T] }]);
  console.log('    filter created: ' + fid);
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < WATCH_SECONDS) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const fresh = await rpc('eth_getFilterChanges', [fid]);
      if (fresh && fresh.length) live.push(...fresh);
      process.stdout.write(`\r    ${Math.round((Date.now() - t0) / 1000)}s — ${live.length} swap(s) seen live   `);
    } catch (e) { console.log('\n    filter poll failed: ' + String(e.message).slice(0, 90)); break; }
  }
  process.stdout.write('\n');
  try { await rpc('eth_uninstallFilter', [fid]); } catch {}
} catch (e) {
  console.log('    eth_newFilter not available: ' + String(e.message).slice(0, 120));
}
if (live.length) { console.log(`    live filter works — ${live.length} swaps in ${WATCH_SECONDS}s (${(live.length / WATCH_SECONDS * 60).toFixed(1)}/min)`); swaps.push(...live); }
else if (!swaps.length) {
  console.log('\n    Nothing from the filter either.');
  console.log('    Either this PoolManager is not where trading happens, or the chain');
  console.log('    is quiet right now. Next step would be checking the explorer for the');
  console.log('    busiest contracts by transaction count.\n');
  process.exit(0);
}
line();

// poolId -> most recent swap
const byPool = {};
for (const lg of swaps) {
  const id = lg.topics[1];
  const bn = Number(BigInt(lg.blockNumber));
  const cur = byPool[id];
  if (!cur || bn > cur.block) byPool[id] = { block: bn, sqrt: BigInt('0x' + wordAt(lg.data, 2)), n: (cur ? cur.n : 0) + 1 };
  else cur.n++;
}
const pools = Object.entries(byPool).sort((a, b) => b[1].n - a[1].n);
console.log(`\n    ${swaps.length} swaps across ${pools.length} distinct pools`);
if (live.length) console.log(`    live rate: ${(live.length / WATCH_SECONDS * 60).toFixed(1)} swaps per minute chain-wide`);
line();

console.log('\n[2] Matching the busiest pools to their token pairs...\n');

// The Initialize event is usually far in the past, and a 10-block getLogs cap
// makes hunting for it hopeless. Much simpler route: a swap's own transaction
// receipt contains the ERC-20 Transfer logs for BOTH sides of the trade. Fetch
// one receipt per pool and the pair falls out. One call each, then cached.
const TRANSFER_T = keccak256('Transfer(address,address,uint256)');
const logsOf = {};
for (const lg of swaps) { const id = lg.topics && lg.topics[1]; if (!id) continue; (logsOf[id] = logsOf[id] || []); if (logsOf[id].length < 4) logsOf[id].push(lg); }

// token names/decimals from the explorer
let names = {};
try {
  const r = await fetch((ENV.EXPLORER_API || 'https://robinhoodchain.blockscout.com/api/v2').replace(/\/$/, '') + '/tokens?type=ERC-20');
  const j = await r.json();
  for (const t of (j.items || [])) {
    const a = String((t.address && (t.address.hash || t.address)) || t.address_hash || '').toLowerCase();
    if (a) names[a] = { sym: (t.symbol || '').trim(), name: t.name || '', dec: +t.decimals || 18 };
  }
} catch {}
const nm = a => { const k = String(a).toLowerCase(); return (names[k] && names[k].sym) || (a.slice(0, 8) + '…'); };
const isRH = a => /robinhood token/i.test(((names[String(a).toLowerCase()] || {}).name) || '');

const TOP = Math.min(+(ENV.POOL_RESOLVE_TOP || 40), pools.length);
const pairOf = {};
process.stdout.write(`    resolving ${TOP} busiest pools from their swap receipts`);
let unresolved = 0, byAmount = 0;
for (const [id] of pools.slice(0, TOP)) {
  const cands = logsOf[id] || [];
  let got = null;
  for (const lg of cands) {
    try { got = await pairFromSwapLog(RPC, lg); } catch { got = null; }   // works inside multi-hop routes
    if (got) break;
    try { got = await pairFromSwapTx(RPC, lg.transactionHash); } catch { got = null; }
    if (got) break;
  }
  if (got) { pairOf[id] = got; if (got.matched === 'amounts') byAmount++; process.stdout.write('.'); }
  else { unresolved++; process.stdout.write('x'); }
}
process.stdout.write('\n');
console.log(`    ${Object.keys(pairOf).length}/${TOP} resolved (${byAmount} by matching swap amounts inside multi-hop routes)${unresolved ? `, ${unresolved} could not be matched` : ''}`);
console.log('');

// ---- decimals straight from the token contracts, never guessed ----
const allToks = [...new Set(Object.values(pairOf).flatMap(p => [p.c0, p.c1]))];
process.stdout.write(`    reading decimals() for ${allToks.length} tokens...`);
let decs = {};
try { decs = await readDecimals(RPC, allToks); process.stdout.write(' done\n'); }
catch (e) { process.stdout.write(' failed: ' + e.message + '\n'); }

// ---- anchors: USDG is a dollar, tokenized stocks come from Chainlink ----
const bySym = {};
for (const [a, v] of Object.entries(names)) if (v.sym) (bySym[v.sym] = bySym[v.sym] || []).push(a);
let FEEDS = {}; try { FEEDS = JSON.parse(fs.readFileSync(new URL('worker/feeds.json', ROOT), 'utf8')); } catch {}
let feedPx = {}; try { feedPx = await readChainlink(RPC, FEEDS); } catch {}
const anchors = {};
for (const st of ['USDG', 'USDC', 'USDT', 'USDE']) for (const a of (bySym[st] || [])) anchors[a] = 1;
for (const [sym, v] of Object.entries(feedPx)) for (const a of (bySym[sym] || [])) anchors[a] = v.price;
console.log(`    anchors: ${Object.keys(anchors).length} tokens with a known USD value (stables + ${Object.keys(feedPx).length} Chainlink feeds)\n`);

const poolsForPricing = {};
for (const [id, v] of pools.slice(0, TOP)) { const p = pairOf[id]; if (p) poolsForPricing[id] = { ...p, sqrt: v.sqrt, n: v.n }; }
const usd = priceFromPools(poolsForPricing, decs, anchors);

console.log('    ' + 'SWAPS'.padStart(6) + '  ' + 'PAIR'.padEnd(22) + 'RATIO (t1/t0)'.padStart(14) + '  ' + 'USD PRICE'.padEnd(26) + 'KIND');
let known = 0, stockPaired = 0, priced = 0;
for (const [id, v] of pools.slice(0, TOP)) {
  const p = pairOf[id];
  if (!p) { console.log('    ' + String(v.n).padStart(6) + '  ' + '(unresolved)'); continue; }
  known++;
  const ratio = ratioFromSqrt(v.sqrt, decs[p.c0] ?? 18, decs[p.c1] ?? 18);
  const rh0 = isRH(p.c0), rh1 = isRH(p.c1);
  const kind = (rh0 || rh1) ? 'STOCK-PAIRED' : '';
  if (kind) stockPaired++;
  // which side did we manage to put a dollar value on?
  const hit = (usd[p.c0] && usd[p.c0].pool === id) ? { a: p.c0, v: usd[p.c0] } : (usd[p.c1] && usd[p.c1].pool === id) ? { a: p.c1, v: usd[p.c1] } : null;
  if (hit) priced++;
  const usdTxt = hit ? `${nm(hit.a)} $${hit.v.usd >= 1 ? hit.v.usd.toFixed(2) : hit.v.usd.toPrecision(3)}` : 'no anchor';
  const hopTxt = hit && hit.v.hops > 1 ? ` via ${nm(hit.v.via)}` : '';
  console.log('    ' + String(v.n).padStart(6) + '  ' + `${nm(p.c0)}/${nm(p.c1)}`.padEnd(22) + (ratio ? ratio.toPrecision(6) : '?').padStart(14) + '  ' + (usdTxt + hopTxt).padEnd(26) + kind);
}
console.log(`\n    ${priced} token(s) priced in dollars from these pools.`);

// cache what we learned so the runner does not repeat this
try {
  fs.writeFileSync(new URL('worker/pools_cache.json', ROOT), JSON.stringify({ updated: new Date().toISOString(), poolManager: POOL_MANAGER, pairs: pairOf }, null, 1));
  console.log(`\n    cached ${Object.keys(pairOf).length} pool pairs to worker/pools_cache.json`);
} catch (e) { console.log('    could not write cache: ' + e.message); }
line();

console.log('\n VERDICT\n');
console.log(`   The chain IS trading: ${swaps.length} swaps observed.`);
console.log(`   ${pools.length} pools active · ${known}/${TOP} busiest pools resolved to a token pair`);
if (stockPaired) console.log(`   ${stockPaired} of them are STOCK-PAIRED — a memecoin quoted in a tokenized stock.`);
console.log('');
console.log('   A pool gives a RATIO. It becomes a price only when one side is anchored:');
console.log('   USDG at a dollar, or a tokenized stock at its Chainlink value. Anything');
console.log('   unanchored is left unpriced rather than guessed.');
console.log('');
console.log('   Every Swap event carries sqrtPriceX96, so a live price per pool is');
console.log('   readable directly from these logs — no indexer, no paid API, and it');
console.log('   updates every block instead of every few hours.');
console.log('\n============================================================\n');
