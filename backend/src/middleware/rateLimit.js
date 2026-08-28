// Minimal in-memory fixed-window rate limiter for the public (unauthenticated)
// endpoints. Good enough for a single-instance deployment and dependency-free;
// if the API is ever run behind more than one instance this should move to a
// shared store (e.g. Redis). It is a coarse abuse guard, not a security control
// — the real protections are backend validation, private storage and RLS.

function createRateLimiter({ windowMs, max, code = 'RATE_LIMITED', message }) {
  const hits = new Map();

  // Periodically drop expired buckets so the map cannot grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  sweep.unref();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        success: false,
        error: {
          code,
          message: message || 'Too many requests. Please try again in a little while.',
        },
      });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
