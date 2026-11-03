const loginHandler = require('../login');
const checkHandler = require('../check');
const logoutHandler = require('../logout');

module.exports = async (req, res) => {
  const orig = req.originalUrl || req.url || '';
  if (orig.includes('/login')) return loginHandler(req, res);
  if (orig.includes('/check')) return checkHandler(req, res);
  if (orig.includes('/logout')) return logoutHandler(req, res);
  const app = require('../../server');
  return app(req, res);
};
