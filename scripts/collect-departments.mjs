// Collect the DEPARTMENT pages from vectis.co.uk — the 28 in the site's Departments menu — for
// the Hub's Databases → News page and the test website's /departments pages.
//
//   node scripts/collect-departments.mjs <outputFolder>
//
// ⚠ Why an office machine: the website answers the Hub's Railway server with 202 and an empty body
// for everything, while the same request from the office works (measured 2026-09-09). Same folder
// as the news collector, so one upload of the pictures folder covers both.
//
// What a department page is (measured 2026-09-23 on Trains & Model Railway): an SP Page Builder
// page — a banner picture, a first section with "BACK TO DEPARTMENTS", the "SELL … AT AUCTION"
// copy (why Vectis, brand list, contact, bullet lists) and a "Sell your collection with us" box; a
// "Highlighted Lots" section of hand-picked past lots (picture, title, hammer price, date, category,
// brand, link); a "Latest news" module (three stories); and a "Past Auctions" module OUTSIDE the
// builder block (sale links /bidding/<code>-…-<siteId>). The Departments index is a grid of tiles,
// each with a picture and an EXPLORE link — ⚠ the tile picture's own link can be a stale template
// address (Star Wars' picture links to /departments/antiquities), so tiles are matched to the menu
// by NAME, never by that link.
//
// Writes  <outputFolder>/vectis-departments.json
//         <outputFolder>/pictures/dept-<slug>-hero.<ext>, dept-<slug>-tile.<ext>, dept-<slug>-<n>.<ext>
//         <outputFolder>/vectis-departments-log.txt
// Safe to run again: pictures already in the folder are kept.
import fs from "node:fs"
import path from "node:path"

const OUT = process.argv[2] ?? "."
const FILE = path.join(OUT, "vectis-departments.json")
const PICS = path.join(OUT, "pictures")
const SITE = "https://www.vectis.co.uk/"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
const PAUSE = 300
const PIC_PAUSE = 200
const sleep = ms => new Promise(r => setTimeout(r, ms))

fs.mkdirSync(PICS, { recursive: true })
const say = s => {
  const line = new Date().toISOString().slice(11, 19) + " " + s
  console.log(line)
  try { fs.appendFileSync(path.join(OUT, "vectis-departments-log.txt"), line + "\n") } catch {}
}

async function get(url, accept) {
  for (let go = 1; go <= 3; go++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": accept } })
      if (res.status === 404) return null
      if (!res.ok) { await sleep(1500 * go); continue }
      return res
    } catch { await sleep(1500 * go) }
  }
  return null
}

