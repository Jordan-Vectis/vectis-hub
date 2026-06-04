import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 120

export type EmailListEntry = { name: string; email: string }

// GET /api/bc/email-lists?keywords=Star+Wars,Matchbox&dateFrom=2024-01-01
// Fetches AttendenceRegister, filters by auction name keywords and date,
// returns deduplicated list of { name, email }.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

    const { searchParams } = req.nextUrl
    const keywordsRaw = searchParams.get("keywords") ?? ""
    const dateFrom    = searchParams.get("dateFrom") ?? ""

    const keywords = keywordsRaw.split(",").map(k => k.trim()).filter(Boolean)
    if (!keywords.length) return NextResponse.json({ error: "No keywords provided" }, { status: 400 })

    // Build one filter per keyword (BC times out on complex OR filters)
    // Run in parallel, then merge and deduplicate
    const results = await Promise.allSettled(
      keywords.map(async (kw) => {
        // tolower() makes the search case-insensitive — important as BC auction names vary in casing
        const safe = kw.replace(/'/g, "''").toLowerCase()
        const filterParts: string[] = [
          `contains(tolower(EVA_AuctionName),'${safe}')`,
        ]
        if (dateFrom) {
          filterParts.push(`EVA_AuctionDate ge ${dateFrom}`)
        }
        // Removed EVA_EmailAddress ne '' — that misses null values; empty check is done in code
        const filter = filterParts.join(" and ")
        const select = "EVA_BuyerName,EVA_EmailAddress"

        return await bcFetchAll(token, "AttendenceRegister", filter, select)
      })
    )

    // Merge all rows, deduplicate by email (case-insensitive)
    const seen = new Map<string, EmailListEntry>()
    let rawCount = 0
    for (const result of results) {
      if (result.status !== "fulfilled") continue
      rawCount += result.value.length
      for (const row of result.value) {
        const email = String(row.EVA_EmailAddress ?? "").trim().toLowerCase()
        if (!email) continue
        if (!seen.has(email)) {
          seen.set(email, {
            name:  String(row.EVA_BuyerName ?? "").trim(),
            email: String(row.EVA_EmailAddress ?? "").trim(),
          })
        }
      }
    }

    const entries = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name))
    const errors  = results.filter(r => r.status === "rejected").map(r => (r as any).reason?.message ?? "Unknown error")

    return NextResponse.json({ entries, total: entries.length, rawCount, errors })
  } catch (e: any) {
    console.error("bc/email-lists error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
