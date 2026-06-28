/**
 * Ruflo Lightweight Trading Agents
 * Strategy Agent → Risk Agent → Execution Agent → Learning Loop
 */

class StrategyAgent {
  constructor(config = {}) {
    this.role = "strategy";
    this.name = "BTC Strategy Agent";
    this.config = {
      ema_fast: config.ema_fast || 8,
      ema_slow: config.ema_slow || 21,
      min_quality: config.min_quality || 45,
      ...config
    };
    this.memory = [];
  }

  async analyze(priceData) {
    try {
      const { close, volume, timestamp } = priceData;
      const emaFast = this.calculateEMA(close, this.config.ema_fast);
      const emaSlow = this.calculateEMA(close, this.config.ema_slow);
      const momentum = this.calculateMomentum(close);
      
      const momScore = Math.min(50, Math.abs(momentum) * 100);
      const emaScore = emaFast > emaSlow ? 30 : 0;
      const trendBonus = volume > 0 ? 20 : 0;
      const quality = momScore + emaScore + trendBonus;
      
      const signal = {
        timestamp,
        action: emaFast > emaSlow ? "BUY" : emaSlow > emaFast ? "SELL" : "HOLD",
        quality,
        emaFast,
        emaSlow,
        momentum,
        confidence: Math.min(100, quality / 100)
      };

      this.memory.push(signal);
      return signal;
    } catch (error) {
      console.error("StrategyAgent.analyze error:", error);
      return null;
    }
  }

  calculateEMA(prices, period) {
    if (!Array.isArray(prices) || prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  }

  calculateMomentum(prices, period = 5) {
    if (!Array.isArray(prices) || prices.length < period) return 0;
    return (prices[prices.length - 1] - prices[prices.length - period - 1]) / prices[prices.length - period - 1];
  }
}

class RiskAgent {
  constructor(config = {}) {
    this.role = "risk";
    this.name = "Risk Validator";
    this.config = {
      max_leverage: config.max_leverage || 7,
      stop_loss_pct: config.stop_loss_pct || 0.015,
      take_profit_pct: config.take_profit_pct || 0.02,
      max_loss_pct: config.max_loss_pct || 0.20,
      ...config
    };
  }

  async validate(signal, portfolio) {
    try {
      const equity = portfolio.equity || 500;
      const drawdown = (portfolio.peak - equity) / portfolio.peak;
      
      if (drawdown >= this.config.max_loss_pct) {
        return {
          approved: false,
          reason: `Kill switch: drawdown ${(drawdown * 100).toFixed(2)}% >= ${(this.config.max_loss_pct * 100)}%`,
          action: "STOP_ALL"
        };
      }

      if (signal.quality < 45) {
        return {
          approved: false,
          reason: `Low quality: ${signal.quality} < 45`,
          action: "SKIP"
        };
      }

      let leverage = 3;
      if (signal.quality >= 45 && signal.quality < 70) leverage = 5;
      if (signal.quality >= 70) leverage = 7;

      leverage = Math.min(leverage, this.config.max_leverage);

      const validation = {
        approved: true,
        signal: signal.action,
        leverage,
        stopLoss: this.config.stop_loss_pct,
        takeProfit: this.config.take_profit_pct,
        riskReward: this.config.take_profit_pct / this.config.stop_loss_pct,
        quality: signal.quality
      };

      return validation;
    } catch (error) {
      console.error("RiskAgent.validate error:", error);
      return { approved: false, reason: error.message };
    }
  }
}

class LearningAgent {
  constructor(config = {}) {
    this.role = "learning";
    this.name = "Learning & Optimization";
    this.config = config;
    this.patterns = {};
    this.trajectory = [];
    this.successCount = 0;
    this.failureCount = 0;
  }

  async learn(tradeOutcome) {
    try {
      const {
        entryPrice,
        exitPrice,
        pnl,
        quality,
        leverage,
        duration,
        reason
      } = tradeOutcome;

      const isSuccess = pnl > 0;
      if (isSuccess) this.successCount++;
      else this.failureCount++;

      const patternKey = `quality_${Math.floor(quality / 10)}_lev_${leverage}`;
      
      if (!this.patterns[patternKey]) {
        this.patterns[patternKey] = {
          count: 0,
          avgPnl: 0,
          avgDuration: 0,
          successRate: 0,
          recentTrades: []
        };
      }

      const pattern = this.patterns[patternKey];
      pattern.count++;
      pattern.avgPnl = (pattern.avgPnl * (pattern.count - 1) + pnl) / pattern.count;
      pattern.avgDuration = (pattern.avgDuration * (pattern.count - 1) + duration) / pattern.count;
      pattern.successRate = this.successCount / (this.successCount + this.failureCount);
      pattern.recentTrades.push({ pnl, quality, leverage, reason });

      if (pattern.recentTrades.length > 20) {
        pattern.recentTrades.shift();
      }

      this.trajectory.push({
        timestamp: Date.now(),
        outcome: tradeOutcome,
        winRate: this.successCount / (this.successCount + this.failureCount)
      });

      return {
        learned: true,
        pattern: patternKey,
        winRate: (this.successCount / (this.successCount + this.failureCount) * 100).toFixed(2) + "%",
        totalTrades: this.successCount + this.failureCount
      };
    } catch (error) {
      console.error("LearningAgent.learn error:", error);
      return { learned: false, reason: error.message };
    }
  }

  getBestPattern() {
    let best = null;
    let bestPnl = -Infinity;

    for (const [key, pattern] of Object.entries(this.patterns)) {
      if (pattern.avgPnl > bestPnl && pattern.count > 2) {
        best = { key, ...pattern };
        bestPnl = pattern.avgPnl;
      }
    }

    return best || { key: "none", message: "Insufficient data" };
  }

  getStats() {
    const total = this.successCount + this.failureCount;
    return {
      totalTrades: total,
      wins: this.successCount,
      losses: this.failureCount,
      winRate: total > 0 ? (this.successCount / total * 100).toFixed(2) + "%" : "N/A",
      patterns: Object.keys(this.patterns).length,
      bestPattern: this.getBestPattern()
    };
  }
}

class TradingSwarm {
  constructor(config = {}) {
    this.strategyAgent = new StrategyAgent(config);
    this.riskAgent = new RiskAgent(config);
    this.learningAgent = new LearningAgent(config);
    this.tradeHistory = [];
    this.isRunning = true;
  }

  async coordinate(priceData, portfolio) {
    try {
      const signal = await this.strategyAgent.analyze(priceData);
      
      if (!signal || signal.action === "HOLD") {
        return { action: "HOLD", reason: "No signal" };
      }

      const validation = await this.riskAgent.validate(signal, portfolio);
      
      if (!validation.approved) {
        return { action: "SKIP", reason: validation.reason };
      }

      return {
        action: validation.signal,
        leverage: validation.leverage,
        stopLoss: validation.stopLoss,
        takeProfit: validation.takeProfit,
        quality: signal.quality,
        approved: true
      };
    } catch (error) {
      console.error("TradingSwarm.coordinate error:", error);
      return { action: "ERROR", reason: error.message };
    }
  }

  async recordTrade(outcome) {
    const learned = await this.learningAgent.learn(outcome);
    this.tradeHistory.push(outcome);
    return learned;
  }

  getStats() {
    return this.learningAgent.getStats();
  }

  stop() {
    this.isRunning = false;
  }
}

module.exports = {
  StrategyAgent,
  RiskAgent,
  LearningAgent,
  TradingSwarm
};
