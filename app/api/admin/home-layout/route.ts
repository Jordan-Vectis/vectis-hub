import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { sanitiseLayout } from "@/lib/home-layout"
import { getHomeLayout } from "@/lib/home-layout-server"

// Admin → Home Page Cards: the sections and each card's section, icon and colours.
// Applies to everyone. Card order / name / description / hidden / ★ stay on /api/admin/app-cards.

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") return null
  return session
}

export async function GET() {
  try {
    if (!await requireAdmin()) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    return NextResponse.json(await getHomeLayout())
  } catch (e: any) {
    console.error("home-layout GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireAdmin()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    let data
    try { data = sanitiseLayout(await req.json()) }
    catch (e: any) { return NextResponse.json({ error: e?.message ?? "That layout couldn't be read" }, { status: 400 }) }

    const updatedBy = session.user.name ?? session.user.email ?? null
    try {
      await prisma.homePageLayout.upsert({
        where:  { id: "global" },
        create: { id: "global", data: data as any, updatedBy },
        update: { data: data as any, updatedBy },
      })
    } catch (e: any) {
      if (/HomePageLayout|does not exist/i.test(e?.message ?? "")) {
        return NextResponse.json({ error: "The sections and colours can't be saved until Run Migrations has been pressed." }, { status: 503 })
      }
      throw e
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("home-layout PUT error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
