"use strict";
const { URL } = require("url");
const { request } = require("./fetch.js");

// ----------------------------- helpers -----------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalize(u) {
  try {
    const x = new URL(u);
    x.hash = "";
    let s = x.href;
    if (s.endsWith("/") && x.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch { return u; }
}

function sameDomain(host, startHost, includeSub) {
  if (host === startHost) return true;
  if (includeSub) return host.endsWith("." + startHost) || startHost.endsWith("." + host);
  return false;
}

// Global rate limiter: spaces request start times by the current gap regardless of
// concurrency (derived from --rps and/or robots crawl-delay). `minGap` may be a fixed
// number (ms) or a getter returning the current gap, so spacing can be re-tuned live
// mid-crawl (see --tune-file). Returns an async acquire() each request awaits.
function makeRateLimiter(minGap) {
  const getGap = typeof minGap === "function" ? minGap : () => minGap;
  let next = 0;
  return async function acquire() {
    const gap = getGap();
    if (!gap || gap <= 0) return;
    const now = Date.now();
    const slot = Math.max(now, next);
    next = slot + gap;
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
  };
}

// Parse a Retry-After header value into milliseconds (numeric seconds or HTTP date).
function parseRetryAfter(value, maxMs) {
  if (!value) return 0;
  const secs = Number(value);
  let ms;
  if (Number.isFinite(secs)) ms = secs * 1000;
  else { const t = Date.parse(value); ms = Number.isFinite(t) ? t - Date.now() : 0; }
  return Math.max(0, Math.min(ms, maxMs));
}

// Adaptive backoff controller. On a 429/503 it opens a backoff window (honoring
// Retry-After, else exponential 5s,10s,20s… capped at --max-backoff). Workers
// wait out the window via gate(), then auto-resume. Success slowly relaxes it.
function makeThrottle(maxBackoffMs) {
  const BASE = 5000;
  let backoffUntil = 0, streak = 0;
  return {
    async gate() {
      // Loop because the window may be extended by other workers while we wait.
      for (;;) {
        const wait = backoffUntil - Date.now();
        if (wait <= 0) return;
        await sleep(Math.min(wait, 2000));
      }
    },
    noteThrottle(retryMs) {
      streak++;
      let wait = retryMs > 0 ? retryMs : Math.min(maxBackoffMs, BASE * Math.pow(2, streak - 1));
      wait = Math.round(wait * (0.85 + 0.3 * Math.random())); // jitter to avoid lockstep
      backoffUntil = Math.max(backoffUntil, Date.now() + wait);
      return wait;
    },
    noteSuccess() { if (streak > 0) streak--; },
    activeMs() { return Math.max(0, backoffUntil - Date.now()); },
    get streak() { return streak; },
  };
}

// Fetch robots.txt for the start origin and return its crawl-delay (seconds, 0
// if none) for our User-Agent, falling back to the '*' group.
async function fetchCrawlDelay(cfg) {
  try {
    const u = new URL(cfg.startUrl);
    const r = await request(`${u.protocol}//${u.host}/robots.txt`, "GET", cfg);
    if (!r.html || r.status >= 400) return 0;
    return parseCrawlDelay(r.html, cfg.userAgent);
  } catch { return 0; }
}

function parseCrawlDelay(txt, ua) {
  const uaLower = (ua || "").toLowerCase();
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!lastWasAgent || !cur) { cur = { agents: [], delay: null }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      if (cur && field === "crawl-delay") { const d = parseFloat(value); if (!Number.isNaN(d)) cur.delay = d; }
      lastWasAgent = false;
    }
  }
  let starDelay = null, specificDelay = null;
  for (const g of groups) {
    if (g.delay == null) continue;
    for (const a of g.agents) {
      if (a === "*") starDelay = g.delay;
      else if (uaLower && uaLower.indexOf(a) >= 0) specificDelay = g.delay;
    }
  }
  return specificDelay != null ? specificDelay : (starDelay != null ? starDelay : 0);
}

module.exports = { sleep, normalize, sameDomain, makeRateLimiter, parseRetryAfter, makeThrottle, fetchCrawlDelay };
