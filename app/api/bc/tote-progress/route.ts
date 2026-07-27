import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 300

// GET /api/bc/tote-progress?excludeBench=1
//
// "Where are we up to" per check-in category.
//
// For each EVA_TOT_ArticleCategory this returns the check-in date
// (SystemCreatedAt) of the OLDEST tote that has NOT yet been catalogued —
// the true progress line. If nothing older than 12 Jun is left in TV_FILM,
// then TV_FILM is genuinely up to 12 Jun, regardless of whether a newer tote
// happened to be catalogued out of order.
//
// The newest CATALOGUED tote's check-in date is returned alongside it for
// context: a wide gap between the two means old stock is being skipped.
//
// BC stores EVA_TOT_Catalogued as a plain boolean with no timestamp, so
// "when was it catalogued" is not answerable from this endpoint — every date
// here is a CHECK-IN date.

const SALESPERSON_NAMES: Record<string, string> = {
  AM: "Ashley McIntyre", AR: "Andrea Rowntree", AR2: "Andrew Reed", AROB: "Amelia Robson",
  AUCTIONM: "Auction Marketer", AW: "Andrew Wilson", BC: "Bob Coulson", BG: "Bryan Goodall",
  BJ: "Becky Jones", BK: "Ben Kennington", CDT: "Craig Deery Taylor", CH: "Chris Hemingway",
  CW: "Chris Whan", DAVEC: "Dave Cannings", DB: "Daniel Brakenbury", DC: "Debbie Cockerill",
  DL: "Daniel Lorraine", DP: "Dispatch", ED: "Edward Duffy", EG: "Ewan Gray",
  EVO: "Evo-soft", EW: "Eve Walker", FG: "Felix Goodman", GH: "Gill Harley",
  HW: "Harry Wheatley", ID: "Ian Dilley", IM: "Ian Main", JACKS: "Jack Swinnerton",
  JC: "Jack Collings", JG: "Jonathon Gouder", JGOOD: "Jonathan Goodall", JK: "Jake Kenyon",
  JM: "Jo McDonald", JO: "Jordan Orange", JR: "Julian Royse", JS: "Jake Smithson",
  JW: "Julie Walker", KR: "Kay Rankin", KS: "Keiran Southgate", KT: "Kathy Taylor",
  LH: "Lesley Hill", LOUISEH: "Louise", LS: "Lisa Sutherland", MB: "Matt Bailey",
  MBAR: "Matthew Barrass", MBARRAS: "Matthew Barras", MC: "Matthew Cotton", MD: "Mike Delaney",
  MF: "Mike Fishwick", MT: "Michelle Trotter", MV: "Melanie Vasey", ND: "Nick Dykes",
  NO: "Naomi O'Conner", OB: "Olivia Burley", OJ: "Olivia Jordan", PATM: "Patricia McKnight",
  PB: "Paul Beverley", PC: "Phil Cochrane", PD: "Peter Davis", PG: "Paul Garrens",
  PM: "Peter Morris", SC: "Simon Clarke", SCANNER: "Scanner", SF: "Steven Furlong",
  SM: "Sanaz Moghaddam", SR: "Stuart Redding", SS: "Simon Smith", TR: "Tim Routh",
  VA: "Vectis Accounts", VS: "Vanessa Stanton", WA: "Admin Warehouse", WR: "Wendy Robins",
}

// Same column names the Warehouse report uses — keep these in sync with
// app/api/bc/warehouse/route.ts.
const CAT_COL        = "EVA_TOT_ArticleCategory"
const CATALOGUER_COL = "EVA_TOT_AssignToCataloguer"
const CATALOGUED_COL = "EVA_TOT_Catalogued"
const CREATED_COL    = "SystemCreatedAt"      // BC record-creation timestamp = when the tote was checked in
const LOC_COL        = "EVA_TOT_ToteLocation" // blank = unlocated; "BENCH*" = at a cataloguing bench

// How many "next up" totes to return per category for the drill-down.
const UPCOMING_PER_CATEGORY = 8

const DAY_MS = 86_400_000

