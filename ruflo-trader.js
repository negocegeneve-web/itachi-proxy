// ruflo-trader.js
class StrategyAgent {
  analyze(priceData) {
    try {
      if (!priceData || !Array.isArray(priceData) || priceData.length < 10) {
        return { action: 'HOLD', q: 0, emaFast: 0, emaSlow: 0, momentum: 0 };
      }

      const emaFast = this.calcEMA(priceData, 8);
      const emaSlow = this.calcEMA(priceData, 21);
      const last = priceData[priceData.length - 1];
      const prev = priceData[priceData.length - 2];
      const momentum = last - prev;

      let action = 'HOLD';
      let q = 0;

      // Signal BUY si EMA fast >= EMA slow
      if (emaFast >= emaSlow) {
        action = 'BUY';
        q = 60; // Base haute
      }

      // Boost si momentum positif
      if (momentum >= 0) {
        q += 20;
      }

      // Boost spread EMA
      const spread = Math.abs(emaFast - emaSlow) / emaSlow * 100;
      if (spread > 0) {
        q += Math.min(20, spread * 100);
      }

      q = Math.min(100, Math.max(0, q));

      return {
        action,
        q: parseFloat(q.toFixed(2)),
        emaFast: parseFloat(emaFast.toFixed(2)),
        emaSlow: parseFloat(emaSlow.toFixed(2)),
        momentum: parseFloat(momentum.toFixed(6))
      };
    } catch(e) {
      console.error(`StrategyAgent error: ${e.message}`);
      return { action: 'HOLD', q: 0, emaFast: 0, emaSlow: 0, momentum: 0 };
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
      return { approved: false, leverage: 5, stopLoss: 0.002, takeProfit: 0.003 };
    }

    let leverage = 5;
    if (signal.q >= 90) leverage = 10;
    else if (signal.q >= 75) leverage = 7;

    // Approuve dès Q >= 25
    const approved = signal.action === 'BUY' && signal.q >= 25;

    return {
      approved,
      leverage,
      stopLoss: 0.002,
      takeProfit: 0.003
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
    const key = `q${Math.floor(tradeOutcome.q / 10)}`;
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
    this.lastLeverage = 5;
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
      momentum: sig.momentum
    };
  }

  recordOutcomes() {}

  getStats() {
    return this.learning.getStats();
  }
}

module.exports = { StrategyAgent, RiskAgent, LearningAgent, TradingSwarm };
