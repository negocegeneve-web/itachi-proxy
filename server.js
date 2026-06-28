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

  // Get bot trades state + stats
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

  // Start engine
  if (req.url === '/api/engine/start' && req.method === 'POST') {
    if (!engine.running) {
      engine.start();
    }
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'started', running: engine.running }));
    return;
  }

  // Stop engine
  if (req.url === '/api/engine/stop' && req.method === 'POST') {
    engine.stop();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'stopped', running: engine.running }));
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
    .stat-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 15px; }
    .stat-item { background: rgba(255,255,255,0.08); padding: 15px; border-radius: 8px; text-align: center; }
    .stat-label { font-size: 0.9em; opacity: 0.7; margin-bottom: 5px; }
    .stat-value { font-size: 1.8em; font-weight: bold; }
    .positive { color: #10b981; }
    .negative { color: #ef4444; }
    .price { font-size: 2em; font-weight: bold; margin-bottom: 10px; }
    .button-group { display: flex; gap: 10px; margin: 20px 0; }
    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-weight: bold;
      cursor: pointer;
      font-size: 1em;
      transition: all 0.3s;
    }
    .btn-start {
      background: rgba(16,185,129,0.8);
      color: #fff;
    }
    .btn-start:hover { background: rgba(16,185,129,1); transform: scale(1.05); }
    .btn-stop {
      background: rgba(239,68,68,0.8);
      color: #fff;
    }
    .btn-stop:hover { background: rgba(239,68,68,1); transform: scale(1.05); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
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
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    th { background: rgba(255,255,255,0.05); }
    tr:hover { background: rgba(255,255,255,0.05); }
  </style>
</head>
<body>
  <div class="container">
    <h1>🤖 CryptoSignal AI - Simulateur Temps Réel</h1>
    
    <div class="status-bar" id="status">
      🟢 Connecté | En attente de commande...
    </div>

    <div class="button-group">
      <button class="btn btn-start" id="btnStart" onclick="startBot()">▶️ Lancer le Bot</button>
      <button class="btn btn-stop" id="btnStop"
