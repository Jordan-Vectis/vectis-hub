import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { uploadBufferToR2, getSignedImageUrl } from "@/lib/r2"

export const maxDuration = 60

// Attaches another page (image) to an existing document — for multi-page invoices.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const form = await req.formData()
    const docId = form.get("docId") as string
    const file  = form.get("file")
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 })

    const doc = await prisma.accountingDocument.findUnique({ where: { id: docId } })
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const safeName = (file.name || "page").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60)
    const key = `accounts/${doc.monthId}/${Date.now()}-${safeName}`
    await uploadBufferToR2(buffer, key, file.type || "image/jpeg")

    const images = [...doc.images, key]
    // Adding a page means the AI should read it again.
    await prisma.accountingDocument.update({ where: { id: docId }, data: { images, aiRun: false } })

    const signed = await Promise.all(images.map((k) => getSignedImageUrl(k)))
    return NextResponse.json({ id: docId, images: signed })
  } catch (e: any) {
    console.error("accounts/add-page error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
