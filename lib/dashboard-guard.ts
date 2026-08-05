// The gate every dashboard widget route goes through.
//
// ⚠ This is the security boundary for the whole dashboard. A widget shows
// figures from an app the viewer might not have, so the check CANNOT be done
// once for the page — a saved layout is just a list of keys, and anyone can PUT
// one. Each widget route calls requireWidget() with its own key, and that
// verifies three things independently:
//   1. they can open the Manager Portal at all
//   2. the Dashboard tab is ticked for them
//   3. they have the app the widget's data belongs to
//
// It also hands back the department gate, so any widget listing SALES applies
// auctionWhere — otherwise the dashboard becomes the way round the restriction
// that every other page listing sales already honours.

import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess, getAllowedSections } from "@/lib/apps"
import { WIDGETS_BY_KEY } from "@/lib/dashboard-widgets"
import { getDepartmentAccess, auctionWhere, type DepartmentAccess } from "@/lib/departments"

export type WidgetContext = {
  userId: string
  role: string
  access: DepartmentAccess
  /** Spread into a Prisma `where` on CatalogueAuction. `{}` when unrestricted. */
  saleWhere: Record<string, unknown>
}

export type WidgetGate =
  | { ok: true; ctx: WidgetContext }
  | { ok: false; res: NextResponse }

export async function requireWidget(key: string): Promise<WidgetGate> {
  const def = WIDGETS_BY_KEY[key]
  if (!def) return { ok: false, res: NextResponse.json({ error: "Unknown widget" }, { status: 404 }) }

  const session = await auth()
  if (!session) return { ok: false, res: NextResponse.json({ error: "Unauthorised" }, { status: 401 }) }

  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, allowedApps: true, appPermissions: true },
  })
  const role = dbUser?.role ?? ""
  const apps = dbUser?.allowedApps ?? []

  if (!hasAppAccess(role, apps, "MANAGER_PORTAL")) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  const sections = getAllowedSections(role, dbUser?.appPermissions as any, "MANAGER_PORTAL")
  if (sections && !sections.includes("dashboard")) {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  // The widget's own app — this is the check that stops a dashboard showing
  // someone the sale results or the warehouse figures they can't otherwise open.
  if (!hasAppAccess(role, apps, def.app)) {
    return { ok: false, res: NextResponse.json({ error: "You don't have access to this report" }, { status: 403 }) }
  }

  const access = await getDepartmentAccess(session.user.id, role)
  return {
    ok: true,
    ctx: { userId: session.user.id, role, access, saleWhere: auctionWhere(access) },
  }
}

/** Wraps a widget handler in the gate and the standard try/catch. */
export async function widgetRoute(
  key: string,
  handler: (ctx: WidgetContext) => Promise<any>,
): Promise<NextResponse> {
  try {
    const gate = await requireWidget(key)
    if (!gate.ok) return gate.res
    return NextResponse.json(await handler(gate.ctx))
  } catch (e: any) {
    console.error(`dashboard widget ${key} error:`, e)
    return NextResponse.json({ error: e?.message ?? "Couldn't load this report" }, { status: 500 })
  }
}
