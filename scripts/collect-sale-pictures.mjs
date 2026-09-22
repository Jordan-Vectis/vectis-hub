// Collect every sale's cover picture — the "hero" the website's auction calendar shows — with its
// title and date, from vectis.co.uk, WITHOUT touching the lot feed.
//
//   node scripts/collect-sale-pictures.mjs <firstSale> <lastSale> <outputFolder>
//
// ⚠ Why a separate script (Jordan, 2026-09-22: "can't we make a new one that just gets the cover
// images?"): the lot collector reads every sale's lots as well, which is the slow part and
// pointless when the lots are already in the Hub. This one reads ONE page per sale number and
// nothing else — about a third of a second a sale, so the whole website (1 to ~1,650) takes ten
// minutes or so. It writes one file, vectis-sale-pictures.json, loaded on Databases → Sales →
// "Get the pictures" (the BC Database page's upload reads it too — same route). Safe to stop and
// run again: it carries on from where it got to, and the Hub never blanks a value it already holds.
//
// ⚠ It is the SAME page-reading as the browser copy in lib/sale-pictures-collector.ts and the lot
// collectors. Change one, change the others.
import fs from "node:fs"
import path from "node:path"

const FROM = Number(process.argv[2] ?? 1)
const TO = Number(process.argv[3] ?? 1700)
const OUT = process.argv[4] ?? "."
const STATE = path.join(OUT, "vectis-sale-pictures-state.json")
const FILE = path.join(OUT, "vectis-sale-pictures.json")
const PAUSE = 250
const PAGE_URL = "https://www.vectis.co.uk/bidding/0-x-"
const PAGE_OPTS = { headers: {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-GB,en;q=0.9",
} }
const sleep = ms => new Promise(r => setTimeout(r, ms))

fs.mkdirSync(OUT, { recursive: true })
const say = s => {
  const line = new Date().toISOString().slice(11, 19) + " " + s
  console.log(line)
  try { fs.appendFileSync(path.join(OUT, "vectis-sale-pictures-log.txt"), line + "\n") } catch {}
}

// The sale's own page — its title, date and the cover picture. A page that is not a sale (the
// site's error page) gives {}; a page that would not load after three tries gives null.
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"]
const decode = s => String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, " ")
async function salePage(saleId) {
  for (let go = 1; go <= 3; go++) {
    let res
    try { res = await fetch(PAGE_URL + saleId, PAGE_OPTS) }
    catch { await sleep(1500 * go); continue }
    if (res.status === 404 || res.status >= 500) return {}
    if (!res.ok) { await sleep(1500 * go); continue }
    const html = await res.text()
    const t = html.match(/<title>\s*Vectis Auctions\s*\|\s*([^<]*)<\/title>/i)
    const d = html.match(/\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/)
    const h = html.match(/auction_images\/large\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\.(?:webp|jpe?g|png)/i)
    const title = t ? decode(t[1]).trim() : ""
    return {
      title: title && !/^(404|error|page not found)$/i.test(title) ? title : null,   // the error page has a title too
      date: d ? d[3] + "-" + String(MONTHS.indexOf(d[2]) + 1).padStart(2, "0") + "-" + d[1].padStart(2, "0") : null,
      hero: h ? h[0] : null,
    }
  }
  return null
}

// Resume: the file holds what was found so far, the state file says where to carry on from.
const prev = (() => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")) } catch { return null } })()
const resuming = prev && prev.from === FROM && prev.to === TO && prev.next > FROM
let at = resuming ? prev.next : FROM
let sales = []
if (resuming) { try { sales = (JSON.parse(fs.readFileSync(FILE, "utf8")).sales || []).filter(s => s.siteId < at) } catch { sales = [] } }
let found = sales.length, heroes = sales.filter(s => s.hero).length, gaps = 0
const failed = []

function save(next) {
  fs.writeFileSync(FILE, JSON.stringify({ collectedAt: new Date().toISOString(), kind: "sale-pictures", sales }))
  try { fs.writeFileSync(STATE, JSON.stringify({ from: FROM, to: TO, next }, null, 1)) } catch {}
}

say((resuming ? "Carrying on" : "Collecting") + " sale pictures from sale " + at + " to " + TO + " into " + FILE)

for (; at <= TO; at++) {
  const m = await salePage(at)
  if (m === null) {
    failed.push(at)
    say("⚠ sale " + at + " · the page would not load after three tries — noted; run it again later")
    await sleep(PAUSE); continue
  }
  if (!m.title && !m.hero) {
    gaps++
    if (at % 100 === 0) say("… at sale " + at + " · " + found + " sales, " + heroes + " pictures so far")
    await sleep(PAUSE); continue
  }
  sales.push({ siteId: at, title: m.title, date: m.date, hero: m.hero, lots: [] })
  found++
  if (m.hero) heroes++
  say("sale " + at + " · " + (m.title || "(no title)") + " · " + (m.date || "no date") + " · " + (m.hero ? "picture" : "NO picture"))
  if (found % 50 === 0) save(at + 1)
  await sleep(PAUSE)
}

save(TO + 1)
if (!failed.length) { try { fs.unlinkSync(STATE) } catch {} }
say("FINISHED — " + found + " sales, " + heroes + " with a cover picture, " + gaps + " numbers with no sale. File: " + FILE)
if (failed.length) say("⚠ " + failed.length + " sale(s) would not load and are missing: " + failed.join(", ") + " — run it again to pick them up")
say("Now load the file on the Hub: Databases → Sales → Get the pictures, then press Copy sale pictures.")
