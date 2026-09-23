// Collect every News & Stories article from vectis.co.uk — text AND pictures — for the Hub's
// Databases → News page (and, through it, the test website's News & Stories pages).
//
//   node scripts/collect-news.mjs <outputFolder>
//
// ⚠ Why an office machine: the website answers the Hub's Railway server with 202 and an empty body
// for everything, while the same request from the office works (measured twice, 2026-09-09). So this
// runs on an office PC and the folder it makes is loaded on Databases → News.
//
// How the site serves its news (found 2026-09-23): the page is a Joomla blog with a JSON feed —
//   POST index.php?option=com_blog&format=json&task=blog.getArticles   (form: start, selected_category,
//        search, articles_per_page — 100 a page works)  → { status, articles, total_articles, featured_articles }
//   POST …task=blog.getCategories → { status, categories: [{ id, title }] }
// Each article carries its category id, tags, dates and its cover picture as a path on the site
// (images/2026/09/Lot-305-news-desk.jpg), which the site serves as a plain file.
//
// ⚠ The feed's "fulltext" is FLATTENED — tags stripped, paragraphs collapsed to runs of spaces,
// emojis dropped (Jordan, 2026-09-23: "it hasn't got the images inside the articles or the format
// correct, like missing spaces, emojis etc."). The real article — paragraphs, emojis (Facebook
// emoji pictures with the emoji in their alt), and the article's own pictures (SP Page Builder
// images, lazy-loaded with the real file in data-large) — is only on the article's PAGE. So after
// the feed, every article's page is read too (sef_link), its page-builder block is cleaned into
// plain HTML, and the pictures inside it are downloaded as well.
//
// Writes  <outputFolder>/vectis-news.json             — every article (the file the Hub page loads)
//         <outputFolder>/pictures/<id>.<ext>          — each cover picture (the listing thumbnail)
//         <outputFolder>/pictures/<id>-<n>.<ext>      — each picture inside the article, in order
//         <outputFolder>/vectis-news-log.txt
// Safe to run again: the article list is always pulled whole (14 requests); an article's page is
// read again only when the feed says it has been modified since; pictures already in the folder
// are kept; and the Hub keeps its own copy of any picture it already has.
import fs from "node:fs"
import path from "node:path"

const OUT = process.argv[2] ?? "."
// ⚠ Written in PARTS (vectis-news-1.json, -2.json, …, 250 articles each, a few MB apiece): the page
// text takes one file for everything past the Hub's 20 MB request limit, where Railway's proxy
// silently cuts a request off. The page loads all the parts in one go.
const PART = 250
const partFile = n => path.join(OUT, `vectis-news-${n}.json`)
const FILE = partFile(1)
const PICS = path.join(OUT, "pictures")
const FEED = "https://www.vectis.co.uk/index.php?option=com_blog&format=json&task=blog."
const SITE = "https://www.vectis.co.uk/"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
const PER_PAGE = 100
const PAUSE = 300        // between feed pages and article pages
const PIC_PAUSE = 200    // between pictures
const sleep = ms => new Promise(r => setTimeout(r, ms))

fs.mkdirSync(PICS, { recursive: true })
const say = s => {
  const line = new Date().toISOString().slice(11, 19) + " " + s
  console.log(line)
  try { fs.appendFileSync(path.join(OUT, "vectis-news-log.txt"), line + "\n") } catch {}
}

