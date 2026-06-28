const https = require('https');
const crypto = require('crypto');
const { TradingSwarm } = require('./ruflo-trader');
const MultiTimeframeAnalyzer = require('./multi-timeframe');

const BASE_URL = 'testnet.binancefuture.com';
const TAKER_FEE = 0.0004;

const SYMBOLS = [
  { symbol: 'BTCUSDT', precision: 3, minQty: 0.001 },
  { symbol: 'ETHUSDT', precision: 3, minQty: 0.001 },
  { symbol: 'SOLUSDT', precision: 1, minQty: 0.1   },
  { symbol: 'BNBUSDT', precision: 2, minQty: 0.01  },
  { symbol: 'XRPUSDT', precision: 0, minQty: 1     }
];

class SymbolBot {
  constructor(symbolConfig, engine) {
    this.symbol = symbolConfig.symbol;
    this.precision = symbolConfig.precision;
    this.minQty = symbolConfig.minQty;
    this.engine = engine;
    this.swarm = new TradingSwarm();
    this.mtf = new MultiTimeframeAnalyzer(this.symbol);
    this.priceHistory = [];
    this.currentPrice = 0;
    this.openTrade = null;
    this.lastOpenTime = 0;
    this.lastMTFTime = 0;
    this.MTF_REFRESH_MS = 60000;
    this.TRADE_TIMEOUT_MS = 180000; // ✅ 3min timeout (TP 2% prend plus de temps)
    console.log(`⚙️  SymbolBot | ${this.symbol}`);
  }

