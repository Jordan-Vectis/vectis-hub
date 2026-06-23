import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { uploadBufferToR2, getSignedImageUrl } from "@/lib/r2"

export const maxDuration = 60

// Upload one page of a bank/card statement (photo or PDF). Creates a BankStatement
// on the first page; pass statementId to append further pages to the same one.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const form = await req.formData()
    const monthId     = form.get("monthId") as string
    const statementId = (form.get("statementId") as string) || null
    const label       = ((form.get("label") as string) || "").slice(0, 120)
    const file        = form.get("file")

    if (!monthId) return NextResponse.json({ error: "monthId required" }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 })

    const month = await prisma.accountingMonth.findUnique({ where: { id: monthId } })
    if (!month) return NextResponse.json({ error: "Month not found" }, { status: 404 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const safe = (file.name || "statement").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60)
    const key = `accounts/${monthId}/statements/${Date.now()}-${safe}`
    await uploadBufferToR2(buffer, key, file.type || "image/jpeg")

    let stmt
    if (statementId) {
      const existing = await prisma.bankStatement.findUnique({ where: { id: statementId } })
      if (!existing) return NextResponse.json({ error: "Statement not found" }, { status: 404 })
      stmt = await prisma.bankStatement.update({ where: { id: statementId }, data: { images: [...existing.images, key] } })
    } else {
      stmt = await prisma.bankStatement.create({ data: { monthId, label, source: "SCAN", images: [key] } })
    }

    return NextResponse.json({
      id: stmt.id,
      label: stmt.label,
      images: await Promise.all(stmt.images.map((k) => getSignedImageUrl(k))),
    })
  } catch (e: any) {
    console.error("statement/upload error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
