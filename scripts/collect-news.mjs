// Collect every News & Stories article from vectis.co.uk — text AND cover picture — for the Hub's
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
// Each article carries its FULL text (HTML), its category id, tags, dates and its cover picture as a
// path on the site (images/2026/09/Lot-305-news-desk.jpg), which the site serves as a plain file.
// Inline pictures inside the text are counted and reported, not downloaded (v1).
//
// Writes  <outputFolder>/vectis-news.json            — every article (the file the Hub page loads)
//         <outputFolder>/pictures/<article id>.<ext> — each cover picture (the folder the page uploads)
//         <outputFolder>/vectis-news-log.txt
// Safe to run again: the article list is always pulled whole (14 requests), pictures already in the
// folder are kept, and the Hub keeps its own copy of any picture it already has.
import fs from "node:fs"
import path from "node:path"

const OUT = process.argv[2] ?? "."
const FILE = path.join(OUT, "vectis-news.json")
const PICS = path.join(OUT, "pictures")
const FEED = "https://www.vectis.co.uk/index.php?option=com_blog&format=json&task=blog."
const SITE = "https://www.vectis.co.uk/"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
const PER_PAGE = 100
const PAUSE = 300        // between feed pages
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
  const text = typeof a.fulltext === "string" ? a.fulltext : ""
  const intro = typeof a.introtext === "string" ? a.introtext : ""
  const inline = (text.match(/<img\b/gi) || []).length
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
    introText: intro || null,
    fullText: text || null,
    publishedAt: when(a.publish_up) || when(a.created),
    modifiedAt: when(a.modified),
    imagePath: pic.path,
    imageAlt: pic.alt,
    inlinePictures: inline,
  }
}

say("Collecting News & Stories from vectis.co.uk into " + FILE)

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
fs.writeFileSync(FILE, JSON.stringify({ collectedAt: new Date().toISOString(), kind: "news", categories: [...categories].map(([id, title]) => ({ id, title })), articles }))
const inlineTotal = articles.reduce((n, a) => n + a.inlinePictures, 0)
say("Saved " + articles.length + " articles" + (total !== null && articles.length !== total ? " (the site said " + total + ")" : "") + " — " + articles.filter(a => a.imagePath).length + " with a cover picture, " + inlineTotal + " pictures inside the text (not collected)")

// 3 · The cover pictures, one file each, named by article id
let had = 0, got = 0
const failed = []
for (const a of articles) {
  if (!a.imagePath) continue
  const ext = (path.extname(a.imagePath.split("?")[0]).toLowerCase() || ".jpg").replace(/[^.a-z0-9]/g, "")
  const file = path.join(PICS, a.id + ext)
  try { if (fs.statSync(file).size > 0) { had++; continue } } catch {}
  let ok = false
  for (let go = 1; go <= 3 && !ok; go++) {
    try {
      const res = await fetch(SITE + encodeURI(a.imagePath), { headers: { "User-Agent": UA, "Accept": "image/*" } })
      if (res.status === 404) break
      if (!res.ok) { await sleep(1500 * go); continue }
      const buf = Buffer.from(await res.arrayBuffer())
      if (!buf.length) { await sleep(1500 * go); continue }
      fs.writeFileSync(file, buf)
      ok = true
    } catch { await sleep(1500 * go) }
  }
  if (ok) { got++; if ((had + got) % 50 === 0) say("… " + (had + got) + " pictures in the folder") }
  else failed.push(a.id + " " + a.imagePath)
  await sleep(PIC_PAUSE)
}

say("FINISHED — " + articles.length + " articles in " + FILE + "; pictures: " + got + " downloaded now, " + had + " already in the folder" + (failed.length ? ", " + failed.length + " could not be fetched" : ""))
if (failed.length) say("⚠ Pictures that would not download (the article is still saved, without one): " + failed.join("; "))
say("Now on the Hub: Databases → News → Update the news — load vectis-news.json, then choose the pictures folder.")
