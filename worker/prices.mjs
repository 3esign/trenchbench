// ============================================================
//  BENCHHOOD — price layer
//
//  Robinhood Chain publishes prices through Chainlink. Reading the feed
//  directly over the Alchemy RPC gives the same number the chain itself uses,
//  updated as the oracle updates, for free. The explorer's exchange_rate field
//  is a slow cache and stays flat for minutes at a time — it is the fallback,
//  not the source.
//
//  Everything here is plain JSON-RPC. No packages.
// ============================================================

// latestRoundData() -> (uint80 roundId, int256 answer, uint256 startedAt,
//                       uint256 updatedAt, uint80 answeredInRound)
const SEL_LATEST = '0xfeaf968c';
const SEL_DECIMALS = '0x313ce567';

const word = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
// int256 from a 32-byte word, two's complement
function toInt(w) {
  let v = BigInt('0x' + w);
  if (v >= (1n << 255n)) v -= (1n << 256n);
  return v;
}

export function decodeLatestRoundData(hex) {
  if (!hex || hex === '0x' || hex.length < 2 + 64 * 5) return null;
  const answer = toInt(word(hex, 1));
  const updatedAt = Number(BigInt('0x' + word(hex, 3)));
  return { answer, updatedAt };
}

async function rpcBatch(rpc, calls) {
  if (!calls.length) return [];
  const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }));
  // an RpcPool routes this across providers and fails over on quota
  if (rpc && typeof rpc.batch === 'function') return rpc.batch(body.map(b => ({ method: b.method, params: b.params })));
  const r = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('rpc HTTP ' + r.status);
  const j = await r.json();
  const out = new Array(calls.length).fill(null);
  for (const row of (Array.isArray(j) ? j : [j])) if (row && typeof row.id === 'number') out[row.id] = row.error ? null : row.result;
  return out;
}

// Read every configured feed. Returns { SYM: {price, updatedAt, ageSec} }.
export async function readChainlink(rpcUrl, feeds, nowSec = Math.floor(Date.now() / 1000)) {
  const syms = Object.keys(feeds).filter(s => !s.startsWith('_') && /^0x[0-9a-fA-F]{40}$/.test(feeds[s]));
  if (!rpcUrl || !syms.length) return {};
  const calls = [];
  for (const s of syms) { calls.push({ to: feeds[s], data: SEL_LATEST }); calls.push({ to: feeds[s], data: SEL_DECIMALS }); }
  const res = await rpcBatch(rpcUrl, calls);
  const out = {};
  syms.forEach((s, i) => {
    const rd = decodeLatestRoundData(res[i * 2]);
    if (!rd) return;
    const decHex = res[i * 2 + 1];
    const dec = decHex && decHex !== '0x' ? Number(BigInt(decHex)) : 8;
    const price = Number(rd.answer) / Math.pow(10, dec);
    if (!(price > 0)) return;
    out[s] = { price, updatedAt: rd.updatedAt, ageSec: rd.updatedAt ? nowSec - rd.updatedAt : null };
  });
  return out;
}

export async function chainHead(rpcUrl) {
  try {
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
    const j = await r.json();
    return j && j.result ? Number(BigInt(j.result)) : null;
  } catch { return null; }
}

export const fmtAge = s => s == null ? 'unknown'
  : s < 90 ? `${s}s ago`
  : s < 5400 ? `${Math.round(s / 60)}m ago`
  : s < 172800 ? `${Math.round(s / 3600)}h ago`
  : `${Math.round(s / 86400)}d ago`;
