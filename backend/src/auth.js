const crypto = require('crypto');

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isValidDeployToken(token) {
  const expected = process.env.DEPLOY_TOKEN;
  if (!expected || !token) return false;
  return safeEqual(token, expected);
}

function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !isValidDeployToken(token)) {
    return res.status(401).json({ error: 'Token inválido o ausente' });
  }
  next();
}

module.exports = { requireAuth, isValidDeployToken, safeEqual };
