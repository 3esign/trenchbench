// ============================================================
//  BENCHHOOD — live prices from Uniswap v4 swap logs
//
//  A pool tells you a RATIO, not a price. GME/USDG says "how much USDG per
//  GME"; that is only dollars because USDG is a dollar. So every price here
//  is anchored: USDG = $1, and tokenized stocks = their Chainlink feed.
//  Anything that cannot be anchored is reported as unpriced rather than
//  guessed at — a wrong price is worse than a missing one.
//
//  Decimals are read from the token contracts themselves. The explorer's
//  list only covers 50 tokens and silently omits the rest, which is how you
//  end up with a price of 1.7e17.
// ============================================================
import { keccak256 } from './keccak.mjs';

export const SWAP_TOPIC = keccak256('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)');
export const TRANSFER_TOPIC = keccak256('Transfer(address,address,uint256)');
const SEL_DECIMALS = '0x313ce567';
const SEL_SYMBOL = '0x95d89b41';
const Q96 = 2 ** 96;

// `rpc` is either a plain URL string (one provider, no failover) or an RpcPool
// (several providers, automatic failover when one runs out of quota). Every
// call site passes it through unchanged, so the pool is opt-in per session.
export async function rpcCall(rpc, method, params) {
  if (rpc && typeof rpc.call === 'function') return rpc.call(method, params);
  const r = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}

async function rpcBatch(rpc, reqs) {
  if (!reqs.length) return [];
  if (rpc && typeof rpc.batch === 'function') return rpc.batch(reqs);
  const r = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqs.map((q, i) => ({ jsonrpc: '2.0', id: i, ...q }))) });
  if (!r.ok) throw new Error('rpc HTTP ' + r.status);
  const j = await r.json();
  const out = new Array(reqs.length).fill(null);
  for (const row of (Array.isArray(j) ? j : [j])) if (row && typeof row.id === 'number') out[row.id] = row.error ? null : row.result;
  return out;
}

// Read decimals() straight off each token. Never guess.
// A token whose decimals() call did not answer is left ABSENT from the cache,
// not filled in with 18. An unanswered read and a confirmed 18 are different
// facts, and pricing code must be able to tell them apart — see the CASHCAT
// incident: decimals defaulted to 18 on a 6-decimal token, the WETH hop came
// out 10^12 too small, an agent bought 2.1bn units for 20 cents, and the
// correction later marked the bag at $109m.
export async function readDecimals(rpcUrl, addrs, cache = {}) {
  const need = [...new Set(addrs.map(a => String(a).toLowerCase()))].filter(a => cache[a] == null);
  for (let i = 0; i < need.length; i += 60) {
    const slice = need.slice(i, i + 60);
    let res;
    try { res = await rpcBatch(rpcUrl, slice.map(a => ({ method: 'eth_call', params: [{ to: a, data: SEL_DECIMALS }, 'latest'] }))); }
    catch { continue; }                      // leave them unknown; a later pass retries
    slice.forEach((a, k) => {
      const h = res[k];
      if (!h || h === '0x') return;          // no answer -> stays unknown, stays unpriced
      let d; try { d = Number(BigInt(h)); } catch { return; }
      if (Number.isInteger(d) && d >= 0 && d <= 36) cache[a] = d;
    });
  }
  return cache;
}

// token1 per token0, with decimals applied
export function ratioFromSqrt(sqrtX96, dec0, dec1) {
  const r = Number(sqrtX96) / Q96;
  const p = r * r * Math.pow(10, dec0 - dec1);
  return isFinite(p) && p > 0 ? p : null;
}

// Pull sqrtPriceX96 out of a Swap log (data words: amount0, amount1, sqrtPriceX96, ...)
export const sqrtFromLog = log => BigInt('0x' + log.data.slice(2 + 2 * 64, 2 + 3 * 64));

// int128 amounts live in 256-bit words, sign-extended
const toInt = w => { let v = BigInt('0x' + w); if (v >= (1n << 255n)) v -= (1n << 256n); return v; };
const abs = v => v < 0n ? -v : v;
export const amountsFromLog = log => ({ a0: toInt(log.data.slice(2, 66)), a1: toInt(log.data.slice(66, 130)) });

