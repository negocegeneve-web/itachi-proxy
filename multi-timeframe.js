// multi-timeframe.js — v6.0 (allégé : 4 timeframes)
const https = require('https');
const BASE_URL = 'testnet.binancefuture.com';

class MultiTimeframeAnalyzer {
  constructor(symbol) {
    this.symbol = symbol;
    this.cache = {};
    this.cacheTTL = {
      '1h':  300000,  // 5min cache
      '15m':  60000,  // 1min cache
      '3m':   30000,  // 30s cache
      '1m':   15000,  // 15s cache
    };
    this.lastScore = 50;
    this.lastAnalysis = null;
  }

  async fetchKlines(interval, limit) {
    const cacheKey = `${this.symbol}_${interval}`;
    const ttl = this.cacheTTL[interval] || 15000;
    const now = Date.now();

    if (this.cache[cacheKey] && (now - this.cache[cacheKey].time) < ttl) {
      return this.cache[cacheKey].data;
    }

    try {
      const data = await new Promise((resolve, reject) => {
        https.get({
          hostname: BASE_URL,
          path: `/fapi/v1/klines?symbol=${this.symbol}&interval=${interval}&limit=${limit}`
        }, res => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch(e) { reject(e); }
          });
        }).on('error', reject);
      });

      const klines = Array.isArray(data) ? data.map(k => ({
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        time: k[0]
      })) : [];

      this.cache[cacheKey] = { data: klines, time: now };
      return klines;
    } catch(e) {
      console.error(`❌ ${this.symbol} klines ${interval}: ${e.message}`);
      return this.cache[cacheKey]?.data || [];
    }
  }

  calcEMA(closes, period) {
    if (closes.length < period) return closes[closes.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
  }

  calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  }

  calcTrend(klines) {
    if (!klines || klines.length < 5) return 'NEUTRAL';
    const closes = klines.map(k => k.close);
    const emaFast = this.calcEMA(closes, Math.min(8, closes.length));
    const emaSlow = this.calcEMA(closes, Math.min(21, closes.length));
    const rsi = this.calcRSI(closes);
    const momentum = closes[closes.length - 1] - closes[Math.max(0, closes.length - 4)];

    if (emaFast > emaSlow && momentum > 0 && rsi < 75) return 'BULL';
    if (emaFast < emaSlow && momentum < 0 && rsi > 25) return 'BEAR';
    return 'NEUTRAL';
  }

  calcSR(klines, lookback = 10) {
    if (!klines || klines.length < 2) return { support: 0, resistance: Infinity };
    const recent = klines.slice(-lookback);
    return {
      support: Math.min(...recent.map(k => k.low)),
      resistance: Math.max(...recent.map(k => k.high))
    };
  }

  async analyze(currentPrice) {
    try {
      // ✅ 4 timeframes seulement (allégé)
      const [klines_1h, klines_15m, klines_3m, klines_1m] = await Promise.all([
        this.fetchKlines('1h', 24),
        this.fetchKlines('15m', 20),
        this.fetchKlines('3m', 20),
        this.fetchKlines('1m', 20)
      ]);

      const trend_1h  = this.calcTrend(klines_1h.slice(-8));
      const trend_15m = this.calcTrend(klines_15m.slice(-8));
      const trend_3m  = this.calcTrend(klines_3m.slice(-8));
      const trend_1m  = this.calcTrend(klines_1m.slice(-8));

      const sr_1h  = this.calcSR(klines_1h, 8);
      const sr_15m = this.calcSR(klines_15m, 8);
      const sr_3m  = this.calcSR(klines_3m, 8);
      const sr_1m  = this.calcSR(klines_1m, 8);

      // Score 0-100
      let score = 50; // Base neutre

      // Tendances (60 pts total)
      if (trend_1h  === 'BULL') score += 20; else if (trend_1h  === 'BEAR') score -= 20;
      if (trend_15m === 'BULL') score += 15; else if (trend_15m === 'BEAR') score -= 15;
      if (trend_3m  === 'BULL') score += 13; else if (trend_3m  === 'BEAR') score -= 13;
      if (trend_1m  === 'BULL') score += 12; else if (trend_1m  === 'BEAR') score -= 12;

      // Support/Résistance (20 pts)
      if (currentPrice > sr_1h.support)  score += 5;
      if (currentPrice > sr_15m.support) score += 5;
      if (currentPrice > sr_3m.support)  score += 5;
      if (currentPrice > sr_1m.support)  score += 5;

      // Pas trop proche résistance (20 pts)
      const distRes1h  = (sr_1h.resistance  - currentPrice) / currentPrice * 100;
      const distRes15m = (sr_15m.resistance - currentPrice) / currentPrice * 100;
      if (distRes1h  > 0.5) score += 10;
      if (distRes15m > 0.3) score += 10;

      score = Math.min(100, Math.max(0, score));

      this.lastScore = score;
      this.lastAnalysis = {
        score,
        trends: { trend_1h, trend_15m, trend_3m, trend_1m },
        sr: { sr_1h, sr_15m, sr_3m, sr_1m },
        currentPrice,
        bias: score >= 60 ? 'BULL' : score <= 40 ? 'BEAR' : 'NEUTRAL'
      };

      console.log(`📊 ${this.symbol} MTF:${score.toFixed(0)} | 1h:${trend_1h} 15m:${trend_15m} 3m:${trend_3m} 1m:${trend_1m} | ${this.lastAnalysis.bias}`);
      return this.lastAnalysis;

    } catch(e) {
      console.error(`❌ ${this.symbol} MTF: ${e.message}`);
      return this.lastAnalysis || { score: 50, bias: 'NEUTRAL' };
    }
  }
}

module.exports = MultiTimeframeAnalyzer;
