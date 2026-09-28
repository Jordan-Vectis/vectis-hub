import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPage, bcApiUrl } from "@/lib/bc"

export const maxDuration = 60

// GET /api/bc/api-viewer?endpoint=XXX&limit=5&filter=...
// Fetches a small sample from any BC OData endpoint and returns field names + rows.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  const { searchParams } = req.nextUrl
  const endpoint = searchParams.get("endpoint")?.trim() ?? ""
  const limit    = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "5"), 1), 50)
  const filter   = searchParams.get("filter")?.trim() ?? ""
  const orderby  = searchParams.get("orderby")?.trim() ?? ""

  if (!endpoint) return NextResponse.json({ error: "No endpoint specified" }, { status: 400 })

  try {
    const params: Record<string, any> = { $top: limit }
    if (filter)  params.$filter  = filter
    if (orderby) params.$orderby = orderby

    // Published web services (ODataV4) first. A 404 there usually means the name belongs to BC's
    // STANDARD API instead — "customers", "items", "vendors" live under api/v2.0, not ODataV4 —
    // so try that before giving up (2026-09-28: the Customers button 404'd with no message).
    let rows: any[]
    let source = "ODataV4 web service"
    try {
      rows = await bcPage(token, endpoint, params)
    } catch (e: any) {
      if (!/\b404\b/.test(String(e?.message ?? ""))) throw e
      // $-keys stay unencoded, like bcPage — BC ignores %24filter.
      const qs  = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
      const url = `${await bcApiUrl(token, "api/v2.0", endpoint)}?${qs}`
      const res = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
      if (res.status === 404) throw new Error(`"${endpoint}" isn't a published web service or a standard API page in Business Central (404 from both). Names are case-sensitive.`)
      if (!res.ok) throw new Error(`BC standard API ${res.status}: ${(await res.text()).slice(0, 300)}`)
      rows = (await res.json()).value ?? []
      source = "standard API (api/v2.0)"
    }

    const fields = rows.length > 0
      ? Object.keys(rows[0]).map(key => ({
          name:    key,
          sample:  rows[0][key],
          allNull: rows.every(r => r[key] === null || r[key] === "" || r[key] === undefined),
        }))
      : []

    return NextResponse.json({ endpoint, source, fields, rows, count: rows.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "BC request failed" }, { status: 500 })
  }
}
