// 内存限流（单实例适用）：固定窗口内每 IP 限 N 次；limitMax<=0 时关闭
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000;

function createRateLimiter(limitMax) {
  const hits = new Map();
  if (limitMax > 0) {
    setInterval(() => {
      const now = Date.now();
      for (const [ip, times] of hits) {
        const recent = times.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
        if (recent.length === 0) hits.delete(ip);
        else hits.set(ip, recent);
      }
    }, RATE_LIMIT_WINDOW_MS).unref();
  }
  return function rateLimit(req, res, next) {
    if (limitMax <= 0) return next();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const times = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (times.length >= limitMax) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: '请求太频繁了，请休息片刻再试。' });
    }
    times.push(now);
    hits.set(ip, times);
    next();
  };
}

module.exports = { createRateLimiter };
