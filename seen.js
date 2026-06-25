"use strict";
// Seen-set (dedup) backends: memory / compact / disk. Extracted from crawl.js (AD-014).
const fs = require("fs");

// A crawler must remember visited/queued URLs to avoid re-crawling. The default
// keeps the URL strings in RAM. For very large crawls, two lower-RAM backends
// store only a 64-bit hash per URL and trade speed (and a vanishingly small
// collision chance) for a bounded footprint:
//   compact — fixed-size open-addressing table of hashes in RAM
//   disk    — the same table in a file (RAM ~ O(1) + OS page cache), slowest
// Note: the progress logs can't serve as this index — they record only crawled
// pages, not the queued frontier, and scanning them per URL would be O(n^2).
function fnv1a64(str) {
  const prime = 0x100000001b3n, mask = 0xffffffffffffffffn;
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h = ((h ^ BigInt(c & 0xff)) * prime) & mask;
    if (c > 0xff) h = ((h ^ BigInt((c >> 8) & 0xff)) * prime) & mask;
  }
  return h === 0n ? 1n : h;  // reserve 0 as the empty-slot sentinel
}

// Returns a store with tryAdd(url) -> true if newly added (not seen before),
// false if already present OR the cap is reached. `size` is the live count.
function makeSeenStore(mode, maxItems, seenFile) {
  if (mode === "memory" || !Number.isFinite(maxItems)) {
    const s = new Set();
    return {
      mode: "memory",
      tryAdd(k) { if (s.has(k)) return false; if (s.size >= maxItems) return false; s.add(k); return true; },
      get size() { return s.size; },
      close() {},
    };
  }

  const slots = Math.max(1024, Math.ceil(maxItems / 0.7) + 1); // keep load factor < 0.7
  const slotsBig = BigInt(slots);
  let count = 0;

  if (mode === "disk") {
    const fd = fs.openSync(seenFile, "w+");
    fs.ftruncateSync(fd, slots * 8);   // preallocate; zero-filled = all empty
    const buf = Buffer.alloc(8);
    const read = (i) => { fs.readSync(fd, buf, 0, 8, i * 8); return buf.readBigUInt64BE(0); };
    const write = (i, h) => { buf.writeBigUInt64BE(h, 0); fs.writeSync(fd, buf, 0, 8, i * 8); };
    return {
      mode: "disk",
      tryAdd(k) {
        const h = fnv1a64(k); let i = Number(h % slotsBig);
        for (;;) {
          const v = read(i);
          if (v === 0n) { if (count >= maxItems) return false; write(i, h); count++; return true; }
          if (v === h) return false;
          i = (i + 1) % slots;
        }
      },
      get size() { return count; },
      close() { try { fs.closeSync(fd); fs.unlinkSync(seenFile); } catch { /* ignore */ } },
    };
  }

  // compact: in-RAM typed array of 64-bit hashes
  const table = new BigUint64Array(slots);
  return {
    mode: "compact",
    tryAdd(k) {
      const h = fnv1a64(k); let i = Number(h % slotsBig);
      for (;;) {
        const v = table[i];
        if (v === 0n) { if (count >= maxItems) return false; table[i] = h; count++; return true; }
        if (v === h) return false;
        i = (i + 1) % slots;
      }
    },
    get size() { return count; },
    close() {},
  };
}

module.exports = { makeSeenStore };
