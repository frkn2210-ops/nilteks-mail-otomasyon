// Vercel Serverless Function Catch-All & Direct Auth Handler
const AUTH_USER = 'furkan';
const AUTH_PASS = 'Furkan2210.';
const AUTH_SECRET = 'nilteks_secret_token_2026';

const app = require('../server');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const orig = req.originalUrl || req.headers['x-matched-path'] || req.url || '';

  // 1. Direct Login Handler
  if (orig.includes('/login') && req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) {}
    }
    if (!body || Object.keys(body).length === 0) {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        if (chunks.length > 0) body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch(e) {}
    }

    const { username, password } = body || {};
    if (username === AUTH_USER && password === AUTH_PASS) {
      const token = Buffer.from(`${AUTH_USER}:${AUTH_SECRET}`).toString('base64');
      return res.status(200).json({
        success: true,
        token,
        user: { username: AUTH_USER }
      });
    }

    return res.status(401).json({
      success: false,
      error: 'Kullanıcı adı veya şifre hatalı!'
    });
  }

  // 2. Direct Auth Check Handler
  if (orig.includes('/check')) {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.headers.cookie) {
      const match = req.headers.cookie.match(/(?:^|;\s*)nilteks_auth=([^;]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    if (token) {
      try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        if (decoded === `${AUTH_USER}:${AUTH_SECRET}`) {
          return res.status(200).json({
            success: true,
            authenticated: true,
            user: { username: AUTH_USER }
          });
        }
      } catch(e) {}
    }

    return res.status(200).json({
      success: false,
      authenticated: false
    });
  }

  // 3. Direct Logout Handler
  if (orig.includes('/logout')) {
    return res.status(200).json({
      success: true,
      message: 'Çıkış yapıldı.'
    });
  }

  // 4. Normalise req.url and delegate to Express app
  if (orig.startsWith('/api') && (!req.url || !req.url.startsWith('/api'))) {
    req.url = orig;
  }

  return app(req, res);
};
