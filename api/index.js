// Vercel Serverless Function Giriş Noktası
const app = require('../server');

module.exports = (req, res) => {
  if (req.url === '/' || req.url === '' || req.url === '/api' || req.url === '/api/') {
    req.url = '/api/status';
  }
  return app(req, res);
};
