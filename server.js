const https = require('https');
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

const TradingEngine = require('./trading-engine');
const engine = new TradingEngine();

const BOT_B64 = 'PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImZyIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9IlVURi04Ij4KPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCxpbml0aWFsLXNjYWxlPTEuMCIKPHRpdGxlPkl0YWNoaSBVY2hpd2EgdjMgUmVhbCDigJQgQ3J5cHRvU2lnbmFsIEFJPC90aXRsZT4KPGxpbmsgcmVsPSJwcmVjb25uZWN0IiBocmVmPSJodHRwczovL2ZvbnRzLmdvb2dsZWFwaXMuY29tIj4KPGxpbmsgaHJlZj0iaHR0cHM6Ly9mb250cy5nb29nbGVhcGlzLmNvbS9jc3MyP2ZhbWlseT1TcGFjZStHcm90ZXNrOndnaHRANDAwOzUwMDs2MDA7NzAwJmZhbWlseT1KZXRCcmFpbnMrTW9ubzp3Z2h0QDQwMDs1MDA7NzAwJmRpc3BsYXk9c3dhcCIgcmVsPSJzdHlsZXNoZWV0Ij4KPC9oZWFkPgo8Ym9keT4KICAKPC9ib2R5Pgo8L2h0bWw+';
const BOT_HTML = Buffer.from(BOT_B64, 'base64').toString('utf8');

