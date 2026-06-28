// multi-timeframe.js
// Analyse multi-temporelle + Supports/Résistances

const https = require('https');
const BASE_URL = 'testnet.binancefuture.com';

class MultiTimeframeAnalyzer {
  constructor(symbol) {
    this.symbol = symbol;
    this.cache = {};
    this.cacheTTL = {
      '1d': 3600000,   // 1h cache pour 21j/7j
      '4h': 900000,    // 15min cache pour 4h/12h
      '1h': 300000,    // 5min cache pour 1h/24h
      '15m': 60000,    // 1min cache pour 15min
      '3m': 30000,     // 30s cache pour 3min
      '1m': 15000,     // 15s cache pour 1min
      '30s': 5000,     // 5s cache pour 30s
      '5s': 2000       // 2s cache pour 5s
    };
    this.lastScore = 0;
    this.lastAnalysis = null;
  }

  // Fetch bougies Binance
  async fetchKlines(interval, limit) {
    const cacheKey = `${this.symbol}_${interval}`;
    const ttl = this.cacheTTL[interval] || 10000;
    const now = Date.now();

    // Retourne cache si frais
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

      // Format: [openTime, open, high, low, close, volume, ...]
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
      console.error(`❌ ${this.symbol} fetchKlines ${interval}: ${e.message}`);
      return this.cache[cacheKey]?.data || [];
    }
  }

  // Calcule EMA sur les closes
  calcEMA(closes, period) {
    if (closes.length < period) return closes[closes.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
  }

  // Tendance d'un timeframe
  calcTrend(klines) {
    if (!klines || klines.length < 5) return 'NEUTRAL';
    const closes = klines.map(k => k.close);
    const last = closes[closes.length - 1];
    const emaFast = this.calcEMA(closes, Math.min(8, closes.length));
    const emaSlow = this.calcEMA(closes, Math.min(21, closes.length));
    const momentum = last - closes[Math.max(0, closes.length - 4)];

    if (emaFast > emaSlow && momentum > 0) return 'BULL';
    if (emaFast < emaSlow && momentum < 0) return 'BEAR';
    return 'NEUTRAL';
  }

  // Support & Résistance
  calcSR(klines, lookback = 20) {
    if (!klines || klines.length < 2) return { support: 0, resistance: Infinity };
    const recent = klines.slice(-lookback);
    const highs = recent.map(k => k.high);
    const lows = recent.map(k => k.low);
    return {
      support: Math.min(...lows),
      resistance: Math.max(...highs)
    };
  }

  // Analyse complète multi-timeframe
  async analyze(currentPrice) {
    try {
      // Fetch tous les timeframes en parallèle
      const [
        klines_1d,
        klines_4h,
        klines_1h,
        klines_15m,
        klines_3m,
        klines_1m
      ] = await Promise.all([
        this.fetchKlines('1d', 21),   // 21 jours
        this.fetchKlines('4h', 42),   // 7 jours en 4h
        this.fetchKlines('1h', 24),   // 24h en 1h
        this.fetchKlines('15m', 48),  // 12h en 15min
        this.fetchKlines('3m', 80),   // 4h en 3min
        this.fetchKlines('1m', 30)    // 30min en 1min
      ]);

      // Tendances
      const trend_21d = this.calcTrend(klines_1d.slice(-21));
      const trend_7d  = this.calcTrend(klines_1d.slice(-7));
      const trend_24h = this.calcTrend(klines_1h);
      const trend_12h = this.calcTrend(klines_1h.slice(-12));
      const trend_4h  = this.calcTrend(klines_4h.slice(-4));
      const trend_15m = this.calcTrend(klines_15m.slice(-15));
      const trend_3m  = this.calcTrend(klines_3m.slice(-10));
      const trend_1m  = this.calcTrend(klines_1m.slice(-10));

      // Supports & Résistances
      const sr_21d = this.calcSR(klines_1d, 21);
      const sr_7d  = this.calcSR(klines_1d.slice(-7), 7);
      const sr_24h = this.calcSR(klines_1h, 24);
      const sr_4h  = this.calcSR(klines_4h.slice(-4), 4);
      const sr_1h  = this.calcSR(klines_1h.slice(-4), 4);
      const sr_15m = this.calcSR(klines_15m.slice(-8), 8);
      const sr_3m  = this.calcSR(klines_3m.slice(-10), 10);
      const sr_1m  = this.calcSR(klines_1m.slice(-10), 10);

      // Score de confluence (0-100)
      let score = 0;

      // Poids tendances (total 77 pts)
      if (trend_21d === 'BULL') score += 15;
      else if (trend_21d === 'BEAR') score -= 15;

      if (trend_7d === 'BULL') score += 12;
      else if (trend_7d === 'BEAR') score -= 12;

      if (trend_24h === 'BULL') score += 10;
      else if (trend_24h === 'BEAR') score -= 10;

      if (trend_12h === 'BULL') score += 8;
      else if (trend_12h === 'BEAR') score -= 8;

      if (trend_4h === 'BULL') score += 8;
      else if (trend_4h === 'BEAR') score -= 8;

      if (trend_15m === 'BULL') score += 7;
      else if (trend_15m === 'BEAR') score -= 7;

      if (trend_3m === 'BULL') score += 7;
      else if (trend_3m === 'BEAR') score -= 7;

      if (trend_1m === 'BULL') score += 6;
      else if (trend_1m === 'BEAR') score -= 6;

      // Poids S/R (total 23 pts)
      // Prix au-dessus des supports clés
      if (currentPrice > sr_24h.support) score += 5;
      if (currentPrice > sr_4h.support)  score += 4;
      if (currentPrice > sr_1h.support)  score += 3;
      if (currentPrice > sr_15m.support) score += 3;
      if (currentPrice > sr_3m.support)  score += 2;
      if (currentPrice > sr_1m.support)  score += 2;

      // Prix sous les résistances clés
      const distToRes21d = (sr_21d.resistance - currentPrice) / currentPrice * 100;
      const distToRes7d  = (sr_7d.resistance - currentPrice) / currentPrice * 100;
      if (distToRes21d > 0.3) score += 2;
      if (distToRes7d > 0.2)  score += 2;

      // Normalise 0-100
      const normalizedScore = Math.min(100, Math.max(0, score + 50));

      this.lastScore = normalizedScore;
      this.lastAnalysis = {
        score: normalizedScore,
        trends: { trend_21d, trend_7d, trend_24h, trend_12h, trend_4h, trend_15m, trend_3m, trend_1m },
        sr: { sr_21d, sr_7d, sr_24h, sr_4h, sr_1h, sr_15m, sr_3m, sr_1m },
        currentPrice,
        bias: normalizedScore >= 65 ? 'BULL' : normalizedScore <= 35 ? 'BEAR' : 'NEUTRAL'
      };

      console.log(`📊 ${this.symbol} MTF Score:${normalizedScore.toFixed(0)} | 21d:${trend_21d} 7d:${trend_7d} 24h:${trend_24h} 4h:${trend_4h} 15m:${trend_15m} 3m:${trend_3m} 1m:${trend_1m} | Bias:${this.lastAnalysis.bias}`);

      return this.lastAnalysis;
    } catch(e) {
      console.error(`❌ ${this.symbol} MTF analyze: ${e.message}`);
      return this.lastAnalysis || { score: 50, bias: 'NEUTRAL' };
    }
  }
}

module.exports = MultiTimeframeAnalyzer;
