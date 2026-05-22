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
    const { yellowMins, redMins, reasons } = body

    if (
      typeof yellowMins !== "number" || yellowMins < 1 ||
      typeof redMins    !== "number" || redMins    < 1 ||
      !Array.isArray(reasons)
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    const config = await (prisma as any).idleTimerConfig.upsert({
      where:  { id: "global" },
      create: { id: "global", yellowMins, redMins, reasons },
      update: { yellowMins, redMins, reasons },
    })

    return NextResponse.json({
      yellowMins: config.yellowMins,
      redMins:    config.redMins,
      reasons:    config.reasons ?? [],
    })
  } catch (e: any) {
    console.error("idle-timer-config PUT error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
