/**
 * 03_Cache.gs — CacheService wrapper.
 *
 * Adds three things on top of Apps Script's built-in CacheService:
 *   1. JSON-safe get/put (raw CacheService is string-only).
 *   2. Chunking past the 100KB-per-key cap (auto-splits + reassembles).
 *   3. Prefix-based bust via a ScriptProperties-tracked key index.
 *
 * Public API:
 *   Cache.get(key)             → any | null
 *   Cache.put(key, val, ttlSec)
 *   Cache.bust(prefix)
 *   Cache.wrap(key, ttlSec, fn) → fn() result, cached
 */

var Cache = Cache || {};

(function (ns) {
  var MAX_VALUE_BYTES = 90 * 1024;     // stay under the 100KB CacheService limit
  var DEFAULT_TTL = 300;               // 5 min
  var INDEX_PROP = 'cache:keyIndex';   // ScriptProperties key holding the comma-joined list of live keys
  var CHUNK_PROP_PREFIX = 'cache:chunks:'; // ScriptProperties holds chunk count per chunked key

  ns.get = function (key) {
    var c = CacheService.getScriptCache();
    var manifestRaw = c.get(key);
    if (manifestRaw === null) return null;
    var manifest = parseJson_(manifestRaw);
    if (manifest && manifest.__chunked) {
      var parts = [];
      for (var i = 0; i < manifest.n; i++) {
        var part = c.get(key + ':part' + i);
        if (part === null) return null; // a chunk evicted; treat whole thing as miss
        parts.push(part);
      }
      return parseJson_(parts.join(''));
    }
    return manifest === undefined ? manifestRaw : manifest;
  };

  ns.put = function (key, value, ttlSec) {
    var c = CacheService.getScriptCache();
    var ttl = ttlSec || DEFAULT_TTL;
    var serialized = JSON.stringify(value);
    if (serialized.length <= MAX_VALUE_BYTES) {
      c.put(key, serialized, ttl);
      indexKey_(key);
      return;
    }
    // Chunk into manifest + part0..N
    var chunks = chunkString_(serialized, MAX_VALUE_BYTES);
    var manifest = { __chunked: true, n: chunks.length };
    c.put(key, JSON.stringify(manifest), ttl);
    for (var i = 0; i < chunks.length; i++) {
      c.put(key + ':part' + i, chunks[i], ttl);
      indexKey_(key + ':part' + i);
    }
    indexKey_(key);
    PropertiesService.getScriptProperties().setProperty(CHUNK_PROP_PREFIX + key, String(chunks.length));
  };

  ns.bust = function (prefix) {
    var c = CacheService.getScriptCache();
    var index = readIndex_();
    var remaining = [];
    var toRemove = [];
    for (var i = 0; i < index.length; i++) {
      if (index[i].indexOf(prefix) === 0) toRemove.push(index[i]);
      else remaining.push(index[i]);
    }
    if (toRemove.length === 0) return;
    // CacheService removeAll accepts up to 1000 keys
    while (toRemove.length) {
      var batch = toRemove.splice(0, 1000);
      c.removeAll(batch);
    }
    writeIndex_(remaining);
  };

  /**
   * Cache-aside wrapper. Returns cached value if present; otherwise calls fn,
   * caches the result, and returns it.
   */
  ns.wrap = function (key, ttlSec, fn) {
    var cached = ns.get(key);
    if (cached !== null) return cached;
    var fresh = fn();
    ns.put(key, fresh, ttlSec);
    return fresh;
  };

  /**
   * Test-only helper to clear absolutely everything we put in the cache.
   */
  ns.flushAll = function () {
    var c = CacheService.getScriptCache();
    var index = readIndex_();
    while (index.length) {
      var batch = index.splice(0, 1000);
      c.removeAll(batch);
    }
    writeIndex_([]);
  };

  // ───────── internals ─────────

  function indexKey_(key) {
    var props = PropertiesService.getScriptProperties();
    var idx = readIndex_();
    if (idx.indexOf(key) === -1) {
      idx.push(key);
      writeIndex_(idx);
    }
  }

  function readIndex_() {
    var raw = PropertiesService.getScriptProperties().getProperty(INDEX_PROP);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch (e) { return []; }
  }

  function writeIndex_(arr) {
    PropertiesService.getScriptProperties().setProperty(INDEX_PROP, JSON.stringify(arr));
  }

  function chunkString_(s, sz) {
    var out = [];
    for (var i = 0; i < s.length; i += sz) out.push(s.substring(i, i + sz));
    return out;
  }

  function parseJson_(s) {
    try { return JSON.parse(s); } catch (e) { return undefined; }
  }
})(Cache);
