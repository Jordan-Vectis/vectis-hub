import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/invoices/files — list all invoices, newest first
export async function GET(_req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const files = await prisma.invoiceFile.findMany({
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(files)
  } catch (e: any) {
    console.error("invoices/files GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