  async fetchPrice() {
    try {
      const data = await new Promise((resolve, reject) => {
        https.get({
          hostname: BASE_URL,
          path: `/fapi/v1/ticker/price?symbol=${this.symbol}`
        }, res => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
        }).on('error', reject);
      });
      return parseFloat(data.price);
    } catch(e) { return 0; }
  }

  calcFees(entry, exit, qty) {
    return parseFloat(((entry * qty * TAKER_FEE) + (exit * qty * TAKER_FEE)).toFixed(4));
  }

  async forceClose(price, reason) {
    try {
      const grossPnL = (price - this.openTrade.entry) * this.openTrade.qty;
      const fees = this.calcFees(this.openTrade.entry, price, this.openTrade.qty);
      const netPnL = grossPnL - fees;
      console.log(`⏱️  ${this.symbol} FORCE CLOSE | ${reason} | Net:${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`);

      await this.engine.request('DELETE', '/fapi/v1/allOpenOrders', { symbol: this.symbol });
      await this.engine.request('POST', '/fapi/v1/order', {
        symbol: this.symbol, side: 'SELL', type: 'MARKET',
        quantity: this.openTrade.qty, reduceOnly: 'true'
      });

      const closedTrade = {
        ...this.openTrade, exit: price, closeTime: Date.now(),
        grossPnL: parseFloat(grossPnL.toFixed(4)),
        fees, pnl: parseFloat(netPnL.toFixed(4)),
        status: netPnL > 0 ? 'TIMEOUT+' : 'TIMEOUT-'
      };

      this.engine.closedTrades.push(closedTrade);
      this.engine.totalFees += fees;
      this.engine.capital += netPnL;
      this.engine.openTrades = this.engine.openTrades.filter(t => t.id !== this.openTrade.id);
      this.swarm.recordTrade({ ...closedTrade, symbol: this.symbol });
      console.log(`📊 ${this.symbol} Net:${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)} | Capital:$${this.engine.capital.toFixed(2)}`);
      this.openTrade = null;
    } catch(e) {
      console.error(`❌ ${this.symbol} forceClose: ${e.message}`);
      this.openTrade = null;
    }
  }

  async syncPosition(price) {
    try {
      if (!this.openTrade) return;
      const now = Date.now();
      const tradeAge = now - this.openTrade.openTime;
      const grossPnL = (price - this.openTrade.entry) * this.openTrade.qty;
      const grossPnLPct = (price - this.openTrade.entry) / this.openTrade.entry * 100;

      // ✅ Trailing SL : accroche si profit > 1%
      if (grossPnLPct > 1.0 && price > (this.openTrade.highPrice || this.openTrade.entry)) {
        this.openTrade.highPrice = price;
        const newSL = parseFloat((price * 0.99).toFixed(2));
        if (newSL > this.openTrade.sl) {
          this.openTrade.sl = newSL;
          console.log(`📈 ${this.symbol} TRAILING SL → $${newSL.toFixed(2)} (+1% protégé)`);
        }
      }

      // ✅ Timeout SEULEMENT si en bénéfice net (après fees estimées)
      if (tradeAge >= this.TRADE_TIMEOUT_MS) {
        const estimatedFees = this.calcFees(this.openTrade.entry, price, this.openTrade.qty);
        const estimatedNet = grossPnL - estimatedFees;
        if (estimatedNet > 0) {
          await this.forceClose(price, `3min + profit net +$${estimatedNet.toFixed(2)}`);
        } else {
          console.log(`⏳ ${this.symbol} 3min écoulées mais perte nette ($${estimatedNet.toFixed(2)}) | Attend SL/TP`);
        }
        return;
      }

      const result = await this.engine.request('GET', '/fapi/v2/positionRisk', { symbol: this.symbol });
      const positions = Array.isArray(result) ? result : [];
      const active = positions.find(p => Math.abs(parseFloat(p.positionAmt)) > 0);
      const currentAmt = active ? Math.abs(parseFloat(active.positionAmt)) : 0;

      if (currentAmt === 0 && this.openTrade) {
        let realGross = grossPnL;
        try {
          const income = await this.engine.request('GET', '/fapi/v1/income', {
            symbol: this.symbol, incomeType: 'REALIZED_PNL', limit: 1
          });
          if (Array.isArray(income) && income.length > 0) realGross = parseFloat(income[0].income);
        } catch(e) {}

        const fees = this.calcFees(this.openTrade.entry, price, this.openTrade.qty);
        const netPnL = realGross - fees;

        const closedTrade = {
          ...this.openTrade, exit: price, closeTime: Date.now(),
          grossPnL: parseFloat(realGross.toFixed(4)),
          fees, pnl: parseFloat(netPnL.toFixed(4)),
          status: netPnL > 0 ? 'TP' : 'SL'
        };

        this.engine.closedTrades.push(closedTrade);
        this.engine.totalFees += fees;
        this.engine.capital += netPnL;
        this.engine.openTrades = this.engine.openTrades.filter(t => t.id !== this.openTrade.id);
        this.swarm.recordTrade({ ...closedTrade, symbol: this.symbol });
        console.log(`📊 ${this.symbol} ${closedTrade.status} | Net:${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)} | Capital:$${this.engine.capital.toFixed(2)}`);
        this.openTrade = null;
      } else if (active) {
        const unrealPnL = parseFloat(active.unRealizedProfit || 0);
        const remaining = Math.max(0, this.TRADE_TIMEOUT_MS - tradeAge);
        const estFees = this.calcFees(this.openTrade.entry, price, this.openTrade.qty);
        const estNet = unrealPnL - estFees;
        console.log(`🔄 ${this.symbol} | Gross:${unrealPnL >= 0 ? '+' : ''}$${unrealPnL.toFixed(2)} | Fees:-$${estFees.toFixed(2)} | Net:${estNet >= 0 ? '+' : ''}$${estNet.toFixed(2)} | SL:$${this.openTrade.sl.toFixed(2)} | ${Math.floor(remaining/1000)}s`);
      }
    } catch(e) { console.error(`❌ ${this.symbol} sync: ${e.message}`); }
  }

  async placeOrder(price, sig, mtfScore) {
    try {
      const stake = this.engine.getStake();
      const lev = sig.leverage || 7;
      const tpPct = sig.tp || 0.020;
      const slPct = sig.sl || 0.010;

      // ✅ Anti corrélation baissière
      const bearAssets = this.engine.bots
        .filter(b => b.symbol !== this.symbol)
        .filter(b => b.mtf?.lastAnalysis?.bias === 'BEAR').length;
      if (bearAssets >= 3) {
        console.log(`⛔ ${this.symbol} | Corrélation baissière ${bearAssets}/4 | SKIP`);
        return;
      }

      // ✅ Asset health check
      if (!this.swarm.isAssetHealthy(this.symbol)) {
        console.log(`⛔ ${this.symbol} WR < 40% | SKIP`);
        return;
      }

      await this.engine.request('POST', '/fapi/v1/leverage', { symbol: this.symbol, leverage: lev });

      const qty = parseFloat((stake * lev / price).toFixed(this.precision));
      if (qty < this.minQty) {
        console.log(`⚠️  ${this.symbol}: qty ${qty} < min ${this.minQty}`);
        return;
      }

      const order = await this.engine.request('POST', '/fapi/v1/order', {
        symbol: this.symbol, side: 'BUY', type: 'MARKET', quantity: qty
      });

      if (order && order.orderId) {
        const sl = parseFloat((price * (1 - slPct)).toFixed(2));
        const tp = parseFloat((price * (1 + tpPct)).toFixed(2));

        await this.engine.request('POST', '/fapi/v1/order', {
          symbol: this.symbol, side: 'SELL', type: 'STOP_MARKET',
          stopPrice: sl, closePosition: 'true'
        });
        await this.engine.request('POST', '/fapi/v1/order', {
          symbol: this.symbol, side: 'SELL', type: 'TAKE_PROFIT_MARKET',
          stopPrice: tp, closePosition: 'true'
        });

        this.openTrade = {
          id: order.orderId, symbol: this.symbol,
          entry: price, qty, stake, sl, tp,
          highPrice: price, direction: 'LONG',
          openTime: Date.now(), leverage: lev,
          mtfScore, q: sig.q, tpPct, slPct
        };

        this.lastOpenTime = Date.now();
        this.engine.tradeCount++;
        this.engine.openTrades.push(this.openTrade);
        console.log(`✅ #${this.engine.tradeCount} ${this.symbol} | $${price} | Q:${sig.q.toFixed(0)} | Lev:${lev}x | TP:+${(tpPct*100).toFixed(1)}%($${tp}) | SL:-${(slPct*100).toFixed(1)}%($${sl}) | Mise:$${stake}`);
      } else {
        console.error(`❌ ${this.symbol} rejeté: ${JSON.stringify(order)}`);
      }
    } catch(e) { console.error(`❌ ${this.symbol} placeOrder: ${e.message}`); }
  }

  async tick() {
    const price = await this.fetchPrice();
    if (price === 0) return;
    this.currentPrice = price;
    this.priceHistory.push(price);
    if (this.priceHistory.length > 300) this.priceHistory.shift();

    await this.syncPosition(price);

    if (this.priceHistory.length < 50) {
      console.log(`⏳ ${this.symbol} Init (${this.priceHistory.length}/50)`);
      return;
    }

    const now = Date.now();
    if (now - this.lastMTFTime >= this.MTF_REFRESH_MS) {
      await this.mtf.analyze(price);
      this.lastMTFTime = now;
    }

    const mtfScore = this.mtf.lastScore || 50;
    const mtfBias = this.mtf.lastAnalysis?.bias || 'NEUTRAL';

    const sig = this.swarm.coordinate(this.priceHistory, {
      capital: this.engine.capital,
      trades: this.engine.openTrades
    });

    const timeSinceLast = now - this.lastOpenTime;

    // ✅ Filtre MA20 : prix doit être au-dessus de la moyenne
    const ma20 = this.priceHistory.slice(-20).reduce((a,b) => a+b, 0) / 20;
    const aboveMA20 = price > ma20;

    console.log(`💹 ${this.symbol}: $${price.toFixed(2)} | Q:${sig.q.toFixed(0)} | RSI:${(sig.rsi||50).toFixed(0)} | ${sig.action} | Lev:${sig.leverage}x | MA20:${aboveMA20 ? '✅' : '❌'} | MTF:${mtfScore.toFixed(0)}(${mtfBias}) | Pos:${this.openTrade ? '1' : '0'}`);

    // ✅ CONDITIONS OUVERTURE STRICTES
    if (
      sig.action === 'BUY' &&
      sig.q >= 50 &&
      aboveMA20 &&
      mtfBias !== 'BEAR' &&
      !this.openTrade &&
      timeSinceLast >= 6000 &&
      this.engine.config.apiKey
    ) {
      await this.placeOrder(price, sig, mtfScore);
    }
  }
}

