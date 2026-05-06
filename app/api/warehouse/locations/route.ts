import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const locations = await prisma.warehouseLocation.findMany({
      orderBy: { code: "asc" },
      select: { code: true },
    })

    return NextResponse.json(locations)
  } catch (e: any) {
    console.error("warehouse locations error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
