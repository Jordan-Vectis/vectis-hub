import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess, getAllowedSections, type AppKey } from "@/lib/apps"
import {
  WIDGETS, STARTER_LAYOUT, sanitiseLayout,
  type DashboardWidgetPlacement,
} from "@/lib/dashboard-widgets"

export const dynamic = "force-dynamic"

// GET  /api/dashboard/layout — this person's dashboard, plus what they may add.
// PUT  /api/dashboard/layout — save the arrangement.
//
// The layout is per person. Where they have never arranged one, they inherit the
// role default an admin set, and failing that a short starter layout — an empty
// screen on first open reads as broken.
//
// ⚠ Both directions run the layout through sanitiseLayout against THIS viewer's
// permissions. So an admin's saved layout inherited by a role, or a layout saved
// before someone lost an app, can never show a widget they aren't entitled to.

type Ctx = { canUse: (app: AppKey) => boolean }

async function requireDashboard(): Promise<
  { ok: true; userId: string; ctx: Ctx } | { ok: false; res: NextResponse }
> {
  const session = await auth()
  if (!session) {
    return { ok: false, res: NextResponse.json({ error: "Unauthorised" }, { status: 401 }) }
  }

  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, allowedApps: true, appPermissions: true },
  })
  const role = dbUser?.role ?? ""
  const apps = dbUser?.allowedApps ?? []

  if (!hasAppAccess(role, apps, "MANAGER_PORTAL")) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  // The dashboard is a Manager Portal section, gated by the same per-section
  // tickboxes as the other tabs. null = nothing configured = sees every tab.
  const allowed = getAllowedSections(role, dbUser?.appPermissions as any, "MANAGER_PORTAL")
  if (allowed && !allowed.includes("dashboard")) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  return {
    ok: true,
    userId: session.user.id,
    ctx: { canUse: (app: AppKey) => hasAppAccess(role, apps, app) },
  }
}

/**
 * Read the stored layout, falling back through role default → starter.
 *
 * ⚠ Migration-safe. Code reaches Railway the moment it is pushed, but the table
 * only exists once someone clicks Run Migrations. Until then every read throws,
 * and an unhandled throw here would take the whole Manager Portal down — Sales
 * and Departments included — for a feature nobody is using yet. So a failure
 * degrades to the starter layout.
 */
async function readLayout(userId: string, role: string): Promise<DashboardWidgetPlacement[]> {
  try {
    const mine = await prisma.dashboardLayout.findUnique({ where: { userId } })
    if (mine && Array.isArray(mine.widgets) && (mine.widgets as any[]).length > 0) {
      return mine.widgets as unknown as DashboardWidgetPlacement[]
    }
  } catch { /* table not migrated yet — fall through */ }

  try {
    const def = await prisma.roleDefault.findUnique({ where: { role } })
    const seeded = (def as any)?.dashboardWidgets
    if (Array.isArray(seeded) && seeded.length > 0) return seeded as DashboardWidgetPlacement[]
  } catch { /* column not migrated yet — fall through */ }

  return STARTER_LAYOUT
}

export async function GET() {
  try {
    const gate = await requireDashboard()
    if (!gate.ok) return gate.res

    const dbUser = await prisma.user.findUnique({
      where:  { id: gate.userId },
      select: { role: true },
    })

    const stored = await readLayout(gate.userId, dbUser?.role ?? "")
    const widgets = sanitiseLayout(stored, gate.ctx.canUse)

    // Only offer widgets for apps this person can actually open — the picker is
    // the first place a dashboard would leak the existence of data they can't see.
    const available = WIDGETS.filter(w => gate.ctx.canUse(w.app)).map(w => ({
      key: w.key, label: w.label, description: w.description,
      group: w.group, defaultSize: w.defaultSize, sizes: w.sizes, bc: !!w.bc, href: w.href ?? null,
    }))

    return NextResponse.json({ widgets, available })
  } catch (e: any) {
    console.error("dashboard/layout GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const gate = await requireDashboard()
    if (!gate.ok) return gate.res

    const body = await req.json()
    const widgets = sanitiseLayout(body?.widgets, gate.ctx.canUse)

    try {
      await prisma.dashboardLayout.upsert({
        where:  { userId: gate.userId },
        create: { userId: gate.userId, widgets: widgets as any },
        update: { widgets: widgets as any },
      })
    } catch (e: any) {
      // Same migration window as the read. Tell the user plainly rather than
      // letting the page think it saved.
      console.error("dashboard/layout PUT save failed:", e)
      return NextResponse.json(
        { error: "Couldn't save — the dashboard table isn't there yet. An admin needs to click Run Migrations." },
        { status: 503 },
      )
    }

    return NextResponse.json({ ok: true, widgets })
  } catch (e: any) {
    console.error("dashboard/layout PUT error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
