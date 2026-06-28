// ruflo-trader.js
class StrategyAgent {
  analyze(priceData) {
    try {
      if (!priceData || !Array.isArray(priceData) || priceData.length < 21) {
        return { action: 'HOLD', q: 0, emaFast: 0, emaSlow: 0, ema50: 0, momentum: 0 };
      }

      const emaFast = this.calcEMA(priceData, 8);
      const emaSlow = this.calcEMA(priceData, 21);
      const ema50 = this.calcEMA(priceData, Math.min(50, priceData.length));
      const last = priceData[priceData.length - 1];
      const prev = priceData[priceData.length - 2];
      const prev5 = priceData[Math.max(0, priceData.length - 6)];
      const momentum = last - prev;
      const momentum5 = last - prev5;

      let action = 'HOLD';
      let q = 0;

      // ✅ Signal BUY uniquement si :
      // 1. EMA fast > EMA slow (tendance haussière court terme)
      // 2. Prix > EMA50 (tendance haussière long terme)
      // 3. Momentum positif sur 1 ET 5 derniers prix
      if (
        emaFast > emaSlow &&
        last > ema50 &&
        momentum > 0 &&
        momentum5 > 0
      ) {
        action = 'BUY';
        q = 55; // Base haute

        // Boost spread EMA fast/slow
        const spread = (emaFast - emaSlow) / emaSlow * 100;
        q += Math.min(20, spread * 200);

        // Boost momentum
        const momStrength = Math.abs(momentum5) / prev5 * 100;
        q += Math.min(25, momStrength * 1000);
      }

      q = Math.min(100, Math.max(0, q));

      return {
        action,
        q: parseFloat(q.toFixed(2)),
        emaFast: parseFloat(emaFast.toFixed(4)),
        emaSlow: parseFloat(emaSlow.toFixed(4)),
        ema50: parseFloat(ema50.toFixed(4)),
        momentum: parseFloat(momentum.toFixed(6)),
        momentum5: parseFloat(momentum5.toFixed(6))
      };
    } catch(e) {
      console.error(`StrategyAgent error: ${e.message}`);
      return { action: 'HOLD', q: 0, emaFast: 0, emaSlow: 0, ema50: 0, momentum: 0 };
    }
  }

  calcEMA(data, period) {
    if (!data || data.length < period) return data[data.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }
}

class RiskAgent {
  validate(signal, portfolio) {
    if (!signal || !portfolio) {
      return { approved: false, leverage: 7, stopLoss: 0.004, takeProfit: 0.008 };
    }

    let leverage = 7;
    if (signal.q >= 90) leverage = 10;
    else if (signal.q >= 75) leverage = 8;

    // Approuve uniquement si signal fort
    const approved = signal.action === 'BUY' && signal.q >= 55;

    return {
      approved,
      leverage,
      stopLoss: 0.004,   // -0.4%
      takeProfit: 0.008  // +0.8%
    };
  }
}

class LearningAgent {
  constructor() {
    this.totalTrades = 0;
    this.wins = 0;
    this.losses = 0;
    this.patterns = {};
  }

  learn(tradeOutcome) {
    if (!tradeOutcome) return;
    this.totalTrades++;
    if (tradeOutcome.pnl > 0) this.wins++;
    else this.losses++;
    const key = `q${Math.floor((tradeOutcome.q || 0) / 10)}`;
    if (!this.patterns[key]) this.patterns[key] = { trades: 0, wins: 0 };
    this.patterns[key].trades++;
    if (tradeOutcome.pnl > 0) this.patterns[key].wins++;
  }

  getStats() {
    const winRate = this.totalTrades > 0
      ? (this.wins / this.totalTrades * 100).toFixed(1)
      : 0;
    return {
      totalTrades: this.totalTrades,
      wins: this.wins,
      losses: this.losses,
      winRate: parseFloat(winRate)
    };
  }
}

class TradingSwarm {
  constructor() {
    this.strategy = new StrategyAgent();
    this.risk = new RiskAgent();
    this.learning = new LearningAgent();
    this.lastLeverage = 7;
  }

  coordinate(priceData, portfolio) {
    const sig = this.strategy.analyze(priceData);
    const risk = this.risk.validate(sig, portfolio);
    this.lastLeverage = risk.leverage;
    return {
      action: risk.approved ? sig.action : 'HOLD',
      q: sig.q,
      leverage: risk.leverage,
      stopLoss: risk.stopLoss,
      takeProfit: risk.takeProfit,
      emaFast: sig.emaFast,
      emaSlow: sig.emaSlow,
      ema50: sig.ema50,
      momentum: sig.momentum
    };
  }

  recordOutcomes() {}

  getStats() {
    return this.learning.getStats();
  }
}

module.exports = { StrategyAgent, RiskAgent, LearningAgent, TradingSwarm };
