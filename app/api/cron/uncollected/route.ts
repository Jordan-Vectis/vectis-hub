import { NextRequest, NextResponse } from "next/server"
import { getBCTokenAny } from "@/lib/bc"
import { startUncollectedSync } from "@/lib/uncollected-feed"

export const maxDuration = 300

// POST /api/cron/uncollected — Accounts → Paid, not collected: the nightly BC check (server.js,
// 08:30 London, after BC's overnight payment run). Protected by CRON_SECRET.
//
// Reads BC (read only — never writes to it) with the ONE background sign-in (getBCTokenAny) and
// fills the panel's cases: lib/uncollected-feed.ts → syncUncollected, with the nightly run's 25 minutes
// to read BC (its default for trigger "nightly" — nobody is waiting on it). See RULES.md → "Accounts →
// Paid, not collected".
//
// ⚠ ANSWERS AT ONCE (202) once the check is under way and lets it run on, like bc-warehouse — a
// long check must not hold server.js's request open past Node's 300 s headers timeout and read as
// "fetch failed". The check logs its own result here, and records it as an UncollectedSyncRun row
// (the panel's "Last checked from BC" line). If it can't start — another check is running, the
// tables need Run Migrations, no BC sign-in — the answer says why, with nothing started.

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const token = await getBCTokenAny()
    const r = await startUncollectedSync({ trigger: "nightly", byName: null, token, refreshToken: getBCTokenAny })
    if (!r.started) {
      const res = r.result
      console.warn(`[cron/uncollected] not started — ${res.error ?? "no reason given"}`)
      return NextResponse.json({ ok: false, skipped: res.error ?? "It didn't start.", busy: !!res.busy, notReady: !!res.notReady, runId: res.runId })
    }

    void r.done.then((res) => {
      const line = `[cron/uncollected] ${res.ok ? "finished" : "finished with problems"} — ${res.summary}`
      if (res.ok) console.log(line)
      else console.warn(`${line}${res.error && res.error !== res.summary ? ` — ${res.error}` : ""}`)
    })
    return NextResponse.json({ ok: true, started: true, runId: r.runId }, { status: 202 })
  } catch (e) {
    console.error("[cron/uncollected] error:", e)
    return NextResponse.json({ error: (e as Error)?.message ?? "Unknown error" }, { status: 500 })
  }
}
