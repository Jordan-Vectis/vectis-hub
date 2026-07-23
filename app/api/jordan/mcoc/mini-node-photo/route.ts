import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { uploadBufferToR2, getSignedImageUrl } from "@/lib/r2"

export const maxDuration = 60

// POST /api/jordan/mcoc/mini-node-photo — attach the node photo to one mini boss
// node in the library. FormData: nodeId, image. Same normalisation as the war
// fight photos (HEIC→JPEG, EXIF rotate, downscale). Uploaded once per node —
// wars only change taking/defender. Locked to jordan.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || !(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const form = await req.formData()
    const nodeId = (form.get("nodeId") as string) ?? ""
    const file = form.get("image")
    if (!nodeId) return NextResponse.json({ error: "Missing node" }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: "No photo received" }, { status: 400 })

    // Only the owner's own node — never let a nodeId from elsewhere be written.
    const node = await prisma.mcocMiniNode.findFirst({ where: { id: nodeId, ownerId: session.user.id }, select: { id: true } })
    if (!node) return NextResponse.json({ error: "Node not found" }, { status: 404 })

    const original = Buffer.from(await file.arrayBuffer())
    let buffer = original
    try {
      buffer = Buffer.from(await sharp(original).rotate().resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer())
    } catch { /* unreadable by sharp — store the original bytes */ }

    const key = `mcoc/${session.user.id}/mini/${nodeId}-${Date.now()}.jpg`
    await uploadBufferToR2(buffer, key, "image/jpeg")
    await prisma.mcocMiniNode.update({ where: { id: nodeId }, data: { nodesImageKey: key } })

    return NextResponse.json({ imageUrl: await getSignedImageUrl(key) })
  } catch (e: any) {
    console.error("jordan/mcoc/mini-node-photo error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
