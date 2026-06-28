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
    res.end(JSON.stringify({ status: 'ok', name: 'Itachi Uchiwa Proxy v3.1' }));
    return;
  }

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

  if (req.url === '/api/engine/start' && req.method === 'POST') {
    engine.start();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'started' }));
    return;
  }

  if (req.url === '/api/engine/stop' && req.method === 'POST') {
    engine.stop();
    res.writeHead(200, { ...cors(), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'stopped' }));
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
        if (!k || !s) { res.writeHead(400, cors()); res.end(JSON.stringify({error:'Clés manquantes'})); return; }
        const BASE = mode === 'mainnet' ? 'fapi.binance.com' : 'demo-fapi.binance.com';
        const ts = Date.now();
        const qBase = Object.entries({...params, timestamp: ts}).map(([a,b]) => a+'='+b).join('&');
        const sig = hmacSHA256(s, qBase);
        const query = qBase + '&signature=' + sig;
        const rPath = (m === 'GET') ? p + '?' + query : p;
        const pb = (m === 'POST' || m === 'DELETE') ? query : '';
        const opts = {
          hostname: BASE, path: rPath, method: m,
          headers: { 'X-MBX-APIKEY': k, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(pb) }
        };
        const pr = https.request(opts, r2 => {
          let d = '';
          r2.on('data', c => d += c);
          r2.on('end', () => { res.writeHead(200, {...cors(),'Content-Type':'application/json'}); res.end(d); });
        });
        pr.on('error', e => { res.writeHead(500, cors()); res.end(JSON.stringify({error:e.message})); });
        if (pb) pr.write(pb);
        pr.end();
      } catch(e) { res.writeHead(500, cors()); res.end(JSON.stringify({error:e.message})); }
    }); return;
  }

  res.writeHead(404, cors()); res.end('Not found');

}).listen(PORT, () => {
  console.log('🎯 Itachi v3.1 running on port ' + PORT);
  engine.start();
});
