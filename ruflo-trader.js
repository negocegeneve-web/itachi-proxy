// ruflo-trader.js
// Agents Ruflo - Stratégie entrées multiples rapides

class StrategyAgent {
  analyze(priceData) {
    try {
      if (!priceData || !Array.isArray(priceData) || priceData.length < 21) {
        return { action: 'HOLD', q: 0, emaFast: 0, emaSlow: 0, momentum: 0 };
      }

      const emaFast = this.calcEMA(priceData, 8);
      const emaSlow = this.calcEMA(priceData, 21);
      
      // Momentum très sensible (1 prix)
      const momentum = priceData[priceData.length - 1] - priceData[priceData.length - 2];
      const momentumPercent = (momentum / priceData[priceData.length - 2]) * 100;

      let action = 'HOLD';
      let baseQ = 15;

      // Signal ultra-sensible
      if (emaFast > emaSlow) {
        action = 'BUY';
        baseQ = 35;
      } else if (emaFast < emaSlow) {
        action = 'SELL';
        baseQ = 35;
      }

      // Boost momentum (même micro)
      if (momentum > 0) {
        baseQ += Math.min(40, Math.abs(momentum) * 100);
      }

      // Boost spread EMA
      const emaSpread = Math.abs(emaFast - emaSlow) / emaSlow * 100;
      if (emaSpread > 0.05) {
        baseQ += Math.min(25, emaSpread * 30);
      }

      const q = Math.min(100, Math.max(0, baseQ));

      return {
        action,
        q: parseFloat(q.toFixed(2)),
        emaFast: parseFloat(emaFast.toFixed(2)),
        emaSlow: parseFloat(emaSlow.toFixed(2)),
        momentum: parseFloat(momentum.toFixed(8))
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
      return { approved: false, leverage: 1, stopLoss: 0.01, takeProfit: 0.02 };
    }

    let leverage = 3;
    if (signal.q >= 70) leverage = 12;
    else if (signal.q >= 50) leverage = 7;
    else if (signal.q >= 35) leverage = 5;

    const approved = signal.action === 'BUY' && signal.q >= 20;

    return {
      approved,
      leverage,
      stopLoss: 0.01, // -1%
      takeProfit: 0.02 // +2%
    };
  }
}

class LearningAgent {
  constructor() {
    this.totalTrades = 0;
    this.wins = 0;
    this.losses = 0;
  }

  learn(tradeOutcome) {
    if (!tradeOutcome) return;
    this.totalTrades++;
    if (tradeOutcome.pnl > 0) this.wins++;
    else this.losses++;
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
      emaSlow: sig.emaSlow,
      momentum: sig.momentum
    };
  }

  recordOutcomes(trades, currentPrice) {
    if (!trades || trades.length === 0) return;
  }

  getStats() {
    return this.learning.getStats();
  }
}

module.exports = { StrategyAgent, RiskAgent, LearningAgent, TradingSwarm };
