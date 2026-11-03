const AUTH_USER = 'furkan';
const AUTH_PASS = 'Furkan2210.';
const AUTH_SECRET = 'nilteks_secret_token_2026';

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let body = req.body;
  if (!body || typeof body === 'string') {
    try {
      body = typeof body === 'string' ? JSON.parse(body) : {};
    } catch {
      body = {};
    }
  }

  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      if (chunks.length > 0) {
        const raw = Buffer.concat(chunks).toString('utf8');
        body = JSON.parse(raw);
      }
    } catch (e) {}
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
};
