// ============================================================
//  BENCHHOOD — the RPC pool
//
//  One provider is a single point of failure and a single quota. This spreads
//  every call across whatever endpoints you have, drops an endpoint the moment
//  it rate-limits, and brings it back after a cooldown.
//
//  Free endpoints that need NO key are built in, so the benchmark keeps running
//  even with no Alchemy key at all — slower, but running. A key, when present,
//  is preferred while it lasts.
//
//  It also counts calls per method, because "I hit the free tier" should be
//  answerable with a number rather than a guess.
// ============================================================

// No API key required. Rate-limited and explicitly "not recommended for
// production" by Robinhood, which is exactly right: they are the safety net,
// not the plan.
// Verified 2026-07-25 against the live chain:
//   rpc.mainnet.chain.robinhood.com  alive · eth_getLogs OK · NO eth_newFilter
//   robinhood.drpc.org               refuses this chain on the free plan
// dRPC is therefore not listed. Keeping a known-dead endpoint in the rotation
// costs a timeout on every failover for nothing.
export const PUBLIC_RPCS = [
  'https://rpc.mainnet.chain.robinhood.com',   // official public endpoint
];

const isQuota = msg => /429|rate.?limit|too many|quota|exceeded|capacity|throttl|402|403/i.test(String(msg || ''));

export class RpcPool {
  // urls: preferred first. Keyed endpoints should lead; public ones follow.
  constructor({ urls = [], log = () => {}, cooldownMs = 60000, timeoutMs = 15000 } = {}) {
    const seen = new Set();
    this.eps = [];
    for (const u of urls.filter(Boolean)) {
      const url = String(u).trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      this.eps.push({ url, coldUntil: 0, calls: 0, fails: 0, quota: 0, name: label(url) });
    }
    if (!this.eps.length) throw new Error('RpcPool needs at least one URL');
    this.i = 0;
    this.log = log;
    this.cooldownMs = cooldownMs;
    this.timeoutMs = timeoutMs;
    this.byMethod = {};
    this.total = 0;
  }

  get size() { return this.eps.length; }

  // Next endpoint that is not cooling down. If every one is cold we use the one
  // that recovers soonest rather than failing — a degraded price is still a
  // price, and a session that dies at 3am is not.
  _pick() {
    const now = Date.now();
    for (let k = 0; k < this.eps.length; k++) {
      const e = this.eps[(this.i + k) % this.eps.length];
      if (e.coldUntil <= now) { this.i = (this.i + k) % this.eps.length; return e; }
    }
    return this.eps.reduce((a, b) => (a.coldUntil <= b.coldUntil ? a : b));
  }
  pick() { return this._pick(); }
  isCold(e) { return !e || e.coldUntil > Date.now(); }
  endpoints() { return this.eps.slice(); }

  // Call ONE named endpoint with no failover.
  //
  // Filters are stateful and live inside a single provider: a filter id created
  // on Alchemy means nothing to Robinhood's public node, which does not even
  // implement eth_newFilter. Rotating a filter read to another host does not
  // error loudly — it returns an empty array, so prices simply stop moving and
  // nothing in the log says why. Anything filter-shaped must be pinned.
  async callOn(e, method, params) {
    this.total++;
    this.byMethod[method] = (this.byMethod[method] || 0) + 1;
    e.calls++;
    try {
      const j = await this._post(e, { jsonrpc: '2.0', id: 1, method, params });
      if (j && j.error) {
        const m = j.error.message || 'rpc error';
        if (isQuota(m)) this._cool(e, 'is out of quota');
        throw new Error(m);
      }
      return j.result;
    } catch (err) {
      e.fails++;
      if (isQuota(err.message)) this._cool(e, 'rate-limited');
      throw err;
    }
  }

  _cool(e, why) {
    e.coldUntil = Date.now() + this.cooldownMs;
    e.quota++;
    this.log(`  [rpc] ${e.name} ${why} — resting it ${Math.round(this.cooldownMs / 1000)}s, moving to the next endpoint`);
    this.i = (this.i + 1) % this.eps.length;
  }