// ⚠ The same page-cleaning as scripts/collect-news.mjs — change one, change the other.
const unescape = s => String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
const attr = (s, name) => { const r = s.match(new RegExp("\\b" + name + "=\"([^\"]*)\"", "i")); return r ? unescape(r[1]) : null }
const textOf = h => unescape(String(h).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
function sitePath(src) {
  let s = src.trim()
  if (s.startsWith(SITE)) s = s.slice(SITE.length)
  else if (s.startsWith("//www.vectis.co.uk/")) s = s.slice("//www.vectis.co.uk/".length)
  if (s.startsWith("/") && !s.startsWith("//")) s = s.slice(1)
  return s.split("#")[0]
}
function builderBlock(html) {
  for (const marker of ['<div id="sp-page-builder"', '<div class="com-content-article__body"']) {
    const start = html.indexOf(marker)
    if (start < 0) continue
    const re = /<div\b|<\/div>/g
    re.lastIndex = start
    let depth = 0, m
    while ((m = re.exec(html))) {
      depth += m[0] === "</div>" ? -1 : 1
      if (depth === 0) return html.slice(start, m.index + 6)
    }
  }
  return null
}
// Pictures are kept (the "prices achieved" panel, a photo in the copy) and so is an embedded Vimeo or
// YouTube video (the "Sell Your Toys" tour) — as a bare <iframe src>; every other frame goes.
function cleanBlock(block) {
  let h = block
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
  h = h.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, m => {
    const src = attr(m, "src") || ""
    return /^https:\/\/(player\.vimeo\.com|www\.youtube(?:-nocookie)?\.com|youtu\.be)\//i.test(src) ? `<iframe src="${src}"></iframe>` : ""
  })
  h = h.replace(/<(?:svg|button|form|input)\b[\s\S]*?<\/(?:svg|button|form|input)>/gi, "")
  h = h.replace(/<img\b[^>]*emoji\.php[^>]*>/gi, m => attr(m, "alt") ?? "")
  h = h.replace(/<img\b[^>]*>/gi, m => {
    const file = (attr(m, "data-large") || attr(m, "data-src") || attr(m, "data-original") || attr(m, "src") || "").trim()
    if (!file || /\/media\/com_sppagebuilder\/placeholder\//.test(file) || /\/templates\/vectis\//.test(file) || /^data:/.test(file)) return ""
    const alt = attr(m, "alt"), w = attr(m, "width"), hh = attr(m, "height")
    return `<img src="${sitePath(file)}"${alt ? ` alt="${alt}"` : ""}${w ? ` width="${w}"` : ""}${hh ? ` height="${hh}"` : ""}>`
  })
  h = h.replace(/<a\b([^>]*)>/gi, (m, attrs) => { const href = attr(attrs, "href"); return href ? `<a href="${href}">` : "<a>" })
  h = h.replace(/<(?!\/)(?!a\b)(?!img\b)(?!iframe\b)([a-z][a-z0-9]*)\b[^>]*>/gi, "<$1>")
  h = h.replace(/<p>(?:\s|&nbsp;|<br>|<strong>|<\/strong>)*<\/p>/gi, "").replace(/<li>\s*<\/li>/gi, "")
  h = h.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
  return h.trim()
}

// The top-level columns of a page-builder section (sppb-col-*), each from its opening div to its
// own closing tag — the department pages put the copy in the first column and the "Sell your
// collection" box (video, text, GET STARTED, the prices-achieved picture) in the next.
function columnsOf(section) {
  const out = []
  const re = /<div class="sppb-col-/g
  let m
  while ((m = re.exec(section))) {
    const start = m.index
    const inner = /<div\b|<\/div>/g
    inner.lastIndex = start
    let depth = 0, x, end = -1
    while ((x = inner.exec(section))) {
      depth += x[0] === "</div>" ? -1 : 1
      if (depth === 0) { end = x.index + 6; break }
    }
    if (end < 0) break
    out.push(section.slice(start, end))
    re.lastIndex = end
  }
  return out
}
const ext = p => (path.extname(String(p).split("?")[0]).toLowerCase() || ".jpg").replace(/[^.a-z0-9]/g, "")
const norm = s => unescape(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()

say("Collecting the department pages from vectis.co.uk into " + OUT)

// 1 · The menu — the list, the order and the names, from the Departments dropdown on the index page
const indexRes = await get(SITE + "departments/departments", "text/html,application/xhtml+xml")
if (!indexRes) { say("⚠ The departments index would not load — nothing collected"); process.exit(1) }
const indexHtml = await indexRes.text()
const menu = []
const seen = new Set()
for (const m of indexHtml.matchAll(/<li class="nav-item item-\d+"><a href="\/departments\/([^"\/]+)"[^>]*>([^<]*)<\/a>/g)) {
  const slug = m[1].trim(), name = unescape(m[2]).trim()
  if (slug === "departments" || seen.has(slug)) continue
  seen.add(slug)
  menu.push({ slug, name, order: menu.length + 1 })
}
say(menu.length + " departments in the menu")

// 2 · The index tiles — a picture per department, matched by name
const tiles = new Map()
const indexBlock = builderBlock(indexHtml) || ""
for (const m of indexBlock.matchAll(/data-large="([^"]+)"[^>]*alt="([^"]*)"[\s\S]*?<div class="department__content"><p>([^<]*)<\/p>\s*<a[^>]*href="([^"]+)"/g)) {
  const pic = sitePath(unescape(m[1])), alt = unescape(m[2]), label = unescape(m[3]).trim(), href = unescape(m[4])
  tiles.set(norm(label), { pic, alt, href })
  if (alt) tiles.set(norm(alt), { pic, alt, href })
}
say(tiles.size ? "index tiles read" : "⚠ no tiles read from the index — departments will have no tile picture")

