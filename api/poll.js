const { poll, run } = require('../lib/api');

module.exports = async (req, res) => {
  const { status, body } = await run(poll, req.query);
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
};