class TradingEngine {
  constructor(config = {}) {
    this.config = {
      apiKey: process.env.BINANCE_API_KEY || '',
      apiSecret: process.env.BINANCE_API_SECRET || '',
      capital: parseInt(process.env.CAPITAL) || 500,
      tickMs: 2000,
      ...config
    };
    this.bots = SYMBOLS.map(s => new SymbolBot(s, this));
    this.openTrades = [];
    this.closedTrades = [];
    this.capital = this.config.capital;
    this.startCapital = this.config.capital;
    this.totalFees = 0;
    this.running = false;
    this.tradeCount = 0;
    this.profitTakingConfig = {
      5000:  { toSave: 1000, newCapital: 4000,  done: false },
      10000: { toSave: 1000, newCapital: 9000,  done: false },
      15000: { toSave: 1000, newCapital: 14000, done: false },
      20000: { toSave: 3000, newCapital: 17000, done: false }
    };
    this.pendingProfitTaking = null;
    console.log(`⚙️  TradingEngine v6.1 | ${SYMBOLS.length} assets | Capital: $${this.capital}`);
  }

  sign(params) {
    const query = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
    const sig = crypto.createHmac('sha256', this.config.apiSecret).update(query).digest('hex');
    return `${query}&signature=${sig}`;
  }

