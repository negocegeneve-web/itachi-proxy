class StrategyAgent {
  analyze(priceData) {
    try {
      if (!priceData || !Array.isArray(priceData) || priceData.length < 21) {
        return { action: 'HOLD', q: 0, rsi: 50, direction: 'NONE', emaFast: 0, emaSlow: 0, momentum: 0 };
      }

      const emaFast = this.calcEMA(priceData, 8);
      const emaSlow = this.calcEMA(priceData, 21);
      const rsi = this.calcRSI(priceData, 14);
      const last = priceData[priceData.length - 1];
      const prev = priceData[priceData.length - 2];
      const prev5 = priceData[Math.max(0, priceData.length - 6)];
      const momentum = last - prev;
      const momentum5 = last - prev5;
      const ma20 = priceData.slice(-20).reduce((a,b) => a+b, 0) / Math.min(20, priceData.length);

      let action = 'HOLD';
      let direction = 'NONE';
      let q = 0;

      // ✅ Signal LONG (tendance haussière)
      if (
        emaFast > emaSlow &&
        last > ma20 &&
        momentum > 0 &&
        rsi > 30 && rsi < 70
      ) {
        action = 'BUY';
        direction = 'LONG';
        q = 55;

        const spread = (emaFast - emaSlow) / emaSlow * 100;
        q += Math.min(15, spread * 300);
        const momStrength = Math.abs(momentum5) / Math.max(prev5, 0.001) * 100;
        q += Math.min(15, momStrength * 2000);
        if (rsi >= 40 && rsi <= 60) q += 15;
        else if (rsi >= 35 && rsi <= 65) q += 8;
      }

      // ✅ Signal SHORT (tendance baissière)
      else if (
        emaFast < emaSlow &&
        last < ma20 &&
        momentum < 0 &&
        rsi > 30 && rsi < 70
      ) {
        action = 'SELL';
        direction = 'SHORT';
        q = 55;

        const spread = (emaSlow - emaFast) / emaSlow * 100;
        q += Math.min(15, spread * 300);
        const momStrength = Math.abs(momentum5) / Math.max(prev5, 0.001) * 100;
        q += Math.min(15, momStrength * 2000);
        if (rsi >= 40 && rsi <= 60) q += 15;
        else if (rsi >= 35 && rsi <= 65) q += 8;
      }

      // RSI extrême oversold → LONG fort
      if (rsi < 30 && momentum > 0) {
        action = 'BUY';
        direction = 'LONG';
        q = Math.max(q, 60);
      }

      // RSI extrême overbought → SHORT fort
      if (rsi > 70 && momentum < 0) {
        action = 'SELL';
        direction = 'SHORT';
        q = Math.max(q, 60);
      }

      q = Math.min(100, Math.max(0, q));

      return {
        action,
        direction,
        q: parseFloat(q.toFixed(2)),
        rsi: parseFloat(rsi.toFixed(2)),
        emaFast: parseFloat(emaFast.toFixed(4)),
        emaSlow: parseFloat(emaSlow.toFixed(4)),
        momentum: parseFloat(momentum.toFixed(6)),
        momentum5: parseFloat(momentum5.toFixed(6)),
        ma20: parseFloat(ma20.toFixed(2))
      };
    } catch(e) {
      console.error(`StrategyAgent error: ${e.message}`);
      return { action: 'HOLD', q: 0, rsi: 50, direction: 'NONE', emaFast: 0, emaSlow: 0, momentum: 0 };
    }
  }

  calcEMA(data, period) {
    if (!data || data.length < period) return data[data.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
    return ema;
  }

  calcRSI(data, period = 14) {
    if (data.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
      const diff = data[i] - data[i - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  }
}

class RiskAgent {
  validate(signal, portfolio) {
    if (!signal || !portfolio) {
      return { approved: false, leverage: 7, tp: 0.020, sl: 0.010, direction: 'NONE' };
    }

    let leverage = 7;
    if (signal.q >= 80) leverage = 12;
    else if (signal.q >= 55) leverage = 7;
    else leverage = 3;

    let tp = 0.020;
    if (signal.q >= 80) tp = 0.025;
    else if (signal.q >= 55) tp = 0.020;
    else tp = 0.015;

    const approved = (signal.action === 'BUY' || signal.action === 'SELL') && signal.q >= 50;

    return { approved, leverage, tp, sl: 0.010, direction: signal.direction };
  }
}

class LearningAgent {
  constructor() {
    this.totalTrades = 0;
    this.wins = 0;
    this.losses = 0;
    this.assetStats = {};
  }

  learn(tradeOutcome) {
    if (!tradeOutcome) return;
    this.totalTrades++;
    if (tradeOutcome.pnl > 0) this.wins++;
    else this.losses++;
    const sym = tradeOutcome.symbol || 'UNKNOWN';
    if (!this.assetStats[sym]) this.assetStats[sym] = { trades: 0, wins: 0, pnl: 0 };
    this.assetStats[sym].trades++;
    if (tradeOutcome.pnl > 0) this.assetStats[sym].wins++;
    this.assetStats[sym].pnl += tradeOutcome.pnl;
  }

  isAssetHealthy(symbol) {
    const stats = this.assetStats[symbol];
    if (!stats || stats.trades < 10) return true;
    const wr = stats.wins / stats.trades;
    if (wr < 0.40) {
      console.log(`⛔ ${symbol}: WR ${(wr*100).toFixed(1)}% < 40% → PAUSE`);
      return false;
    }
    return true;
  }

  getStats() {
    const winRate = this.totalTrades > 0
      ? (this.wins / this.totalTrades * 100).toFixed(1) : 0;
    return {
      totalTrades: this.totalTrades,
      wins: this.wins,
      losses: this.losses,
      winRate: parseFloat(winRate),
      assetStats: this.assetStats
    };
  }
}

class TradingSwarm {
  constructor() {
    this.strategy = new StrategyAgent();
    this.risk = new RiskAgent();
    this.learning = new LearningAgent();
    this.lastLeverage = 7;
    this.lastTP = 0.020;
    this.lastSL = 0.010;
    this.lastDirection = 'NONE';
  }

  coordinate(priceData, portfolio) {
    const sig = this.strategy.analyze(priceData);
    const risk = this.risk.validate(sig, portfolio);
    this.lastLeverage = risk.leverage;
    this.lastTP = risk.tp;
    this.lastSL = risk.sl;
    this.lastDirection = risk.direction;
    return {
      action: risk.approved ? sig.action : 'HOLD',
      direction: risk.direction,
      q: sig.q,
      rsi: sig.rsi,
      leverage: risk.leverage,
      tp: risk.tp,
      sl: risk.sl,
      emaFast: sig.emaFast,
      emaSlow: sig.emaSlow,
      momentum: sig.momentum,
      ma20: sig.ma20
    };
  }

  isAssetHealthy(symbol) { return this.learning.isAssetHealthy(symbol); }
  recordTrade(tradeOutcome) { this.learning.learn(tradeOutcome); }
  getStats() { return this.learning.getStats(); }
}

module.exports = { StrategyAgent, RiskAgent, LearningAgent, TradingSwarm };