// Identify a pool's two tokens from ANY swap, including one leg of a multi-hop
// route. The Swap log states exactly how much of each side moved, so we look
// for the Transfer logs carrying those precise amounts — the tokens they belong
// to are currency0 and currency1. Reading the receipt's token list instead only
// works for single-hop trades, and most trades here are not.
export async function pairFromSwapLog(rpcUrl, swapLog) {
  const rec = await rpcCall(rpcUrl, 'eth_getTransactionReceipt', [swapLog.transactionHash]);
  if (!rec || !rec.logs) return null;
  const { a0, a1 } = amountsFromLog(swapLog);
  const v0 = abs(a0), v1 = abs(a1);
  if (v0 === 0n || v1 === 0n) return null;
  const transfers = rec.logs.filter(l => l.topics && l.topics[0] === TRANSFER_TOPIC && l.data && l.data.length >= 66);
  const find = want => {
    for (const t of transfers) { try { if (BigInt(t.data.slice(0, 66)) === want) return t.address.toLowerCase(); } catch {} }
    return null;
  };
  const t0 = find(v0), t1 = find(v1);
  if (!t0 || !t1 || t0 === t1) return null;
  return t0 < t1 ? { c0: t0, c1: t1, matched: 'amounts' } : { c0: t1, c1: t0, matched: 'amounts' };
}

// Fallback: a single-hop receipt touches exactly two tokens.
export async function pairFromSwapTx(rpcUrl, txHash) {
  const rec = await rpcCall(rpcUrl, 'eth_getTransactionReceipt', [txHash]);
  if (!rec || !rec.logs) return null;
  const toks = [...new Set(rec.logs.filter(l => l.topics && l.topics[0] === TRANSFER_TOPIC).map(l => l.address.toLowerCase()))];
  if (toks.length !== 2) return null;
  toks.sort();
  return { c0: toks[0], c1: toks[1], matched: 'single-hop' };
}

// Turn pool ratios into dollars, using whatever we can anchor.
//   anchors: { "0xaddr": usdPrice }  — USDG = 1, stock tokens = Chainlink
// Returns { "0xaddr": {usd, via, pool} } for every token we could price.
// Absurd numbers mean a bad pair or bad decimals, not a real price.
const SANE = v => v > 1e-14 && v < 1e7 && isFinite(v);

// Anchoring HOPS. Start from stables and Chainlink; each pass prices whatever
// sits next to something already priced. USDG prices WETH, then WETH prices
// every memecoin paired against it. Repeats until nothing new appears.
export function priceFromPools(pools, decs, anchors, passes = 4) {
  let known = { ...anchors }, out = {};
  for (let pass = 0; pass < passes; pass++) {
    const found = onePass(pools, decs, known);
    let added = 0;
    for (const [addr, v] of Object.entries(found)) {
      if (known[addr] != null && anchors[addr] != null) continue;      // never overwrite a hard anchor
      if (!out[addr] || (v.swaps || 0) > (out[addr].swaps || 0)) { out[addr] = { ...v, hops: pass + 1 }; known[addr] = v.usd; added++; }
    }
    if (!added) break;
  }
  return out;
}

function onePass(pools, decs, anchors) {
  const out = {};
  for (const [id, p] of Object.entries(pools)) {
    const { c0, c1, sqrt } = p;
    if (!c0 || !c1 || sqrt == null) continue;
    // Both sides must have CONFIRMED decimals. Guessing 18 here is how a price
    // lands 10^12 off: the number still looks sane, so every downstream guard
    // waves it through. No decimals, no price.
    if (decs[c0] == null || decs[c1] == null) continue;
    const ratio = ratioFromSqrt(sqrt, decs[c0], decs[c1]);   // c1 per c0
    if (!ratio) continue;
    const a0 = anchors[c0], a1 = anchors[c1];
    if (a1 != null && a0 == null) {
      const usd = ratio * a1;
      if (SANE(usd)) out[c0] = pickBetter(out[c0], { usd, via: c1, pool: id, swaps: p.n || 0 });
    } else if (a0 != null && a1 == null) {
      const usd = a0 / ratio;
      if (SANE(usd)) out[c1] = pickBetter(out[c1], { usd, via: c0, pool: id, swaps: p.n || 0 });
    }
  }
  return out;
}
// if a token trades against several anchors, trust the busiest pool
const pickBetter = (a, b) => (!a || (b.swaps || 0) > (a.swaps || 0)) ? b : a;
