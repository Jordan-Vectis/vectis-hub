import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { requireWidget } from "@/lib/dashboard-guard"

export const dynamic = "force-dynamic"

// Catch-all for widgets that are in the registry but whose report hasn't been
// wired up yet. Next resolves a static segment before this dynamic one, so any
// widget with its own folder takes precedence and never reaches here.
//
// This exists so the whole catalogue is browsable while it is being built out:
// the "+ Add" picker lists every report, and one that isn't ready says so
// plainly on the card instead of showing a red error the user has to interpret.
// It still goes through the full permission gate — an unbuilt widget must not
// become a hole that skips the checks.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await ctx.params
    const gate = await requireWidget(key)
    if (!gate.ok) return gate.res

    return NextResponse.json({
      kind: "stat",
      value: "—",
      sub: "Not built yet",
      note: "This report is on the list but its figures aren't wired up yet. It'll fill in without you having to add it again.",
    })
  } catch (e: any) {
    console.error("dashboard widget placeholder error:", e)
    return NextResponse.json({ error: e?.message ?? "Couldn't load this report" }, { status: 500 })
  }
}
