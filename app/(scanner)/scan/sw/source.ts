// The handheld scanner's service worker — the script itself, served by ./route.ts at /scan/sw.
//
// It is a plain string (written as plain ES2017 with no template literals) so that what the browser
// runs is exactly what is written here — no bundler between. Scope /scan only:
//   · the /scan page: network first, but a Wi-Fi dead spot doesn't leave it hanging — after 4 s the
//     saved copy is shown (and the slow answer, when it comes, refreshes the copy once every file it
//     names is in the cache — never a new build saved without its chunks). Only a page that
//     really is the scanner screen (it carries data-scan-ready) is saved: never the sign-in page, a
//     redirect, or the "no Goods In access" message. A page that says data-scan-use-cache (the Hub
//     couldn't check access just now) is swapped for the saved copy when there is one.
//   · Next's static files (/_next/static/…) the screen is built from: stale-while-revalidate.
//   · GET /api/goods-in/scan/bootstrap (who, which Hub, every location): network first, the saved
//     copy when offline (marked X-Scan-From-Cache: 1 so the screen knows it's a copy).
//   · NOTHING ELSE. Never a POST (the sync, server actions), never any other API or page.
// The page asks it three things by message: "served-from-cache?" (for the offline banner), "keep"
// (the files this page needs; a fresh page lets older builds' files go) and "forget" (signing out).

