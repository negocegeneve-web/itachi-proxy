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
    let ema =
