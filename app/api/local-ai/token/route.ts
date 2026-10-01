import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { newWorkerToken, hashToken, workerPresence } from "@/lib/local-ai"

// The office PC's bridge token (lib/local-ai.ts). Admins only.
//   GET  — the workers that exist (never their tokens) and whether each has been seen.
//   POST — make a NEW token, shown once in the response; every earlier token is switched off,
//          because there is one office PC and a lost token should stop working.

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const workers = await prisma.localAiWorker.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true, createdBy: true, lastSeenAt: true, lastModel: true, lastInfo: true, disabledAt: true },
    })
    return NextResponse.json({ workers: workers.map(w => ({ ...w, presence: w.disabledAt ? "off" : workerPresence(w.lastSeenAt) })) })
  } catch (e: any) {
    console.error("local-ai/token GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const body = await req.json().catch(() => ({})) as { name?: string }
    const name = (body.name ?? "").trim() || "Office PC"
    const token = newWorkerToken()

    const worker = await prisma.$transaction(async tx => {
      await tx.localAiWorker.updateMany({ where: { disabledAt: null }, data: { disabledAt: new Date() } })
      return tx.localAiWorker.create({
        data: { name, tokenHash: hashToken(token), createdBy: session.user?.email ?? "unknown" },
        select: { id: true, name: true, createdAt: true },
      })
    })

    return NextResponse.json({ token, worker })
  } catch (e: any) {
    console.error("local-ai/token POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
