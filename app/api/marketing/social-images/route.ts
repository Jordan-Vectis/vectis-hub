import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { r2 } from "@/lib/r2"
import { PutObjectCommand } from "@aws-sdk/client-s3"

export const maxDuration = 30

// GET — list all social images
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const tag = searchParams.get("tag")

    const images = await prisma.socialImage.findMany({
      where: tag ? { tags: { contains: tag } } : undefined,
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ images })
  } catch (e: any) {
    console.error("social-images GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// POST — upload image + save record
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const formData = await req.formData()
    const file  = formData.get("file")  as File   | null
    const label = formData.get("label") as string | null
    const tags  = formData.get("tags")  as string | null

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })

    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ error: "Only JPG, PNG, WEBP and GIF images are allowed" }, { status: 400 })
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "Image must be under 20MB" }, { status: 400 })
    }

    const ext      = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const key      = `social/${Date.now()}-${safeName}`
    const buffer   = Buffer.from(await file.arrayBuffer())

    await r2.send(
      new PutObjectCommand({
        Bucket:      process.env.CLOUDFLARE_R2_BUCKET!,
        Key:         key,
        Body:        buffer,
        ContentType: file.type,
      })
    )

    const image = await prisma.socialImage.create({
      data: {
        key,
        filename:   file.name,
        label:      label || null,
        tags:       tags  || null,
        uploadedBy: session.user.name ?? session.user.email ?? "Unknown",
      },
    })

    return NextResponse.json({ image })
  } catch (e: any) {
    console.error("social-images POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
