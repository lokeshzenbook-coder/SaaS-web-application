import { config } from "../config.js";

const buckets = new Map();

function hit(key, limit, windowMs, now) {
  const entry = buckets.get(key);
  if (!entry || now - entry.start >= windowMs) {
    const bucket = { start: now, count: 1 };
    buckets.set(key, bucket);
    return { allowed: true, bucket };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { allowed: false, bucket: entry };
  }
  return { allowed: true, bucket: entry };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.start >= config.rateLimit.windowMs) {
      buckets.delete(key);
    }
  }
}, 60_000).unref();

export function rateLimit({ limit, windowMs, key = (req) => req.ip }) {
  return (req, res, next) => {
    const k = String(key(req));
    const { allowed, bucket } = hit(k, limit, windowMs, Date.now());
    res.set({
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": String(Math.max(0, limit - bucket.count)),
    });
    if (!allowed) {
      res.status(429).json({
        error: { code: "rate_limited", message: "Too many requests, slow down." },
      });
      return;
    }
    next();
  };
}

export const globalRateLimit = rateLimit(config.rateLimit);