// 3 · Each department's page
const departments = []
for (const d of menu) {
  const res = await get(SITE + "departments/" + d.slug, "text/html,application/xhtml+xml")
  if (!res) { say("⚠ " + d.name + " — its page would not load"); departments.push({ ...d, siteLink: "departments/" + d.slug, failed: true }); await sleep(PAUSE); continue }
  const html = await res.text()
  const block = builderBlock(html)
  const out = {
    ...d, siteLink: "departments/" + d.slug,
    pageTitle: null, heading: null, heroPath: null, heroFile: null, tilePath: null, tileFile: null,
    copyHtml: null, sideHtml: null, extraImages: [], highlights: [], newsAliases: [], pastAuctions: [], saleKeywords: [],
  }
  const t = html.match(/<title>\s*Vectis Auctions\s*\|\s*([^<]*)<\/title>/i)
  out.pageTitle = t ? unescape(t[1]).trim() || null : null
  if (block) {
    const hero = block.match(/<img\b[^>]*data-large="([^"]+)"[^>]*>/i)
    if (hero) {
      out.heroPath = sitePath(unescape(hero[1]))
      const alt = attr(hero[0], "alt")
      if (alt) out.pageTitle = alt
      out.heroFile = `dept-${d.slug}-hero${ext(out.heroPath)}`
    }
    const h1 = block.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    out.heading = h1 ? textOf(h1[1]) : null
    const sections = [...block.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/gi)].map(m => m[0])
    // the section with the h1 (else the first): its first column is the copy, the rest the "Sell your
    // collection" side box — video, text, GET STARTED, the prices-achieved picture
    const first = sections.find(s => /<h1\b/i.test(s)) || sections[0] || ""
    const cols = columnsOf(first)
    const back = /<a\b[^>]*>\s*(?:<i[^>]*>\s*<\/i>)?\s*BACK TO DEPARTMENTS\s*<\/a>/gi
    out.copyHtml = cleanBlock((cols[0] ?? first).replace(back, "")) || null
    out.sideHtml = cols.length > 1 ? cleanBlock(cols.slice(1).join("\n")) || null : null
    // the pictures inside either column become files of their own
    for (const part of [out.copyHtml, out.sideHtml]) {
      for (const m of (part || "").matchAll(/<img src="([^"]+)"/g)) {
        const p = m[1]
        if (out.extraImages.some(x => x.path === p)) continue
        out.extraImages.push({ path: p, file: `dept-${d.slug}-x${out.extraImages.length + 1}${ext(p)}` })
      }
    }
    // the highlighted lots
    const hl = sections.find(s => /Highlighted Lots/i.test(s))
    if (hl) {
      const chunks = hl.split("sppb-addon-single-image-container").slice(1)
      for (const c of chunks) {
        const img = c.match(/<img\b[^>]*data-large="([^"]+)"[^>]*>/i)
        if (!img) continue
        const link = (c.match(/<a\b[^>]*href="([^"]+)"/i) || [])[1]
        const strong = c.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)
        const hammer = c.match(/Hammer Price:(?:&nbsp;|\s)*£?\s*([\d,]+)/i)
        const metaP = c.match(/<p[^>]*>((?:(?!<\/p>)[\s\S])*Item Category[\s\S]*?)<\/p>/i)
        const n = out.highlights.length + 1
        const imagePath = sitePath(unescape(img[1]))
        out.highlights.push({
          title: (strong ? textOf(strong[1]) : "") || attr(img[0], "alt") || "",
          hammer: hammer ? "£" + hammer[1] : null,
          meta: metaP ? unescape(metaP[1].replace(/<br\s*\/?>/gi, " · ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").replace(/\s*·\s*/g, " · ").trim() : null,
          link: link ? unescape(link) : null,
          imagePath, file: `dept-${d.slug}-${n}${ext(imagePath)}`,
        })
        if (out.highlights.length >= 24) break
      }
    }
  } else {
    say("⚠ " + d.name + " — no page-builder block on its page; only the menu entry is kept")
  }
  for (const m of html.matchAll(/\/news-stories\/news\/([a-z0-9-]+)/gi)) { if (!out.newsAliases.includes(m[1])) out.newsAliases.push(m[1]) }
  out.newsAliases = out.newsAliases.slice(0, 6)
  const sales = new Map()
  for (const m of html.matchAll(/href="\/bidding\/([A-Za-z0-9]+)-[^"]*?-(\d+)"[^>]*title="([^"]*)"/g)) {
    const siteId = Number(m[2]); if (!sales.has(siteId)) sales.set(siteId, { siteId, code: m[1].toUpperCase(), title: unescape(m[3]).trim() })
  }
  out.pastAuctions = [...sales.values()]
  out.saleKeywords = unescape(d.name).split(/\s*(?:&|,|\/|\band\b)\s*/i).map(s => s.trim()).filter(Boolean)
  const tile = tiles.get(norm(d.name)) || tiles.get(norm(out.pageTitle || "")) || [...tiles.entries()].find(([k]) => k.includes(norm(d.name)) || norm(d.name).includes(k))?.[1]
  if (tile) { out.tilePath = tile.pic; out.tileFile = `dept-${d.slug}-tile${ext(tile.pic)}` }
  departments.push(out)
  say(d.name + " · " + (out.copyHtml ? "copy" : "NO copy") + " · " + out.highlights.length + " highlighted lots · " + out.pastAuctions.length + " past sales · " + out.newsAliases.length + " news · " + (out.heroPath ? "banner" : "no banner") + (out.tilePath ? " · tile" : " · no tile"))
  await sleep(PAUSE)
}
fs.writeFileSync(FILE, JSON.stringify({ collectedAt: new Date().toISOString(), kind: "departments", departments }))

