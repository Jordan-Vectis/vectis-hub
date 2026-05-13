import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// User-managed ticket category list. Anyone signed in can read; only admins
// can mutate (these are shared across all staff).

function slug(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const categories = await prisma.ticketCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    })
    return NextResponse.json({ categories })
  } catch (e: any) {
    console.error("ticket-categories GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to list" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin only" }, { status: 401 })
    }

    const body  = await req.json()
    const label = String(body.label ?? "").trim()
    if (!label) return NextResponse.json({ error: "Label required" }, { status: 400 })

    const key = slug(label)
    if (!key) return NextResponse.json({ error: "Invalid label" }, { status: 400 })

    const existing = await prisma.ticketCategory.findUnique({ where: { key } })
    if (existing) {
      return NextResponse.json({ error: `A category with key '${key}' already exists` }, { status: 409 })
    }

    const max = await prisma.ticketCategory.aggregate({ _max: { sortOrder: true } })
    const category = await prisma.ticketCategory.create({
      data: { key, label, sortOrder: (max._max.sortOrder ?? 0) + 10 },
    })
    return NextResponse.json({ category })
  } catch (e: any) {
    console.error("ticket-categories POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to create" }, { status: 500 })
  }
}