// One call to the feed, three tries. The site wants a form body (the page's own client posts with
// emulateJSON) and answers JSON with a status flag.
async function feed(task, form) {
  let last = ""
  for (let go = 1; go <= 3; go++) {
    try {
      const res = await fetch(FEED + task, {
        method: "POST",
        headers: { "User-Agent": UA, "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
      })
      if (!res.ok) { last = "HTTP " + res.status; await sleep(1500 * go); continue }
      const j = await res.json()
      if (!j || j.status !== true) { last = "the feed said no: " + (j && j.message ? j.message : "no status"); await sleep(1500 * go); continue }
      return j
    } catch (e) {
      last = String(e && e.message ? e.message : e)
      await sleep(1500 * go)
    }
  }
  throw new Error(task + " failed three times — " + last)
}

// A page or a picture, three tries; null when it will not come. 404 = gone, given up at once.
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

// The site's dates are "2026-09-22 11:53:57" in UK time; "0000-00-00 00:00:00" means none.
const when = s => (typeof s === "string" && !/^0000/.test(s) && s.trim()) ? s.trim().replace(" ", "T") : null

// The cover picture: the images field is a JSON string; image_intro is the file's path on the site
// followed by "#joomlaImage://…" — the part before the # is the file.
function picture(a) {
  let im = {}
  try { im = a.images ? JSON.parse(a.images) : {} } catch { im = {} }
  const raw = String(im.image_intro || im.image_fulltext || "").split("#")[0].trim()
  return { path: raw ? raw.replace(/^\/+/, "") : null, alt: String(im.image_intro_alt || im.image_fulltext_alt || "").trim() || null }
}

function normalise(a, categories) {
  const pic = picture(a)
  return {
    id: Number(a.id),
    alias: String(a.alias || "").trim() || String(a.id),
    title: String(a.title || "").trim(),
    sefLink: typeof a.sef_link === "string" ? a.sef_link.replace(/^\/+/, "") : null,
    categoryId: Number.isFinite(Number(a.catid)) ? Number(a.catid) : null,
    category: categories.get(Number(a.catid)) || null,
    tags: Array.isArray(a.tags) ? a.tags.map(t => String(t).trim()).filter(Boolean) : [],
    featured: Number(a.featured) === 1,
    hits: Number.isFinite(Number(a.hits)) ? Number(a.hits) : 0,
    introText: (typeof a.introtext === "string" && a.introtext) || null,
    fullText: (typeof a.fulltext === "string" && a.fulltext) || null,   // the feed's flattened copy — a fallback only
    publishedAt: when(a.publish_up) || when(a.created),
    modifiedAt: when(a.modified),
    imagePath: pic.path,
    imageAlt: pic.alt,
    bodyHtml: null,
    bodyImages: [],
    pageAt: null,
  }
}

// ── The article's page ───────────────────────────────────────────────────────

// The block that IS the article, from its opening div to its own closing tag, found by counting
// divs. Newer articles (2024 on) are an SP Page Builder page; the older ones (2017–2023) use the
// classic Joomla article body — measured 2026-09-23: 591 of 1,337 pages had the builder block,
// the other 746 none, and every one of those had com-content-article__body instead.
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

const attr = (s, name) => { const r = s.match(new RegExp("\\b" + name + "=\"([^\"]*)\"", "i")); return r ? r[1] : null }

// A picture address on the site → its path form ("images/2026/09/22/lot-595.jpg"), or the address
// untouched when it lives somewhere else.
function sitePath(src) {
  let s = src.trim()
  if (s.startsWith(SITE)) s = s.slice(SITE.length)
  else if (s.startsWith("//www.vectis.co.uk/")) s = s.slice("//www.vectis.co.uk/".length)
  if (s.startsWith("/") && !s.startsWith("//")) s = s.slice(1)
  return s
}

// The block as plain article HTML: scripts and styles out; Facebook's emoji pictures back into
// the emoji; lazy pictures pointed at their real file; every attribute dropped except a link's
// href and a picture's src/alt/width/height; empty paragraphs gone.
function cleanBlock(block) {
  let h = block
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/<(?:svg|button|form|input|iframe)\b[\s\S]*?<\/(?:svg|button|form|input|iframe)>/gi, "")
  h = h.replace(/<img\b[^>]*emoji\.php[^>]*>/gi, m => attr(m, "alt") ?? "")
  h = h.replace(/<img\b[^>]*>/gi, m => {
    const file = (attr(m, "data-large") || attr(m, "data-src") || attr(m, "data-original") || attr(m, "src") || "").trim()
    if (!file || /\/media\/com_sppagebuilder\/placeholder\//.test(file) || /\/templates\/vectis\//.test(file)) return ""
    const alt = attr(m, "alt"), w = attr(m, "width"), hh = attr(m, "height")
    return `<img src="${sitePath(file)}"${alt ? ` alt="${alt}"` : ""}${w ? ` width="${w}"` : ""}${hh ? ` height="${hh}"` : ""}>`
  })
  h = h.replace(/<a\b([^>]*)>/gi, (m, attrs) => { const href = attr(attrs, "href"); return href ? `<a href="${href}">` : "<a>" })
  h = h.replace(/<(?!\/)(?!a\b)(?!img\b)([a-z][a-z0-9]*)\b[^>]*>/gi, "<$1>")
  h = h.replace(/<p>(?:\s|&nbsp;|<br>)*<\/p>/gi, "")
  h = h.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
  return h.trim()
}

// Read one article's page: the cleaned block and the pictures inside it (site paths, in order).
async function articlePage(a) {
  if (!a.sefLink) return null
  const res = await get(SITE + a.sefLink, "text/html,application/xhtml+xml")
  if (!res) return null
  const html = await res.text()
  const block = builderBlock(html)
  if (!block) return { bodyHtml: null, bodyImages: [] }
  let bodyHtml = cleanBlock(block)
  const seen = new Set()
  const bodyImages = []
  let n = 0
  // Pictures pasted straight into an older article as a data: address (one was 880 KB of base64
  // inside the page) are written out as files here and the address replaced by a stand-in path
  // "inline/<file>" — the Hub shows its own copy once uploaded and nothing until then.
  bodyHtml = bodyHtml.replace(/<img src="data:image\/(png|jpe?g|gif|webp);base64,([^"]+)"/gi, (m, kind, b64) => {
    n++
    const file = `${a.id}-${n}.${kind.toLowerCase().replace("jpeg", "jpg")}`
    try { fs.writeFileSync(path.join(PICS, file), Buffer.from(b64, "base64")) } catch { return "<img" }
    const p = `inline/${file}`
    seen.add(p)
    bodyImages.push({ path: p, file })
    return `<img src="${p}"`
  })
  bodyHtml = bodyHtml.replace(/<img(?![^>]*\bsrc="(?!data:)[^"]+")[^>]*>/gi, "")   // a data: picture that would not write, or one of another kind, or no address at all
  for (const m of bodyHtml.matchAll(/<img src="([^"]+)"/g)) {
    const p = m[1]
    if (seen.has(p)) continue
    seen.add(p)
    n++
    const ext = (path.extname(p.split("?")[0]).toLowerCase() || ".jpg").replace(/[^.a-z0-9]/g, "")
    bodyImages.push({ path: p, file: `${a.id}-${n}${ext}` })
  }
  return { bodyHtml, bodyImages }
}

