import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 300

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

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

    const CAT_COL        = "EVA_TOT_ArticleCategory"
    const CATALOGUER_COL = "EVA_TOT_AssignToCataloguer"
    const CATALOGUED_COL = "EVA_TOT_Catalogued"
    const CREATED_COL    = "SystemCreatedAt"   // BC record-creation timestamp = when the tote was created/arrived

    // Optional date filter on the tote's creation date (YYYY-MM-DD, inclusive).
    const { searchParams } = new URL(req.url)
    const fromParam = searchParams.get("from")
    const toParam   = searchParams.get("to")
    const fMs = fromParam ? Date.parse(`${fromParam}T00:00:00.000Z`) : NaN
    const tMs = toParam   ? Date.parse(`${toParam}T23:59:59.999Z`)   : NaN
    const validFrom = Number.isFinite(fMs) ? fMs : null
    const validTo   = Number.isFinite(tMs) ? tMs : null
    const dateActive = validFrom != null || validTo != null

    // Keep a tote if its SystemCreatedAt falls inside the selected window.
    const inWindow = (r: any): boolean => {
      if (!dateActive) return true
      const t = Date.parse(String(r[CREATED_COL] ?? ""))
      if (!Number.isFinite(t)) return false          // undated rows can't be placed in a range
      if (validFrom != null && t < validFrom) return false
      if (validTo   != null && t > validTo)   return false
      return true
    }

    const allRows    = await bcFetchAll(token, "Receipt_Totes_Excel")
    const windowRows = allRows.filter(inWindow)

    // Whole report is scoped to totes STILL TO BE CATALOGUED — catalogued totes are
    // finished work. (By Cataloguer already excluded them; By Category / totals / raw
    // now match, so every number reflects what's left in the warehouse to catalogue.)
    const rows = windowRows.filter((r) => r[CATALOGUED_COL] !== true)
    const cataloguedExcluded = windowRows.length - rows.length
    // Uncatalogued totes dropped by the date filter for lack of a creation date (transparency).
    const undated = !dateActive ? 0 : allRows.filter(
      (r) => r[CATALOGUED_COL] !== true && !Number.isFinite(Date.parse(String(r[CREATED_COL] ?? ""))),
    ).length

    // By category
    const catCount: Record<string, number> = {}
    for (const r of rows) {
      const cat = r[CAT_COL] ?? "Unknown"
      catCount[cat] = (catCount[cat] ?? 0) + 1
    }
    const byCategory = Object.entries(catCount)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)

    // By cataloguer
    const catloguerCount: Record<string, number> = {}
    for (const r of rows) {
      const code = String(r[CATALOGUER_COL] ?? "").trim()
      if (!code) continue
      const name = SALESPERSON_NAMES[code] ?? code
      catloguerCount[name] = (catloguerCount[name] ?? 0) + 1
    }
    const byCataloguer = Object.entries(catloguerCount)
      .map(([cataloguer, count]) => ({ cataloguer, count }))
      .sort((a, b) => b.count - a.count)

    // Raw rows — keep only useful display fields to limit response size
    const raw = rows.map((r) => ({
      category:   r[CAT_COL]        ?? "",
      cataloguer: SALESPERSON_NAMES[String(r[CATALOGUER_COL] ?? "").trim()] ?? String(r[CATALOGUER_COL] ?? ""),
      catalogued: r[CATALOGUED_COL] === true,
      barcode:    r["No_"] ?? r["EVA_TOT_No"] ?? "",
      description: r["Description"] ?? r["EVA_TOT_Description"] ?? "",
      created:    r[CREATED_COL] ?? "",
    }))

    return NextResponse.json({
      byCategory,
      byCataloguer,
      raw,
      meta: {
        total:              rows.length,
        openTotes:          rows.length,
        cataloguedExcluded,
        undated,
        from:               fromParam ?? null,
        to:                 toParam ?? null,
        categoryCount:      byCategory.length,
        largestCategory:    byCategory[0]?.category ?? "—",
      },
    })
  } catch (e: any) {
    console.error("bc/warehouse error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
