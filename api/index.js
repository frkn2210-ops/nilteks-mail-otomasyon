// Vercel Serverless Function Giriş Noktası
const app = require('../server');

module.exports = (req, res) => {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const pathParam = urlObj.searchParams.get('path');
    if (pathParam) {
      urlObj.searchParams.delete('path');
      const search = urlObj.search;
      req.url = '/api/' + pathParam.replace(/^\/+/, '') + (search || '');
    } else if (req.url === '/' || req.url === '' || req.url === '/api' || req.url === '/api/') {
      req.url = '/api/status';
    }
  } catch (err) {
    console.error('URL parse error in api/index.js:', err);
  }

  return app(req, res);
};
