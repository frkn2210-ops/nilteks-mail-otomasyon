// Vercel Serverless Function Catch-All
const app = require('../server');

module.exports = (req, res) => {
  if (req.query && req.query.slug) {
    const slugParts = Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug];
    const reconstructed = '/api/' + slugParts.join('/');
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      urlObj.searchParams.delete('slug');
      const search = urlObj.search;
      req.url = reconstructed + (search || '');
    } catch {
      req.url = reconstructed;
    }
  }
  return app(req, res);
};
