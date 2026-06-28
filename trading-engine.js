const https = require('https');
const crypto = require('crypto');
const { TradingSwarm } = require('./ruflo-trader');
const MultiTimeframeAnalyzer = require('./multi-timeframe');

const BASE_URL = 'testnet.binancefuture.com';

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
    this.MTF_REFRESH_MS = 30000;
    this.TRADE_TIMEOUT_MS = 90000;
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

  async forceClose(price, reason) {
    try {
      const pnl = (price - this.openTrade.entry) * this.openTrade.qty;
      console.log(`⏱️  ${this.symbol} TIMEOUT | ${reason} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);

      await this.engine.request('DELETE', '/fapi/v1/allOpenOrders', {
        symbol: this.symbol
      });

      await this.engine.request('POST', '/fapi/v1/order', {
        symbol: this.symbol,
        side: 'SELL',
        type: 'MARKET',
        quantity: this.openTrade.qty,
        reduceOnly: 'true'
      });

      this.engine.closedTrades.push({
        ...this.openTrade,
        exit: price,
        closeTime: Date.now(),
        pnl: parseFloat(pnl.toFixed(4)),
        status: pnl > 0 ? 'TIMEOUT+' : 'TIMEOUT-'
      });

      this.engine.capital += pnl;
      this.engine.openTrades = this.engine.openTrades.filter(t => t.id !== this.openTrade.id);
      console.log(`📊 ${this.symbol} FERMÉ FORCÉ | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | Capital: $${this.engine.capital.toFixed(2)}`);
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

      if (tradeAge >= this.TRADE_TIMEOUT_MS) {
        await this.forceClose(price, `90s écoulées`);
        return;
      }

      const result = await this.engine.request('GET', '/fapi/v2/positionRisk', {
        symbol: this.symbol
      });
      const positions = Array.isArray(result) ? result : [];
      const active = positions.find(p => Math.abs(parseFloat(p.positionAmt)) > 0);
      const currentAmt = active ? Math.abs(parseFloat(active.positionAmt)) : 0;

      if (currentAmt === 0 && this.openTrade) {
        let realPnL = (price - this.openTrade.entry) * this.openTrade.qty;
        try {
          const income = await this.engine.request('GET', '/fapi/v1/income', {
            symbol: this.symbol,
            incomeType: 'REALIZED_PNL',
            limit: 1
          });
          if (Array.isArray(income) && income.length > 0) {
            realPnL = parseFloat(income[0].income);
          }
        } catch(e) {}

        this.engine.closedTrades.push({
          ...this.openTrade,
          exit: price,
          closeTime: Date.now(),
          pnl: parseFloat(realPnL.toFixed(4)),
          status: realPnL > 0 ? 'TP' : 'SL'
        });

        this.engine.capital += realPnL;
        this.engine.openTrades = this.engine.openTrades.filter(t => t.id !== this.openTrade.id);
        console.log(`📊 ${this.symbol} FERMÉ | PnL: ${realPnL >= 0 ? '+' : ''}$${realPnL.toFixed(2)} | Capital: $${this.engine.capital.toFixed(2)}`);
        this.openTrade = null;
      } else if (active) {
        const unrealPnL = parseFloat(active.unRealizedProfit || 0);
        const remaining = Math.max(0, this.TRADE_TIMEOUT_MS - tradeAge);
        console.log(`🔄 ${this.symbol} | PnL: ${unrealPnL >= 0 ? '+' : ''}$${unrealPnL.toFixed(2)} | Ferme dans: ${Math.floor(remaining/1000)}s`);
      }
    } catch(e) {
      console.error(`❌ ${this.symbol} sync: ${e.message}`);
    }
  }

  async placeOrder(price, mtfScore) {
    try {
      const stake = this.engine.getStake();
      const lev = this.swarm.lastLeverage || 7;

      await this.engine.request('POST', '/fapi/v1/leverage', {
        symbol: this.symbol,
        leverage: lev
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
        const slPct = ['SOLUSDT', 'XRPUSDT'].includes(this.symbol) ? 0.006 : 0.004;
        const tpPct = ['SOLUSDT', 'XRPUSDT'].includes(this.symbol) ? 0.010 : 0.008;

        const sl = parseFloat((price * (1 - slPct)).toFixed(2));
        const tp = parseFloat((price * (1 + tpPct)).toFixed(2));

        await this.engine.request('POST', '/fapi/v1/order', {
          symbol: this.symbol,
          side: 'SELL',
          type: 'STOP_MARKET',
          stopPrice: sl,
          closePosition: 'true'
        });

        await this.engine.request('POST', '/fapi/v1/order', {
          symbol: this.symbol,
          side: 'SELL',
          type: 'TAKE_PROFIT_MARKET',
          stopPrice: tp,
          closePosition: 'true'
        });

        this.openTrade = {
          id: order.orderId,
          symbol: this.symbol,
          entry: price,
          qty,
          stake,
          sl,
          tp,
          direction: 'LONG',
          openTime: Date.now(),
          leverage: lev,
          mtfScore
        };

        this.lastOpenTime = Date.now();
        this.engine.tradeCount++;
        this.engine.openTrades.push(this.openTrade);

        console.log(`✅ #${this.engine.tradeCount} ${this.symbol} | $${price} | SL:$${sl} | TP:$${tp} | MTF:${mtfScore} | Lev:${lev}x`);
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

    this.currentPrice = price; // ✅ Stocke le prix actuel
    this.priceHistory.push(price);
    if (this.priceHistory.length > 300) this.priceHistory.shift();

    await this.syncPosition(price);

    if (this.priceHistory.length < 30) {
      console.log(`⏳ ${this.symbol} Init (${this.priceHistory.length}/30)`);
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

    console.log(`💹 ${this.symbol}: $${price.toFixed(2)} | Q:${Math.floor(sig.q)} | ${sig.action} | MTF:${mtfScore.toFixed(0)}(${mtfBias}) | Pos:${this.openTrade ? '1' : '0'}`);

    if (
      sig.action === 'BUY' &&
      sig.q >= 55 &&
      mtfScore >= 60 &&
      mtfBias !== 'BEAR' &&
      !this.openTrade &&
      timeSinceLast >= 6000 &&
      this.engine.config.apiKey
    ) {
      await this.placeOrder(price, mtfScore);
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
    this.running = false;
    this.tradeCount = 0;

    console.log(`⚙️  TradingEngine MULTI-ASSET MTF | ${SYMBOLS.length} assets | Capital: $${this.capital}`);
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

  getStake() {
    let stake = 45;
    let threshold = 500;
    while (this.capital >= threshold + 250) {
      stake = stake * 1.35;
      threshold += 250;
    }
    if (this.capital >= 1500 && this.tradeCount > 0 && this.tradeCount % 10 === 0) {
      console.log(`💥 TRADE SPÉCIAL 3× | Mise: $${(stake * 3).toFixed(2)}`);
      return parseFloat((stake * 3).toFixed(2));
    }
    return parseFloat(stake.toFixed(2));
  }

  async tick() {
    await Promise.all(this.bots.map(bot => bot.tick()));
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log(`🚀 MULTI-BOT MTF DÉMARRÉ | ${SYMBOLS.length} assets | Capital:$${this.capital}`);
    console.log(`🎯 MTF Score>=60 | Q>=55 | TP:+0.8% | SL:-0.4% | SOL/XRP: TP:+1% SL:-0.6% | Timeout:90s`);

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
    console.log(`⏸️  MULTI-BOT STOPPÉ | Capital: $${this.capital.toFixed(2)} | Trades: ${this.tradeCount}`);
  }

  getStats() {
    const totalTrades = this.closedTrades.length;
    const winTrades = this.closedTrades.filter(t => t.pnl > 0).length;
    const lossTrades = this.closedTrades.filter(t => t.pnl < 0).length;
    const totalPnL = this.closedTrades.reduce((sum, t) => sum + t.pnl, 0);
    const winRate = totalTrades > 0 ? (winTrades / totalTrades * 100).toFixed(1) : 0;

    // ✅ Prix actuels par symbol pour dashboard correct
    const currentPrices = {};
    this.bots.forEach(b => {
      currentPrices[b.symbol] = b.currentPrice || 0;
    });

    // MTF scores par asset
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
      totalPnL: parseFloat(totalPnL.toFixed(2)),
      winRate: parseFloat(winRate),
      capital: parseFloat(this.capital.toFixed(2)),
      running: this.running,
      currentStake: this.getStake(),
      tradeCount: this.tradeCount,
      mode: 'MULTI-ASSET MTF',
      currentPrices, // ✅ Prix réels par asset
      mtfScores
    };
  }
}

module.exports = TradingEngine;
