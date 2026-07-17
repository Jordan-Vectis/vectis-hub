import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { uploadBufferToR2, getSignedImageUrl } from "@/lib/r2"

export const maxDuration = 60

// POST /api/jordan/mcoc/war-fight-photo — attach a nodes photo to one saved war
// fight. FormData: fightId, image. Normalises through sharp (HEIC→JPEG, EXIF
// rotate, downscale) like the roster scan, stores it in R2 under a per-fight
// key, and saves the key on the fight. Returns the signed URL. Locked to jordan.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || !(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const form = await req.formData()
    const fightId = (form.get("fightId") as string) ?? ""
    const file = form.get("image")
    if (!fightId) return NextResponse.json({ error: "Missing fight" }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: "No photo received" }, { status: 400 })

    // Only the owner's own fight — never let a fightId from elsewhere be written.
    const fight = await prisma.mcocWarFight.findFirst({ where: { id: fightId, ownerId: session.user.id }, select: { id: true } })
    if (!fight) return NextResponse.json({ error: "Fight not found" }, { status: 404 })

    const original = Buffer.from(await file.arrayBuffer())
    let buffer = original
    try {
      buffer = Buffer.from(await sharp(original).rotate().resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer())
    } catch { /* unreadable by sharp — store the original bytes */ }

    const key = `mcoc/${session.user.id}/war/${fightId}-${Date.now()}.jpg`
    await uploadBufferToR2(buffer, key, "image/jpeg")
    await prisma.mcocWarFight.update({ where: { id: fightId }, data: { nodesImageKey: key } })

    return NextResponse.json({ imageUrl: await getSignedImageUrl(key) })
  } catch (e: any) {
    console.error("jordan/mcoc/war-fight-photo error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
