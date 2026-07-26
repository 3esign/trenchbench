// worker/sandbox.mjs
// TrenchBench Memecoin Launch Sandbox Simulator

export class BondingCurveSim {
  /**
   * Initializes a virtual Pump.fun bonding curve.
   * Target: reaches 85 SOL virtual reserves to migrate to Raydium.
   * @param {string} symbol - Token symbol
   * @param {string} archetype - Token archetype ('moonshot', 'rug', 'crab', 'slow_bleed')
   * @param {number} startSolReserves - Virtual SOL pool size (default: 30 SOL)
   * @param {number} startTokenReserves - Virtual token pool size (default: 1,073,000,000 tokens)
   */
  constructor(symbol, archetype = 'moonshot', startSolReserves = 30, startTokenReserves = 1073000000) {
    this.symbol = symbol;
    this.archetype = archetype;
    this.solReserves = startSolReserves;
    this.tokenReserves = startTokenReserves;
    this.k = startSolReserves * startTokenReserves; // Constant Product invariant
    this.initialSol = startSolReserves;
    this.graduated = false;
    this.ticks = 0;
    this.volumeSol = 0;
  }

  /**
   * Simulates buying tokens on the bonding curve with SOL.
   * @param {number} solAmount - Amount of SOL spent
   * @returns {object} { tokensReceived, execPrice, priceImpactPct }
   */
  buy(solAmount) {
    if (solAmount <= 0 || this.graduated) return { tokensReceived: 0, execPrice: 0, priceImpactPct: 0 };
    
    const spotPrice = this.solReserves / this.tokenReserves;
    const newSolReserves = this.solReserves + solAmount;
    const newTokenReserves = this.k / newSolReserves;
    const tokensReceived = this.tokenReserves - newTokenReserves;
    
    const execPrice = solAmount / tokensReceived;
    const priceImpactPct = ((execPrice - spotPrice) / spotPrice) * 100;
    
    this.solReserves = newSolReserves;
    this.tokenReserves = newTokenReserves;
    this.volumeSol += solAmount;
    
    this.checkGraduation();
    
    return { tokensReceived, execPrice, priceImpactPct };
  }

  /**
   * Simulates selling tokens back to the bonding curve.
   * @param {number} tokenAmount - Amount of tokens sold
   * @returns {object} { solReceived, execPrice, priceImpactPct }
   */
  sell(tokenAmount) {
    if (tokenAmount <= 0 || this.graduated) return { solReceived: 0, execPrice: 0, priceImpactPct: 0 };
    
    const spotPrice = this.solReserves / this.tokenReserves;
    const newTokenReserves = this.tokenReserves + tokenAmount;
    const newSolReserves = this.k / newTokenReserves;
    
    // Prevent draining the pool past initial SOL
    const solReceived = Math.min(this.solReserves - this.initialSol, this.solReserves - newSolReserves);
    const execPrice = solReceived / tokenAmount;
    const priceImpactPct = -((spotPrice - execPrice) / spotPrice) * 100;
    
    this.solReserves = this.solReserves - solReceived;
    this.tokenReserves = this.k / this.solReserves;
    this.volumeSol += solReceived;
    
    return { solReceived, execPrice, priceImpactPct };
  }

  checkGraduation() {
    if (this.solReserves >= 85) {
      this.graduated = true;
    }
  }

  /**
   * Advances the simulation by 1 tick, applying randomized market noise
   * @returns {object} Current state summary
   */
  tick() {
    this.ticks++;
    if (this.graduated) return this.state();

    const actionRoll = Math.random();
    
    if (this.archetype === 'moonshot') {
      // Strong positive drift: 65% buy pressure, 20% sell
      if (actionRoll < 0.65) {
        this.buy(0.5 + Math.random() * 2.5);
      } else if (actionRoll < 0.85) {
        this.sell(this.tokenReserves * (0.01 + Math.random() * 0.02));
      }
    } else if (this.archetype === 'rug') {
      // Pump phase: first 25 ticks are moonshot. Then instant rug dump!
      if (this.ticks < 25) {
        if (actionRoll < 0.70) {
          this.buy(1.0 + Math.random() * 3.0);
        }
      } else {
        // RUG! Dump mock-holder reserves instantly
        const sellAmt = this.tokenReserves * 0.40;
        this.sell(sellAmt);
      }
    } else if (this.archetype === 'crab') {
      // Mean reverting: support and resistance bounds
      const currentPrice = this.solReserves / this.tokenReserves;
      const initialPrice = this.initialSol / (this.k / this.initialSol);
      const deviation = (currentPrice - initialPrice) / initialPrice;
      
      if (deviation > 0.06) {
        this.sell(this.tokenReserves * (0.02 + Math.random() * 0.04));
      } else if (deviation < -0.06) {
        this.buy(0.2 + Math.random() * 0.8);
      } else {
        if (actionRoll < 0.3) this.buy(0.1 + Math.random() * 0.4);
        else if (actionRoll < 0.6) this.sell(this.tokenReserves * 0.01);
      }
    } else if (this.archetype === 'slow_bleed') {
      // Steady decay
      if (actionRoll < 0.20) {
        this.buy(0.1 + Math.random() * 0.3);
      } else if (actionRoll < 0.75) {
        this.sell(this.tokenReserves * (0.005 + Math.random() * 0.015));
      }
    }
    
    return this.state();
  }

  state() {
    return {
      symbol: this.symbol,
      archetype: this.archetype,
      solReserves: this.solReserves.toFixed(2),
      tokenReserves: Math.round(this.tokenReserves).toLocaleString(),
      price: (this.solReserves / this.tokenReserves).toPrecision(6),
      graduated: this.graduated,
      ticks: this.ticks,
      volumeSol: this.volumeSol.toFixed(2)
    };
  }
}
