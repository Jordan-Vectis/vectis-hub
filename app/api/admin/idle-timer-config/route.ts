import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CONFIG } from "@/lib/idle-timer-config"

// Returns the singleton config, seeding defaults on first call
async function getOrCreate() {
  const existing = await (prisma as any).idleTimerConfig.findUnique({ where: { id: "global" } })
  if (existing) return existing
  return (prisma as any).idleTimerConfig.create({
    data: {
      id:         "global",
      yellowMins: DEFAULT_CONFIG.yellowMins,
      redMins:    DEFAULT_CONFIG.redMins,
      reasons:    DEFAULT_CONFIG.reasons,
    },
  })
}

export async function GET(req: NextRequest) {
  try {
    // Readable by any logged-in user (popup needs it)
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const config = await getOrCreate()
    return NextResponse.json({
      yellowMins: config.yellowMins,
      redMins:    config.redMins,
      reasons:    config.reasons ?? [],
      // Undefined until the column exists — the popup treats a missing message as "no banner".
      message:    config.message ?? "",
    })
  } catch (e: any) {
    console.error("idle-timer-config GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const body = await req.json()
    const { reasons, message } = body

    // Timing is a single per-user threshold (User.timerRedMins) — this config
    // only manages the reasons list. The legacy yellow/red columns are kept in
    // the row (harmless) but no longer edited.
    if (!Array.isArray(reasons) || reasons.length === 0) {
      return NextResponse.json({ error: "Invalid payload — reasons required" }, { status: 400 })
    }

    // `message` is newer than the deploy that reads it, so a save must still work before
    // the column exists — write it, and on failure fall back to saving the reasons alone
    // rather than 500ing the whole settings page. Same migration-safe pattern as
    // getAllInstructions (RULES.md).
    const msg = typeof message === "string" ? message.trim() : undefined
    let config
    try {
      config = await (prisma as any).idleTimerConfig.upsert({
        where:  { id: "global" },
        create: { id: "global", yellowMins: DEFAULT_CONFIG.yellowMins, redMins: DEFAULT_CONFIG.redMins, reasons, ...(msg !== undefined ? { message: msg } : {}) },
        update: { reasons, ...(msg !== undefined ? { message: msg } : {}) },
      })
    } catch {
      config = await (prisma as any).idleTimerConfig.upsert({
        where:  { id: "global" },
        create: { id: "global", yellowMins: DEFAULT_CONFIG.yellowMins, redMins: DEFAULT_CONFIG.redMins, reasons },
        update: { reasons },
      })
    }

    return NextResponse.json({
      yellowMins: config.yellowMins,
      redMins:    config.redMins,
      reasons:    config.reasons ?? [],
      message:    config.message ?? "",
    })
  } catch (e: any) {
    console.error("idle-timer-config PUT error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
