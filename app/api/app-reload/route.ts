import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// GET /api/app-reload — the force-refresh token for THIS user. Polled by every
// signed-in tab; a change means an admin has pushed a reload that applies to them.
//
// The token combines two sources so one poll covers both "refresh everyone" and
// "refresh just this person":
//   - the row id="current"  → bumped when everyone is refreshed
//   - the row id=<their userId> → bumped when they specifically are refreshed
// Combined as `${everyone}:${mine}`. Either source changing changes the combined
// string, so the client's existing single-baseline compare handles both. Tokens
// are UUIDs (no colons), so the separator is unambiguous. A user never targeted
// individually simply has no row and an empty `mine` half — stable, so they only
// reload on an everyone-refresh.
//
// ⚠ `ok` distinguishes "nothing pending" (ok:true) from "couldn't tell" (ok:false).
// They MUST NOT be conflated: the client reloads when the token CHANGES, so
// reporting a failure as a token would look like a change to every tab and reload
// the whole company's iPads on one database blip. A missing table (code deploys
// before Run Migrations) is also ok:false — nobody reloads.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ ok: false })

    const rows = await prisma.appReload.findMany({
      where: { id: { in: ["current", session.user.id] } },
      select: { id: true, token: true },
    })
    const everyone = rows.find((r) => r.id === "current")?.token ?? ""
    const mine     = rows.find((r) => r.id === session.user.id)?.token ?? ""
    const token = `${everyone}:${mine}`

    // Both empty → nothing has ever been pushed. Return null so a brand-new tab's
    // baseline is null, not ":", though either would be stable.
    return NextResponse.json({ ok: true, token: everyone || mine ? token : null })
  } catch (e: any) {
    console.error("app-reload GET error:", e)
    return NextResponse.json({ ok: false })
  }
}