export const SCAN_SW_SOURCE = String.raw`/* Vectis Hub — the handheld scanner's service worker. Scope /scan only. */
"use strict";
var VERSION = "2026-10-16.2";
var PAGE_CACHE = "vectis-scan-page-v1";
var STATIC_CACHE = "vectis-scan-static-v1";
var DATA_CACHE = "vectis-scan-data-v1";
var KEEP = [PAGE_CACHE, STATIC_CACHE, DATA_CACHE];
var PAGE_KEY = "/scan";
var SCRIPT_PATH = "/scan/sw";
var BOOTSTRAP_PATH = "/api/goods-in/scan/bootstrap";
var PAGE_TIMEOUT_MS = 4000;
var DATA_TIMEOUT_MS = 6000;
var READY_MARK = "data-scan-ready";
var USE_CACHE_MARK = "data-scan-use-cache";
var servedFromCache = new Map();

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    var names = await caches.keys();
    await Promise.all(names.filter(function (n) {
      return n.indexOf("vectis-scan-") === 0 && KEEP.indexOf(n) === -1;
    }).map(function (n) { return caches.delete(n); }));
    await self.clients.claim();
  })());
});

function isScanPage(url) {
  if (url.origin !== self.location.origin || url.pathname === SCRIPT_PATH) return false;
  return url.pathname === "/scan" || url.pathname.indexOf("/scan/") === 0;
}

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
    promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
  });
}

async function readHtml(res) {
  if (!res || !res.ok || res.redirected || res.type !== "basic") return null;
  var ct = res.headers.get("content-type") || "";
  if (ct.indexOf("text/html") === -1) return null;
  try { return await res.clone().text(); } catch (e) { return null; }
}

async function savePage(html) {
  var cache = await caches.open(PAGE_CACHE);
  await cache.put(PAGE_KEY, new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Scan-Saved-At": String(Date.now()) },
  }));
}

// Every /_next/static/ file a page names — its script and style tags, and the chunk paths in its
// inline flight data (quoted, so the match stops at a quote or the backslash before one).
var ASSET_RE = /\/_next\/static\/[^"'\\\s)<>]+/g;
var MAX_ASSETS = 400;

function assetsOf(html) {
  var found = html.match(ASSET_RE) || [];
  var set = new Set();
  for (var i = 0; i < found.length; i++) {
    try { set.add(new URL(found[i].replace(/&amp;/g, "&"), self.location.origin).href); } catch (e) { /* not a URL */ }
  }
  return Array.from(set);
}

// Save a page that ISN'T the one now loading its own files (the slow answer that arrived after the
// saved copy was shown, or the copy fetched on a first visit) only once every file it names is in
// the static cache. Otherwise keep the old copy, whose files are still there: after a deploy, a new
// page saved without its chunks would open offline looking normal and never take a scan.
async function savePageWithAssets(html) {
  var urls = assetsOf(html);
  if (urls.length > MAX_ASSETS) return false;
  var cache = await caches.open(STATIC_CACHE);
  for (var i = 0; i < urls.length; i++) {
    var have = await cache.match(urls[i], { ignoreVary: true });
    if (have) continue;
    var res = await fetch(urls[i], { credentials: "same-origin" });
    if (!res || !res.ok || res.status !== 200 || res.type !== "basic") return false;
    await cache.put(urls[i], res);
  }
  await savePage(html);
  return true;
}

async function savedPage() {
  try {
    var cache = await caches.open(PAGE_CACHE);
    return (await cache.match(PAGE_KEY)) || null;
  } catch (e) {
    return null;
  }
}

function markFromCache(event) {
  var id = event.resultingClientId || event.clientId;
  if (!id) return;
  servedFromCache.set(id, Date.now());
  if (servedFromCache.size > 50) servedFromCache.delete(servedFromCache.keys().next().value);
}

async function handlePage(event) {
  var network = fetch(event.request).then(async function (res) {
    return { res: res, html: await readHtml(res) };
  });
  var got;
  try {
    got = await withTimeout(network, PAGE_TIMEOUT_MS);
  } catch (e) {
    var saved = await savedPage();
    if (saved) {
      markFromCache(event);
      event.waitUntil(network.then(function (g) {
        // The page on screen is the OLD copy, so nothing is loading this one's files: fetch them first.
        if (g.html && g.html.indexOf(READY_MARK) !== -1) return savePageWithAssets(g.html);
      }).catch(function () {}));
      return saved;
    }
    return (await network).res;
  }
  if (got.html && got.html.indexOf(READY_MARK) !== -1) {
    event.waitUntil(savePage(got.html).catch(function () {}));
    return got.res;
  }
  if (got.html && got.html.indexOf(USE_CACHE_MARK) !== -1) {
    var copy = await savedPage();
    if (copy) {
      markFromCache(event);
      return copy;
    }
  }
  return got.res;
}

async function handleStatic(event) {
  var cache = await caches.open(STATIC_CACHE);
  var hit = null;
  try { hit = await cache.match(event.request, { ignoreVary: true }); } catch (e) { hit = null; }
  var network = fetch(event.request).then(function (res) {
    if (res && res.ok && res.status === 200 && res.type === "basic") {
      cache.put(event.request, res.clone()).catch(function () {});
    }
    return res;
  });
  if (hit) {
    event.waitUntil(network.catch(function () {}));
    return hit;
  }
  return network;
}

async function handleData(event) {
  var cache = await caches.open(DATA_CACHE);
  try {
    var res = await withTimeout(fetch(event.request), DATA_TIMEOUT_MS);
    if (res.ok && res.status === 200) {
      var copy = res.clone();
      event.waitUntil(cache.put(BOOTSTRAP_PATH, copy).catch(function () {}));
    }
    return res;
  } catch (e) {
    var saved = null;
    try { saved = await cache.match(BOOTSTRAP_PATH); } catch (e2) { saved = null; }
    if (saved) {
      var body = await saved.text();
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Scan-From-Cache": "1" } });
    }
    return Response.error();
  }
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    if (isScanPage(url)) event.respondWith(handlePage(event));
    return;
  }
  if (url.pathname.indexOf("/_next/static/") === 0) {
    event.respondWith(handleStatic(event));
    return;
  }
  if (url.pathname === BOOTSTRAP_PATH) {
    event.respondWith(handleData(event));
  }
});

async function keep(urls, fresh) {
  var cache = await caches.open(STATIC_CACHE);
  var wanted = new Set();
  for (var i = 0; i < urls.length; i++) {
    try {
      var u = new URL(String(urls[i]), self.location.origin);
      if (u.origin === self.location.origin && u.pathname.indexOf("/_next/static/") === 0) wanted.add(u.href);
    } catch (e) { /* not a URL */ }
  }
  var kept = 0;
  var list = Array.from(wanted);
  for (var j = 0; j < list.length; j++) {
    try {
      var have = await cache.match(list[j], { ignoreVary: true });
      if (!have) {
        var res = await fetch(list[j], { credentials: "same-origin" });
        if (res.ok && res.status === 200 && res.type === "basic") await cache.put(list[j], res);
      }
      kept++;
    } catch (e) { /* tried again next visit */ }
  }
  // A page fresh from the Hub is the current build: let older builds' files go.
  if (fresh && wanted.size >= 3) {
    var keys = await cache.keys();
    for (var k = 0; k < keys.length; k++) {
      if (!wanted.has(keys[k].url)) await cache.delete(keys[k]);
    }
  }
  // The page itself: the first visit loaded it before this worker existed, so fetch a copy now.
  // Accept: text/html so the Android app's bridge is put into the copy, as into a normal load.
  if (!(await savedPage())) {
    try {
      var r = await fetch(PAGE_KEY, { credentials: "same-origin", cache: "no-store", headers: { Accept: "text/html,application/xhtml+xml" } });
      var html = await readHtml(r);
      if (html && html.indexOf(READY_MARK) !== -1) await savePageWithAssets(html);
    } catch (e) { /* next visit */ }
  }
  return kept;
}

self.addEventListener("message", function (event) {
  var data = event.data || {};
  var port = event.ports && event.ports[0];
  function reply(v) {
    try { if (port) port.postMessage(v); } catch (e) { /* page gone */ }
  }
  if (data.type === "served-from-cache?") {
    var id = event.source && event.source.id;
    reply({ fromCache: !!(id && servedFromCache.has(id)), version: VERSION });
    return;
  }
  if (data.type === "keep") {
    event.waitUntil(keep(Array.isArray(data.urls) ? data.urls : [], !!data.fresh).then(
      function (n) { reply({ ok: true, kept: n }); },
      function () { reply({ ok: false }); }
    ));
    return;
  }
  if (data.type === "forget") {
    event.waitUntil(Promise.all([caches.delete(PAGE_CACHE), caches.delete(DATA_CACHE)]).then(
      function () { reply({ ok: true }); },
      function () { reply({ ok: false }); }
    ));
  }
});
`
