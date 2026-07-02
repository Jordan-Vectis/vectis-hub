import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { uploadBufferToR2, getSignedImageUrl } from "@/lib/r2"
import { cleanCardholder } from "@/lib/accounting"
import { getAccountsAccess } from "@/lib/accounts-auth"

export const maxDuration = 60

// Stores one scanned document as a BLANK line (image only, no AI yet). The user
// snaps/uploads each one, then runs the AI over the whole batch afterwards.
export async function POST(req: NextRequest) {
  try {
    const { canAccess } = await getAccountsAccess()
    if (!canAccess) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const form = await req.formData()
    const monthId    = form.get("monthId") as string
    const cardholder = cleanCardholder(form.get("cardholder") as string)
    const file       = form.get("file")

    if (!monthId) return NextResponse.json({ error: "monthId required" }, { status: 400 })
    if (!cardholder) return NextResponse.json({ error: "Cardholder required" }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 })

    const month = await prisma.accountingMonth.findUnique({ where: { id: monthId } })
    if (!month) return NextResponse.json({ error: "Month not found" }, { status: 404 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const safeName = (file.name || "scan").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60)
    const key = `accounts/${monthId}/${Date.now()}-${safeName}`
    await uploadBufferToR2(buffer, key, file.type || "image/jpeg")

    const doc = await prisma.accountingDocument.create({
      data: { monthId, cardholder, source: "SCAN", images: [key], vatCode: 2, gross: 0, vat: 0, net: 0, column: "vectis", aiRun: false },
    })

    return NextResponse.json({ id: doc.id, images: [await getSignedImageUrl(key)] })
  } catch (e: any) {
    console.error("accounts/upload error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