  async request(method, path, params = {}) {
    params.timestamp = Date.now();
    params.recvWindow = 5000;
    const query = this.sign(params);
    return new Promise((resolve, reject) => {
      const options = {
        hostname: BASE_URL,
        path: method === 'GET' ? `${path}?${query}` : path,
        method,
        headers: {
          'X-MBX-APIKEY': this.config.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      };
      const req = https.request(options, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
      });
      req.on('error', reject);
      if (method !== 'GET') req.write(query);
      req.end();
    });
  }

  getStake() {
    const cap = this.capital;
    let base = 65, special = 100;
    if (cap >= 25000)      { base = 2000; special = 4500; }
    else if (cap >= 20000) { base = 900;  special = 1500; }
    else if (cap >= 10000) { base = 875;  special = 1500; }
    else if (cap >= 5000)  { base = 475;  special = 750;  }
    else if (cap >= 2000)  { base = 195;  special = 325;  }
    else if (cap >= 1000)  { base = 125;  special = 185;  }
    else                   { base = 65;   special = 100;  }
    if (this.tradeCount > 0 && this.tradeCount % 10 === 0) {
      console.log(`💥 TRADE SPÉCIAL (1/10) | Mise: $${special}`);
      return special;
    }
    return base;
  }

  checkProfitTaking() {
    if (this.pendingProfitTaking) return;
    for (const [threshold, cfg] of Object.entries(this.profitTakingConfig)) {
      const t = parseInt(threshold);
      if (this.capital >= t && !cfg.done) {
        cfg.done = true;
        this.pendingProfitTaking = { threshold: t, toSave: cfg.toSave, newCapital: cfg.newCapital };
        console.log(`🎯 PROFIT TAKING | $${this.capital.toFixed(0)} >= $${t} | Sauvegarder $${cfg.toSave}?`);
        break;
      }
    }
  }

