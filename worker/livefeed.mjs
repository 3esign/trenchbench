// ============================================================
//  BENCHHOOD — the live price feed
//
//  Prices come from Uniswap v4 swap logs: every trade on the chain stamps
//  sqrtPriceX96 into its Swap event, so the price is whatever the last trade
//  said, updated per block. ~1000 swaps a minute on Robinhood Chain.
//
//  Anchoring: a pool gives a ratio, not a price. USDG and friends are $1,
//  tokenized stocks come from Chainlink, and everything else is priced by
//  hopping from those. Unanchorable tokens get no price rather than a wrong one.
//
//  Free tier notes: eth_getLogs is capped at a 10-block range, so seeding uses
//  small steps and the live loop uses a filter, which has no range limit.
// ============================================================
import { SWAP_TOPIC, rpcCall, readDecimals, ratioFromSqrt, priceFromPools,
         pairFromSwapLog, pairFromSwapTx, sqrtFromLog } from './pools.mjs';
import { readChainlink } from './prices.mjs';

const hex = n => '0x' + n.toString(16);

export class LiveFeed {
  constructor({ rpc, poolManager, tokens, feeds, cache = {}, log = () => {} }) {
    this.rpc = rpc;
    this.pm = poolManager;
    this.tokens = tokens;               // [{addr, sym, name, cat}]
    this.feeds = feeds || {};
    this.bySym = {}; this.byAddr = {};
    for (const t of tokens) { const a = String(t.addr || '').toLowerCase(); if (!a) continue; this.byAddr[a] = t; (this.bySym[t.sym] = this.bySym[t.sym] || []).push(a); }
    this.pairs = { ...(cache.pairs || {}) };   // poolId -> {c0,c1}
    this.pools = {};                            // poolId -> {c0,c1,sqrt,n}
    this.decs = {};
    this.anchors = {};
    this.usd = {};                              // addr -> {usd, via, hops}
    this.filterId = null;
    this.log = log;
    this.stats = { swaps: 0, polls: 0, updates: 0 };
    // Vetting. A number that appeared once is a reading, not a price.
    this.marks = {};                            // addr -> {first,last,confirms,quarantined,why}
    this.confirmTol = 0.25;                     // two readings within 25% agree
    this.quarantineX = 5;                       // a 5x move inside one session is a correction
  }

  // Every price is checked against its own history before anyone may trade it.
  // Two failure modes are separated on purpose:
  //   * unconfirmed — seen once, might be real, not tradable yet
  //   * quarantined — moved further than any real market moves in an hour,
  //     so the token is dropped for the rest of the session and every mark
  //     that touched it is void
  vet() {
    for (const [addr, v] of Object.entries(this.usd)) {
      const usd = v && v.usd;
      if (!(usd > 0)) continue;
      let m = this.marks[addr];
      if (!m) { this.marks[addr] = { first: usd, last: usd, confirms: 0, quarantined: false, why: '' }; continue; }
      if (m.quarantined) continue;
      const vsFirst = usd / m.first;
      if (vsFirst > this.quarantineX || vsFirst < 1 / this.quarantineX) {
        m.quarantined = true;
        m.why = `moved ${vsFirst >= 1 ? vsFirst.toFixed(0) + 'x up' : (1 / vsFirst).toFixed(0) + 'x down'} from its opening reading`;
        const t = this.byAddr[addr];
        this.log(`  [feed] QUARANTINE ${t && t.sym || addr.slice(0, 10)} — ${m.why}. Dropped from the roster; marks void.`);
        continue;
      }
      const vsLast = usd / m.last;
      if (vsLast < 1 + this.confirmTol && vsLast > 1 / (1 + this.confirmTol)) m.confirms++;
      m.last = usd;
    }
  }

  // Symbols an agent is allowed to see. Confirmed, un-quarantined, priced.
  tradable(sym) {
    const addrs = this.bySym[sym] || [];
    return addrs.some(a => { const m = this.marks[a]; return m && !m.quarantined && m.confirms >= 1; });
  }

