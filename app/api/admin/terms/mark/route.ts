import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { TERMS_VERSION } from "@/lib/terms"

// Admin safety valve: mark a user as having accepted the policy on their behalf
// (for someone genuinely unable to sign — the gate tells them to see a manager).
// Records a marker instead of a drawn signature so it's clear it was admin-accepted.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }
    const { userId } = await req.json()
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId required" }, { status: 400 })
    }
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })

    const marker = `admin:${session.user.name ?? "an admin"}`
    await prisma.termsAcceptance.upsert({
      where:  { userId_version: { userId, version: TERMS_VERSION } },
      update: { signature: marker, userName: target.name, userEmail: target.email, acceptedAt: new Date() },
      create: { userId, version: TERMS_VERSION, signature: marker, userName: target.name, userEmail: target.email },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("admin/terms/mark error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
