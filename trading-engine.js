const https = require('https');
const crypto = require('crypto');
const { TradingSwarm } = require('./ruflo-trader');
const MultiTimeframeAnalyzer = require('./multi-timeframe');

const BASE_URL = 'testnet.binancefuture.com';
const TAKER_FEE = 0.0004;

const SYMBOLS = [
  { symbol: 'BTCUSDT',  precision: 3, minQty: 0.001 },
  { symbol: 'ETHUSDT',  precision: 3, minQty: 0.001 },
  { symbol: 'SOLUSDT',  precision: 1, minQty: 0.1   },
  { symbol: 'BNBUSDT',  precision: 2, minQty: 0.01  },
  { symbol: 'XRPUSDT',  precision: 0, minQty: 1     },
  { symbol: 'DOGEUSDT', precision: 0, minQty: 1     },
  { symbol: 'ADAUSDT',  precision: 0, minQty: 1     },
  { symbol: 'DOTUSDT',  precision: 1, minQty: 0.1   },
  { symbol: 'LINKUSDT', precision: 1, minQty: 0.1   },
  { symbol: 'LTCUSDT',  precision: 3, minQty: 0.001 }
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
    this.currentMarketMode = 'CALM';
    this.currentATR = 0;
    this.MTF_REFRESH_MS = 60000;

    // ✅ Timeouts adaptatifs
    this.TIMEOUT_CALM     = 45000;
    this.TIMEOUT_NORMAL   = 60000;
    this.TIMEOUT_VOLATILE = 120000;

    // ✅ Stop rapide adaptatif — moins sensible
    this.STOP_RAPID_CALM     = 3.00;
    this.STOP_RAPID_NORMAL   = 5.00;
    this.STOP_RAPID_VOLATILE = 8.00;

    // ✅ Trailing SL APRES TP atteint uniquement
    this.TRAIL_AFTER_TP_PCT = 0.005;

    console.log(`⚙️  SymbolBot | ${this.symbol}`);
  }

  getTimeout() {
    if (this.currentMarketMode === 'VOLATILE') return this.TIMEOUT_VOLATILE;
    if (this.currentMarketMode === 'NORMAL')   return this.TIMEOUT_NORMAL;
    return this.TIMEOUT_CALM;
  }

  getStopRapid() {
    if (this.currentMarketMode === 'VOLATILE') return this.STOP_RAPID_VOLATILE;
    if (this.currentMarketMode === 'NORMAL')   return this.STOP_RAPID_NORMAL;
    return this.STOP_RAPID_CALM;
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
      const isLong = this.openTrade.direction === 'LONG';
      const grossPnL = isLong
        ? (price - this.openTrade.entry) * this.openTrade.qty
        : (this.openTrade.entry - price) * this.openTrade.qty;
      const fees = this.calcFees(this.openTrade.entry, price, this.openTrade.qty);
      const netPnL = grossPnL - fees;

      console.log(`⏱️  ${this.symbol} CLOSE | ${reason} | Net:${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`);

      await this.engine.request('DELETE', '/fapi/v1/allOpenOrders', { symbol: this.symbol });
      await this.engine.request('POST', '/fapi/v1/order', {
        symbol: this.symbol,
        side: isLong ? 'SELL' : 'BUY',
        type: 'MARKET',
        quantity: this.openTrade.qty,
        reduceOnly: 'true'
      });

      const closedTrade = {
        ...this.openTrade, exit: price, closeTime: Date.now(),
        grossPnL: parseFloat(grossPnL.toFixed(4)),
        fees, pnl: parseFloat(netPnL.toFixed(4)),
        status: netPnL > 0 ? 'TIMEOUT+' : 'STOP-RAPIDE',
        marketMode: this.currentMarketMode
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

  async syncPosition(price, sig) {
    try {
      if (!this.openTrade) return false;
      const now = Date.now();
      const tradeAge = now - this.openTrade.openTime;
      const isLong = this.openTrade.direction === 'LONG';
      const timeout = this.getTimeout();
      const stopRapid = this.getStopRapid();

      const grossPnL = isLong
        ? (price - this.openTrade.entry) * this.openTrade.qty
        : (this.openTrade.entry - price) * this.openTrade.qty;
      const estFees = this.calcFees(this.openTrade.entry, price, this.openTrade.qty);
      const estNet = grossPnL - estFees;
      const pricePctFromEntry = isLong
        ? (price - this.openTrade.entry) / this.openTrade.entry
        : (this.openTrade.entry - price) / this.openTrade.entry;

      // ✅ STOP RAPIDE après 45s
      if (tradeAge > 45000 && estNet < -stopRapid) {
        console.log(`🛑 ${this.symbol} STOP RAPIDE | -$${Math.abs(estNet).toFixed(2)} > $${stopRapid}`);
        await this.forceClose(price, `STOP RAPIDE -$${Math.abs(estNet).toFixed(2)}`);
        return true;
      }

      // ✅ RETOURNEMENT : signal opposé + perte > $0.30
      if (sig && estNet < -0.30) {
        if (isLong && sig.action === 'SELL' && sig.q >= 65) {
          console.log(`🔄 ${this.symbol} RETOURNEMENT LONG→SHORT | -$${Math.abs(estNet).toFixed(2)}`);
          await this.forceClose(price, `RETOURNEMENT→SHORT`);
          return 'REVERSE_SHORT';
        }
        if (!isLong && sig.action === 'BUY' && sig.q >= 65) {
          console.log(`🔄 ${this.symbol} RETOURNEMENT SHORT→LONG | -$${Math.abs(estNet).toFixed(2)}`);
          await this.forceClose(price, `RETOURNEMENT→LONG`);
          return 'REVERSE_LONG';
        }
      }

      // ✅ TRAILING SL UNIQUEMENT après TP atteint
      const tpPct = this.openTrade.tpPct || 0.008;
      const tpAtteint = pricePctFromEntry >= tpPct;

      if (tpAtteint && !this.openTrade.tpReached) {
        this.openTrade.tpReached = true;
        this.openTrade.highPrice = price;
        this.openTrade.lowPrice = price;
        console.log(`🎯 ${this.symbol} TP ATTEINT +${(pricePctFromEntry*100).toFixed(2)}% | Trailing SL -0.5% activé`);
      }

      if (this.openTrade.tpReached) {
        if (isLong) {
          // ✅ Mise à jour highPrice UNIQUEMENT si prix monte
          if (price > this.openTrade.highPrice) {
            this.openTrade.highPrice = price;
          }
          // ✅ Trailing SL = -0.5% du pic, ne descend JAMAIS
          const newSL = parseFloat((this.openTrade.highPrice * (1 - this.TRAIL_AFTER_TP_PCT)).toFixed(2));
          if (newSL > this.openTrade.sl) {
            this.openTrade.sl = newSL;
            console.log(`📈 ${this.symbol} TRAIL SL → $${newSL.toFixed(2)} (pic:$${this.openTrade.highPrice.toFixed(2)})`);
          }
          // ✅ Ferme si prix sous trailing SL
          if (price <= this.openTrade.sl) {
            console.log(`🔒 ${this.symbol} TRAILING SL | $${price} <= $${this.openTrade.sl}`);
            await this.forceClose(price, `TRAILING SL après TP`);
            return false;
          }
        }

        if (!isLong) {
          // ✅ Mise à jour lowPrice UNIQUEMENT si prix baisse
          if (price < this.openTrade.lowPrice) {
            this.openTrade.lowPrice = price;
          }
          // ✅ Trailing SL SHORT = +0.5% du creux
          const newSL = parseFloat((this.openTrade.lowPrice * (1 + this.TRAIL_AFTER_TP_PCT)).toFixed(2));
          if (newSL < this.openTrade.sl) {
            this.openTrade.sl = newSL;
            console.log(`📉 ${this.symbol} SHORT TRAIL SL → $${newSL.toFixed(2)} (creux:$${this.openTrade.lowPrice.toFixed(2)})`);
          }
          // ✅ Ferme si prix au-dessus trailing SL
          if (price >= this.openTrade.sl) {
            console.log(`🔒 ${this.symbol} SHORT TRAILING SL | $${price} >= $${this.openTrade.sl}`);
            await this.forceClose(price, `SHORT TRAILING SL après TP`);
            return false;
          }
        }
      }

      // ✅ Timeout adaptatif
      if (tradeAge >= timeout) {
        if (estNet > 0) {
          await this.forceClose(price, `${Math.floor(timeout/1000)}s + profit +$${estNet.toFixed(2)}`);
        } else if (Math.abs(estNet) < 0.80) {
          await this.forceClose(price, `${Math.floor(timeout/1000)}s perte légère -$${Math.abs(estNet).toFixed(2)}`);
        } else {
          console.log(`⏳ ${this.symbol} Timeout perte lourde | Attend SL Binance`);
        }
        return false;
      }

      // Check Binance position
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
          status: netPnL > 0 ? (isLong ? 'TP' : 'TP-SHORT') : (isLong ? 'SL' : 'SL-SHORT'),
          marketMode: this.currentMarketMode
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
        const remaining = Math.max(0, timeout - tradeAge);
        const tpIcon = this.openTrade.tpReached ? '🎯TRAIL' : `TP@${(tpPct*100).toFixed(1)}%`;
        const modeIcon = this.currentMarketMode === 'VOLATILE' ? '🚀' : this.currentMarketMode === 'NORMAL' ? '🟢' : '🟡';
        console.log(`🔄 ${this.symbol} ${isLong ? '📈' : '📉'} ${tpIcon} | Gross:${unrealPnL >= 0 ? '+' : ''}$${unrealPnL.toFixed(2)} | Net:${estNet >= 0 ? '+' : ''}$${estNet.toFixed(2)} | SL:$${this.openTrade.sl.toFixed(2)} | ${modeIcon} | ${Math.floor(remaining/1000)}s`);
      }
      return false;
    } catch(e) {
      console.error(`❌ ${this.symbol} sync: ${e.message}`);
      return false;
    }
  }

  async placeOrder(price, sig, mtfScore) {
    try {
      const stake = this.engine.getStake();
      const lev = sig.leverage || 7;
      const tpPct = sig.tp || 0.008;
      const slPct = sig.sl || 0.004;
      const isLong = sig.direction === 'LONG';
      const side = isLong ? 'BUY' : 'SELL';
      const closeSide = isLong ? 'SELL' : 'BUY';

      if (isLong) {
        const bearAssets = this.engine.bots.filter(b => b.symbol !== this.symbol).filter(b => b.mtf?.lastAnalysis?.bias === 'BEAR').length;
        if (bearAssets >= 7) { console.log(`⛔ ${this.symbol} LONG bloqué`); return; }
      } else {
        const bullAssets = this.engine.bots.filter(b => b.symbol !== this.symbol).filter(b => b.mtf?.lastAnalysis?.bias === 'BULL').length;
        if (bullAssets >= 7) { console.log(`⛔ ${this.symbol} SHORT bloqué`); return; }
      }

      if (!this.swarm.isAssetHealthy(this.symbol)) { console.log(`⛔ ${this.symbol} WR < 40%`); return; }

      await this.engine.request('POST', '/fapi/v1/leverage', { symbol: this.symbol, leverage: lev });

      const qty = parseFloat((stake * lev / price).toFixed(this.precision));
      if (qty < this.minQty) { console.log(`⚠️  ${this.symbol}: qty ${qty} < min ${this.minQty}`); return; }

      const order = await this.engine.request('POST', '/fapi/v1/order', {
        symbol: this.symbol, side, type: 'MARKET', quantity: qty
      });

      if (order && order.orderId) {
        const sl = isLong
          ? parseFloat((price * (1 - slPct)).toFixed(2))
          : parseFloat((price * (1 + slPct)).toFixed(2));
        const tp = isLong
          ? parseFloat((price * (1 + tpPct)).toFixed(2))
          : parseFloat((price * (1 - tpPct)).toFixed(2));

        await this.engine.request('POST', '/fapi/v1/order', {
          symbol: this.symbol, side: closeSide, type: 'STOP_MARKET',
          stopPrice: sl, closePosition: 'true'
        });
        await this.engine.request('POST', '/fapi/v1/order', {
          symbol: this.symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
          stopPrice: tp, closePosition: 'true'
        });

        this.openTrade = {
          id: order.orderId, symbol: this.symbol,
          entry: price, qty, stake, sl, tp,
          highPrice: price,
          lowPrice: price,
          direction: sig.direction,
          tpReached: false,
          openTime: Date.now(), leverage: lev,
          mtfScore, q: sig.q, tpPct, slPct,
          marketMode: sig.marketMode
        };

        this.lastOpenTime = Date.now();
        this.engine.tradeCount++;
        this.engine.openTrades.push(this.openTrade);

        const modeIcon = sig.marketMode === 'VOLATILE' ? '🚀' : sig.marketMode === 'NORMAL' ? '🟢' : '🟡';
        console.log(`✅ #${this.engine.tradeCount} ${isLong ? '📈LONG' : '📉SHORT'} ${this.symbol} | $${price} | Q:${sig.q.toFixed(0)} | Lev:${lev}x | TP:+${(tpPct*100).toFixed(1)}%($${tp}) | SL:-${(slPct*100).toFixed(1)}%($${sl}) | ${modeIcon}${sig.marketMode} | Mise:$${stake}`);
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
    const sig = this.swarm.coordinate(this.priceHistory, {
      capital: this.engine.capital,
      trades: this.engine.openTrades
    });

    this.currentMarketMode = sig.marketMode || 'CALM';
    this.currentATR = sig.atr || 0;

    const reverseSignal = await this.syncPosition(price, sig);

    const modeIcon = sig.marketMode === 'VOLATILE' ? '🚀' : sig.marketMode === 'NORMAL' ? '🟢' : sig.marketMode === 'EXTREME' ? '🔴' : '🟡';
    const dirIcon = sig.direction === 'LONG' ? '📈' : sig.direction === 'SHORT' ? '📉' : '⏸️';
    console.log(`💹 ${this.symbol}: $${price.toFixed(2)} | Q:${sig.q.toFixed(0)} | RSI:${(sig.rsi||50).toFixed(0)} | ${dirIcon}${sig.action} | Lev:${sig.leverage}x | ${modeIcon}${sig.marketMode}(ATR:${(sig.atr||0).toFixed(3)}%) | Pos:${this.openTrade ? this.openTrade.direction : '0'}`);

    if (sig.marketMode === 'EXTREME') {
      console.log(`🔴 ${this.symbol} EXTREME | PAUSE`);
      return;
    }

    // ✅ Retournement immédiat
    if (reverseSignal === 'REVERSE_SHORT') {
      await this.placeOrder(price, { ...sig, action: 'SELL', direction: 'SHORT' }, mtfScore);
      return;
    }
    if (reverseSignal === 'REVERSE_LONG') {
      await this.placeOrder(price, { ...sig, action: 'BUY', direction: 'LONG' }, mtfScore);
      return;
    }

    const timeSinceLast = now - this.lastOpenTime;

    // ✅ Q minimum 65
    if (
      (sig.action === 'BUY' || sig.action === 'SELL') &&
      sig.q >= 65 &&
      !this.openTrade &&
      timeSinceLast >= 4000 &&
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
      capital: parseInt(process.env.CAPITAL) || 2000,
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
      10000: { toSave: 2000, newCapital: 8000,  done: false },
      20000: { toSave: 2000, newCapital: 18000, done: false },
      30000: { toSave: 2000, newCapital: 28000, done: false },
      50000: { toSave: 8000, newCapital: 42000, done: false }
    };
    this.pendingProfitTaking = null;
    console.log(`⚙️  TradingEngine v11.1 | ${SYMBOLS.length} assets | Capital: $${this.capital}`);
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
    let base = 195, special = 325;
    if (cap >= 80000)      { base = 8500;  special = 14000; }
    else if (cap >= 40000) { base = 4500;  special = 7500;  }
    else if (cap >= 20000) { base = 2500;  special = 4200;  }
    else if (cap >= 12000) { base = 1400;  special = 2300;  }
    else if (cap >= 8000)  { base = 750;   special = 1250;  }
    else if (cap >= 4000)  { base = 390;   special = 650;   }
    else                   { base = 195;   special = 325;   }
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
    console.log(`🚀 BOT v11.1 | ${SYMBOLS.length} assets | Capital:$${this.capital}`);
    console.log(`🎯 Q>=65 | LONG+SHORT | ATR Adaptive | Trailing SL après TP | Stop Rapide 45s`);
    console.log(`🟡 CALM:     TP+0.8% SL-0.4% Stop$3.0  Timeout45s`);
    console.log(`🟢 NORMAL:   TP+1.5% SL-0.7% Stop$5.0  Timeout60s`);
    console.log(`🚀 VOLATILE: TP+2.5% SL-1.0% Stop$8.0  Timeout120s`);
    console.log(`📊 Assets: ${SYMBOLS.map(s => s.symbol).join(', ')}`);
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
    console.log(`⏸️  BOT v11.1 STOPPÉ`);
    console.log(`💰 Capital: $${this.capital.toFixed(2)}`);
    console.log(`📊 Gross: ${grossPnL >= 0 ? '+' : ''}$${grossPnL.toFixed(2)} | Fees: -$${this.totalFees.toFixed(2)} | NET: ${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`);
    console.log(`📈 ROI: ${((netPnL/this.startCapital)*100).toFixed(2)}%`);
  }

  getStats() {
    const totalTrades = this.closedTrades.length;
    const winTrades = this.closedTrades.filter(t => t.pnl > 0).length;
    const lossTrades = this.closedTrades.filter(t => t.pnl < 0).length;
    const longTrades = this.closedTrades.filter(t => t.direction === 'LONG').length;
    const shortTrades = this.closedTrades.filter(t => t.direction === 'SHORT').length;
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
        trends: b.mtf.lastAnalysis?.trends || {},
        marketMode: b.currentMarketMode || 'CALM',
        atr: b.currentATR || 0
      };
    });
    return {
      openTrades: this.openTrades.length,
      closedTrades: totalTrades,
      winTrades, lossTrades, longTrades, shortTrades,
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
      mode: 'BOT v11.1',
      currentPrices, mtfScores,
      pendingProfitTaking: this.pendingProfitTaking
    };
  }
}

module.exports = TradingEngine;