  quarantinedSyms() {
    const out = [];
    for (const [addr, m] of Object.entries(this.marks)) {
      if (!m.quarantined) continue;
      const t = this.byAddr[addr];
      if (t && t.sym && !out.includes(t.sym)) out.push(t.sym);
    }
    return out;
  }

  async seed(lookbackBlocks = 400, resolveTop = 40) {
    const head = Number(BigInt(await rpcCall(this.rpc, 'eth_blockNumber', [])));
    const from = Math.max(0, head - lookbackBlocks);
    const logs = [];
    // Stop as soon as we have enough pools to work with. On a chain doing ~1,000
    // swaps a minute the first few windows already cover the whole active set,
    // and every extra eth_getLogs is one of the most expensive calls there is.
    const ENOUGH = 400;
    for (let end = head; end > from; end -= 10) {
      try {
        const got = await rpcCall(this.rpc, 'eth_getLogs', [{ address: this.pm, topics: [SWAP_TOPIC], fromBlock: hex(Math.max(from, end - 9)), toBlock: hex(end) }]);
        logs.push(...got);
      } catch { break; }        // free tier refused; the filter will carry us
      if (logs.length > ENOUGH) break;
      // cached pairs from a previous run mean we do not need a deep scan at all
      if (logs.length > 80 && Object.keys(this.pairs).length > 20) break;
    }
    this.ingest(logs, false);
    await this.resolvePairs(resolveTop);
    await this.refreshAnchors();
    this.recompute();
    await this.openFilter();
    // A second look before anyone trades. Decimals that were still in flight on
    // the first pass have landed by now, and a price that changed by 10^12
    // between the two readings gets quarantined here instead of being sold to
    // an agent as an opportunity.
    //
    // This deliberately does NOT re-run resolvePairs — that is the expensive
    // call (a transaction receipt per pool) and the pairs have not changed in
    // five seconds. Retrying only the missing decimals is a single batch.
    await new Promise(r => setTimeout(r, 5000));
    const stillUnknown = [...new Set(Object.values(this.pairs).flatMap(p => [p.c0, p.c1]))].filter(a => this.decs[a] == null);
    if (stillUnknown.length) { try { await readDecimals(this.rpc, stillUnknown, this.decs); } catch {} }
    await this.poll();                 // one cheap filter read, so the second look sees new swaps too
    this.recompute();
    const ok = Object.keys(this.usd).filter(a => { const m = this.marks[a]; return m && !m.quarantined && m.confirms >= 1; }).length;
    this.log(`  [feed] ${ok} price(s) confirmed on a second reading${this.quarantinedSyms().length ? `, ${this.quarantinedSyms().length} quarantined` : ''}.`);
    return this;
  }

  // live=false during seeding: those logs are history, and stamping them with
  // the current time would make every pool look like it just traded for the
  // first fifteen minutes of every session.
  ingest(logs, live = true) {
    for (const lg of logs) {
      const id = lg.topics && lg.topics[1];
      if (!id) continue;
      let sqrt; try { sqrt = sqrtFromLog(lg); } catch { continue; }
      const p = this.pools[id] || (this.pools[id] = { n: 0, sample: [] });
      p.sqrt = sqrt; p.n++;
      if (live) p.lastAt = Date.now();   // when this pool was last actually traded
      if (p.sample.length < 4) p.sample.push(lg);
      if (this.pairs[id]) { p.c0 = this.pairs[id].c0; p.c1 = this.pairs[id].c1; }
      this.stats.swaps++;
    }
  }

