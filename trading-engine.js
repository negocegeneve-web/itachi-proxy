const https = require('https');
const crypto = require('crypto');
const { TradingSwarm } = require('./ruflo-trader');
const MultiTimeframeAnalyzer = require('./multi-timeframe');

const BASE_URL = 'testnet.binancefuture.com';
const TAKER_FEE = 0.0004;

const SYMBOLS = [
  { symbol: 'BTCUSDT',  precision: 3, minQty: 0.001, label: '🟠BTC'  },
  { symbol: 'ETHUSDT',  precision: 3, minQty: 0.001, label: '🔵ETH'  },
  { symbol: 'SOLUSDT',  precision: 1, minQty: 0.1,   label: '🟣SOL'  },
  { symbol: 'BNBUSDT',  precision: 2, minQty: 0.01,  label: '🟡BNB'  },
  { symbol: 'XRPUSDT',  precision: 0, minQty: 1,     label: '🔵XRP'  },
  { symbol: 'DOGEUSDT', precision: 0, minQty: 1,     label: '🐶DOGE' },
  { symbol: 'ADAUSDT',  precision: 0, minQty: 1,     label: '🔵ADA'  },
  { symbol: 'DOTUSDT',  precision: 1, minQty: 0.1,   label: '⚪DOT'  },
  { symbol: 'LINKUSDT', precision: 1, minQty: 0.1,   label: '🔵LINK' },
  { symbol: 'LTCUSDT',  precision: 3, minQty: 0.001, label: '⚫LTC'  }
];

class SymbolBot {
  constructor(symbolConfig, engine) {
    this.symbol = symbolConfig.symbol;
    this.symbolConfig = symbolConfig;
    this.precision = symbolConfig.precision;
    this.minQty = symbolConfig.minQty;
    this.label = symbolConfig.label || symbolConfig.symbol;
    this.engine = engine;
    this.swarm = new TradingSwarm();
    this.mtf = new MultiTimeframeAnalyzer(this.symbol);
    this.priceHistory = [];
    this.currentPrice = 0;
    this.openTrade = null;
    this.lastOpenTime = 0;
    this.lastMTFTime = 0;
    this.lastATRTime = 0;
    this.currentMarketMode = 'CALM';
    this.currentATRKlines = 0;
    this.MTF_REFRESH_MS = 60000;
    this.ATR_REFRESH_MS = 30000;

    // ✅ Timeout ABSOLU 14min
    this.TIMEOUT_ABSOLUTE_MS = 840000; // 14min

    // ✅ Timeout adaptatif selon mode (avant 14min)
    this.TIMEOUT_CALM     = 480000; // 8min
    this.TIMEOUT_NORMAL   = 300000; // 5min
    this.TIMEOUT_VOLATILE = 120000; // 2min

    // ✅ Partial TP selon mode
    this.PARTIAL_TP_CALM     = 0.008; // +0.8%
    this.PARTIAL_TP_NORMAL   = 0.010; // +1.0%
    this.PARTIAL_TP_VOLATILE = 0;     // Désactivé (TP +2% atteint vite)

    // ✅ Durée stagnation avant partial TP
    this.STAGNATION_CALM   = 30000; // 30s
    this.STAGNATION_NORMAL = 20000; // 20s

    // ✅ Trailing SL après TP
    this.TRAIL_AFTER_TP_PCT = 0.005;

    // ✅ Gap entre trades
    this.GAP_MS = 4000; // 4s seulement pour max fréquence

    console.log(`⚙️  ${this.label}`);
  }

  getTimeout() {
    if (this.currentMarketMode === 'VOLATILE') return this.TIMEOUT_VOLATILE;
    if (this.currentMarketMode === 'NORMAL')   return this.TIMEOUT_NORMAL;
    return this.TIMEOUT_CALM;
  }

  getPartialTP() {
    if (this.currentMarketMode === 'VOLATILE') return this.PARTIAL_TP_VOLATILE;
    if (this.currentMarketMode === 'NORMAL')   return this.PARTIAL_TP_NORMAL;
    return this.PARTIAL_TP_CALM;
  }

  getStagnationTime() {
    if (this.currentMarketMode === 'NORMAL') return this.STAGNATION_NORMAL;
    return this.STAGNATION_CALM;
  }