// ── Run ──────────────────────────────────────────────────────────────────────

say("Collecting News & Stories from vectis.co.uk into " + OUT)

// What a previous run saved here — the parts, or the single vectis-news.json older runs wrote.
const prevArticles = []
for (const f of fs.readdirSync(OUT)) {
  if (!/^vectis-news(-\d+)?\.json$/.test(f)) continue
  try { const j = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")); if (Array.isArray(j.articles)) prevArticles.push(...j.articles) } catch {}
}
const prevById = new Map(prevArticles.map(a => [Number(a.id), a]))

// 1 · The categories (id → title)
const cats = await feed("getCategories", {})
const categories = new Map((cats.categories || []).map(c => [Number(c.id), String(c.title || "").trim()]))
say(categories.size + " categories")

// 2 · Every article, 100 a page
const byId = new Map()
let total = null
for (let start = 0; ; start += PER_PAGE) {
  const r = await feed("getArticles", { start, selected_category: "", search: "", articles_per_page: PER_PAGE })
  total = Number(r.total_articles)
  const list = Array.isArray(r.articles) ? r.articles : []
  for (const a of list) { const n = normalise(a, categories); if (n.id) byId.set(n.id, n) }
  say("… " + byId.size + " of " + total + " articles")
  if (list.length < PER_PAGE || start + PER_PAGE >= total) break
  await sleep(PAUSE)
}
const articles = [...byId.values()].sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""))
const withCover = articles.filter(a => a.imagePath).length
say("Feed done — " + articles.length + " articles" + (total !== null && articles.length !== total ? " (the site said " + total + ")" : "") + ", " + withCover + " with a cover picture")

