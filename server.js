// Itachi Uchiwa — Proxy Binance
// Deploy sur Render.com (serveurs Europe Frankfurt)
// Résout le blocage CORS Binance sur Vercel USA

const https = require('https');
const http  = require('http');
const crypto = require('crypto');
const url    = require('url');

const PORT = process.env.PORT || 3000;

function hmacSHA256(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, x-api-secret, x-bn-mode',
    'Content-Type': 'application/json'
  };
}

http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders());
    res.end();
    return;
  }

  // Health check
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, corsHeaders());
    res.end(JSON.stringify({ status: 'ok', name: 'Itachi Uchiwa Proxy', region: 'EU' }));
    return;
  }

  if (req.url !== '/api/binance') {
    res.writeHead(404, corsHeaders());
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { path, method = 'GET', params = {} } = JSON.parse(body || '{}');
      const apiKey    = req.headers['x-api-key'];
      const apiSecret = req.headers['x-api-secret'];
      const mode      = req.headers['x-bn-mode'] || 'testnet';

      if (!apiKey || !apiSecret) {
        res.writeHead(400, corsHeaders());
        res.end(JSON.stringify({ error: 'Clés API manquantes' }));
        return;
      }

      const BASE = mode === 'mainnet'
        ? 'fapi.binance.com'
        : 'demo-fapi.binance.com';

      const ts    = Date.now();
      const qBase = Object.entries({ ...params, timestamp: ts })
        .map(([k, v]) => `${k}=${v}`).join('&');
      const sig   = hmacSHA256(apiSecret, qBase);
      const query = `${qBase}&signature=${sig}`;

      const reqPath = method === 'GET' ? `${path}?${query}` : path;
      const postBody = method !== 'GET' ? query : '';

      const options = {
        hostname: BASE,
        path:     reqPath,
        method:   method,
        headers: {
          'X-MBX-APIKEY':  apiKey,
          'Content-Type':  'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postBody)
        }
      };

      const proxyReq = https.request(options, proxyRes => {
        let data = '';
        proxyRes.on('data', c => data += c);
        proxyRes.on('end', () => {
          res.writeHead(200, corsHeaders());
          res.end(data);
        });
      });

      proxyReq.on('error', e => {
        res.writeHead(500, corsHeaders());
        res.end(JSON.stringify({ error: e.message }));
      });

      if (postBody) proxyReq.write(postBody);
      proxyReq.end();

    } catch(e) {
      res.writeHead(500, corsHeaders());
      res.end(JSON.stringify({ error: e.message }));
    }
  });

}).listen(PORT, () => {
  console.log(`Itachi Proxy running on port ${PORT}`);
});
