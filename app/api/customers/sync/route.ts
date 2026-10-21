import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCTokenAny, bcApiUrl, bcPageWithNext } from "@/lib/bc"
import { CUSTOMER_PHASES, copyCustomerPage, type CustomerPhase } from "@/lib/customer-sync"

export const maxDuration = 300

// POST /api/customers/sync {phase?, nextLink?, mode?}
// One page of the BC → Hub customer copy (lib/customer-sync.ts). The caller — the Customers page's
// button, or the nightly BC copy in /api/cron/bc-warehouse — sends back nextPhase/nextLink until
// done is true. Admins or the cron secret only: it writes every customer record.
//
// mode "changes" (the default) asks BC only for what changed since the stage's last COMPLETE pass;
// "all" reads everything. Each page's progress is saved in CustomerSyncState, so a stopped copy can
// carry on from where it got to (GET ?state=1 says where) instead of starting again.

type Mode = "changes" | "all"
const OVERLAP_MS = 10 * 60 * 1000   // the next "changes" pass re-reads the last 10 minutes, to be safe

async function allowed(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true
  const session = await auth()
  return session?.user?.role === "ADMIN"
}

// The progress table only exists after Run Migrations — until then the copy still works, it just
// can't remember anything (every press is a full read, and can't carry on).
async function readState(phase: CustomerPhase) {
  try { return { ok: true as const, row: await prisma.customerSyncState.findUnique({ where: { phase } }) } }
  catch (e: any) { console.warn("[customers/sync] progress table not readable:", e?.message); return { ok: false as const, row: null } }
}
async function writeState(phase: CustomerPhase, data: Record<string, any>) {
  try { await prisma.customerSyncState.upsert({ where: { phase }, update: data, create: { phase, ...data } }) }
  catch (e: any) { console.warn("[customers/sync] progress not saved:", e?.message) }
}

export async function POST(req: NextRequest) {
  try {
    if (!await allowed(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const token = await getBCTokenAny()
    if (!token) return NextResponse.json({ error: "Business Central isn't signed in — press the BC button in the top bar as Jordan." }, { status: 503 })

    const body = await req.json().catch(() => ({}))
    const phase: CustomerPhase = CUSTOMER_PHASES.includes(body?.phase) ? body.phase : "contacts"
    const nextLink: string | null = body?.nextLink ? String(body.nextLink) : null
    const mode: Mode = body?.mode === "all" ? "all" : "changes"

    if (phase === "contacts" && !nextLink) {
      try { await prisma.customer.count({ take: 1 }) } catch {
        return NextResponse.json({ error: "The customer tables aren't there yet — Run Migrations first." }, { status: 503 })
      }
      // A copy that was stopped never closed its log row; close it now so "running" means running.
      await prisma.warehouseSyncLog.updateMany({ where: { source: "customers", status: "running" }, data: { status: "stopped", completedAt: new Date() } })
      await prisma.warehouseSyncLog.create({ data: { source: "customers", status: "running" } })
    }

    const st = await readState(phase)
    let since: Date | null = null
    let note: string | null = null
    if (!nextLink) {
      if (mode === "changes") {
        since = st.row?.since ?? null
        // Before this table existed, the first full copy (20 Oct) already read the five Evo feeds,
        // so those count from when it began. The two card stages have never been read.
        if (!since && !phase.endsWith("Cards")) {
          const last = await prisma.warehouseSyncLog.findFirst({ where: { source: "customers", status: "complete" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } })
          if (last) since = new Date(last.startedAt.getTime() - OVERLAP_MS)
        }
      }
      await writeState(phase, { passStartedAt: new Date(), passMode: mode, nextLink: null, done: 0, total: null })
    }

    let page
    try {
      page = await copyCustomerPage(token, phase, nextLink, since)
    } catch (e: any) {
      // If BC won't filter this feed by date, read it all rather than fail the copy.
      if (since && !nextLink) {
        note = `BC wouldn't give just the changes for this stage, so it is reading all of it (${String(e?.message ?? e).slice(0, 120)})`
        console.warn("[customers/sync]", phase, note)
        since = null
        page = await copyCustomerPage(token, phase, null, null)
      } else {
        await prisma.warehouseSyncLog.updateMany({
          where: { source: "customers", status: "running" },
          data:  { status: "failed", completedAt: new Date(), error: `${phase}: ${e?.message ?? e}` },
        })
        throw e
      }
    }

    const done = (st.row && nextLink ? st.row.done : 0) + page.rows
    const total = page.total ?? (nextLink ? st.row?.total ?? null : null)
    const finishedStage = !page.nextLink
    const passStart = (!nextLink ? new Date() : st.row?.passStartedAt) ?? new Date()
    await writeState(phase, {
      nextLink: page.nextLink, done, total,
      ...(finishedStage ? { since: new Date(passStart.getTime() - OVERLAP_MS), nextLink: null } : {}),
    })

    const i = CUSTOMER_PHASES.indexOf(phase)
    const nextPhase: CustomerPhase | null = page.nextLink ? phase : (CUSTOMER_PHASES[i + 1] ?? null)
    const allDone = !nextPhase
    if (allDone) {
      const people = await prisma.customer.count()
      await prisma.warehouseSyncLog.updateMany({
        where: { source: "customers", status: "running" },
        data:  { status: "complete", completedAt: new Date(), itemsProcessed: people },
      })
    }
    return NextResponse.json({ ok: true, phase, mode, ...page, stageDone: done, stageTotal: total, onlyChanges: !!since, note, nextPhase, nextLink: page.nextLink, done: allDone })
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
    // Where each stage has got to — for "Carry on from where it stopped".
    if (req.nextUrl.searchParams.get("state")) {
      const rows = await prisma.customerSyncState.findMany().catch(() => [])
      return NextResponse.json({ phases: CUSTOMER_PHASES.map(p => rows.find(r => r.phase === p) ?? { phase: p, since: null, nextLink: null, done: 0, total: null, passMode: null }) })
    }
    if (!req.nextUrl.searchParams.get("probe")) return NextResponse.json({ error: "Nothing asked" }, { status: 400 })
    const token = await getBCTokenAny()
    if (!token) return NextResponse.json({ error: "Business Central isn't signed in." }, { status: 503 })

    const feeds: Record<string, any> = {}
    for (const phase of CUSTOMER_PHASES.filter(p => !p.endsWith("Cards"))) {
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
