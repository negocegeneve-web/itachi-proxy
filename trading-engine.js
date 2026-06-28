// trading-engine.js — v6.0
const https = require('https');
const crypto = require('crypto');
const { TradingSwarm } = require('./ruflo-trader');
const MultiTimeframeAnalyzer = require('./multi-timeframe');

const BASE_URL = 'testnet.binancefuture.com';
const TAKER_FEE = 0.0004; // 0.04%

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
    this.MTF_REFRESH_MS = 60000; // ✅ 60s (allégé)
    this.TRADE_TIMEOUT_MS = 120000; // 2min
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
          res.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch(e) { reject(e); }
          });
        }).on('error', reject);
      });
      return parseFloat(data.price);
    } catch(e) {
      return 0;
    }
  }

  // ✅ Fee calculation
  calcFees(entry, exit, qty) {
    const entryFee = entry * qty * TAKER_FEE;
    const exitFee = exit * qty * TAKER_FEE;
    return parseFloat((entryFee + exitFee).toFixed(4));
  }

  async forceClose(price, reason) {
    try {
      const grossPnL = (price - this.openTrade.entry) * this.openTrade.qty;
      const fees = this.calcFees(this.openTrade.entry, price, this.openTrade.qty);
      const netPnL = grossPnL - fees;

      console.log(`⏱️  ${this.symbol} FORCE CLOSE | ${reason} | Gross:$${grossPnL.toFixed(2)} | Fees:$${fees.toFixed(2)} | Net:$${netPnL.toFixed(2)}`);

      await this.engine.request('DELETE', '/fapi/v1/allOpenOrders', { symbol: this.symbol });
      await this.engine.request('POST', '/fapi/v1/order', {
        symbol: this.symbol,
        side: 'SELL',
        type: 'MARKET',
        quantity: this.openTrade.qty,
        reduceOnly: 'true'
      });

      const closedTrade = {
        ...this.openTrade,
        exit: price,
        closeTime: Date.now(),
        grossPnL: parseFloat(grossPnL.toFixed(4)),
        fees: fees,
        pnl: parseFloat(netPnL.toFixed(4)),
        status: netPnL > 0 ? 'TIMEOUT+' : 'TIMEOUT-'
      };

      this.engine.closedTrades.push(closedTrade);
      this.engine.totalFees += fees;
      this.engine.capital += netPnL;
      this.engine.openTrades = this.engine.openTrades.filter(t => t.id !== this.openTrade.id);
      this.swarm.recordTrade({ ...closedTrade, symbol: this.symbol });

      console.log(`📊 ${this.symbol} NET: ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)} | Capital: $${this.engine.capital.toFixed(2)}`);
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

      // ✅ Trailing SL : accroche si profit > 0.5%
      if (grossPnLPct > 0.5 && price > (this.openTrade.highPrice || this.openTrade.entry)) {
        this.openTrade.highPrice = price;
        const newSL = parseFloat((price * 0.99).toFixed(2));
        if (newSL > this.openTrade.sl) {
          this.openTrade.sl = newSL;
          console.log(`📈 ${this.symbol} TRAILING SL → $${newSL.toFixed(2)}`);
        }
      }

      // ✅ Timeout SEULEMENT si en bénéfice
      if (tradeAge >= this.TRADE_TIMEOUT_MS) {
        if (grossPnLPct > 0) {
          await this.forceClose(price, `2min + bénéfice +${grossPnLPct.toFixed(2)}%`);
        } else {
          console.log(`⏳ ${this.symbol} Timeout mais en perte (${grossPnLPct.toFixed(2)}%) | Attend SL ou TP`);
        }
        return;
      }

      // Check position Binance
      const result = await this.engine.request('GET', '/fapi/v2/positionRisk', { symbol: this.symbol });
      const positions = Array.isArray(result) ? result : [];
      const active = positions.find(p => Math.abs(parseFloat(p.positionAmt)) > 0);
      const currentAmt = active ? Math.abs(parseFloat(active.positionAmt)) : 0;

      if (currentAmt === 0 && this.openTrade) {
        let realGrossPnL = grossPnL;
        try {
          const income = await this.engine.request('GET', '/fapi/v1/income', {
            symbol: this.symbol, incomeType: 'REALIZED_PNL', limit: 1
          });
          if (Array.isArray(income) && income.length > 0) {
            realGrossPnL = parseFloat(income[0].income);
          }
        } catch(e) {}

        const fees = this.calcFees(this.openTrade.entry, price, this.openTrade.qty);
        const netPnL = realGrossPnL - fees;

        const closedTrade = {
          ...this.openTrade,
          exit: price,
          closeTime: Date.now(),
          grossPnL: parseFloat(realGrossPnL.toFixed(4)),
          fees,
          pnl: parseFloat(netPnL.toFixed(4)),
          status: netPnL > 0 ? 'TP' : 'SL'
        };

        this.engine.closedTrades.push(closedTrade);
        this.engine.totalFees += fees;
        this.engine.capital += netPnL;
        this.engine.openTrades = this.engine.openTrades.filter(t => t.id !== this.openTrade.id);
        this.swarm.recordTrade({ ...closedTrade, symbol: this.symbol });

        console.log(`📊 ${this.symbol} ${closedTrade.status} | Gross:$${realGrossPnL.toFixed(2)} | Fees:$${fees.toFixed(2)} | Net:$${netPnL.toFixed(2)} | Capital:$${this.engine.capital.toFixed(2)}`);
        this.openTrade = null;
      } else if (active) {
        const unrealPnL = parseFloat(active.unRealizedProfit || 0);
        const remaining = Math.max(0, this.TRADE_TIMEOUT_MS - tradeAge);
        console.log(`🔄 ${this.symbol} | PnL:${unrealPnL >= 0 ? '+' : ''}$${unrealPnL.toFixed(2)} | SL:$${this.openTrade.sl.toFixed(2)} | ${Math.floor(remaining/1000)}s`);
      }
    } catch(e) {
      console.error(`❌ ${this.symbol} sync: ${e.message}`);
    }
  }

  async placeOrder(price, sig, mtfScore) {
    try {
      const stake = this.engine.getStake();
      const lev = sig.leverage || 7;
      const tpPct = sig.tp || 0.010;
      const slPct = sig.sl || 0.010;

      // ✅ Anti trades contradictoires
      const bearAssets = this.engine.bots
        .filter(b => b.symbol !== this.symbol)
        .filter(b => b.mtf?.lastAnalysis?.bias === 'BEAR').length;

      if (bearAssets >= 3) {
        console.log(`⛔ ${this.symbol} | Corrélation baissière ${bearAssets}/4 autres assets | SKIP`);
        return;
      }

      // ✅ Check asset health (learning)
      if (!this.swarm.isAssetHealthy(this.symbol)) {
        console.log(`⛔ ${this.symbol} WR < 35% | SKIP`);
        return;
      }

      await this.engine.request('POST', '/fapi/v1/leverage', {
        symbol: this.symbol, leverage: lev
      });

      const qty = parseFloat((stake * lev / price).toFixed(this.precision));
      if (qty < this.minQty) {
        console.log(`⚠️  ${this.symbol}: qty ${qty} < min ${this.minQty}`);
        return;
      }

      const order = await this.engine.request('POST', '/fapi/v1/order', {
        symbol: this.symbol,
        side: 'BUY',
        type: 'MARKET',
        quantity: qty
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
          id: order.orderId,
          symbol: this.symbol,
          entry: price,
          qty,
          stake,
          sl,
          tp,
          highPrice: price,
          direction: 'LONG',
          openTime: Date.now(),
          leverage: lev,
          mtfScore,
          q: sig.q,
          tpPct,
          slPct
        };

        this.lastOpenTime = Date.now();
        this.engine.tradeCount++;
        this.engine.openTrades.push(this.openTrade);

        console.log(`✅ #${this.engine.tradeCount} ${this.symbol} | $${price} | Q:${sig.q.toFixed(0)} | Lev:${lev}x | TP:+${(tpPct*100).toFixed(1)}% | SL:-${(slPct*100).toFixed(1)}% | Mise:$${stake}`);
      } else {
        console.error(`❌ ${this.symbol} rejeté: ${JSON.stringify(order)}`);
      }
    } catch(e) {
      console.error(`❌ ${this.symbol} placeOrder: ${e.message}`);
    }
  }

  async tick() {
    const price = await this.fetchPrice();
    if (price === 0) return;

    this.currentPrice = price;
    this.priceHistory.push(price);
    if (this.priceHistory.length > 300) this.priceHistory.shift();

    await this.syncPosition(price);

    if (this.priceHistory.length < 30) {
      console.log(`⏳ ${this.symbol} Init (${this.priceHistory.length}/30)`);
      return;
    }

    const now = Date.now();

    // ✅ Refresh MTF toutes les 60s
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

    console.log(`💹 ${this.symbol}: $${price.toFixed(2)} | Q:${sig.q.toFixed(0)} | RSI:${sig.rsi?.toFixed(0)} | ${sig.action} | Lev:${sig.leverage}x | MTF:${mtfScore.toFixed(0)}(${mtfBias}) | Pos:${this.openTrade ? '1' : '0'}`);

    if (
      sig.action === 'BUY' &&
      sig.q >= 30 &&
      mtfScore >= 45 &&
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

    // ✅ Profit taking seuils (1 fois chacun)
    this.profitTakingConfig = {
      5000:  { toSave: 1000, newCapital: 4000,  done: false },
      10000: { toSave: 1000, newCapital: 9000,  done: false },
      15000: { toSave: 1000, newCapital: 14000, done: false },
      20000: { toSave: 3000, newCapital: 17000, done: false }
    };
    this.pendingProfitTaking = null;

    console.log(`⚙️  TradingEngine v6.0 | ${SYMBOLS.length} assets | Capital: $${this.capital}`);
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
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      if (method !== 'GET') req.write(query);
      req.end();
    });
  }

  // ✅ Mises personnalisées avec 1 trade spécial sur 10
  getStake() {
    const cap = this.capital;
    let base = 65;
    let special = 100;

    if (cap >= 25000)     { base = 2000; special = 4500; }
    else if (cap >= 20000){ base = 900;  special = 1500; }
    else if (cap >= 10000){ base = 875;  special = 1500; }
    else if (cap >= 5000) { base = 475;  special = 750;  }
    else if (cap >= 2000) { base = 195;  special = 325;  }
    else if (cap >= 1000) { base = 125;  special = 185;  }
    else                  { base = 65;   special = 100;  }

    // ✅ 1 trade sur 10 = mise spéciale (le plus sûr = Q élevé)
    if (this.tradeCount > 0 && this.tradeCount % 10 === 0) {
      console.log(`💥 TRADE SPÉCIAL (1/10) | Mise: $${special}`);
      return special;
    }

    return base;
  }

  // ✅ Check profit taking
  checkProfitTaking() {
    if (this.pendingProfitTaking) return; // Déjà une pending

    for (const [threshold, cfg] of Object.entries(this.profitTakingConfig)) {
      const t = parseInt(threshold);
      if (this.capital >= t && !cfg.done) {
        cfg.done = true;
        this.pendingProfitTaking = {
          threshold: t,
          toSave: cfg.toSave,
          newCapital: cfg.newCapital
        };
        console.log(`🎯 PROFIT TAKING | Capital $${this.capital.toFixed(0)} >= $${t} | Sauvegarder $${cfg.toSave}?`);
        break;
      }
    }
  }

  acceptProfitTaking() {
    if (!this.pendingProfitTaking) return false;
    const { toSave, newCapital, threshold } = this.pendingProfitTaking;
    console.log(`💾 $${toSave} SAUVEGARDÉS | Capital: $${this.capital.toFixed(2)} → $${newCapital}`);
    this.capital = newCapital;
    this.pendingProfitTaking = null;
    return true;
  }

  rejectProfitTaking() {
    if (!this.pendingProfitTaking) return false;
    console.log(`❌ Profit taking refusé | Capital conservé: $${this.capital.toFixed(2)}`);
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
    console.log(`🚀 MULTI-BOT v6.0 | ${SYMBOLS.length} assets | Capital:$${this.capital}`);
    console.log(`🎯 TP:+0.5/1/2% (Q adaptatif) | SL:-1% trailing | Lev:3/7/12x | Fees:0.04% calculés`);

    while (this.running) {
      try {
        await this.tick();
      } catch(e) {
        console.error(`❌ Tick: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, this.config.tickMs));
    }
  }

  stop() {
    this.running = false;
    const grossPnL = this.closedTrades.reduce((s, t) => s + (t.grossPnL || t.pnl), 0);
    const netPnL = this.closedTrades.reduce((s, t) => s + t.pnl, 0);
    console.log(`⏸️  BOT STOPPÉ`);
    console.log(`💰 Capital final: $${this.capital.toFixed(2)}`);
    console.log(`📊 Gross PnL: $${grossPnL.toFixed(2)}`);
    console.log(`💸 Total Fees: $${this.totalFees.toFixed(2)}`);
    console.log(`✅ Net PnL: $${netPnL.toFixed(2)}`);
    console.log(`📈 ROI Net: ${((netPnL / this.startCapital) * 100).toFixed(2)}%`);
  }

  getStats() {
    const totalTrades = this.closedTrades.length;
    const winTrades = this.closedTrades.filter(t => t.pnl > 0).length;
    const lossTrades = this.closedTrades.filter(t => t.pnl < 0).length;
    const grossPnL = this.closedTrades.reduce((s, t) => s + (t.grossPnL || t.pnl), 0);
    const netPnL = this.closedTrades.reduce((s, t) => s + t.pnl, 0);
    const winRate = totalTrades > 0 ? (winTrades / totalTrades * 100).toFixed(1) : 0;

    // Prix actuels par symbol
    const currentPrices = {};
    this.bots.forEach(b => { currentPrices[b.symbol] = b.currentPrice || 0; });

    // MTF scores
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
      winTrades,
      lossTrades,
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
      mode: 'MULTI-ASSET v6.0',
      currentPrices,
      mtfScores,
      pendingProfitTaking: this.pendingProfitTaking
    };
  }
}

module.exports = TradingEngine;
