import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { isCronRequest } from "@/lib/cron-auth"
import { r2 } from "@/lib/r2"
import { GetObjectCommand } from "@aws-sdk/client-s3"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session && !isCronRequest(req)) return new NextResponse("Unauthorized", { status: 401 })

  const key = req.nextUrl.searchParams.get("key")
  if (!key) return new NextResponse("Missing key", { status: 400 })

  const obj = await r2.send(new GetObjectCommand({
    Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
    Key: key,
  }))

  const body = obj.Body as ReadableStream | null
  if (!body) return new NextResponse("Not found", { status: 404 })

  return new NextResponse(body, {
    headers: {
      "Content-Type":  obj.ContentType ?? "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  })
}
