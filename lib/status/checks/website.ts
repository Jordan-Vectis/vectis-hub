import { prisma } from "@/lib/prisma"
import type { CheckResult, Fact, StatusCheckDef } from "../types"

// 🚦 The Vectis website (www.vectis.co.uk, run by AuctionMarketer) — as the Hub uses it.
//
// The Hub reads the site's lot feed for the one thing Business Central's API doesn't publish: the
// full lot descriptions and photos behind the BC Database (BcLotWeb). For Jordan, "working" means
// that collection is keeping up — so the light is led by how fresh the office collection is.
//
// ⚠⚠ THE SITE ANSWERS THE HUB'S SERVER WITH 202 AND AN EMPTY BODY — BY DESIGN AT ITS END, NOT A
// FAULT (measured twice from Railway, 2026-09-09; RULES.md "Databases → BC Database"). The same
// request from an office machine returns the lots, so the feed is collected on an office computer
// and uploaded. A check that judged the site by what it says to our server would be red for ever,
// so the server's view is only a FACT here, never the light. There is deliberately no homepage
// check either: that has never been measured from Railway and may well be blocked the same way.
//
// ⚠ Production only. Staging and sandbox databases are copies of production that stopped moving
// the day they were made, so their collection would look further behind every day.

const SITE = "https://www.vectis.co.uk"
// ⚠ Mirrors FEED_HEADERS in lib/archive-site.ts (not exported there) — the honest User-Agent and
// the headers the site's own page sends. If that list changes, change this one too.
const FEED_HEADERS = {
  "User-Agent":       "VectisHub archive (IT@vectis.co.uk)",
  "Content-Type":     "application/x-www-form-urlencoded",
  "Accept":           "application/json, text/javascript, */*; q=0.01",
  "Accept-Language":  "en-GB,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  "Referer":          `${SITE}/`,
  "Origin":           SITE,
} as const
/** A sale the site is KNOWN to hold (774 lots, measured from the office 2026-09-09). ⚠ A sale number
 *  that doesn't exist answers 500 by design, so probing an arbitrary one would read as an error. */
const PROBE_SALE = 2
const TIMEOUT_MS = 10_000

/** A sale's lots reach the site's feed once it has finished, and collecting them is a manual job on
 *  an office computer — so a sale only counts as "waiting" once it is this many days old. */
const WAIT_GRACE_DAYS = 7
/** Only recent sales are judged. The point is "are newly sold lots arriving", and an old sale that
 *  was never on the website (B023 was one) must not hold the light amber for ever. */
const WINDOW_DAYS = 90
/** BC holds placeholder sales that never reach the website (the 2026-09-09 run's 8 misses were all
 *  Cancelled / No Auction / Do not use / DUMMY / TESTING). */
const NOT_A_SALE = /cancel|no auction|do not use|dummy|\btest/i

const londonDay = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms))

function fmtWhen(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(d)
}

