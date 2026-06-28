// trading-engine.js
// Bot RÉEL Binance Futures Testnet

const https = require('https');
const crypto = require('crypto');
const { TradingSwarm } = require('./ruflo-trader');

const BASE_URL = 'testnet.binancefuture.com';
const WS_BASE = 'wss://stream.binancefuture.com/ws';

class TradingEngine {
  constructor(config = {}) {
    this.config = {
      apiKey: process.env.BINANCE_API_KEY || '',
      apiSecret: process.env.BINANCE_API_SECRET || '',
      asset: process.env.ASSET || 'BTCUSDT',
      capital: parseInt(process.env.CAPITAL) || 500,
      maxPositions: 5,
      minGapMs: 12000,
      tickMs: 1000,
      ...config
    };

    this.swarm = new TradingSwarm();
    this.priceHistory = [];
    this.openTrades = [];
    this.closedTrades = [];
    this.capital = this.config.capital;
    this.startCapital = this.config.capital;
    this.running = false;
    this.lastOpenTime = 0;
    this.tradeCount = 0;
    this.currentPrice = 0;

    console.log(`⚙️  Bot Binance Testnet | ${this.config.asset} | Capital: $${this.capital}`);
  }

  // ✅ SIGNATURE BINANCE
  sign(params) {
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const sig = crypto
      .createHmac('sha256', this.config.apiSecret)
      .update(query)
      .digest('hex');
    return `${query}&signature=${sig}`;
  }

  // ✅ REQUEST BINANCE TESTNET
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

  // ✅ CALCUL MISE SELON CAPITAL
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

  // ✅ PLACER ORDRE RÉEL BINANCE TESTNET
  async placeOrder(price) {
    try {
      const stake = this.getStake();
      const lev = this.swarm.lastLeverage || 5;

      // 1. Set leverage
      await this.request('POST', '/fapi/v1/leverage', {
        symbol: this.config.asset,
        leverage: lev
      });

      // 2. Quantité
      const qty = parseFloat((stake * lev / price).toFixed(3));

      // 3. Ordre Market LONG
      const order = await this.request('POST', '/fapi/v1/order', {
        symbol: this.config.asset,
        side: 'BUY',
        type: 'MARKET',
        quantity: qty
      });

      if (order.orderId) {
        const sl = parseFloat((price * 0.99).toFixed(2));
        const tp = parseFloat((price * 1.02).toFixed(2));

        // 4. Stop Loss
        await this.request('POST', '/fapi/v1/order', {
          symbol: this.config.asset,
          side: 'SELL',
          type: 'STOP_MARKET',
          stopPrice: sl,
          closePosition: 'true'
        });

        // 5. Take Profit
        await this.request('POST', '/fapi/v1/order', {
          symbol: this.config.asset,
          side: 'SELL',
          type: 'TAKE_PROFIT_MARKET',
          stopPrice: tp,
          closePosition: 'true'
        });

        // 6. Enregistre en local pour le dashboard
        this.openTrades.push({
          id: order.orderId,
          entry: price,
          qty,
          stake,
          sl,
          tp,
          highPrice: price,
          direction: 'LONG',
          openTime: Date.now(),
          leverage: lev
        });

        this.lastOpenTime = Date.now();
        this.tradeCount++;
        console.log(`✅ ORDRE RÉEL #${this.tradeCount} | ID:${order.orderId} | Entry:$${price} | Qty:${qty} | SL:$${sl} | TP:$${tp}`);
      } else {
        console.error(`❌ Ordre rejeté: ${JSON.stringify(order)}`);
      }
    } catch(e) {
      console.error(`❌ placeOrder error: ${e.message}`);
    }
  }

  // ✅ VÉRIFIER POSITIONS RÉELLES BINANCE
  async syncPositions() {
    try {
      const positions = await this.request('GET', '/fapi/v2/positionRisk', {
        symbol: this.config.asset
      });

      const active = positions.filter(p => parseFloat(p.positionAmt) !== 0);

      // Met à jour openTrades selon Binance
      if (active.length === 0 && this.openTrades.length > 0) {
        // Positions fermées par Binance (SL/TP atteint)
        this.openTrades.forEach(t => {
          const pnl = (this.currentPrice - t.entry) * t.qty;
          this.closedTrades.push({
            ...t,
            exit: this.currentPrice,
            closeTime: Date.now(),
            pnl: parseFloat(pnl.toFixed(4)),
            status: pnl > 0 ? 'TP' : 'SL'
          });
          this.capital += pnl;
        });
        this.openTrades = [];
      }
    } catch(e) {
      console.error(`❌ syncPositions error: ${e.message}`);
    }
  }

  // ✅ FETCH PRIX BINANCE
  async fetchPrice() {
    try {
      const data = await new Promise((resolve, reject) => {
        https.get({
          hostname: 'testnet.binancefuture.com',
          path: `/fapi/v1/ticker/price?symbol=${this.config.asset}`
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
      console.error(`❌ Prix: ${e.message}`);
      return 0;
    }
  }

  // ✅ TICK PRINCIPAL
  async tick() {
    const price = await this.fetchPrice();
    if (price === 0) return;

    this.currentPrice = price;
    this.priceHistory.push(price);
    if (this.priceHistory.length > 300) this.priceHistory.shift();

    // Sync avec Binance toutes les 5 ticks
    if (this.tradeCount % 5 === 0) {
      await this.syncPositions();
    }

    if (this.priceHistory.length >= 30) {
      try {
        const sig = this.swarm.coordinate(this.priceHistory, {
          capital: this.capital,
          trades: this.openTrades
        });

        const now = Date.now();
        const timeSinceLast = now - this.lastOpenTime;
        const stake = this.getStake();

        console.log(`💹 $${price.toFixed(2)} | Q:${Math.floor(sig.q)} | Mise:$${stake} | Open:${this.openTrades.length}/${this.config.maxPositions} | Capital:$${this.capital.toFixed(2)}`);

        // ✅ CONDITION OUVERTURE
        const highProb = sig.action === 'BUY' &&
          sig.q >= 45 &&
          sig.emaFast > sig.emaSlow &&
          sig.momentum > 0;

        if (
          highProb &&
          this.openTrades.length < this.config.maxPositions &&
          timeSinceLast >= this.config.minGapMs &&
          this.config.apiKey
        ) {
          await this.placeOrder(price);
        }

      } catch(e) {
        console.error(`⚠️  Swarm error: ${e.message}`);
      }
    } else {
      console.log(`⏳ Init... (${this.priceHistory.length}/30) | $${price.toFixed(2)}`);
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log(`🚀 BOT DÉMARRÉ | ${this.config.asset} | Capital:$${this.capital} | Mode: TESTNET RÉEL`);

    while (this.running) {
      try {
        await this.tick();
      } catch(e) {
        console.error(`❌ Tick error: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, this.config.tickMs));
    }
  }

  stop() {
    this.running = false;
    console.log(`⏸️  BOT STOPPÉ | Capital: $${this.capital.toFixed(2)}`);
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
      mode: 'TESTNET RÉEL'
    };
  }
}

module.exports = TradingEngine;
