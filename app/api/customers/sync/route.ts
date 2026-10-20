import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCTokenAny, bcApiUrl, bcPageWithNext } from "@/lib/bc"
import { CUSTOMER_PHASES, copyCustomerPage, type CustomerPhase } from "@/lib/customer-sync"

export const maxDuration = 300

// POST /api/customers/sync {phase?, nextLink?}
// One page of the BC → Hub customer copy (lib/customer-sync.ts). The caller — the Customers page's
// button, or the nightly BC copy in /api/cron/bc-warehouse — sends back nextPhase/nextLink until
// done is true. Admins or the cron secret only: it writes every customer record.

async function allowed(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true
  const session = await auth()
  return session?.user?.role === "ADMIN"
}

export async function POST(req: NextRequest) {
  try {
    if (!await allowed(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const token = await getBCTokenAny()
    if (!token) return NextResponse.json({ error: "Business Central isn't signed in — press the BC button in the top bar as Jordan." }, { status: 503 })

    const body = await req.json().catch(() => ({}))
    const phase: CustomerPhase = CUSTOMER_PHASES.includes(body?.phase) ? body.phase : "contacts"
    const nextLink: string | null = body?.nextLink ? String(body.nextLink) : null

    const first = phase === "contacts" && !nextLink
    if (first) {
      try { await prisma.customer.count({ take: 1 }) } catch {
        return NextResponse.json({ error: "The customer tables aren't there yet — Run Migrations first." }, { status: 503 })
      }
      await prisma.warehouseSyncLog.create({ data: { source: "customers", status: "running" } })
    }

    let page
    try {
      page = await copyCustomerPage(token, phase, nextLink)
    } catch (e: any) {
      await prisma.warehouseSyncLog.updateMany({
        where: { source: "customers", status: "running" },
        data:  { status: "failed", completedAt: new Date(), error: `${phase}: ${e?.message ?? e}` },
      })
      throw e
    }

    const i = CUSTOMER_PHASES.indexOf(phase)
    const nextPhase: CustomerPhase | null = page.nextLink ? phase : (CUSTOMER_PHASES[i + 1] ?? null)
    const done = !nextPhase
    if (done) {
      const total = await prisma.customer.count()
      await prisma.warehouseSyncLog.updateMany({
        where: { source: "customers", status: "running" },
        data:  { status: "complete", completedAt: new Date(), itemsProcessed: total },
      })
    }
    return NextResponse.json({ ok: true, phase, ...page, nextPhase, nextLink: page.nextLink, done })
  } catch (e: any) {
    console.error("customers/sync error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// GET /api/customers/sync?probe=1 — admin only. What BC actually publishes about customers: the
// field names of each Evo feed (one row each), and every published ODataV4 web service whose name
// mentions a vendor, customer or contact — the places any further fields (commission terms, ID
// checks…) would have to come from. Read-only.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (!req.nextUrl.searchParams.get("probe")) return NextResponse.json({ error: "Nothing asked" }, { status: 400 })
    const token = await getBCTokenAny()
    if (!token) return NextResponse.json({ error: "Business Central isn't signed in." }, { status: 503 })

    const feeds: Record<string, any> = {}
    for (const phase of CUSTOMER_PHASES) {
      try {
        const url = await bcApiUrl(token, "api/evo/base/v1.0", phase)
        const { rows } = await bcPageWithNext(token, `${url}?$top=1`)
        feeds[phase] = { ok: true, fields: rows[0] ? Object.keys(rows[0]) : [] }
      } catch (e: any) {
        feeds[phase] = { ok: false, error: e?.message ?? "unknown" }
      }
    }

    let services: { name: string; fields: string[] | null; error?: string }[] = []
    let servicesError: string | null = null
    try {
      const root = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID}/${process.env.BC_ENVIRONMENT ?? "production"}/ODataV4/`
      const r = await fetch(root, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
      if (!r.ok) throw new Error(`BC ${r.status}`)
      const names: string[] = ((await r.json()).value ?? []).map((v: any) => String(v.name))
      const company = encodeURIComponent(process.env.BC_COMPANY ?? "Vectis")
      for (const name of names.filter(n => /vendor|customer|contact|buyer/i.test(n)).slice(0, 25)) {
        try {
          const { rows } = await bcPageWithNext(token, `${root}Company('${company}')/${name}?$top=1`)
          services.push({ name, fields: rows[0] ? Object.keys(rows[0]) : [] })
        } catch (e: any) {
          services.push({ name, fields: null, error: e?.message?.slice(0, 200) })
        }
      }
    } catch (e: any) {
      servicesError = e?.message ?? "unknown"
    }
    return NextResponse.json({ feeds, services, servicesError })
  } catch (e: any) {
    console.error("customers/sync probe error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
