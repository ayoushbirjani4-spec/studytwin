// ============================================================
// Rate limiter for POST /api/sessions/answer
// ============================================================
//
// Two in-memory sliding windows per client IP:
//   - per-minute  (default: 30 requests)
//   - per-day     (default: 200 requests)
//
// IP DETECTION
// ============
// Express derives req.ip through its configured trust-proxy chain.
// The API defaults to trusting no proxy, so a client-supplied
// X-Forwarded-For value is ignored. Configure a hop count only for
// a known deployment topology with trusted proxy forwarding.
//
// SERVERLESS NOTE
// ===============
// These maps live in a single Node.js process.  On Vercel each
// serverless invocation may run in a different instance, so
// counts do not accumulate across instances.  For a shared,
// persistent counter add an Upstash Redis or MongoDB backend and
// replace windowCount() with an atomic increment against that
// store.  The interface below is kept simple so that swap is
// straightforward.
//
// MAP EVICTION
// ============
// Expired entries are pruned on every request for the same key,
// and a periodic sweep removes any other stale keys so the maps
// do not grow without bound over a long-lived process.
// ============================================================

const DEFAULT_PER_MINUTE = Number(process.env.RATE_LIMIT_ANSWER_PER_MIN) || 30;
const DEFAULT_PER_DAY    = Number(process.env.RATE_LIMIT_ANSWER_DAILY)    || 200;

// How often to sweep the maps for stale entries (every 10 minutes).
const EVICTION_INTERVAL_MS = 10 * 60 * 1000;

// ============================================================
// CLIENT KEY — Express's validated address
// ============================================================

function clientKey(req) {
  // Express validates forwarded addresses using the configured trusted proxy chain.
  // With trust proxy disabled, req.ip resolves to the socket peer.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// ============================================================
// WINDOW COUNT — fixed window per key
// ============================================================

function windowCount(store, key, windowMs, limit) {
  const now = Date.now();
  let entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  entry.count += 1;

  if (entry.count > limit) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    return { limited: true, retryAfterSec };
  }

  return { limited: false };
}

// ============================================================
// MAP EVICTION — remove entries whose window has expired
// ============================================================

function evictExpired(store) {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

// ============================================================
// FACTORY
// ============================================================

function createAnswerRateLimiter({
  perMinute = DEFAULT_PER_MINUTE,
  perDay    = DEFAULT_PER_DAY
} = {}) {
  const minuteStore = new Map();
  const dayStore    = new Map();

  // Periodic sweep so the maps don't grow indefinitely in a
  // long-running process with many unique IPs.
  const sweepTimer = setInterval(() => {
    evictExpired(minuteStore);
    evictExpired(dayStore);
  }, EVICTION_INTERVAL_MS);

  // Allow the process to exit cleanly without waiting for the timer.
  if (sweepTimer.unref) {
    sweepTimer.unref();
  }

  return function answerRateLimiter(req, res, next) {
    const key = clientKey(req);

    const minute = windowCount(minuteStore, key, 60 * 1000, perMinute);
    if (minute.limited) {
      res.setHeader("Retry-After", String(minute.retryAfterSec));
      return res.status(429).json({
        success: false,
        error: "Too many submissions. Please wait a moment and try again."
      });
    }

    const day = windowCount(dayStore, key, 24 * 60 * 60 * 1000, perDay);
    if (day.limited) {
      res.setHeader("Retry-After", String(day.retryAfterSec));
      return res.status(429).json({
        success: false,
        error:
          "Daily submission limit reached for this network. Try again tomorrow."
      });
    }

    return next();
  };
}

module.exports = {
  createAnswerRateLimiter,
  clientKey           // exported for testing
};