  acceptProfitTaking() {
    if (!this.pendingProfitTaking) return false;
    const { toSave, newCapital } = this.pendingProfitTaking;
    console.log(`💾 $${toSave} SAUVEGARDÉS | Capital: $${this.capital.toFixed(2)} → $${newCapital}`);
    this.capital = newCapital;
    this.pendingProfitTaking = null;
    return true;
  }

  rejectProfitTaking() {
    if (!this.pendingProfitTaking) return false;
    console.log(`❌ Profit taking refusé | Capital: $${this.capital.toFixed(2)}`);
    this.pendingProfitTaking = null;
    return true;
  }

  async tick() {
    await Promise.all(this.bots.map(bot => bot.tick()));
    this.checkProfitTaking();
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log(`🚀 MULTI-BOT v6.1 | ${SYMBOLS.length} assets | Capital:$${this.capital}`);
    console.log(`🎯 Q>=50 | MA20 filter | TP:+2/2.5% | SL:-1% trailing | Lev:3/7/12x | Fees auto-calculés`);
    while (this.running) {
      try { await this.tick(); }
      catch(e) { console.error(`❌ Tick: ${e.message}`); }
      await new Promise(r => setTimeout(r, this.config.tickMs));
    }
  }

  stop() {
    this.running = false;
    const netPnL = this.closedTrades.reduce((s, t) => s + t.pnl, 0);
    const grossPnL = this.closedTrades.reduce((s, t) => s + (t.grossPnL || t.pnl), 0);
    console.log(`⏸️  BOT STOPPÉ`);
    console.log(`💰 Capital final: $${this.capital.toFixed(2)}`);
    console.log(`📊 Gross PnL: +$${grossPnL.toFixed(2)}`);
    console.log(`💸 Total Fees: -$${this.totalFees.toFixed(2)}`);
    console.log(`✅ NET PnL: ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`);
    console.log(`📈 ROI NET: ${((netPnL/this.startCapital)*100).toFixed(2)}%`);
  }

  getStats() {
    const totalTrades = this.closedTrades.length;
    const winTrades = this.closedTrades.filter(t => t.pnl > 0).length;
    const lossTrades = this.closedTrades.filter(t => t.pnl < 0).length;
    const grossPnL = this.closedTrades.reduce((s, t) => s + (t.grossPnL || t.pnl), 0);
    const netPnL = this.closedTrades.reduce((s, t) => s + t.pnl, 0);
    const winRate = totalTrades > 0 ? (winTrades / totalTrades * 100).toFixed(1) : 0;
    const currentPrices = {};
    this.bots.forEach(b => { currentPrices[b.symbol] = b.currentPrice || 0; });
    const mtfScores = {};
    this.bots.forEach(b => {
      mtfScores[b.symbol] = {
        score: b.mtf.lastScore || 0,
        bias: b.mtf.lastAnalysis?.bias || 'NEUTRAL',
        trends: b.mtf.lastAnalysis?.trends || {}
      };
    });
    return {
      openTrades: this.openTrades.length,
      closedTrades: totalTrades,
      winTrades, lossTrades,
      grossPnL: parseFloat(grossPnL.toFixed(2)),
      totalFees: parseFloat(this.totalFees.toFixed(2)),
      totalPnL: parseFloat(netPnL.toFixed(2)),
      winRate: parseFloat(winRate),
      capital: parseFloat(this.capital.toFixed(2)),
      startCapital: this.startCapital,
      netRoi: ((netPnL / this.startCapital) * 100).toFixed(2),
      running: this.running,
      currentStake: this.getStake(),
      tradeCount: this.tradeCount,
      mode: 'MULTI-ASSET v6.1',
      currentPrices, mtfScores,
      pendingProfitTaking: this.pendingProfitTaking
    };
  }
}

module.exports = TradingEngine;
