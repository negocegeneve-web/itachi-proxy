// trading-engine.js
// Bot serveur 24/7 avec agents Ruflo

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
      tickMs: 400,
      ...config
    };
    
    this.swarm = new TradingSwarm();
    this.priceHistory = [];
    this.trades = [];
    this.capital = this.config.capital;
    this.startCapital = this.config.capital;
    this.running = false;
    
    console.log(`⚙️  Trading Engine init | ${this.config.asset} | Capital: $${this.capital}`);
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

    // Signal Ruflo
    const sig = this.swarm.coordinate(this.priceHistory, { capital: this.capital, trades: this.trades });
    
    console.log(`💹 ${this.config.asset}: $${price} | Signal: ${sig.action} Q:${sig.q}`);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log(`🚀 Trading Engine STARTED | ${this.config.asset}`);
    
    while (this.running) {
      await this.tick();
      await new Promise(resolve => setTimeout(resolve, this.config.tickMs));
    }
  }

  stop() {
    this.running = false;
    console.log(`⏸️  Trading Engine STOPPED`);
  }
}

module.exports = TradingEngine;
