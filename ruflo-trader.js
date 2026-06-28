// ruflo-trader.js
// Agents Ruflo pour stratégie de trading EMA adaptatif

class StrategyAgent {
  analyze(priceData) {
    try {
      if (!priceData || !Array.isArray(priceData) || priceData.length < 21) {
        return { action: 'HOLD', q: 0, emaFast: 0, emaSlow: 0, momentum: 0 };
      }

      const emaFast = this.calcEMA(priceData, 8);
      const emaSlow = this.calcEMA(priceData, 21);
      const momentum = priceData[priceData.length - 1] - priceData[Math.max(0, priceData.length - 5)];

      let action = 'HOLD';
      let momScore = Math.min(50, Math.abs(momentum) * 10);
      let emaScore = 0;

      if (emaFast > emaSlow && momentum > 0) {
        action = 'BUY';
        emaScore = 30;
        momScore = 50;
      } else if (emaFast < emaSlow && momentum < 0) {
        action = 'SELL';
        emaScore = 30;
        momScore = 50;
      }

      const q = Math.min(100, momScore + emaScore);

      return {
        action,
        q,
        emaFast: parseFloat(emaFast.toFixed(2)),
        emaSlow: parseFloat(emaSlow.toFixed(2)),
        momentum: parseFloat(momentum.toFixed(2))
      };
    } catch(e) {
      console.error(`StrategyAgent.analyze error: ${e.message}`);
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
      return { approved: false, leverage: 1, stopLoss: 0.015, takeProfit: 0.02 };
    }

    let leverage = 3;
    if (signal.q >= 70) leverage = 12;
    else if (signal.q >= 45) leverage = 7;

    return {
      approved: signal.action !== 'HOLD' && signal.q >= 40,
      leverage,
      stopLoss: 0.015,
      takeProfit: 0.02
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

    const key = `q_${Math.floor(tradeOutcome.q / 10)}_lev_${tradeOutcome.leverage}`;
    if (!this.patterns[key]) this.patterns[key] = { trades: 0, wins: 0 };
    this.patterns[key].trades++;
    if (tradeOutcome.pnl > 0) this.patterns[key].wins++;
  }

  getStats() {
    const winRate = this.totalTrades > 0 ? (this.wins / this.totalTrades * 100).toFixed(1) : 0;
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
  }

  coordinate(priceData, portfolio) {
    const sig = this.strategy.analyze(priceData);
    const risk = this.risk.validate(sig, portfolio);

    return {
      action: risk.approved ? sig.action : 'HOLD',
      q: sig.q,
      leverage: risk.leverage,
      stopLoss: risk.stopLoss,
      takeProfit: risk.takeProfit,
      emaFast: sig.emaFast,
      emaSlow: sig.emaSlow
    };
  }

  recordOutcomes(trades, currentPrice) {
    if (!trades || trades.length === 0) return;
    // Simplifié : update learning agent
  }

  getStats() {
    return this.learning.getStats();
  }
}

module.exports = { StrategyAgent, RiskAgent, LearningAgent, TradingSwarm };