function hmacSHA256(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, x-api-secret, x-bn-mode',
  };
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { 
    res.writeHead(200, cors()); 
    res.end(); 
    return; 
  }

  // Serve bot HTML
  if (req.url === '/' || req.url === '/bot') {
    res.writeHead(200, { ...cors(), 'Content-Type': 'text/html; charset=utf-8' });
    res.end(BOT_HTML);
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', name: 'Itachi Uchiwa Proxy v3.1' }));
    return;
  }

  // Get bot trades state
  if (req.url === '/api/trades') {
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      trades: engine.trades,
      capital: engine.capital,
      running: engine.running,
      priceHistory: engine.priceHistory.slice(-50)
    }));
    return;
  }

  // Start engine
  if (req.url === '/api/engine/start' && req.method === 'POST') {
    engine.start();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'started' }));
    return;
  }

  // Stop engine
  if (req.url === '/api/engine/stop' && req.method === 'POST') {
    engine.stop();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'stopped' }));
    return;
  }

  // Simulator dashboard
  if (req.url === '/simulator') {
    res.writeHead(200, { ...cors(), 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CryptoSignal AI - Bot Simulator</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { text-align: center; margin-bottom: 30px; font-size: 2.5em; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 20px;
      backdrop-filter: blur(10px);
    }
    .stats { grid-column: 1 / -1; }
    .stat-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 15px; }
    .stat-item { background: rgba(255,255,255,0.08); padding: 15px; border-radius: 8px; text-align: center; }
    .stat-label { font-size: 0.9em; opacity: 0.7; margin-bottom: 5px; }
    .stat-value { font-size: 1.8em; font-weight: bold; }
    .positive { color: #10b981; }
    .negative { color: #ef4444; }
    .price { font-size: 2em; font-weight: bold; margin-bottom: 10px; }
    .signal { display: inline-block; padding: 8px 16px; border-radius: 20px; font-weight: bold; margin: 5px 0; }
    .signal.bull { background: rgba(16,185,129,0.3); color: #10b981; }
    .signal.sell { background: rgba(239,68,68,0.3); color: #ef4444; }
    .signal.hold { background: rgba(156,163,175,0.3); color: #d1d5db; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    th { background: rgba(255,255,255,0.05); }
    tr:hover { background: rgba(255,255,255,0.05); }
    .status-bar { 
      background: rgba(16,185,129,0.2); 
      border: 1px solid #10b981; 
      padding: 12px; 
      border-radius: 8px; 
      margin-bottom: 20px; 
      text-align: center; 
    }
    .status-bar.error { 
      background: rgba(239,68,68,0.2); 
      border-color: #ef4444; 
    }
    .info-text { font-size: 0.9em; opacity: 0.8; margin-top: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🤖 CryptoSignal AI - Simulateur Temps Réel</h1>
    
    <div class="status-bar" id="status">
      🟢 Connecté | Bot tourne depuis Railway...
    </div>

    <div class="grid">
      <div class="card">
        <h2>📊 Prix BTC Live</h2>
        <div class="price" id="price">$60,000</div>
        <div class="info-text">Mise à jour toutes les 5s</div>
      </div>

      <div class="card">
        <h2>💰 Portefeuille</h2>
        <div class="price" id="capital">$500.00</div>
        <div class="info-text" id="positionInfo">0 position ouverte</div>
      </div>
    </div>

    <div class="card stats">
      <h2>📈 État du Bot</h2>
      <div class="stat-grid">
        <div class="stat-item">
          <div class="stat-label">Capital</div>
          <div class="stat-value" id="statCapital">$500</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Positions</div>
          <div class="stat-value" id="statTrades">0</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Status</div>
          <div class="stat-value" id="statRunning">✅ OUI</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Dernière maj</div>
          <div class="stat-value" id="statTime">--:--:--</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Historique</div>
          <div class="stat-value" id="statHistory">0 prix</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Mode</div>
          <div class="stat-value">TESTNET</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>📡 Données Brutes du Bot</h2>
      <pre id="rawData" style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; overflow-x: auto; font-size: 0.85em;">Chargement...</pre>
    </div>
  </div>

  <script>
    const API_URL = window.location.origin;
    
    async function fetchBotData() {
      try {
        const res = await fetch(API_URL + '/api/trades');
        const data = await res.json();
        return data;
      } catch(e) {
        console.error('Erreur:', e);
        return null;
      }
    }

    async function update() {
      const data = await fetchBotData();
      
      if (!data) {
        document.getElementById('status').className = 'status-bar error';
        document.getElementById('status').textContent = '🔴 Erreur de connexion au bot';
        document.getElementById('rawData').textContent = 'Impossible de se connecter au serveur';
        return;
      }

      // Prix
      const price = data.priceHistory && data.priceHistory.length > 0 
        ? data.priceHistory[data.priceHistory.length - 1] 
        : 0;

      document.getElementById('status').className = 'status-bar';
      document.getElementById('status').textContent = '🟢 Connecté | Bot tourne depuis Railway';
      document.getElementById('price').textContent = '$' + price.toFixed(2);
      document.getElementById('capital').textContent = '$' + data.capital.toFixed(2);
      
      const tradeCount = data.trades ? data.trades.length : 0;
      document.getElementById('positionInfo').textContent = tradeCount + ' position' + (tradeCount !== 1 ? 's' : '') + ' ouverte';

      // Stats
      document.getElementById('statCapital').textContent = '$' + data.capital.toFixed(2);
      document.getElementById('statTrades').textContent = tradeCount;
      document.getElementById('statRunning').textContent = data.running ? '✅ OUI' : '❌ NON';
      document.getElementById('statTime').textContent = new Date().toLocaleTimeString('fr-FR');
      document.getElementById('statHistory').textContent = (data.priceHistory ? data.priceHistory.length : 0) + ' prix';

      // Données brutes
      const historyPreview = data.priceHistory 
        ? data.priceHistory.slice(-10).map(p => '$' + p.toFixed(2)).join(' → ')
        : 'Vide';

      document.getElementById('rawData').textContent = JSON.stringify({
        capital: data.capital,
        running: data.running,
        tradesCount: tradeCount,
        priceHistoryLength: data.priceHistory ? data.priceHistory.length : 0,
        lastPrices: historyPreview,
        timestamp: new Date().toISOString()
      }, null, 2);
    }

    // Premier update immédiat
    update();
    
    // Puis update toutes les 5s
    setInterval(update, 5000);
  </script>
</body>
</html>`);
    return;
  }

  // Binance proxy
  if (req.url === '/api/binance') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { path: p, method: m = 'GET', params = {} } = JSON.parse(body || '{}');
        const k = req.headers['x-api-key'];
        const s = req.headers['x-api-secret'];
        const mode = req.headers['x-bn-mode'] || 'testnet';
        if (!k || !s) { 
          res.writeHead(400, cors()); 
          res.end(JSON.stringify({error:'Clés manquantes'})); 
          return; 
        }
        const BASE = mode === 'mainnet' ? 'fapi.binance.com' : 'demo-fapi.binance.com';
        const ts = Date.now();
        const qBase = Object.entries({...params, timestamp: ts}).map(([a,b]) => a+'='+b).join('&');
        const sig = hmacSHA256(s, qBase);
        const query = qBase + '&signature=' + sig;
        const rPath = (m === 'GET') ? p + '?' + query : p;
        const pb = (m === 'POST' || m === 'DELETE') ? query : '';
        const opts = {
          hostname: BASE, 
          path: rPath, 
          method: m,
          headers: { 
            'X-MBX-APIKEY': k, 
            'Content-Type': 'application/x-www-form-urlencoded', 
            'Content-Length': Buffer.byteLength(pb) 
          }
        };
        const pr = https.request(opts, r2 => {
          let d = '';
          r2.on('data', c => d += c);
          r2.on('end', () => { 
            res.writeHead(200, {...cors(),'Content-Type':'application/json'}); 
            res.end(d); 
          });
        });
        pr.on('error', e => { 
          res.writeHead(500, cors()); 
          res.end(JSON.stringify({error:e.message})); 
        });
        if (pb) pr.write(pb);
        pr.end();
      } catch(e) { 
        res.writeHead(500, cors()); 
        res.end(JSON.stringify({error:e.message})); 
      }
    }); 
    return;
  }

  // 404
  res.writeHead(404, cors()); 
  res.end('Not found');

}).listen(PORT, () => {
  console.log('🎯 Itachi v3.1 running on port ' + PORT);
  engine.start();
});
