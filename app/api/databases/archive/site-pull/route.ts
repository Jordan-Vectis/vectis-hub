import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getJob, probeSite, requestStop, startHeroCopy, startPhotoCopy, startSitePull, type Scope } from "@/lib/archive-site"

// Databases → Lot Archive: the two website jobs (see lib/archive-site.ts).
//   GET                                   → { site, photos, heroes } as they stand
//   POST { job: "site"|"photos"|"heroes", action: "start"|"stop", scope?: "abc"|"bc"|"both" }
// "heroes" copies each sale's cover picture into R2 for Databases → Sales (2026-09-22).
// ⚠ scope is which database the run is for. The ABC page sends "abc" and the BC page "bc", so BC
// photos no longer sit behind 948,000 ABC ones.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })
    const [site, photos, heroes] = await Promise.all([getJob("site"), getJob("photos"), getJob("heroes")])
    return NextResponse.json({ site, photos, heroes })
  } catch (e: any) {
    console.error("databases/archive/site-pull GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })
    const { job, action, scope } = await req.json()
    if (job !== "site" && job !== "photos" && job !== "heroes") return NextResponse.json({ error: "Unknown job" }, { status: 400 })
    const by = session.user?.email ?? "unknown"
    if (action === "stop") { requestStop(job); return NextResponse.json({ ok: true }) }
    // Ask the website what it says to THIS server, and report it verbatim.
    if (action === "probe") return NextResponse.json({ ok: true, probe: await probeSite() })
    if (action !== "start") return NextResponse.json({ error: "Unknown action" }, { status: 400 })
    const sc: Scope = scope === "abc" || scope === "bc" ? scope : "both"
    const j = job === "site" ? await startSitePull(by, sc) : job === "photos" ? await startPhotoCopy(by, sc) : await startHeroCopy(by)
    return NextResponse.json(j)
  } catch (e: any) {
    console.error("databases/archive/site-pull POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
