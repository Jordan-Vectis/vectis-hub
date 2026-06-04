import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken } from "@/lib/bc"

export const maxDuration = 300

export type EmailListEntry = { name: string; email: string; saleCodes: string[] }

const BC_BASE = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID ?? "f146b72a-c3fb-4d6b-9002-072b3191507a"}/production/ODataV4/Company('Vectis')/`

// Fetches all rows from a BC endpoint using $skip pagination, returns rows + BC-reported total
async function fetchAllRows(token: string, endpoint: string, filter: string, select: string): Promise<{ rows: any[]; bcTotal: number }> {
  const all: any[] = []
  let skip = 0
  let bcTotal = 0
  const batchSize = 500

  while (true) {
    const params = new URLSearchParams()
    params.set("$top", String(batchSize))
    params.set("$skip", String(skip))
    params.set("$filter", filter)
    params.set("$select", select)
    if (skip === 0) params.set("$count", "true")

    const url = `${BC_BASE}${endpoint}?${params.toString()}`
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(45_000),
    })

    if (!res.ok) throw new Error(`BC API ${res.status}: ${await res.text()}`)
    const json = await res.json()
    const rows: any[] = json.value ?? []

    if (skip === 0 && json["@odata.count"]) {
      bcTotal = json["@odata.count"]
    }

    all.push(...rows)
    if (rows.length < batchSize) break
    skip += batchSize
  }

  return { rows: all, bcTotal }
}

// GET /api/bc/email-lists?keywords=Star+Wars,Matchbox&dateFrom=2024-01-01
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

    // Run one request per keyword in parallel
    const results = await Promise.allSettled(
      keywords.map(async (kw) => {
        const safe = kw.replace(/'/g, "''")
        const filterParts: string[] = [
          `contains(EVA_AuctionName,'${safe}')`,
        ]
        if (dateFrom) {
          filterParts.push(`EVA_AuctionDate ge ${dateFrom}`)
        }
        const filter = filterParts.join(" and ")
        const select = "EVA_BuyerName,EVA_EmailAddress,EVA_AuctionNo"

        return await fetchAllRows(token, "AttendenceRegister", filter, select)
      })
    )

    // Merge and deduplicate — collect all sale codes per buyer
    const seen     = new Map<string, EmailListEntry>()
    const saleCodes = new Map<string, Set<string>>()
    let rawCount = 0
    let bcTotal  = 0

    for (const result of results) {
      if (result.status !== "fulfilled") continue
      rawCount += result.value.rows.length
      bcTotal  += result.value.bcTotal
      for (const row of result.value.rows) {
        const email    = String(row.EVA_EmailAddress ?? "").trim().toLowerCase()
        const saleCode = String(row.EVA_AuctionNo ?? "").trim()
        if (!email) continue
        if (!seen.has(email)) {
          seen.set(email, {
            name:      String(row.EVA_BuyerName ?? "").trim(),
            email:     String(row.EVA_EmailAddress ?? "").trim(),
            saleCodes: [],
          })
          saleCodes.set(email, new Set())
        }
        if (saleCode) saleCodes.get(email)!.add(saleCode)
      }
    }

    // Attach collected sale codes to each entry
    for (const [email, entry] of seen) {
      entry.saleCodes = Array.from(saleCodes.get(email) ?? []).sort()
    }

    const entries = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name))
    const errors  = results.filter(r => r.status === "rejected").map(r => (r as any).reason?.message ?? "Unknown error")

    return NextResponse.json({ entries, total: entries.length, rawCount, bcTotal, errors })
  } catch (e: any) {
    console.error("bc/email-lists error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