  async resolvePairs(top = 40) {
    const need = Object.entries(this.pools)
      .filter(([id, p]) => !p.c0 && (p.sample || []).length)
      .sort((a, b) => b[1].n - a[1].n).slice(0, top);
    let ok = 0;
    for (const [id, p] of need) {
      let got = null;
      // At most TWO samples per pool. This used to try all four, and since both
      // helpers fetch a full transaction receipt that was up to 8 receipt calls
      // for a single pool we then usually failed to resolve anyway.
      for (const lg of p.sample.slice(0, 2)) {
        try { got = await pairFromSwapLog(this.rpc, lg); } catch {}
        if (!got) { try { got = await pairFromSwapTx(this.rpc, lg.transactionHash); } catch {} }
        if (got) break;
      }
      if (got) { this.pairs[id] = { c0: got.c0, c1: got.c1 }; p.c0 = got.c0; p.c1 = got.c1; ok++; }
    }
    // Retry decimals for every pooled token still unknown. readDecimals only
    // asks about addresses missing from the cache, so this is cheap and it is
    // the mechanism by which a token stops being unpriced.
    const addrs = Object.values(this.pairs).flatMap(p => [p.c0, p.c1]);
    if (addrs.length) { try { await readDecimals(this.rpc, addrs, this.decs); } catch {} }
    return ok;
  }

  async refreshAnchors() {
    this.anchors = {};
    for (const st of ['USDG', 'USDC', 'USDT', 'USDE', 'DAI']) for (const a of (this.bySym[st] || [])) this.anchors[a] = 1;
    try {
      const px = await readChainlink(this.rpc, this.feeds);
      this.chainlink = px;
      for (const [sym, v] of Object.entries(px)) for (const a of (this.bySym[sym] || [])) this.anchors[a] = v.price;
    } catch {}
    return this.anchors;
  }

  recompute() {
    const usable = {};
    for (const [id, p] of Object.entries(this.pools)) if (p.c0 && p.c1 && p.sqrt != null) usable[id] = p;
    this.usd = priceFromPools(usable, this.decs, this.anchors);
    this.vet();
    return this.usd;
  }

  // Open a filter on a SPECIFIC endpoint and remember which one. Not every
  // provider implements eth_newFilter (Robinhood's own public node does not),
  // so try each in turn and record the winner; if none can, we scan instead.
  async openFilter() {
    this.filterId = null; this.filterEp = null;
    const eps = (this.rpc && typeof this.rpc.endpoints === 'function') ? this.rpc.endpoints() : null;
    if (!eps) {
      try { this.filterId = await rpcCall(this.rpc, 'eth_newFilter', [{ address: this.pm, topics: [SWAP_TOPIC] }]); }
      catch (e) { this.log('  [feed] filter unavailable (' + String(e.message).slice(0, 60) + ') — falling back to block scans'); }
      return;
    }
    for (const e of eps) {
      if (this.rpc.isCold(e)) continue;
      try {
        this.filterId = await this.rpc.callOn(e, 'eth_newFilter', [{ address: this.pm, topics: [SWAP_TOPIC] }]);
        this.filterEp = e;
        return;
      } catch (err) { this.noFilter = this.noFilter || new Set(); this.noFilter.add(e.name); }
    }
    this.log(`  [feed] no endpoint offers eth_newFilter${this.noFilter ? ` (${[...this.noFilter].join(', ')})` : ''} — using block scans instead, which is slower but does not lose swaps`);
  }

