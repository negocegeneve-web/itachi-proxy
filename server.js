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
    res.end(JSON.stringify({ status: 'ok', name: 'Itachi Multi-Asset MTF v5.0' }));
    return;
  }

  if (req.url === '/api/trades') {
    const stats = engine.getStats();
    const btcBot = engine.bots && engine.bots[0];
    const priceHistory = btcBot && btcBot.priceHistory
      ? btcBot.priceHistory.slice(-50)
      : [];

    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      trades: engine.openTrades || [],
      closedTrades: engine.closedTrades || [],
      capital: engine.capital || 500,
      running: engine.running || false,
      priceHistory,
      currentPrices: stats.currentPrices || {},
      stats
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
  <title>CryptoSignal AI - Multi-Asset MTF Bot</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #fff; padding: 20px; }
    .container { max-width: 1600px; margin: 0 auto; }
    h1 { text-align: center; margin-bottom: 30px; font-size: 2.2em; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; }
    .card-full { grid-column: 1 / -1; }
    .chart-container { position: relative; height: 350px; }
    .stat-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 12px; margin-top: 15px; }
    .stat-item { background: rgba(255,255,255,0.08); padding: 12px; border-radius: 8px; text-align: center; }
    .stat-label { font-size: 0.8em; opacity: 0.7; margin-bottom: 5px; }
    .stat-value { font-size: 1.5em; font-weight: bold; }
    .positive { color: #10b981; }
    .negative { color: #ef4444; }
    .neutral { color: #fbbf24; }
    .price { font-size: 2em; font-weight: bold; margin-bottom: 10px; }
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
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.85em; }
    th { background: rgba(255,255,255,0.05); font-weight: 600; }
    tr:hover { background: rgba(255,255,255,0.03); }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; }
    .badge-tp { background: rgba(16,185,129,0.3); color: #10b981; }
    .badge-sl { background: rgba(239,68,68,0.3); color: #ef4444; }
    .badge-timeout-p { background: rgba(16,185,129,0.2); color: #6ee7b7; }
    .badge-timeout-n { background: rgba(239,68,68,0.2); color: #fca5a5; }
    .badge-symbol { background: rgba(99,102,241,0.3); color: #818cf8; margin-right: 4px; font-size: 0.75em; padding: 2px 6px; border-radius: 3px; }
    .mode-badge { background: rgba(251,191,36,0.3); color: #fbbf24; padding: 4px 10px; border-radius: 4px; font-size: 0.8em; margin-left: 10px; }
    .mtf-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 15px; }
    .mtf-card { background: rgba(255,255,255,0.05); border-radius: 8px; padding: 12px; }
    .mtf-row { display: flex; justify-content: space-between; font-size: 0.75em; margin: 3px 0; opacity: 0.9; }
    .bull { color: #10b981; }
    .bear { color: #ef4444; }
    .neutral-text { color: #fbbf24; }
    .score-bar { height: 6px; border-radius: 3px; margin-top: 6px; background: rgba(255,255,255,0.1); }
    .score-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🤖 CryptoSignal AI <span class="mode-badge">MULTI-ASSET MTF v5.0</span></h1>
    <div class="status-bar" id="status">🟡 En attente...</div>
    <div class="button-group">
      <button class="btn btn-start" id="btnStart" onclick="startBot()">▶️ Lancer le Bot</button>
      <button class="btn btn-stop" id="btnStop" onclick="stopBot()" disabled>⏹️ Arrêter le Bot</button>
    </div>

    <div class="card card-full">
      <h2>📈 Prix BTC/USDT en Direct</h2>
      <div class="chart-container"><canvas id="priceChart"></canvas></div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>📊 BTC Live</h2>
        <div class="price" id="price">$--</div>
        <div style="opacity:0.7;font-size:0.9em;">5 assets : BTC ETH SOL BNB XRP</div>
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
        <div class="stat-item"><div class="stat-label">Trades Ouverts</div><div class="stat-value" id="openCount">0</div></div>
        <div class="stat-item"><div class="stat-label">Effectués</div><div class="stat-value" id="totalCount">0</div></div>
        <div class="stat-item"><div class="stat-label">✅ Gagnés</div><div class="stat-value positive" id="winCount">0</div></div>
        <div class="stat-item"><div class="stat-label">❌ Perdus</div><div class="stat-value negative" id="lossCount">0</div></div>
        <div class="stat-item"><div class="stat-label">Win Rate</div><div class="stat-value" id="winRate">--%</div></div>
        <div class="stat-item"><div class="stat-label">Total PnL</div><div class="stat-value" id="statPnL">+$0.00</div></div>
        <div class="stat-item"><div class="stat-label">Status</div><div class="stat-value" id="statStatus">⏹️</div></div>
        <div class="stat-item"><div class="stat-label">Maj</div><div class="stat-value" id="statTime" style="font-size:0.9em;">--:--</div></div>
      </div>
    </div>

    <div class="card card-full">
      <h2>🌍 Analyse Multi-Timeframe</h2>
      <div class="mtf-grid" id="mtfGrid"></div>
    </div>

    <div class="card card-full">
      <h2>🎯 Positions Ouvertes</h2>
      <table>
        <thead><tr><th>Symbol</th><th>Entry</th><th>Actuel</th><th>SL</th><th>TP</th><th>Mise</th><th>MTF</th><th>P&L</th><th>P&L %</th></tr></thead>
        <tbody id="openBody"><tr><td colspan="9" style="text-align:center;opacity:0.5;">Aucune position</td></tr></tbody>
      </table>
    </div>

    <div class="card card-full">
      <h2>📝 Historique des Trades</h2>
      <table>
        <thead><tr><th>Heure</th><th>Symbol</th><th>Entry</th><th>Exit</th><th>Mise</th><th>Type</th><th>P&L</th><th>P&L %</th></tr></thead>
        <tbody id="histBody"><tr><td colspan="8" style="text-align:center;opacity:0.5;">Aucun trade fermé</td></tr></tbody>
      </table>
    </div>
  </div>

  <script>
    const API = window.location.origin;
    let chart = null;
    let currentPrices = {};

    function initChart() {
      const ctx = document.getElementById('priceChart').getContext('2d');
      chart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'BTC/USDT', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
          scales: { y: { ticks: { color: '#fff', callback: v => '$' + v.toFixed(0) }, grid: { color: 'rgba(255,255,255,0.1)' } }, x: { ticks: { color: '#fff', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.05)' } } } }
      });
    }

    async function startBot() {
      const res = await fetch(API + '/api/engine/start', { method: 'POST' });
      const data = await res.json();
      if (data.running) {
        document.getElementById('btnStart').disabled = true;
        document.getElementById('btnStop').disabled = false;
        document.getElementById('status').className = 'status-bar';
        document.getElementById('status').textContent = '🟢 Multi-Bot MTF EN COURS — 5 assets Testnet RÉEL';
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

    function tc(t) { return t === 'BULL' ? 'bull' : t === 'BEAR' ? 'bear' : 'neutral-text'; }
    function ti(t) { return t === 'BULL' ? '▲' : t === 'BEAR' ? '▼' : '●'; }

    function renderMTF(mtfScores) {
      if (!mtfScores) return;
      const grid = document.getElementById('mtfGrid');
      grid.innerHTML = Object.keys(mtfScores).map(sym => {
        const m = mtfScores[sym];
        const score = m.score || 0;
        const bias = m.bias || 'NEUTRAL';
        const t = m.trends || {};
        const color = bias === 'BULL' ? '#10b981' : bias === 'BEAR' ? '#ef4444' : '#fbbf24';
        const cp = currentPrices[sym] ? '$' + currentPrices[sym].toFixed(sym === 'XRPUSDT' ? 4 : 2) : '--';
        return '<div class="mtf-card">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:6px;">' +
          '<span class="badge-symbol">' + sym.replace('USDT','') + '</span>' +
          '<span style="font-size:0.8em;opacity:0.7;">' + cp + '</span>' +
          '<span class="' + tc(bias) + '" style="font-weight:bold;">' + ti(bias) + ' ' + score.toFixed(0) + '</span>' +
          '</div>' +
          '<div class="score-bar"><div class="score-fill" style="width:' + Math.min(100,score) + '%;background:' + color + '"></div></div>' +
          '<div style="margin-top:8px;">' +
          '<div class="mtf-row"><span>21d</span><span class="' + tc(t.trend_21d) + '">' + ti(t.trend_21d) + ' ' + (t.trend_21d||'--') + '</span></div>' +
          '<div class="mtf-row"><span>7d</span><span class="' + tc(t.trend_7d) + '">' + ti(t.trend_7d) + ' ' + (t.trend_7d||'--') + '</span></div>' +
          '<div class="mtf-row"><span>24h</span><span class="' + tc(t.trend_24h) + '">' + ti(t.trend_24h) + ' ' + (t.trend_24h||'--') + '</span></div>' +
          '<div class="mtf-row"><span>4h</span><span class="' + tc(t.trend_4h) + '">' + ti(t.trend_4h) + ' ' + (t.trend_4h||'--') + '</span></div>' +
          '<div class="mtf-row"><span>15m</span><span class="' + tc(t.trend_15m) + '">' + ti(t.trend_15m) + ' ' + (t.trend_15m||'--') + '</span></div>' +
          '<div class="mtf-row"><span>3m</span><span class="' + tc(t.trend_3m) + '">' + ti(t.trend_3m) + ' ' + (t.trend_3m||'--') + '</span></div>' +
          '<div class="mtf-row"><span>1m</span><span class="' + tc(t.trend_1m) + '">' + ti(t.trend_1m) + ' ' + (t.trend_1m||'--') + '</span></div>' +
          '</div></div>';
      }).join('');
    }

    async function update() {
      try {
        const res = await fetch(API + '/api/trades');
        const data = await res.json();

        // ✅ Prix réels par asset
        currentPrices = data.currentPrices || {};
        const btcPrice = currentPrices['BTCUSDT'] || 0;

        document.getElementById('price').textContent = '$' + btcPrice.toFixed(2);
        document.getElementById('capital').textContent = '$' + (data.capital || 500).toFixed(2);

        const pnl = data.stats ? data.stats.totalPnL : 0;
        document.getElementById('totalPnL').textContent = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
        document.getElementById('totalPnL').className = pnl >= 0 ? 'positive' : 'negative';
        document.getElementById('currentStake').textContent = '$' + (data.stats ? data.stats.currentStake : 45);

        if (data.priceHistory && data.priceHistory.length > 0 && chart) {
          chart.data.labels = data.priceHistory.map((_, i) => i % 10 === 0 ? i : '');
          chart.data.datasets[0].data = data.priceHistory;
          chart.update('none');
        }

        if (data.stats) {
          document.getElementById('openCount').textContent = data.stats.openTrades || 0;
          document.getElementById('totalCount').textContent = data.stats.closedTrades || 0;
          document.getElementById('winCount').textContent = data.stats.winTrades || 0;
          document.getElementById('lossCount').textContent = data.stats.lossTrades || 0;
          const wr = data.stats.winRate || 0;
          document.getElementById('winRate').textContent = data.stats.closedTrades > 0 ? wr + '%' : '--%';
          document.getElementById('winRate').className = 'stat-value ' + (wr >= 60 ? 'positive' : wr >= 45 ? 'neutral' : 'negative');
          document.getElementById('statPnL').textContent = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
          document.getElementById('statPnL').className = pnl >= 0 ? 'stat-value positive' : 'stat-value negative';
          document.getElementById('statStatus').textContent = data.stats.running ? '🟢 ON' : '⏹️ OFF';
          if (data.stats.mtfScores) renderMTF(data.stats.mtfScores);
        }

        document.getElementById('statTime').textContent = new Date().toLocaleTimeString('fr-FR');

        if (data.running) {
          document.getElementById('btnStart').disabled = true;
          document.getElementById('btnStop').disabled = false;
          document.getElementById('status').className = 'status-bar';
          document.getElementById('status').textContent = '🟢 Multi-Bot MTF EN COURS — 5 assets Testnet RÉEL';
        }

        // ✅ Positions avec prix RÉEL de chaque asset
        const openBody = document.getElementById('openBody');
        if (!data.trades || data.trades.length === 0) {
          openBody.innerHTML = '<tr><td colspan="9" style="text-align:center;opacity:0.5;">Aucune position ouverte</td></tr>';
        } else {
          openBody.innerHTML = data.trades.map(t => {
            const cp = currentPrices[t.symbol] || t.entry; // ✅ Prix réel du bon asset
            const pnl = (cp - t.entry) * t.qty;
            const pnlPct = ((cp - t.entry) / t.entry * 100).toFixed(2);
            return '<tr>' +
              '<td><span class="badge-symbol">' + (t.symbol||'').replace('USDT','') + '</span></td>' +
              '<td>$' + t.entry.toFixed(2) + '</td>' +
              '<td>$' + cp.toFixed(2) + '</td>' +
              '<td>$' + t.sl.toFixed(2) + '</td>' +
              '<td>$' + t.tp.toFixed(2) + '</td>' +
              '<td>$' + t.stake + '</td>' +
              '<td>' + (t.mtfScore ? t.mtfScore.toFixed(0) : '--') + '</td>' +
              '<td class="' + (pnl >= 0 ? 'positive' : 'negative') + '">' + (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2) + '</td>' +
              '<td class="' + (pnl >= 0 ? 'positive' : 'negative') + '">' + (pnl >= 0 ? '+' : '') + pnlPct + '%</td>' +
              '</tr>';
          }).join('');
        }

        // Historique
        const histBody = document.getElementById('histBody');
        if (!data.closedTrades || data.closedTrades.length === 0) {
          histBody.innerHTML = '<tr><td colspan="8" style="text-align:center;opacity:0.5;">Aucun trade fermé</td></tr>';
        } else {
          histBody.innerHTML = data.closedTrades.slice(-15).reverse().map(t => {
            const pnlPct = ((t.exit - t.entry) / t.entry * 100).toFixed(2);
            const bc = t.status === 'TP' ? 'badge-tp' : t.status === 'TIMEOUT+' ? 'badge-timeout-p' : t.status === 'TIMEOUT-' ? 'badge-timeout-n' : 'badge-sl';
            return '<tr>' +
              '<td>' + new Date(t.closeTime).toLocaleTimeString('fr-FR') + '</td>' +
              '<td><span class="badge-symbol">' + (t.symbol||'').replace('USDT','') + '</span></td>' +
              '<td>$' + t.entry.toFixed(2) + '</td>' +
              '<td>$' + t.exit.toFixed(2) + '</td>' +
              '<td>$' + t.stake + '</td>' +
              '<td><span class="badge ' + bc + '">' + t.status + '</span></td>' +
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
    setInterval(update, 3000);
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
        if (!k || !s) { res.writeHead(400, cors()); res.end(JSON.stringify({ error: 'Clés manquantes' })); return; }
        const BASE = mode === 'mainnet' ? 'fapi.binance.com' : 'demo-fapi.binance.com';
        const ts = Date.now();
        const qBase = Object.entries({ ...params, timestamp: ts }).map(([a, b]) => a + '=' + b).join('&');
        const sig = hmacSHA256(s, qBase);
        const query = qBase + '&signature=' + sig;
        const rPath = m === 'GET' ? p + '?' + query : p;
        const pb = (m === 'POST' || m === 'DELETE') ? query : '';
        const opts = { hostname: BASE, path: rPath, method: m, headers: { 'X-MBX-APIKEY': k, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(pb) } };
        const pr = https.request(opts, r2 => {
          let d = '';
          r2.on('data', c => d += c);
          r2.on('end', () => { res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' }); res.end(d); });
        });
        pr.on('error', e => { res.writeHead(500, cors()); res.end(JSON.stringify({ error: e.message })); });
        if (pb) pr.write(pb);
        pr.end();
      } catch(e) { res.writeHead(500, cors()); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  res.writeHead(404, cors());
  res.end('Not found');

}).listen(PORT, () => {
  console.log('🎯 Itachi Multi-Asset MTF v5.0 running on port ' + PORT);
  engine.start();
});