// Writes the parts, drops any part left over from a bigger earlier run, and the old single file.
let parts = 0
function save() {
  const cats = [...categories].map(([id, title]) => ({ id, title }))
  const at = new Date().toISOString()
  parts = Math.max(1, Math.ceil(articles.length / PART))
  for (let k = 1; k <= parts; k++) {
    fs.writeFileSync(partFile(k), JSON.stringify({ collectedAt: at, kind: "news", part: k, parts, categories: cats, articles: articles.slice((k - 1) * PART, k * PART) }))
  }
  for (const f of fs.readdirSync(OUT)) {
    const m = f.match(/^vectis-news(?:-(\d+))?\.json$/)
    if (m && (!m[1] || Number(m[1]) > parts)) { try { fs.unlinkSync(path.join(OUT, f)) } catch {} }
  }
}

// 3 · Every article's page — the real text and the pictures inside it. Read again only when the
//     feed says the article has changed since the page was last read.
let pagesRead = 0, pagesKept = 0, pagesEmpty = 0
const pagesFailed = []
for (const a of articles) {
  const old = prevById.get(a.id)
  if (old && old.bodyHtml && old.pageAt && old.modifiedAt === a.modifiedAt) {
    a.bodyHtml = old.bodyHtml; a.bodyImages = Array.isArray(old.bodyImages) ? old.bodyImages : []; a.pageAt = old.pageAt
    pagesKept++
    continue
  }
  const p = await articlePage(a)
  if (!p) { pagesFailed.push(a.id); say("⚠ article " + a.id + " · its page would not load — the feed's text is kept for it"); await sleep(PAUSE); continue }
  a.bodyHtml = p.bodyHtml; a.bodyImages = p.bodyImages; a.pageAt = new Date().toISOString()
  if (!p.bodyHtml) pagesEmpty++
  pagesRead++
  if (pagesRead % 50 === 0) { say("… " + pagesRead + " pages read"); save() }
  await sleep(PAUSE)
}
save()
say("Pages done — " + pagesRead + " read now, " + pagesKept + " unchanged since last time, " + pagesEmpty + " with no article block" + (pagesFailed.length ? ", " + pagesFailed.length + " would not load" : ""))

// 4 · The pictures: cover pictures as <id>.<ext>, pictures inside the article as <id>-<n>.<ext>
let had = 0, got = 0
const failed = []
async function fetchPicture(sitePathOrUrl, file) {
  const target = path.join(PICS, file)
  try { if (fs.statSync(target).size > 0) { had++; return } } catch {}
  const url = /^https?:\/\//i.test(sitePathOrUrl) ? sitePathOrUrl : SITE + encodeURI(sitePathOrUrl)
  const res = await get(url, "image/*")
  let ok = false
  if (res) {
    try { const buf = Buffer.from(await res.arrayBuffer()); if (buf.length) { fs.writeFileSync(target, buf); ok = true } } catch {}
  }
  if (ok) { got++; if ((had + got) % 100 === 0) say("… " + (had + got) + " pictures in the folder") }
  else failed.push(file + " ← " + sitePathOrUrl)
  await sleep(PIC_PAUSE)
}
for (const a of articles) {
  if (a.imagePath) {
    const ext = (path.extname(a.imagePath.split("?")[0]).toLowerCase() || ".jpg").replace(/[^.a-z0-9]/g, "")
    await fetchPicture(a.imagePath, a.id + ext)
  }
  for (const im of a.bodyImages) await fetchPicture(im.path, im.file)
}

const bodyPics = articles.reduce((n, a) => n + a.bodyImages.length, 0)
say("FINISHED — " + articles.length + " articles in " + parts + " file" + (parts === 1 ? "" : "s") + " (vectis-news-1.json …) in " + OUT + " (" + withCover + " cover pictures, " + bodyPics + " pictures inside the articles); pictures: " + got + " downloaded now, " + had + " already in the folder" + (failed.length ? ", " + failed.length + " could not be fetched" : ""))
if (pagesFailed.length) say("⚠ Article pages that would not load (their feed text is used instead): " + pagesFailed.join(", ") + " — run it again to pick them up")
if (failed.length) say("⚠ Pictures that would not download (the article is still saved without it): " + failed.join("; "))
say("Now on the Hub: Databases → News → Update the news — load every vectis-news-N.json file at once, then choose every file in the pictures folder.")
