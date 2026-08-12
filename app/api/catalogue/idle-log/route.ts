import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Records the activity popup's answer. Two body shapes:
//
// NEW (2026-07-23, multi-select): { auctionId, idleStartedAt, idleDurationMs,
//   segments: [{ reason, durationMs, toteNumbers?, notes? }] } — the gap divided
//   between several reasons by the popup's sliders. One IdleLog row per segment,
//   laid out SEQUENTIALLY from idleStartedAt so the rows tile the gap without
//   overlapping (gap-matching in lib/idle-gaps SUMS logs starting in the window,
//   so a split gap stays "explained" exactly like a single log did).
//
// LEGACY: { auctionId, idleStartedAt, idleDurationMs, reason, toteNumbers?,
//   notes? } — still accepted because shared iPads can run a cached old bundle
//   for days; their popup posts the old single-reason shape.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json()
    const { auctionId, idleStartedAt, idleDurationMs, reason, toteNumbers, notes, segments } = body

    if (!auctionId || !idleStartedAt) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const userId   = session.user.id
    const userName = session.user.name ?? session.user.email ?? "Unknown"
    const startMs  = new Date(idleStartedAt).getTime()
    if (!Number.isFinite(startMs)) return NextResponse.json({ error: "Bad idleStartedAt" }, { status: 400 })

    // ── New multi-select shape ──
    if (Array.isArray(segments)) {
      const clean = segments
        .filter((s: any) => s && typeof s.reason === "string" && s.reason && Number.isFinite(Number(s.durationMs)) && Number(s.durationMs) > 0)
        // ⚠ Must exceed the configured reason count PLUS the UNALLOCATED leftover, which is
        // appended last and would otherwise be the first thing dropped — silently binning the
        // very time the user was warned about and chose to record.
        .slice(0, 40)
      if (clean.length === 0) return NextResponse.json({ error: "No valid segments" }, { status: 400 })

      let offset = 0
      const rows = clean.map((s: any) => {
        const row = {
          userId, userName, auctionId,
          idleStartedAt:  new Date(startMs + offset),
          idleDurationMs: Math.round(Number(s.durationMs)),
          reason:         String(s.reason),
          toteNumbers:    s.toteNumbers ? String(s.toteNumbers) : null,
          notes:          s.notes ? String(s.notes) : null,
        }
        offset += row.idleDurationMs
        return row
      })
      await prisma.idleLog.createMany({ data: rows })
      return NextResponse.json({ count: rows.length })
    }

    // ── Legacy single-reason shape ──
    if (!idleDurationMs || !reason) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    const log = await prisma.idleLog.create({
      data: {
        userId, userName, auctionId,
        idleStartedAt: new Date(idleStartedAt),
        idleDurationMs,
        reason,
        toteNumbers:   toteNumbers || null,
        notes:         notes || null,
      },
    })
    return NextResponse.json({ id: log.id })
  } catch (e: any) {
    console.error("idle-log error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