// 4 · The pictures
let had = 0, got = 0
const failed = []
// ⚠ The same address-building and picture check as scripts/collect-news.mjs — change one, change
// the other: a path may carry %20 already (decode, then encode once), and only a real JPEG, PNG,
// WebP or GIF is written — the site's error page arrives with status 200.
const pictureUrl = p => {
  if (/^https?:\/\//i.test(p)) return p
  let clean = p
  try { clean = decodeURIComponent(p) } catch {}
  return SITE + encodeURI(clean)
}
const isPicture = buf => buf.length > 12 && (
  (buf[0] === 0xFF && buf[1] === 0xD8) || (buf[0] === 0x89 && buf[1] === 0x50) ||
  buf.toString("ascii", 0, 4) === "RIFF" || buf.toString("ascii", 0, 3) === "GIF")
async function fetchPicture(p, file) {
  if (!p || !file) return
  const target = path.join(PICS, file)
  try { if (fs.statSync(target).size > 0) { had++; return } } catch {}
  const res = await get(pictureUrl(p), "image/*")
  let ok = false
  if (res) { try { const buf = Buffer.from(await res.arrayBuffer()); if (isPicture(buf)) { fs.writeFileSync(target, buf); ok = true } } catch {} }
  if (ok) got++; else failed.push(file + " ← " + p)
  await sleep(PIC_PAUSE)
}
for (const d of departments) {
  await fetchPicture(d.heroPath, d.heroFile)
  await fetchPicture(d.tilePath, d.tileFile)
  for (const h of d.highlights || []) await fetchPicture(h.imagePath, h.file)
  for (const x of d.extraImages || []) await fetchPicture(x.path, x.file)
}
const hls = departments.reduce((n, d) => n + (d.highlights || []).length, 0)
say("FINISHED — " + departments.length + " departments in " + FILE + " (" + hls + " highlighted lots); pictures: " + got + " downloaded now, " + had + " already in the folder" + (failed.length ? ", " + failed.length + " could not be fetched" : ""))
if (failed.length) say("⚠ Pictures that would not download: " + failed.join("; "))
say("Now on the Hub: Databases → Departments → Update the departments — load vectis-departments.json, then choose every file in the pictures folder.")
