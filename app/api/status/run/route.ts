import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { checkKeys, isServiceDisabled, runChecks } from "@/lib/status/engine"
import { CHECKS } from "@/lib/status/registry"

export const maxDuration = 120
export const dynamic = "force-dynamic"

// POST /api/status/run  { service?: string }
//
// Two callers:
//  1. The Status Centre loop in server.js, every 5 min (30 off production). It sends
//     x-status-token — a random value made at boot and held only in this process
//     (globalThis._statusToken), so the loop needs no CRON_SECRET. That is deliberate:
//     every check is read-only, so the loop is safe on sandbox, where the other
//     background jobs must stay off. The loop runs only the checks that are due.
//  2. An admin pressing "Check now". Always runs the named check (or all of them).
function fromLoop(req: NextRequest): boolean {
  const want = (globalThis as { _statusToken?: string })._statusToken
  const got = req.headers.get("x-status-token")
  if (!want || !got) return false
  const a = Buffer.from(want), b = Buffer.from(got)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  try {
    const loop = fromLoop(req)
    if (!loop) {
      const session = await auth()
      if (!session || session.user.role !== "ADMIN") {
        return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
      }
    }

    const body = await req.json().catch(() => ({})) as { service?: unknown }
    const service = typeof body.service === "string" ? body.service : undefined
    if (service && !checkKeys().includes(service)) {
      return NextResponse.json({ error: `No such check: ${service}` }, { status: 404 })
    }
    // The page never asks for one that is switched off; said plainly rather than answered with
    // nothing, which the page would read as "already being checked".
    if (service && await isServiceDisabled(service)) {
      const name = CHECKS.find(c => c.key === service)?.name ?? service
      return NextResponse.json({ error: `${name} is switched off — open its tile and switch it on first.` }, { status: 409 })
    }

    const result = await runChecks({ only: service ? [service] : undefined, force: !loop })
    return NextResponse.json(result)
  } catch (e: any) {
    console.error("status run error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
