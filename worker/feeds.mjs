// ============================================================
//  TRENCH BENCH — the live feed (Data Layer)
//
//  Pump.fun mechanics: 
//  1. Discovery: PumpPortal WebSocket (free) gives us new token launches.
//  2. Pricing/Momentum: Dexscreener REST API (free) gives us batch price updates
//     and tracks the token across the Raydium migration boundary.
// ============================================================

export class LiveFeed {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.tokens = {}; // mint -> { mint, name, symbol, creator, initialBuy, createdAt, priceNative, marketCap, txns5m, priceChange5m, isMigrated, active }
    this.ws = null;
    this.isTracking = false;
  }

  close() {
    this.isTracking = false;
    if (this.ws) {
      try {
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  // 1. Discovery: Connect to PumpPortal and listen for new tokens
  startDiscovery() {
    if (this.ws) return;
    
    // Using global WebSocket available in Node 21+
    this.ws = new WebSocket('wss://pumpportal.fun/api/data');
    
    this.ws.onopen = () => {
      this.log('[feed] Connected to PumpPortal Discovery');
      this.ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      this.isTracking = true;
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Ensure it's a token creation event
        if (data.txType === 'create' && data.mint) {
          if (!this.tokens[data.mint]) {
            this.tokens[data.mint] = {
              mint: data.mint,
              name: data.name || 'Unknown',
              symbol: data.symbol || 'UNK',
              creator: data.traderPublicKey,
              initialBuy: data.initialBuy,
              createdAt: Date.now(),
              // Calculate initial price from virtual reserves
              priceNative: ((data.vSolInBondingCurve / data.vTokensInBondingCurve) * 160) || 0.000005, 
              marketCap: (data.marketCapSol * 160) || 5000,
              txns5m: 1, // Start with 1 transaction (the creation)
              priceChange5m: 0,
              isMigrated: false,
              active: true
            };
            this.log(`[feed] Discovery: New token [${data.symbol}] ${data.mint.slice(0,6)}... MarketCap: $${this.tokens[data.mint].marketCap.toFixed(2)}`);
          }
        }
      } catch (e) {
        // Ignore parse errors or weird events
      }
    };

    this.ws.onerror = (err) => {
      this.log(`[feed] PumpPortal WS Error`);
    };

    this.ws.onclose = () => {
      this.log('[feed] PumpPortal connection closed. Reconnecting in 5s...');
      this.ws = null;
      setTimeout(() => this.startDiscovery(), 5000);
    };
  }

  // 2. Pricing: Batch update prices from Dexscreener
  async updatePrices() {
    // Only update active tokens
    const activeMints = Object.keys(this.tokens).filter(mint => this.tokens[mint].active);
    if (activeMints.length === 0) return;

    // Dexscreener allows up to 30 addresses per request
    const BATCH_SIZE = 30;
    
    for (let i = 0; i < activeMints.length; i += BATCH_SIZE) {
      const batch = activeMints.slice(i, i + BATCH_SIZE);
      const url = `https://api.dexscreener.com/latest/dex/tokens/${batch.join(',')}`;
      
      try {
        const res = await fetch(url);
        if (!res.ok) {
          this.log(`[feed] Dexscreener fetch failed: ${res.status}`);
          continue;
        }
        
        const data = await res.json();
        const pairs = data.pairs || [];
        
        // Group pairs by token
        const pairsByToken = {};
        for (const p of pairs) {
          const baseAddr = p.baseToken.address;
          if (!pairsByToken[baseAddr]) pairsByToken[baseAddr] = [];
          pairsByToken[baseAddr].push(p);
        }

        // Update our roster
        for (const mint of batch) {
          const tPairs = pairsByToken[mint];
          if (!tPairs || tPairs.length === 0) continue;

          // Find the best pair (Raydium if migrated, else Pumpfun)
          let bestPair = tPairs.find(p => p.dexId === 'raydium');
          let isMigrated = true;
          
          if (!bestPair) {
            bestPair = tPairs.find(p => p.dexId === 'pumpfun');
            isMigrated = false;
          }

          if (bestPair) {
            const t = this.tokens[mint];
            t.symbol = bestPair.baseToken.symbol || t.symbol;
            t.name = bestPair.baseToken.name || t.name;
            t.priceNative = parseFloat(bestPair.priceUsd) || parseFloat(bestPair.priceNative) || 0;
            t.marketCap = parseFloat(bestPair.marketCap) || t.marketCap;
            t.tier = t.marketCap < 10000 ? 'micro' : t.marketCap < 100000 ? 'growth' : 'established';
            t.priceChange5m = bestPair.priceChange?.m5 || 0;
            t.priceChange1h = bestPair.priceChange?.h1 || 0;
            t.volume5m = bestPair.volume?.m5 || 0;
            t.liquidityUsd = bestPair.liquidity?.usd || 0;
            t.txns5m = (bestPair.txns?.m5?.buys || 0) + (bestPair.txns?.m5?.sells || 0);
            
            if (isMigrated && !t.isMigrated) {
              this.log(`[feed] 🎓 GRADUATION: [${t.symbol}] migrated to Raydium!`);
              t.isMigrated = true;
            }
          }
        }
      } catch (err) {
        this.log(`[feed] Dexscreener update error: ${err.message}`);
      }
    }
  }

  // Helper to trim the roster (drop old tokens that died)
  pruneRoster(maxAgeSeconds = 3600) {
    const now = Date.now();
    let pruned = 0;
    for (const mint in this.tokens) {
      const t = this.tokens[mint];
      const ageSec = (now - t.createdAt) / 1000;
      // If a token hasn't migrated after 1 hour, it's likely dead in the trenches.
      // We set it inactive so we stop polling it.
      if (t.active && !t.isMigrated && ageSec > maxAgeSeconds) {
        t.active = false;
        pruned++;
      }
    }
    if (pruned > 0) this.log(`[feed] Pruned ${pruned} dead tokens from active roster.`);
  }

  stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isTracking = false;
  }

  // Benchhood drop-in interface compatibility methods
  async seed() {
    this.startDiscovery();
    
    // Seed with latest profiles to ensure we have a robust initial list of memecoins
    try {
      this.log('[feed] Seeding initial active roster from Dexscreener profiles...');
      const pRes = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
      if (pRes.ok) {
        const profiles = await pRes.json();
        const solMints = profiles
          .filter(p => p.chainId === 'solana')
          .map(p => p.tokenAddress)
          .slice(0, 30); // Max 30 for batch fetch
        
        if (solMints.length > 0) {
          // Pre-populate tokens structure
          for (const mint of solMints) {
            this.tokens[mint] = {
              mint,
              name: 'Loading...',
              symbol: 'LOAD',
              createdAt: Date.now(),
              priceNative: 0,
              marketCap: 0,
              txns5m: 0,
              priceChange5m: 0,
              isMigrated: false,
              active: true
            };
          }
        }
      }
    } catch (e) {
      this.log(`[feed] Failed to seed from Dexscreener profiles: ${e.message}`);
    }

    // Give PumpPortal discovery and Dexscreener index a moment to populate
    await new Promise(r => setTimeout(r, 5000));
    
    // Initial price pull for seeded profiles (and any new discovery tokens)
    await this.updatePrices();

    // Fill in placeholders for seeded tokens that might have failed to fetch
    for (const mint in this.tokens) {
      const t = this.tokens[mint];
      if (t.symbol === 'LOAD' || t.priceNative === 0) {
        delete this.tokens[mint];
      }
    }
    this.log(`[feed] Roster seeded with ${Object.keys(this.tokens).length} active token(s)`);
  }
  vet() { this.pruneRoster(); }
  tradable(sym) { 
    // In Trench Bench, any token in the active roster is tradable
    const t = Object.values(this.tokens).find(x => x.symbol === sym);
    return t ? t.active : false; 
  }
  quarantinedSyms() { return []; } // No quarantine logic needed for MVP
}