  // Called on a timer during the session. Cheap: one RPC most of the time.
  async poll() {
    this.stats.polls++;
    // Re-read Chainlink periodically. refreshAnchors() used to run ONCE inside
    // seed(), which pinned every tokenized equity and stablecoin to its opening
    // value for the whole session — so the stock side of the roster never
    // moved, never registered as traded, and was dropped from the menu. The
    // benchmark was a memecoin benchmark describing itself as an equities one.
    const now = Date.now();
    if (!this._anchorsAt || now - this._anchorsAt > (this.anchorEveryMs || 120000)) {
      this._anchorsAt = now;
      try { await this.refreshAnchors(); this._anchorDirty = true; } catch {}
    }
    let fresh = [];
    // if the filter's own host is resting, the filter is gone with it
    if (this.filterId && this.filterEp && this.rpc.isCold && this.rpc.isCold(this.filterEp)) {
      this.filterId = null; this.filterEp = null;
    }
    if (this.filterId) {
      try {
        fresh = (this.filterEp ? await this.rpc.callOn(this.filterEp, 'eth_getFilterChanges', [this.filterId])
                               : await rpcCall(this.rpc, 'eth_getFilterChanges', [this.filterId])) || [];
      } catch { this.filterId = null; this.filterEp = null; await this.openFilter(); }
    }
    if (!this.filterId) {
      // Scan from where we last got to, NOT a fixed 10-block window off the
      // head. Robinhood Chain is an Arbitrum L2 with sub-second blocks, so at
      // an 8-second poll a 10-block window silently skips most of the interval
      // and the missed swaps are simply never seen. Free tiers cap a single
      // getLogs at 10 blocks, so we page — bounded, so a long stall cannot turn
      // into hundreds of calls at once.
      try {
        const head = Number(BigInt(await rpcCall(this.rpc, 'eth_blockNumber', [])));
        let from = this.scanned != null ? this.scanned + 1 : head - 9;
        if (head - from > 200) from = head - 200;                 // a big gap: take the recent slice
        const MAX_WINDOWS = 24;
        for (let w = 0, lo = from; lo <= head && w < MAX_WINDOWS; w++, lo += 10) {
          const hi = Math.min(head, lo + 9);
          const got = await rpcCall(this.rpc, 'eth_getLogs', [{ address: this.pm, topics: [SWAP_TOPIC], fromBlock: hex(lo), toBlock: hex(hi) }]);
          if (got && got.length) fresh.push(...got);
          this.scanned = hi;
        }
      } catch {}
    }
    // A Chainlink move alone is a reason to recompute, even with zero swaps —
    // otherwise a quiet block means the equity feeds never reach the session.
    if (!fresh.length) {
      if (this._anchorDirty) { this._anchorDirty = false; this.recompute(); this.stats.updates++; return 0.5; }
      return 0;
    }
    this._anchorDirty = false;
    this.ingest(fresh);
    this.recompute();
    this.stats.updates++;
    return fresh.length;
  }

  // Anchored tokens (stocks, stables) are priced by Chainlink, not by a pool,
  // so they never appear in this.usd. The session still needs them.
  anchorPrices() {
    const out = {};
    for (const [addr, usd] of Object.entries(this.anchors || {})) {
      const t = this.byAddr[addr];
      if (t && t.sym && usd > 0) out[t.sym] = { usd, via: 'chainlink', hops: 0, swaps: 0, addr, lastAt: this._anchorsAt || 0 };
    }
    return out;
  }

  // symbol -> usd, for the roster. Anchored, confirmed twice, not quarantined.
  // Everything else is withheld: an agent that sees no price simply cannot
  // trade the token, which is the correct outcome for a number we do not trust.
  priceBySymbol({ vetted = true } = {}) {
    const out = {};
    for (const [addr, v] of Object.entries(this.usd)) {
      const t = this.byAddr[addr];
      if (!t || !t.sym) continue;
      if (vetted) {
        const m = this.marks[addr];
        if (!m || m.quarantined || m.confirms < 1) continue;
      }
      const cur = out[t.sym];
      // lastAt = when this token's own pool last saw a trade. The session uses
      // it to keep dead tokens off the menu: a token nobody is trading is not
      // an instrument, it is a row, and offering it guarantees a decision that
      // scores "flat" and teaches the benchmark nothing.
      const lastAt = (v.pool && this.pools[v.pool] && this.pools[v.pool].lastAt) || 0;
      if (!cur || (v.swaps || 0) > (cur.swaps || 0)) out[t.sym] = { usd: v.usd, via: v.via, hops: v.hops, swaps: v.swaps, addr, lastAt };
    }
    return out;
  }

  summary() {
    const priced = Object.keys(this.priceBySymbol()).length;
    const pools = Object.values(this.pools).filter(p => p.c0).length;
    const q = this.quarantinedSyms().length;
    return `${this.stats.swaps} swaps · ${pools} pools mapped · ${priced} tokens priced${q ? ` · ${q} quarantined` : ''}`;
  }
}
