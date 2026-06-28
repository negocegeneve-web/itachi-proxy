// trading-engine.js
const { TradingSwarm } = require('./ruflo-trader');
const https = require('https');
const crypto = require('crypto');

class TradingEngine {
  constructor(config = {}) {
    this.config = {
      apiKey: process.env.BINANCE_API_KEY || '',
      apiSecret: process.env.BINANCE_API_SECRET || '',
      mode: process.env.BINANCE_MODE || 'testnet',
      asset: process.env.ASSET || 'BTCUSDT',
      capital: parseInt(process.env.CAPITAL) || 500,
      tickMs: 1000, // 1s pour 3-5 positions/min
      maxPositions: 5,
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
    this.minTimeBeforeNewPosition = 12000; // Min 12s entre 2 ouvertures (5 par min max)
    
    console.log(`⚙️  Trading Engine init | ${this.config.asset} | Capital: $${this.capital} | MaxPos: ${this.config.maxPositions}`);
  }

  async fetchRealPrice() {
    try {
      const symbol = this.config.asset === 'BTCUSDT' ? 'BTCUSDT' : 'SOLUSDT';
      const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
      const data = await new Promise((resolve, reject) => {
        https.get(url, res => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } 
            catch(e) { reject(e); }
          });
        }).on('error', reject);
      });
      return parseFloat(data.lastPrice);
    } catch(e) {
      console.error(`❌ Prix Binance: ${e.message}`);
      return 0;
    }
  }

  async tick() {
    const price = await this.fetchRealPrice();
    if (price === 0) return;

    this.priceHistory.push(price);
    if (this.priceHistory.length > 300) this.priceHistory.shift();

    // Signal Ruflo - seulement après 30 prix
    if (this.priceHistory.length >= 30) {
      try {
        const sig = this.swarm.coordinate(this.priceHistory, { capital: this.capital, trades: this.openTrades });
        
        console.log(`💹 ${this.config.asset}: $${price.toFixed(2)} | Signal: ${sig.action} | Q:${Math.floor(sig.q)} | Open: ${this.openTrades.length}/${this.config.maxPositions}`);

        // Ouvre position SI :
        // - Signal BUY
        // - Q >= 20
        // - Moins de MAX_POS positions ouvertes
        // - Pas d'ordres contraires (on n'ouvre que des LONG)
        // - Délai min respecté (3-5 par minute)
        const now = Date.now();
        const timeSinceLastOpen = now - this.lastOpenTime;
        
        if (
          sig.action === 'BUY' && 
          sig.q >= 20 && 
          this.openTrades.length < this.config.maxPositions &&
          timeSinceLastOpen >= this.minTimeBeforeNewPosition
        ) {
          const stake = Math.round(this.capital * 0.06); // 6% per trade
          const qty = stake / price;
          const trade = {
            id: Date.now(),
            entry: price,
            qty,
            highPrice: price, // Pour trailing stop
            sl: price * 0.99, // -1%
            tp: price * 1.02, // +2%
            direction: 'LONG',
            openTime: now,
            signal: sig.action,
            quality: sig.q,
            leverage: sig.leverage
          };
          this.openTrades.push(trade);
          this.lastOpenTime = now;
          console.log(`🎯 TRADE #${this.openTrades.length} OPENED | Entry: $${price.toFixed(2)} | Q:${Math.floor(sig.q)} | SL: $${trade.sl.toFixed(2)} | TP: $${trade.tp.toFixed(2)}`);
        }

        // Gère les trades ouverts (SL/TP + TRAILING STOP)
        this.openTrades = this.openTrades.filter(trade => {
          // Update high price pour trailing stop
          if (price > trade.highPrice) {
            trade.highPrice = price;
            // Trailing SL : -1% du high price
            const newSL = trade.highPrice * 0.99;
            if (newSL > trade.sl) {
              trade.sl = newSL;
              console.log(`📈 TRAILING SL UPDATE | Trade #${this.openTrades.indexOf(trade) + 1} | New SL: $${trade.sl.toFixed(2)}`);
            }
          }

          // Check SL
          if (price <= trade.sl) {
            const pnl = (trade.sl - trade.entry) * trade.qty;
            this.closedTrades.push({...trade, exit: trade.sl, closeTime: Date.now(), pnl, status: 'SL'});
            this.capital += pnl;
            console.log(`❌ STOP LOSS HIT | Entry: $${trade.entry.toFixed(2)} | Exit: $${trade.sl.toFixed(2)} | PnL: $${pnl.toFixed(2)}`);
            return false;
          }

          // Check TP
          if (price >= trade.tp) {
            const pnl = (trade.tp - trade.entry) * trade.qty;
            this.closedTrades.push({...trade, exit: trade.tp, closeTime: Date.now(), pnl, status: 'TP'});
            this.capital += pnl;
            console.log(`✅ TAKE PROFIT HIT | Entry: $${trade.entry.toFixed(2)} | Exit: $${trade.tp.toFixed(2)} | PnL: $${pnl.toFixed(2)}`);
            return false;
          }

          return true;
        });

      } catch(e) {
        console.error(`⚠️  Swarm error: ${e.message}`);
      }
    } else {
      console.log(`⏳ Init... (${this.priceHistory.length}/30 prix) | ${this.config.asset}: $${price.toFixed(2)}`);
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log(`🚀 Trading Engine STARTED | ${this.config.asset} | Tick: ${this.config.tickMs}ms | MAX_POS: ${this.config.maxPositions}`);
    
    while (this.running) {
      try {
        await this.tick();
      } catch(e) {
        console.error(`❌ Tick error: ${e.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, this.config.tickMs));
    }
  }

  stop() {
    this.running = false;
    console.log(`⏸️  Trading Engine STOPPED`);
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
      capital: this.capital,
      running: this.running,
      maxPositions: this.config.maxPositions
    };
  }
}

module.exports = TradingEngine;