  async _post(e, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const r = await fetch(e.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      if (r.status === 429 || r.status === 402 || r.status === 403) { const t = await r.text().catch(() => ''); throw new Error(`HTTP ${r.status} ${t.slice(0, 120)}`); }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(timer); }
  }

  // One JSON-RPC call, tried across every endpoint before giving up.
  async call(method, params) {
    this.total++;
    this.byMethod[method] = (this.byMethod[method] || 0) + 1;
    let last;
    for (let attempt = 0; attempt < this.eps.length + 1; attempt++) {
      const e = this._pick();
      e.calls++;
      try {
        const j = await this._post(e, { jsonrpc: '2.0', id: 1, method, params });
        if (j && j.error) {
          const m = j.error.message || 'rpc error';
          if (isQuota(m)) { this._cool(e, 'is out of quota'); last = new Error(m); continue; }
          throw new Error(m);                      // a real RPC error: the next endpoint says the same
        }
        return j.result;
      } catch (err) {
        last = err; e.fails++;
        if (isQuota(err.message)) { this._cool(e, 'rate-limited'); continue; }
        if (this.eps.length === 1) throw err;
        this.i = (this.i + 1) % this.eps.length;   // transport hiccup: just try another
      }
    }
    throw last || new Error('all RPC endpoints failed');
  }

  // A JSON-RPC batch. Same failover, and it degrades to sequential singles if an
  // endpoint refuses batching rather than losing the whole request.
  async batch(reqs) {
    if (!reqs.length) return [];
    this.total++;
    this.byMethod['(batch)'] = (this.byMethod['(batch)'] || 0) + 1;
    let last;
    for (let attempt = 0; attempt < this.eps.length + 1; attempt++) {
      const e = this._pick();
      e.calls++;
      try {
        const j = await this._post(e, reqs.map((q, i) => ({ jsonrpc: '2.0', id: i, ...q })));
        const out = new Array(reqs.length).fill(null);
        for (const row of (Array.isArray(j) ? j : [j])) if (row && typeof row.id === 'number') out[row.id] = row.error ? null : row.result;
        return out;
      } catch (err) {
        last = err; e.fails++;
        if (isQuota(err.message)) { this._cool(e, 'rate-limited'); continue; }
        this.i = (this.i + 1) % this.eps.length;
      }
    }
    throw last || new Error('all RPC endpoints failed on a batch');
  }

  // What actually got spent, so "I hit the free tier" has a number attached.
  report() {
    const top = Object.entries(this.byMethod).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([m, n]) => `${m} ${n}`).join(' · ');
    const eps = this.eps.map(e => `${e.name} ${e.calls}${e.quota ? ` (${e.quota}x limited)` : ''}${e.fails ? ` (${e.fails} failed)` : ''}`).join(' · ');
    return `  rpc: ${this.total} request(s) across ${this.eps.length} endpoint(s)\n       by method: ${top}\n       by endpoint: ${eps}`;
  }
}

function label(url) {
  try {
    const h = new URL(url).hostname;
    if (h.includes('alchemy')) return 'alchemy';
    if (h.includes('drpc')) return 'drpc';
    if (h.includes('robinhood')) return 'robinhood-public';
    if (h.includes('quicknode')) return 'quicknode';
    if (h.includes('chainstack')) return 'chainstack';
    if (h.includes('blockdaemon')) return 'blockdaemon';
    return h.split('.').slice(-2).join('.');
  } catch { return 'rpc'; }
}

// Build the pool from config. Keyed endpoints first (fast, generous), then the
// public ones as a floor. RPC_URLS accepts a comma-separated list so extra
// providers can be added without touching code.
export function poolFromEnv(ENV = {}, log = () => {}) {
  const extra = String(ENV.RPC_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  const usePublic = String(ENV.USE_PUBLIC_RPC || 'on').toLowerCase() !== 'off';
  const urls = [ENV.ALCHEMY_RPC_URL, ...extra, ...(usePublic ? PUBLIC_RPCS : [])].filter(Boolean);
  return new RpcPool({ urls, log });
}
