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

  if (req.url === '/' || req.url === '/bot') {
    res.writeHead(200, { ...cors(), 'Content-Type': 'text/html; charset=utf-8' });
    res.end(BOT_HTML);
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', name: 'Itachi Uchiwa Proxy v3.1' }));
    return;
  }

  if (req.url === '/api/trades') {
    const stats = engine.getStats();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      trades: engine.openTrades,
      closedTrades: engine.closedTrades,
      capital: engine.capital,
      running: engine.running,
      priceHistory: engine.priceHistory.slice(-50),
      stats: stats
    }));
    return;
  }

  if (req.url === '/api/engine/start' && req.method === 'POST') {
    if (!engine.running) engine.start();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'started', running: engine.running }));
    return;
  }

  if (req.url === '/api/engine/stop' && req.method === 'POST') {
    engine.stop();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'stopped', running: engine.running }));
    return;
  }

  if (req.url === '/simulator') {
    res.writeHead(200, { ...cors(), 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CryptoSignal AI - Bot Simulator</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #fff; padding: 20px; }
    .container { max-width: 1600px; margin: 0 auto; }
    h1 { text-align: center; margin-bottom: 30px; font-size: 2.5em; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; backdrop-filter: blur(10px); }
    .card-full { grid-column: 1 / -1; }
    .chart-container { position: relative; height: 400px; }
    .stat-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 15px; margin-top: 15px; }
    .stat-item { background: rgba(255,255,255,0.08); padding: 15px; border-radius: 8px; text-align: center; }
    .stat-label { font-size: 0.85em; opacity: 0.7; margin-bottom: 5px; }
    .stat-value { font-size: 1.6em; font-weight: bold; }
    .positive { color: #10b981; }
    .negative { color: #ef4444; }
    .price { font-size: 2.2em; font-weight: bold; margin-bottom: 10px; }
    .button-group { display: flex; gap: 10px; margin: 20px 0; }
    .btn { padding: 14px 28px; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 1em; transition: all 0.3s; }
    .btn-start { background: rgba(16,185,129,0.8); color: #fff; }
    .btn-start:hover { background: rgba(16,185,129,1); transform: scale(1.05); }
    .btn-stop { background: rgba(239,68,68,0.8); color: #fff; }
    .btn-stop:hover { background: rgba(239,68,68,1); transform: scale(1.05); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
    .status-bar { background: rgba(16,185,129,0.2); border: 1px solid #10b981; padding: 12px; border-radius: 8px; margin-bottom: 20px; text-align: center; font-weight: bold; }
    .status-bar.error { background: rgba(239,68,68,0.2); border-color: #ef4444; }
    .status-bar.stopped { background: rgba(156,163,175,0.2); border-color: #9ca3af; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.9em; }
    th { background: rgba(255,255,255,0.05); font-weight: 600; }
    tr:hover { background: rgba(255,255,255,0.03); }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; }
    .badge-tp { background: rgba(16,185,129,0.3); color: #10b981; }
    .badge-sl { background: rgba(239,68,68,0.3); color: #ef4444; }
    .mode-badge { background: rgba(251,191,36,0.3); color: #fbbf24; padding: 4px 10px; border-radius: 4px; font-size: 0.85em; margin-left: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🤖 CryptoSignal AI <span class="mode-badge">TESTNET RÉEL</span></h1>

    <div class="status-bar" id="status">🟡 En attente...</div>

    <div class="button-group">
      <button class="btn btn-start" id="btnStart" onclick="startBot()">▶️ Lancer le Bot</button>
      <button class="btn btn-stop" id="btnStop" onclick="stopBot()" disabled>⏹️ Arrêter le Bot</button>
    </div>

    <div class="card card-full">
      <h2>📈 Prix BTC/USDT en Direct</h2>
      <div class="chart-container">
        <canvas id="priceChart"></canvas>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>📊 Prix BTC Live</h2>
        <div class="price" id="price">$--</div>
        <div style="opacity:0.7; font-size:0.9em;">Mise à jour toutes les 5s</div>
      </div>
      <div class="card">
        <h2>💰 Portefeuille</h2>
        <div class="price" id="capital">$500.00</div>
        <div style="font-size:0.9em;">
          P&L Total: <span id="totalPnL" class="positive">+$0.00</span><br>
          Mise actuelle: <strong id="currentStake">$45</strong>
        </div>
      </div>
    </div>

    <div class="card card-full">
      <h2>📈 Statistiques</h2>
      <div class="stat-grid">
        <div class="stat-item">
          <div class="stat-label">Trades Ouverts</div>
          <div class="stat-value" id="openCount">0</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Trades Effectués</div>
          <div class="stat-value" id="totalCount">0</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">✅ Gagnés</div>
          <div class="stat-value positive" id="winCount">0</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">❌ Perdus</div>
          <div class="stat-value negative" id="lossCount">0</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Win Rate</div>
          <div class="stat-value" id="winRate">--%</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Total PnL</div>
          <div class="stat-value positive" id="statPnL">+$0.00</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Status</div>
          <div class="stat-value" id="statStatus">⏹️</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Maj</div>
          <div class="stat-value" id="statTime" style="font-size:1em;">--:--</div>
        </div>
      </div>
    </div>

    <div class="card card-full">
      <h2>🎯 Positions Ouvertes</h2>
      <table>
        <thead><tr><th>ID</th><th>Entry</th><th>Actuel</th><th>SL</th><th>TP</th><th>Mise</th><th>P&L</th><th>P&L %</th></tr></thead>
        <tbody id="openBody"><tr><td colspan="8" style="text-align:center;opacity:0.5;">Aucune position</td></tr></tbody>
      </table>
    </div>

    <div class="card card-full">
      <h2>📝 Historique des Trades</h2>
      <table>
        <thead><tr><th>Heure</th><th>Entry</th><th>Exit</th><th>Mise</th><th>Type</th><th>P&L</th><th>P&L %</th></tr></thead>
        <tbody id="histBody"><tr><td colspan="7" style="text-align:center;opacity:0.5;">Aucun trade fermé</td></tr></tbody>
      </table>
    </div>
  </div>

  <script>
    const API = window.location.origin;
    let lastPrice = 0;
    let chart = null;

    function initChart() {
      const ctx = document.getElementById('priceChart').getContext('2d');
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'BTC/USDT',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.1)',
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { ticks: { color: '#fff', callback: v => '$' + v.toFixed(0) }, grid: { color: 'rgba(255,255,255,0.1)' } },
            x: { ticks: { color: '#fff', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.05)' } }
          }
        }
      });
    }

    async function startBot() {
      const res = await fetch(API + '/api/engine/start', { method: 'POST' });
      const data = await res.json();
      if (data.running) {
        document.getElementById('btnStart').disabled = true;
        document.getElementById('btnStop').disabled = false;
        document.getElementById('status').className = 'status-bar';
        document.getElementById('status').textContent = '🟢 Bot EN COURS — Testnet Binance RÉEL';
      }
    }

    async function stopBot() {
      const res = await fetch(API + '/api/engine/stop', { method: 'POST' });
      const data = await res.json();
      if (!data.running) {
        document.getElementById('btnStart').disabled = false;
        document.getElementById('btnStop').disabled = true;
        document.getElementById('status').className = 'status-bar stopped';
        document.getElementById('status').textContent = '🔴 Bot ARRÊTÉ';
      }
    }

    async function update() {
      try {
        const res = await fetch(API + '/api/trades');
        const data = await res.json();

        lastPrice = data.priceHistory && data.priceHistory.length > 0
          ? data.priceHistory[data.priceHistory.length - 1] : 0;

        // Prix
        document.getElementById('price').textContent = '$' + lastPrice.toFixed(2);
        document.getElementById('capital').textContent = '$' + data.capital.toFixed(2);
        document.getElementById('totalPnL').textContent = (data.stats.totalPnL >= 0 ? '+' : '') + '$' + data.stats.totalPnL.toFixed(2);
        document.getElementById('totalPnL').className = data.stats.totalPnL >= 0 ? 'positive' : 'negative';
        document.getElementById('currentStake').textContent = '$' + data.stats.currentStake;

        // Graphique
        if (data.priceHistory && data.priceHistory.length > 0 && chart) {
          chart.data.labels = data.priceHistory.map((_, i) => i % 10 === 0 ? i : '');
          chart.data.datasets[0].data = data.priceHistory;
          chart.update('none');
        }

        // Stats
        document.getElementById('openCount').textContent = data.stats.openTrades;
        document.getElementById('totalCount').textContent = data.stats.closedTrades;
        document.getElementById('winCount').textContent = data.stats.winTrades;
        document.getElementById('lossCount').textContent = data.stats.lossTrades;
        document.getElementById('winRate').textContent = data.stats.closedTrades > 0 ? data.stats.winRate + '%' : '--%';
        document.getElementById('statPnL').textContent = (data.stats.totalPnL >= 0 ? '+' : '') + '$' + data.stats.totalPnL.toFixed(2);
        document.getElementById('statPnL').className = data.stats.totalPnL >= 0 ? 'stat-value positive' : 'stat-value negative';
        document.getElementById('statStatus').textContent = data.stats.running ? '🟢 ON' : '⏹️ OFF';
        document.getElementById('statTime').textContent = new Date().toLocaleTimeString('fr-FR');

        // Boutons sync
        if (data.stats.running) {
          document.getElementById('btnStart').disabled = true;
          document.getElementById('btnStop').disabled = false;
          document.getElementById('status').className = 'status-bar';
          document.getElementById('status').textContent = '🟢 Bot EN COURS — Testnet Binance RÉEL';
        }

        // Positions ouvertes
        const openBody = document.getElementById('openBody');
        if (!data.trades || data.trades.length === 0) {
          openBody.innerHTML = '<tr><td colspan="8" style="text-align:center;opacity:0.5;">Aucune position ouverte</td></tr>';
        } else {
          openBody.innerHTML = data.trades.map(t => {
            const pnl = (lastPrice - t.entry) * t.qty;
            const pnlPct = ((lastPrice - t.entry) / t.entry * 100).toFixed(2);
            return '<tr>' +
              '<td>#' + String(t.id).slice(-5) + '</td>' +
              '<td>$' + t.entry.toFixed(2) + '</td>' +
              '<td>$' + lastPrice.toFixed(2) + '</td>' +
              '<td>$' + t.sl.toFixed(2) + '</td>' +
              '<td>$' + t.tp.toFixed(2) + '</td>' +
              '<td>$' + t.stake + '</td>' +
              '<td class="' + (pnl >= 0 ? 'positive' : 'negative') + '">' + (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2) + '</td>' +
              '<td class="' + (pnl >= 0 ? 'positive' : 'negative') + '">' + (pnl >= 0 ? '+' : '') + pnlPct + '%</td>' +
              '</tr>';
          }).join('');
        }

        // Historique
        const histBody = document.getElementById('histBody');
        if (!data.closedTrades || data.closedTrades.length === 0) {
          histBody.innerHTML = '<tr><td colspan="7" style="text-align:center;opacity:0.5;">Aucun trade fermé</td></tr>';
        } else {
          histBody.innerHTML = data.closedTrades.slice(-15).reverse().map(t => {
            const pnlPct = ((t.exit - t.entry) / t.entry * 100).toFixed(2);
            return '<tr>' +
              '<td>' + new Date(t.closeTime).toLocaleTimeString('fr-FR') + '</td>' +
              '<td>$' + t.entry.toFixed(2) + '</td>' +
              '<td>$' + t.exit.toFixed(2) + '</td>' +
              '<td>$' + t.stake + '</td>' +
              '<td><span class="badge ' + (t.status === 'TP' ? 'badge-tp' : 'badge-sl') + '">' + t.status + '</span></td>' +
              '<td class="' + (t.pnl >= 0 ? 'positive' : 'negative') + '">' + (t.pnl >= 0 ? '+' : '') + '$' + t.pnl.toFixed(2) + '</td>' +
              '<td class="' + (t.pnl >= 0 ? 'positive' : 'negative') + '">' + (t.pnl >= 0 ? '+' : '') + pnlPct + '%</td>' +
              '</tr>';
          }).join('');
        }

      } catch(e) {
        document.getElementById('status').className = 'status-bar error';
        document.getElementById('status').textContent = '🔴 Erreur connexion';
      }
    }

    initChart();
    update();
    setInterval(update, 5000);
  </script>
</body>
</html>`);
    return;
  }

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
          res.end(JSON.stringify({ error: 'Clés manquantes' }));
          return;
        }
        const BASE = mode === 'mainnet' ? 'fapi.binance.com' : 'demo-fapi.binance.com';
        const ts = Date.now();
        const qBase = Object.entries({ ...params, timestamp: ts }).map(([a, b]) => a + '=' + b).join('&');
        const sig = hmacSHA256(s, qBase);
        const query = qBase + '&signature=' + sig;
        const rPath = m === 'GET' ? p + '?' + query : p;
        const pb = (m === 'POST' || m === 'DELETE') ? query : '';
        const opts = {
          hostname: BASE, path: rPath, method: m,
          headers: { 'X-MBX-APIKEY': k, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(pb) }
        };
        const pr = https.request(opts, r2 => {
          let d = '';
          r2.on('data', c => d += c);
          r2.on('end', () => { res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' }); res.end(d); });
        });
        pr.on('error', e => { res.writeHead(500, cors()); res.end(JSON.stringify({ error: e.message })); });
        if (pb) pr.write(pb);
        pr.end();
      } catch(e) {
        res.writeHead(500, cors());
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, cors());
  res.end('Not found');

}).listen(PORT, () => {
  console.log('🎯 Itachi v3.1 running on port ' + PORT);
  engine.start();
});