  async fetchATRFromKlines() {
    try {
      const data = await new Promise((resolve, reject) => {
        https.get({
          hostname: BASE_URL,
          path: `/fapi/v1/klines?symbol=${this.symbol}&interval=1m&limit=20`
        }, res => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
        }).on('error', reject);
      });

      if (!Array.isArray(data) || data.length < 14) return 0;
      const trueRanges = [];
      for (let i = 1; i < data.length; i++) {
        const high = parseFloat(data[i][2]);
        const low  = parseFloat(data[i][3]);
        const prevClose = parseFloat(data[i-1][4]);
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trueRanges.push(tr);
      }
      const atr14 = trueRanges.slice(-14).reduce((a,b) => a+b, 0) / 14;
      const lastClose = parseFloat(data[data.length-1][4]);
      return parseFloat(((atr14 / lastClose) * 100).toFixed(4));
    } catch(e) {
      return 0;
    }
  }

  getMarketModeFromATR(atrPct) {
    if (atrPct > 1.5) return 'EXTREME';
    if (atrPct > 0.8) return 'VOLATILE';
    if (atrPct > 0.3) return 'NORMAL';
    return 'CALM';
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

      console.log(`⏱️  ${this.label} CLOSE | ${reason} | Net:${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)}`);

      await this.engine.request('DELETE', '/fapi/v1/allOpenOrders', { symbol: this.symbol });
      await this.engine.request('POST', '/fapi/v1/order', {
        symbol: this.symbol,
        side: isLong ? 'SELL' : 'BUY',
        type: 'MARKET',
        quantity: this.openTrade.qty,
        reduceOnly: 'true'
      });

      const status = netPnL > 0 ? 'CLOSE+' : reason.includes('14min') ? 'TIMEOUT' : reason.includes('PARTIAL') ? 'PARTIAL' : 'CLOSE-';

      const closedTrade = {
        ...this.openTrade, exit: price, closeTime: Date.now(),
        grossPnL: parseFloat(grossPnL.toFixed(4)),
        fees, pnl: parseFloat(netPnL.toFixed(4)),
        status,
        marketMode: this.currentMarketMode
      };

      this.engine.closedTrades.push(closedTrade);
      this.engine.totalFees += fees;
      this.engine.capital += netPnL;
      this.engine.openTrades = this.engine.openTrades.filter(t => t.id !== this.openTrade.id);
      this.swarm.recordTrade({ ...closedTrade, symbol: this.symbol });
      console.log(`📊 ${this.label} ${status} | Net:${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)} | Capital:$${this.engine.capital.toFixed(2)}`);
      this.openTrade = null;
    } catch(e) {
      console.error(`❌ ${this.label} forceClose: ${e.message}`);
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
      const partialTP = this.getPartialTP();
      const stagnationTime = this.getStagnationTime();

      const grossPnL = isLong
        ? (price - this.openTrade.entry) * this.openTrade.qty
        : (this.openTrade.entry - price) * this.openTrade.qty;
      const estFees = this.calcFees(this.openTrade.entry, price, this.openTrade.qty);
      const estNet = grossPnL - estFees;
      const pricePctFromEntry = isLong
        ? (price - this.openTrade.entry) / this.openTrade.entry
        : (this.openTrade.entry - price) / this.openTrade.entry;

      // ✅ TIMEOUT ABSOLU 14min → ferme quoi qu'il arrive
      if (tradeAge >= this.TIMEOUT_ABSOLUTE_MS) {
        console.log(`⛔ ${this.label} TIMEOUT ABSOLU 14min | Net:${estNet >= 0 ? '+' : ''}$${estNet.toFixed(2)}`);
        await this.forceClose(price, `14min ABSOLU`);
        return 'REENTER'; // Réentrée possible après
      }

      // ✅ PARTIAL TP : prix dans zone +0.8% et stagne
      if (partialTP > 0 && pricePctFromEntry >= partialTP && !this.openTrade.tpReached) {
        if (!this.openTrade.partialZonePrice) {
          this.openTrade.partialZonePrice = price;
          this.openTrade.partialZoneTime = now;
          console.log(`📊 ${this.label} ZONE PARTIAL +${(pricePctFromEntry*100).toFixed(2)}% | Attente stagnation ${stagnationTime/1000}s`);
        } else {
          const stagnation = now - this.openTrade.partialZoneTime;
          const variation = Math.abs(price - this.openTrade.partialZonePrice) / this.openTrade.partialZonePrice;

          if (stagnation >= stagnationTime && variation < 0.003) {
            // ✅ Stagne depuis assez longtemps → PARTIAL TP
            console.log(`💰 ${this.label} PARTIAL TP +${(pricePctFromEntry*100).toFixed(2)}% | Stagnation ${Math.floor(stagnation/1000)}s`);
            await this.forceClose(price, `PARTIAL TP +${(pricePctFromEntry*100).toFixed(2)}%`);
            return 'REENTER'; // ✅ Signal pour réentrée immédiate
          } else if (variation >= 0.003) {
            // Prix a bougé → reset la zone
            this.openTrade.partialZonePrice = price;
            this.openTrade.partialZoneTime = now;
          }
        }
      }

      // ✅ RETOURNEMENT signal opposé + perte
      if (sig && estNet < -0.50) {
        if (isLong && sig.action === 'SELL' && sig.q >= 70) {
          console.log(`🔄 ${this.label} RETOURNEMENT LONG→SHORT | -$${Math.abs(estNet).toFixed(2)}`);
          await this.forceClose(price, `RETOURNEMENT→SHORT`);
          return 'REVERSE_SHORT';
        }
        if (!isLong && sig.action === 'BUY' && sig.q >= 70) {
          console.log(`🔄 ${this.label} RETOURNEMENT SHORT→LONG | -$${Math.abs(estNet).toFixed(2)}`);
          await this.forceClose(price, `RETOURNEMENT→LONG`);
          return 'REVERSE_LONG';
        }
      }

      // ✅ TRAILING SL uniquement après TP +2% atteint
      const tpPct = this.openTrade.tpPct || 0.020;
      const tpAtteint = pricePctFromEntry >= tpPct;

      if (tpAtteint && !this.openTrade.tpReached) {
        this.openTrade.tpReached = true;
        this.openTrade.highPrice = price;
        this.openTrade.lowPrice = price;
        // Reset zone partielle
        this.openTrade.partialZonePrice = null;
        console.log(`🎯 ${this.label} TP +2% ATTEINT | Trail -0.5% activé | Laisse courir`);
      }

      if (this.openTrade.tpReached) {
        if (isLong) {
          if (price > this.openTrade.highPrice) this.openTrade.highPrice = price;
          const newSL = parseFloat((this.openTrade.highPrice * (1 - this.TRAIL_AFTER_TP_PCT)).toFixed(2));
          if (newSL > this.openTrade.sl) {
            this.openTrade.sl = newSL;
            console.log(`📈 ${this.label} TRAIL → $${newSL.toFixed(2)}`);
          }
          if (price <= this.openTrade.sl) {
            await this.forceClose(price, `TRAIL SL`);
            return 'REENTER';
          }
        } else {
          if (price < this.openTrade.lowPrice) this.openTrade.lowPrice = price;
          const newSL = parseFloat((this.openTrade.lowPrice * (1 + this.TRAIL_AFTER_TP_PCT)).toFixed(2));
          if (newSL < this.openTrade.sl) {
            this.openTrade.sl = newSL;
            console.log(`📉 ${this.label} SHORT TRAIL → $${newSL.toFixed(2)}`);
          }
          if (price >= this.openTrade.sl) {
            await this.forceClose(price, `SHORT TRAIL SL`);
            return 'REENTER';
          }
        }
      }

      // ✅ Timeout adaptatif (avant 14min)
      if (tradeAge >= timeout) {
        if (estNet > 0) {
          await this.forceClose(price, `${Math.floor(timeout/60000)}min + profit +$${estNet.toFixed(2)}`);
          return 'REENTER';
        } else {
          console.log(`⏳ ${this.label} ${Math.floor(timeout/60000)}min | Perte -$${Math.abs(estNet).toFixed(2)} | Attend 14min max`);
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
          status: netPnL > 0 ? (isLong ? 'TP' : 'TP-S') : (isLong ? 'SL' : 'SL-S'),
          marketMode: this.currentMarketMode
        };
        this.engine.closedTrades.push(closedTrade);
        this.engine.totalFees += fees;
        this.engine.capital += netPnL;
        this.engine.openTrades = this.engine.openTrades.filter(t => t.id !== this.openTrade.id);
        this.swarm.recordTrade({ ...closedTrade, symbol: this.symbol });
        console.log(`📊 ${this.label} ${closedTrade.status} | Net:${netPnL >= 0 ? '+' : ''}$${netPnL.toFixed(2)} | Capital:$${this.engine.capital.toFixed(2)}`);
        this.openTrade = null;
        return 'REENTER'; // Réentrée possible
      } else if (active) {
        const unrealPnL = parseFloat(active.unRealizedProfit || 0);
        const remaining14 = Math.max(0, this.TIMEOUT_ABSOLUTE_MS - tradeAge);
        const partialStatus = this.openTrade.partialZonePrice ? `📊ZONE` : this.openTrade.tpReached ? '🎯TRAIL' : `TP@2%`;
        const modeIcon = this.currentMarketMode === 'VOLATILE' ? '🚀' : this.currentMarketMode === 'NORMAL' ? '🟢' : '🟡';
        console.log(`🔄 ${this.label} ${isLong ? '📈' : '📉'} ${partialStatus} | Gross:${unrealPnL >= 0 ? '+' : ''}$${unrealPnL.toFixed(2)} | Net:${estNet >= 0 ? '+' : ''}$${estNet.toFixed(2)} | ${modeIcon} | Max:${Math.floor(remaining14/60000)}m${Math.floor((remaining14%60000)/1000)}s`);
      }
      return false;
    } catch(e) {
      console.error(`❌ ${this.label} sync: ${e.message}`);
      return false;
    }
  }

  async placeOrder(price, sig, mtfScore) {
    try {
      const stake = this.engine.getStake();
      const lev = sig.leverage || 7;
      const tpPct = 0.020;
      const slPct = sig.sl || 0.006;
      const isLong = sig.direction === 'LONG';
      const side = isLong ? 'BUY' : 'SELL';
      const closeSide = isLong ? 'SELL' : 'BUY';

      if (isLong) {
        const bearAssets = this.engine.bots.filter(b => b.symbol !== this.symbol).filter(b => b.mtf?.lastAnalysis?.bias === 'BEAR').length;
        if (bearAssets >= 7) { console.log(`⛔ ${this.label} LONG bloqué`); return; }
      } else {
        const bullAssets = this.engine.bots.filter(b => b.symbol !== this.symbol).filter(b => b.mtf?.lastAnalysis?.bias === 'BULL').length;
        if (bullAssets >= 7) { console.log(`⛔ ${this.label} SHORT bloqué`); return; }
      }

      if (!this.swarm.isAssetHealthy(this.symbol)) { console.log(`⛔ ${this.label} WR < 35%`); return; }

      await this.engine.request('POST', '/fapi/v1/leverage', { symbol: this.symbol, leverage: lev });

      const qty = parseFloat((stake * lev / price).toFixed(this.precision));
      if (qty < this.minQty) { console.log(`⚠️  ${this.label}: qty ${qty} < min ${this.minQty}`); return; }

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

        const estFees = this.calcFees(price, tp, qty);
        const estNetTP = (tp - price) * qty * (isLong ? 1 : -1) - estFees;
        const partialTP = this.getPartialTP();

        this.openTrade = {
          id: order.orderId, symbol: this.symbol,
          entry: price, qty, stake, sl, tp,
          highPrice: price, lowPrice: price,
          direction: sig.direction,
          tpReached: false,
          partialZonePrice: null,
          partialZoneTime: null,
          openTime: Date.now(), leverage: lev,
          mtfScore, q: sig.q,
          tpPct, slPct,
          marketMode: this.currentMarketMode
        };

        this.lastOpenTime = Date.now();
        this.engine.tradeCount++;
        this.engine.openTrades.push(this.openTrade);

        const modeIcon = this.currentMarketMode === 'VOLATILE' ? '🚀' : this.currentMarketMode === 'NORMAL' ? '🟢' : '🟡';
        const partialInfo = partialTP > 0 ?
