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
  if (req.method === 'OPTIONS') { res.writeHead(200, cors()); res.end(); return; }

  if (req.url === '/' || req.url === '/bot') {
    res.writeHead(200, { ...cors(), 'Content-Type': 'text/html; charset=utf-8' });
    res.end(BOT_HTML); return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', name: 'Itachi v6.0' })); return;
  }

  if (req.url === '/api/trades') {
    const stats = engine.getStats();
    const btcBot = engine.bots && engine.bots[0];
    const priceHistory = btcBot?.priceHistory ? btcBot.priceHistory.slice(-50) : [];
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      trades: engine.openTrades || [],
      closedTrades: engine.closedTrades || [],
      capital: engine.capital || 500,
      running: engine.running || false,
      priceHistory,
      currentPrices: stats.currentPrices || {},
      stats
    })); return;
  }

  if (req.url === '/api/engine/start' && req.method === 'POST') {
    if (!engine.running) engine.start();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'started', running: engine.running })); return;
  }

  if (req.url === '/api/engine/stop' && req.method === 'POST') {
    engine.stop();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'stopped', running: engine.running })); return;
  }

  if (req.url === '/api/profit-taking/accept' && req.method === 'POST') {
    engine.acceptProfitTaking();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'accepted', capital: engine.capital })); return;
  }

  if (req.url === '/api/profit-taking/reject' && req.method === 'POST') {
    engine.rejectProfitTaking();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'rejected', capital: engine.capital })); return;
  }

  if (req.url === '/simulator') {
    res.writeHead(200, { ...cors(), 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CryptoSignal AI v6.0</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js"></script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI',sans-serif; background:linear-gradient(135deg,#1a1a2e,#16213e); color:#fff; padding:20px; }
    .container { max-width:1600px; margin:0 auto; }
    h1 { text-align:center; margin-bottom:20px; font-size:2em; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px; }
    .card { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:20px; }
    .card-full { grid-column:1/-1; }
    .chart-container { position:relative; height:300px; }
    .stat-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:15px; }
    .stat-grid-wide { display:grid; grid-template-columns:repeat(8,1fr); gap:10px; margin-top:15px; }
    .stat-item { background:rgba(255,255,255,0.08); padding:12px; border-radius:8px; text-align:center; }
    .stat-label { font-size:0.75em; opacity:0.7; margin-bottom:4px; }
    .stat-value { font-size:1.3em; font-weight:bold; }
    .positive { color:#10b981; }
    .negative { color:#ef4444; }
    .neutral { color:#fbbf24; }
    .price { font-size:1.8em; font-weight:bold; margin-bottom:8px; }
    .btn-group { display:flex; gap:10px; margin:15px 0; }
    .btn { padding:12px 24px; border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:0.95em; transition:all 0.3s; }
    .btn-start { background:rgba(16,185,129,0.8); color:#fff; }
    .btn-start:hover { background:#10b981; transform:scale(1.05); }
    .btn-stop { background:rgba(239,68,68,0.8); color:#fff; }
    .btn-stop:hover { background:#ef4444; transform:scale(1.05); }
    .btn:disabled { opacity:0.4; cursor:not-allowed; transform:none; }
    .status-bar { padding:12px; border-radius:8px; margin-bottom:15px; text-align:center; font-weight:bold; background:rgba(16,185,129,0.2); border:1px solid #10b981; }
    .status-bar.stopped { background:rgba(156,163,175,0.2); border-color:#9ca3af; }
    .status-bar.error { background:rgba(239,68,68,0.2); border-color:#ef4444; }
    table { width:100%; border-collapse:collapse; margin-top:10px; }
    th,td { padding:9px 10px; text-align:left; border-bottom:1px solid rgba(255,255,255,0.08); font-size:0.82em; }
    th { background:rgba(255,255,255,0.05); font-weight:600; }
    .badge { display:inline-block; padding:2px 7px; border-radius:4px; font-size:0.78em; font-weight:bold; }
    .badge-tp { background:rgba(16,185,129,0.3); color:#10b981; }
    .badge-sl { background:rgba(239,68,68,0.3); color:#ef4444; }
    .badge-tp-t { background:rgba(16,185,129,0.2); color:#6ee7b7; }
    .badge-sl-t { background:rgba(239,68,68,0.2); color:#fca5a5; }
    .badge-sym { background:rgba(99,102,241,0.3); color:#818cf8; padding:2px 5px; border-radius:3px; font-size:0.75em; }
    .mode-badge { background:rgba(251,191,36,0.3); color:#fbbf24; padding:3px 8px; border-radius:4px; font-size:0.75em; margin-left:8px; }
    .mtf-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; margin-top:12px; }
    .mtf-card { background:rgba(255,255,255,0.05); border-radius:8px; padding:10px; }
    .mtf-row { display:flex; justify-content:space-between; font-size:0.72em; margin:2px 0; }
    .bull { color:#10b981; }
    .bear { color:#ef4444; }
    .neut { color:#fbbf24; }
    .score-bar { height:5px; border-radius:3px; margin:5px 0; background:rgba(255,255,255,0.1); }
    .score-fill { height:100%; border-radius:3px; transition:width 0.5s; }
    /* Fee box */
    .fee-box { background:rgba(99,102,241,0.1); border:1px solid rgba(99,102,241,0.3); border-radius:8px; padding:12px; margin-top:12px; display:grid; grid-template-columns:repeat(4,1fr); gap:10px; text-align:center; }
    .fee-item label { font-size:0.75em; opacity:0.7; display:block; margin-bottom:3px; }
    .fee-item span { font-size:1.1em; font-weight:bold; }
    /* Modal */
    .modal { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:9999; justify-content:center; align-items:center; }
    .modal-box { background:#1a1a2e; border:2px solid #fbbf24; border-radius:16px; padding:35px; max-width:420px; text-align:center; }
    .modal-box h2 { color:#fbbf24; margin-bottom:15px; font-size:1.5em; }
    .modal-box p { font-size:1.1em; margin-bottom:25px; line-height:1.6; }
    .modal-btns { display:flex; gap:15px; }
    .modal-btn { flex:1; padding:14px; border:none; border-radius:8px; cursor:pointer; font-weight:bold; font-size:1em; }
    .modal-accept { background:#10b981; color:#fff; }
    .modal-reject { background:#ef4444; color:#fff; }
  </style>
</head>
<body>
<div class="container">
  <h1>🤖 CryptoSignal AI <span class="mode-badge">v6.0 MULTI-ASSET</span></h1>

  <div class="status-bar" id="status">🟡 En attente...</div>

  <div class="btn-group">
    <button class="btn btn-start" id="btnStart" onclick="startBot()">▶️ Lancer le Bot</button>
    <button class="btn btn-stop" id="btnStop" onclick="stopBot()" disabled>⏹️ Arrêter le Bot</button>
  </div>

  <div class="card card-full">
    <h2>📈 BTC/USDT Live</h2>
    <div class="chart-container"><canvas id="priceChart"></canvas></div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>📊 Prix Live</h2>
      <div class="price" id="price">$--</div>
      <div style="opacity:0.7;font-size:0.85em;">BTC · ETH · SOL · BNB · XRP</div>
    </div>
    <div class="card">
      <h2>💰 Portefeuille</h2>
      <div class="price" id="capital">$500.00</div>
      <div style="font-size:0.85em;">
        P&L Net: <span id="totalPnL" class="positive">+$0.00</span> |
        ROI: <span id="netRoi" class="positive">0.00%</span><br>
        Mise: <strong id="currentStake">$65</strong>
      </div>
    </div>
  </div>

  <!-- Fee Box -->
  <div class="card card-full">
    <h2>💸 Fees & Performance Réelle</h2>
    <div class="fee-box">
      <div class="fee-item"><label>Gross PnL</label><span id="grossPnL" class="positive">+$0.00</span></div>
      <div class="fee-item"><label>Total Fees (0.04%)</label><span id="totalFees" class="negative">-$0.00</span></div>
      <div class="fee-item"><label>NET PnL</label><span id="netPnL" class="positive">+$0.00</span></div>
      <div class="fee-item"><label>Capital Réel</label><span id="realCapital">$500.00</span></div>
    </div>
  </div>

  <!-- Stats -->
  <div class="card card-full">
    <h2>📈 Statistiques</h2>
    <div class="stat-grid-wide">
      <div class="stat-item"><div class="stat-label">Ouverts</div><div class="stat-value" id="openCount">0</div></div>
      <div class="stat-item"><div class="stat-label">Effectués</div><div class="stat-value" id="totalCount">0</div></div>
      <div class="stat-item"><div class="stat-label">✅ Gagnés</div><div class="stat-value positive" id="winCount">0</div></div>
      <div class="stat-item"><div class="stat-label">❌ Perdus</div><div class="stat-value negative" id="lossCount">0</div></div>
      <div class="stat-item"><div class="stat-label">Win Rate</div><div class="stat-value" id="winRate">--%</div></div>
      <div class="stat-item"><div class="stat-label">Trades Total</div><div class="stat-value" id="tradeCount">0</div></div>
      <div class="stat-item"><div class="stat-label">Status</div><div class="stat-value" id="statStatus">⏹️</div></div>
      <div class="stat-item"><div class="stat-label">Maj</div><div class="stat-value" id="statTime" style="font-size:0.85em;">--:--</div></div>
    </div>
  </div>

  <!-- MTF -->
  <div class="card card-full">
    <h2>🌍 Analyse Multi-Timeframe</h2>
    <div class="mtf-grid" id="mtfGrid"></div>
  </div>

  <!-- Positions -->
  <div class="card card-full">
    <h2>🎯 Positions Ouvertes</h2>
    <table>
      <thead><tr><th>Symbol</th><th>Entry</th><th>Actuel</th><th>SL Trailing</th><th>TP</th><th>Mise</th><th>Lev</th><th>Q</th><th>P&L Gross</th><th>Fees</th><th>P&L Net</th></tr></thead>
      <tbody id="openBody"><tr><td colspan="11" style="text-align:center;opacity:0.5;">Aucune position</td></tr></tbody>
    </table>
  </div>

  <!-- Historique -->
  <div class="card card-full">
    <h2>📝 Historique (Net après fees)</h2>
    <table>
      <thead><tr><th>Heure</th><th>Symbol</th><th>Entry</th><th>Exit</th><th>Mise</th><th>Lev</th><th>Type</th><th>Gross</th><th>Fees</th><th>NET P&L</th></tr></thead>
      <tbody id="histBody"><tr><td colspan="10" style="text-align:center;opacity:0.5;">Aucun trade</td></tr></tbody>
    </table>
  </div>
</div>

<!-- Modal Profit Taking -->
<div class="modal" id="profitModal">
  <div class="modal-box">
    <h2>🎯 Profit Taking !</h2>
    <p id="profitMsg"></p>
    <div class="modal-btns">
      <button class="modal-btn modal-accept" onclick="acceptPT()">✅ Accepter</button>
      <button class="modal-btn modal-reject" onclick="rejectPT()">❌ Continuer</button>
    </div>
  </div>
</div>

<script>
const API = window.location.origin;
let chart = null;
let currentPrices = {};
let lastPTThreshold = null;

function initChart() {
  const ctx = document.getElementById('priceChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'BTC', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', borderWidth: 2, tension: 0.4, fill: true, pointRadius: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
      scales: { y: { ticks: { color: '#fff', callback: v => '$'+v.toFixed(0) }, grid: { color: 'rgba(255,255,255,0.08)' } }, x: { ticks: { color: '#fff', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.04)' } } } }
  });
}

async function startBot() {
  const r = await fetch(API+'/api/engine/start',{method:'POST'});
  const d = await r.json();
  if (d.running) {
    document.getElementById('btnStart').disabled = true;
    document.getElementById('btnStop').disabled = false;
    document.getElementById('status').className = 'status-bar';
    document.getElementById('status').textContent = '🟢 Multi-Bot v6.0 EN COURS';
  }
}

async function stopBot() {
  const r = await fetch(API+'/api/engine/stop',{method:'POST'});
  const d = await r.json();
  if (!d.running) {
    document.getElementById('btnStart').disabled = false;
    document.getElementById('btnStop').disabled = true;
    document.getElementById('status').className = 'status-bar stopped';
    document.getElementById('status').textContent = '🔴 Bot ARRÊTÉ';
  }
}

async function acceptPT() {
  await fetch(API+'/api/profit-taking/accept',{method:'POST'});
  document.getElementById('profitModal').style.display = 'none';
  lastPTThreshold = null;
}

async function rejectPT() {
  await fetch(API+'/api/profit-taking/reject',{method:'POST'});
  document.getElementById('profitModal').style.display = 'none';
  lastPTThreshold = null;
}

function tc(t) { return t==='BULL'?'bull':t==='BEAR'?'bear':'neut'; }
function ti(t) { return t==='BULL'?'▲':t==='BEAR'?'▼':'●'; }

function renderMTF(mtf) {
  if (!mtf) return;
  document.getElementById('mtfGrid').innerHTML = Object.keys(mtf).map(sym => {
    const m = mtf[sym];
    const s = m.score || 0;
    const b = m.bias || 'NEUTRAL';
    const t = m.trends || {};
    const color = b==='BULL'?'#10b981':b==='BEAR'?'#ef4444':'#fbbf24';
    const cp = currentPrices[sym] ? '$'+(currentPrices[sym]).toFixed(sym==='XRPUSDT'?4:2) : '--';
    return '<div class="mtf-card">'+
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px;">'+
      '<span class="badge-sym">'+sym.replace('USDT','')+'</span>'+
      '<span style="font-size:0.75em;opacity:0.6">'+cp+'</span>'+
      '<span class="'+tc(b)+'" style="font-weight:bold;">'+ti(b)+' '+s.toFixed(0)+'</span></div>'+
      '<div class="score-bar"><div class="score-fill" style="width:'+Math.min(100,s)+'%;background:'+color+'"></div></div>'+
      '<div style="margin-top:6px;">'+
      '<div class="mtf-row"><span>1h</span><span class="'+tc(t.trend_1h)+'">'+ti(t.trend_1h)+' '+(t.trend_1h||'--')+'</span></div>'+
      '<div class="mtf-row"><span>15m</span><span class="'+tc(t.trend_15m)+'">'+ti(t.trend_15m)+' '+(t.trend_15m||'--')+'</span></div>'+
      '<div class="mtf-row"><span>3m</span><span class="'+tc(t.trend_3m)+'">'+ti(t.trend_3m)+' '+(t.trend_3m||'--')+'</span></div>'+
      '<div class="mtf-row"><span>1m</span><span class="'+tc(t.trend_1m)+'">'+ti(t.trend_1m)+' '+(t.trend_1m||'--')+'</span></div>'+
      '</div></div>';
  }).join('');
}

async function update() {
  try {
    const r = await fetch(API+'/api/trades');
    const data = await r.json();
    currentPrices = data.currentPrices || {};
    const btcP = currentPrices['BTCUSDT'] || 0;
    const s = data.stats || {};

    document.getElementById('price').textContent = '$'+btcP.toFixed(2);
    document.getElementById('capital').textContent = '$'+(data.capital||500).toFixed(2);

    const net = s.totalPnL || 0;
    const gross = s.grossPnL || 0;
    const fees = s.totalFees || 0;

    document.getElementById('totalPnL').textContent = (net>=0?'+':'')+' $'+net.toFixed(2);
    document.getElementById('totalPnL').className = net>=0?'positive':'negative';
    document.getElementById('netRoi').textContent = (s.netRoi||'0.00')+'%';
    document.getElementById('netRoi').className = parseFloat(s.netRoi||0)>=0?'positive':'negative';
