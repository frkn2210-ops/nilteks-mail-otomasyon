const AUTH_USER = 'furkan';
const AUTH_SECRET = 'nilteks_secret_token_2026';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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
    } catch {}
  }

  return res.status(200).json({
    success: false,
    authenticated: false
  });
};
