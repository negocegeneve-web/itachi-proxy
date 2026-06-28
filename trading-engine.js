const https = require('https');
const crypto = require('crypto');
const { TradingSwarm } = require('./ruflo-trader');

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
    this.priceHistory = [];
    this.openTrade = null;
    this.lastOpenTime = 0;
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

  async syncPosition(price) {
    try {
      if (!this.openTrade) return;

      const result = await this.engine.request('GET', '/fapi/v2/positionRisk', {
        symbol: this.symbol
      });
      const positions = Array.isArray(result) ? result : [];
      const active = positions.find(p => Math.abs(parseFloat(p.positionAmt)) > 0);
      const currentAmt = active ? Math.abs(parseFloat(active.positionAmt)) : 0;

      if (currentAmt === 0 && this.openTrade) {
        // Récupère PnL réel
        let realPnL = 0;
        try {
          const income = await this.engine.request('GET', '/fapi/v1/income', {
            symbol: this.symbol,
            incomeType: 'REALIZED_PNL',
            limit: 1
          });
          if (Array.isArray(income) && income.length > 0) {
            realPnL = parseFloat(income[0].income);
          } else {
            realPnL = (price - this.openTrade.entry) * this.openTrade.qty;
          }
        } catch(e) {
          realPnL = (price - this.openTrade.entry) * this.openTrade.qty;
        }

        this.engine.closedTrades.push({
          ...this.openTrade,
          exit: price,
          closeTime: Date.now(),
          pnl: parseFloat(realPnL.toFixed(4)),
          status: realPnL > 0 ? 'TP' : 'SL'
        });

        this.engine.capital += realPnL;
        this.engine.openTrades = this.engine.openTrades.filter(t => t.id !== this.openTrade.id);
        console.log(`📊 ${this.symbol} FERMÉ | PnL: $${realPnL.toFixed(2)} | Capital: $${this.engine.capital.toFixed(2)}`);
        this.openTrade = null;
      } else if (active) {
        const unrealPnL = parseFloat(active.unRealizedProfit || 0);
        console.log(`🔄 ${this.symbol} | ${currentAmt} | PnL: $${unrealPnL.toFixed(2)}`);
      }
    } catch(e) {
      console.error(`❌ ${this.symbol} sync: ${e.message}`);
    }
  }

  async placeOrder(price) {
    try {
      const stake = this.engine.getStake();
      const lev = this.swarm.lastLeverage || 5;

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
        // TP +0.3% et SL -0.2% pour fermeture ULTRA RAPIDE
        const sl = parseFloat((price * 0.998).toFixed(2));
        const tp = parseFloat((price * 1.003).toFixed(2));

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
          leverage: lev
        };

        this.lastOpenTime = Date.now();
        this.engine.tradeCount++;
        this.engine.openTrades.push(this.openTrade);

        console.log(`✅ #${this.engine.tradeCount} ${this.symbol} | Entry:$${price} | SL:$${sl} | TP:$${tp} | Lev:${lev}x`);
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

    this.priceHistory.push(price);
    if (this.priceHistory.length > 300) this.priceHistory.shift();

    // Sync à chaque tick
    await this.syncPosition(price);

    if (this.priceHistory.length < 30) {
      console.log(`⏳ ${this.symbol} Init (${this.priceHistory.length}/30)`);
      return;
    }

    const sig = this.swarm.coordinate(this.priceHistory, {
      capital: this.engine.capital,
      trades: this.engine.openTrades
    });

    const now = Date.now();
    const timeSinceLast = now - this.lastOpenTime;

    console.log(`💹 ${this.symbol}: $${price.toFixed(2)} | Q:${Math.floor(sig.q)} | ${sig.action} | Pos:${this.openTrade ? '1' : '0'}`);

    // Ouvre si signal + pas de position + délai 6s
    if (
      sig.action === 'BUY' &&
      sig.q >= 30 &&
      !this.openTrade &&
      timeSinceLast >= 6000 &&
      this.engine.config.apiKey
    ) {
      await this.placeOrder(price);
    }
  }
}

class TradingEngine {
  constructor(config = {}) {
    this.config = {
      apiKey: process.env.BINANCE_API_KEY || '',
      apiSecret: process.env.BINANCE_API_SECRET || '',
      capital: parseInt(process.env.CAPITAL) || 500,
      tickMs: 2000, // Tick 2s = ultra rapide
      ...config
    };

    this.bots = SYMBOLS.map(s => new SymbolBot(s, this));
    this.openTrades = [];
    this.closedTrades = [];
    this.capital = this.config.capital;
    this.startCapital = this.config.capital;
    this.running = false;
    this.tradeCount = 0;

    console.log(`⚙️  TradingEngine | ${SYMBOLS.length} assets | Capital: $${this.capital}`);
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
    // Tous les bots tournent en parallèle
    await Promise.all(this.bots.map(bot => bot.tick()));
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log(`🚀 MULTI-BOT DÉMARRÉ | ${SYMBOLS.length} assets | Capital:$${this.capital} | Tick:${this.config.tickMs}ms`);
    console.log(`📊 Symbols: ${SYMBOLS.map(s => s.symbol).join(', ')}`);
    console.log(`🎯 TP:+0.3% | SL:-0.2% | Gap:6s | Lev:5-10x`);

    while (this.running) {
      try {
        await this.tick();
      } catch(e) {
        console.error(`❌ Tick global: ${e.message}`);
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
      mode: 'MULTI-ASSET TESTNET',
      symbols: SYMBOLS.map(s => s.symbol)
    };
  }
}

module.exports = TradingEngine;