function fmtAgo(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 1) return "less than a minute"
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`
  return `${Math.round(h / 24)} days`
}

/** "2026-09-02" → "2 Sep" */
function fmtDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])))
}

function listSales(sales: { code: string; d: string }[]): string {
  const shown = sales.slice(0, 6).map(s => `${s.code} (${fmtDay(s.d)})`).join(", ")
  return sales.length > 6 ? `${shown} and ${sales.length - 6} more` : shown
}

const isMissingTable = (e: unknown) => {
  const err = e as { code?: string; message?: string } | null
  // ⚠ Not a bare /relation/ — plenty of unrelated Postgres errors mention a relation ("is locked"…).
  return err?.code === "P2021" || err?.code === "P2022" || /does not exist/i.test(String(err?.message ?? ""))
}

/** What the website says to the Hub's own server. Information only — see the header. */
async function serverView(): Promise<{ value: string; tone?: Fact["tone"] }> {
  try {
    // Exactly probeSite() in lib/archive-site.ts, but one lot instead of five, and with a timeout.
    const body = new URLSearchParams({
      per_page: "1", current_page: "1", auction_id: String(PROBE_SALE), lot_order: "", sale_type: "", keyword: "",
      cate_arr: "[]", sub_cate_arr: "[]", extended_attrs_obj: "{}", low_estimate: "", high_estimate: "", catalogue_layout_header_id: "0",
    })
    const res = await fetch(`${SITE}/index.php?option=com_bidding&format=json&task=commission.getLots`, {
      method: "POST", headers: FEED_HEADERS, body, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = (await res.text().catch(() => "")).trim()
    if (!text) {
      // ⚠ Only 202-and-nothing is the measured block. Any other empty answer is something new (a 500
      // would mean "no such sale", but sale 2 exists), so it is never labelled "expected".
      return res.status === 202
        ? { value: "Blocked from the Hub's server (expected) — it answers 202 with nothing, as it has since 9 Sep 2026." }
        : { value: `Answered HTTP ${res.status} with nothing — not the usual block (202), so worth trying vectis.co.uk from an office computer.`, tone: "warn" }
    }
    let j: unknown
    try { j = JSON.parse(text) } catch {
      return res.ok
        ? { value: `Answered with a web page instead of its lot feed (HTTP ${res.status}) — maintenance or a block page.`, tone: "warn" }
        : { value: `Answered with an error (HTTP ${res.status}).`, tone: "warn" }
    }
    const lots = (j as { lots?: unknown } | null)?.lots
    // ⚠ Sale 2 holds 774 lots, so only a list WITH lots means the block has lifted — an empty list
    // is just another way of being refused, and must not announce good news.
    if (Array.isArray(lots) && lots.length > 0) {
      // News worth telling: the block has lifted, so the page's own Pull button would work again.
      return { value: "The Hub's server can read the lot feed again — the block seems to have lifted, so Pull from the website may work.", tone: "good" }
    }
    if (Array.isArray(lots)) return { value: `Answered HTTP ${res.status} with an empty lot list for a sale that has lots.`, tone: "warn" }
    return { value: `Answered HTTP ${res.status} without a lot list.`, tone: "warn" }
  } catch (e) {
    const err = e as { name?: string; code?: string; cause?: { name?: string; code?: string } } | null
    if (err?.name === "TimeoutError" || err?.name === "AbortError" || err?.cause?.name === "TimeoutError") {
      return { value: `Didn't answer the Hub's server within ${TIMEOUT_MS / 1000} seconds — try vectis.co.uk from an office computer.`, tone: "warn" }
    }
    const code = err?.cause?.code ?? err?.code
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return { value: "The Hub's server couldn't look up the website's address — try vectis.co.uk from an office computer.", tone: "warn" }
    }
    return { value: "The Hub's server couldn't connect — try vectis.co.uk from an office computer.", tone: "warn" }
  }
}

const HOW: Fact = {
  label: "How it's collected",
  value: "On an office computer, then loaded on the BC Database page (📥 Update the BC lots). The website won't answer the Hub's own server.",
}

const check: StatusCheckDef = {
  key: "website",
  name: "Vectis website",
  group: "suppliers",
  what: "The public auction site. Its full lot descriptions and photos feed the ABC and BC Databases.",
  whenDown: "Newly sold lots don't reach the BC Database.",
  intervalMin: 60,

  async run(ctx): Promise<CheckResult> {
    if (!ctx.isProduction) {
      return {
        state: "off",
        summary: "Only checked on production — this database is a copy that stopped updating when it was made, so the collection would always look behind.",
      }
    }

    const nowMs = ctx.now.getTime()
    const today = londonDay(nowMs)
    const graceCut = londonDay(nowMs - WAIT_GRACE_DAYS * 86_400_000)
    const windowStart = londonDay(nowMs - WINDOW_DAYS * 86_400_000)
    const tomorrow = londonDay(nowMs + 86_400_000)

    // The server's view runs alongside the database reads — it's a fact, not the light.
    const viewP = serverView()

    let held = 0
    let lastLoaded: Date | null = null
    let collectedTo: number | null = null
    let sales: { code: string; name: string | null; d: string; collected: boolean }[]
    try {
      const agg = await prisma.bcLotWeb.aggregate({ _count: { _all: true }, _max: { pulledAt: true } })
      held = agg._count._all
      lastLoaded = agg._max.pulledAt
      // ⚠ Migration-safe on its own: siteSaleId arrived later than the table (it was missed from the
      // MIGRATIONS array once, 2026-09-09), so a missing column must not sink the whole check.
      try {
        const r = await prisma.$queryRaw<{ m: number | null }[]>`SELECT max("siteSaleId") AS m FROM "BcLotWeb"`
        collectedTo = r[0]?.m != null ? Number(r[0].m) : null
      } catch { collectedTo = null }

      // Recent sales BC has results for, and whether ANY of their lots has come back from the site.
      // ⚠ Matched on the BC unique ID (upper-cased, as the BC Database page joins), NOT on
      // BcLotWeb.auctionCode — that comes from the collector's file and can be blank.
      // ⚠ auctionDate is an ISO string, sometimes with a time on it, so the bounds are plain string
      // comparisons that hold for both ("2026-09-10T…" < "2026-09-11"), and stay index-friendly.
      // hammerPrice > 0 means the sale really happened and BC has its results; the lot-number rule is
      // the same one the BC Database uses for what it shows.
      sales = await prisma.$queryRaw<{ code: string; name: string | null; d: string; collected: boolean }[]>`
        SELECT w."auctionCode" AS code,
               max(w."auctionName") AS name,
               max(left(w."auctionDate", 10)) AS d,
               bool_or(b."uniqueId" IS NOT NULL) AS collected
        FROM "WarehouseItem" w
        LEFT JOIN "BcLotWeb" b ON b."uniqueId" = upper(w."uniqueId")
        WHERE w."auctionCode" IS NOT NULL
          AND w."auctionDate" >= ${windowStart}
          AND w."auctionDate" < ${tomorrow}
          AND w."hammerPrice" > 0
          AND COALESCE(NULLIF(w."currentLotNo", '0'), NULLIF(w."lotNo", '0')) IS NOT NULL
        GROUP BY w."auctionCode"`
    } catch (e) {
      const view = await viewP
      return {
        state: "unknown",
        summary: isMissingTable(e)
          ? "The BC Database isn't fully set up here yet — press Run Migrations on the Admin page."
          : "Couldn't read the BC Database, so how far the collection has got couldn't be confirmed.",
        facts: [{ label: "From the Hub's own server", value: view.value, tone: view.tone }, HOW],
      }
    }

    const real = sales.filter(s => !s.collected && s.d <= today && !(s.name && NOT_A_SALE.test(s.name)))
    const waiting = real.filter(s => s.d <= graceCut).sort((a, b) => b.d.localeCompare(a.d))
    const recent = real.filter(s => s.d > graceCut).sort((a, b) => b.d.localeCompare(a.d))
    const view = await viewP

    const facts: Fact[] = [
      lastLoaded
        ? { label: "Last collection loaded", value: `${fmtWhen(lastLoaded)} (${fmtAgo(nowMs - lastLoaded.getTime())} ago)` }
        : { label: "Last collection loaded", value: "Never — nothing has been loaded from the website yet", tone: "warn" },
    ]
    // ⚠ Say so when the marker is missing rather than leaving the line out. siteSaleId arrived after
    // the table, so lots loaded before it exists carry NULL and max() is null on a full database —
    // silence there reads as "nothing to report" and the BC page's own start-from guess is wrong
    // (2026-09-17: a year of sales was collected again because of it).
    if (collectedTo != null) facts.push({ label: "Collected up to website sale", value: `${collectedTo} — the next run starts at ${collectedTo + 1}` })
    else if (held > 0) facts.push({ label: "Collected up to website sale", value: "Not recorded for these lots — they were loaded before the Hub kept the sale number, so a new run has no sale to carry on from", tone: "warn" })
    facts.push({ label: "Lots held from the website", value: held.toLocaleString("en-GB") })
    facts.push(waiting.length
      ? { label: "Waiting to be collected", value: listSales(waiting), tone: "warn" }
      : { label: "Waiting to be collected", value: `None — every sale in the last ${WINDOW_DAYS} days that is over ${WAIT_GRACE_DAYS} days old is in`, tone: "good" })
    if (recent.length) facts.push({ label: "Recent sales not collected yet", value: `${listSales(recent)} — normal for the first ${WAIT_GRACE_DAYS} days` })
    facts.push({ label: "From the Hub's own server", value: view.value, tone: view.tone })
    facts.push(HOW)

    if (waiting.length) {
      const n = waiting.length
      // ⚠ cause "hub": the website blocking our server is its normal state (see the header), so a sale
      // waiting here is an office task not done yet — collecting and uploading it is ours to do.
      return {
        state: "degraded",
        cause: "hub",
        summary: `${n} sale${n === 1 ? " is" : "s are"} waiting to be collected from an office computer.`,
        facts,
      }
    }
    return {
      state: "ok",
      summary: lastLoaded
        ? `Every recent sale over a week old has reached the BC Database — last collection loaded ${fmtAgo(nowMs - lastLoaded.getTime())} ago.`
        : "No recent sale is waiting to be collected.",
      facts,
    }
  },
}

export default check