type ToteRow = {
  barcode:     string
  description: string
  location:    string
  cataloguer:  string
  created:     string
  createdMs:   number
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

    const excludeBench = req.nextUrl.searchParams.get("excludeBench") === "1"

    // Drop blank-location and bench totes when asked — those are in-progress,
    // not shelved stock waiting to be worked.
    const locOk = (r: any): boolean => {
      if (!excludeBench) return true
      const loc = String(r[LOC_COL] ?? "").trim()
      return loc !== "" && !loc.toUpperCase().includes("BENCH")
    }
    const isCatalogued = (r: any): boolean => r[CATALOGUED_COL] === true

    const allRows = await bcFetchAll(token, "Receipt_Totes_Excel")
    const scoped  = allRows.filter(locOk)

    const outstandingRows = scoped.filter(r => !isCatalogued(r))
    const cataloguedRows  = scoped.filter(isCatalogued)

    const locationExcluded = excludeBench
      ? allRows.filter(r => !isCatalogued(r) && !locOk(r)).length
      : 0

    const toRow = (r: any): ToteRow => {
      const created   = String(r[CREATED_COL] ?? "")
      const createdMs = Date.parse(created)
      const code      = String(r[CATALOGUER_COL] ?? "").trim()
      return {
        barcode:     String(r["No_"] ?? r["EVA_TOT_No"] ?? ""),
        description: String(r["Description"] ?? r["EVA_TOT_Description"] ?? ""),
        location:    String(r[LOC_COL] ?? ""),
        cataloguer:  SALESPERSON_NAMES[code] ?? code,
        created,
        createdMs:   Number.isFinite(createdMs) ? createdMs : NaN,
      }
    }

    // ── Group outstanding totes by category ────────────────────────────────
    const byCat = new Map<string, ToteRow[]>()
    for (const r of outstandingRows) {
      const cat = String(r[CAT_COL] ?? "").trim() || "Unknown"
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat)!.push(toRow(r))
    }

    // Newest CHECK-IN date among already-catalogued totes, per category.
    const newestCatalogued = new Map<string, number>()
    const cataloguedCount  = new Map<string, number>()
    for (const r of cataloguedRows) {
      const cat = String(r[CAT_COL] ?? "").trim() || "Unknown"
      cataloguedCount.set(cat, (cataloguedCount.get(cat) ?? 0) + 1)
      const ms = Date.parse(String(r[CREATED_COL] ?? ""))
      if (!Number.isFinite(ms)) continue
      const cur = newestCatalogued.get(cat)
      if (cur == null || ms > cur) newestCatalogued.set(cat, ms)
    }

    const now = Date.now()

    const categories = [...byCat.entries()].map(([category, rows]) => {
      const dated   = rows.filter(r => Number.isFinite(r.createdMs)).sort((a, b) => a.createdMs - b.createdMs)
      const undated = rows.length - dated.length
      const oldest  = dated[0] ?? null

      const newestCatMs = newestCatalogued.get(category) ?? null

      return {
        category,
        outstanding:          rows.length,
        undated,
        oldestDate:           oldest ? new Date(oldest.createdMs).toISOString() : null,
        oldestAgeDays:        oldest ? Math.floor((now - oldest.createdMs) / DAY_MS) : null,
        newestCataloguedDate: newestCatMs != null ? new Date(newestCatMs).toISOString() : null,
        cataloguedCount:      cataloguedCount.get(category) ?? 0,
        // Oldest-first — this is the queue in the order it should be worked.
        upcoming:             dated.slice(0, UPCOMING_PER_CATEGORY).map(({ createdMs, ...rest }) => rest),
      }
    })

    // Worst backlog first: oldest outstanding date at the top. Categories with
    // no dated outstanding tote sink to the bottom.
    categories.sort((a, b) => {
      if (a.oldestDate == null && b.oldestDate == null) return b.outstanding - a.outstanding
      if (a.oldestDate == null) return 1
      if (b.oldestDate == null) return -1
      return Date.parse(a.oldestDate) - Date.parse(b.oldestDate)
    })

    const furthestBehind = categories.find(c => c.oldestDate != null) ?? null

    return NextResponse.json({
      categories,
      meta: {
        totalOutstanding:    outstandingRows.length,
        totalCatalogued:     cataloguedRows.length,
        categoryCount:       categories.length,
        furthestBehindDate:  furthestBehind?.oldestDate ?? null,
        furthestBehindCat:   furthestBehind?.category ?? null,
        furthestBehindDays:  furthestBehind?.oldestAgeDays ?? null,
        undatedOutstanding:  outstandingRows.filter(r => !Number.isFinite(Date.parse(String(r[CREATED_COL] ?? "")))).length,
        locationExcluded,
        excludeBench,
        generatedAt:         new Date().toISOString(),
      },
    })
  } catch (e: any) {
    console.error("bc/tote-progress error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
