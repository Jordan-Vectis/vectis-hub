import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { r2 } from "@/lib/r2"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { readManifest } from "../route"

// GET /api/it-tools/craft-apps/download?key=craft-apps/<app>/<version>/<file>
// A one-hour signed URL that SAVES the installer under its own filename. The
// bucket is private; nothing links to it directly. Content-Disposition is set on
// the signature because <a download> is ignored cross-origin and R2 is a
// different origin to the Hub (same as the Screen Recorder's download).
// Only a key the manifest lists can be signed: the key shape is checked first
// (an installer, or one of the "Download all" bundle zips), then it must be one
// of the manifest's entries — never a prefix match.
const KEY_SHAPE = /^craft-apps\/[a-z0-9-]+\/[A-Za-z0-9.+-]+\/[A-Za-z0-9][A-Za-z0-9._+-]*$/
const BUNDLE_SHAPE = /^craft-apps\/bundles\/[A-Za-z0-9][A-Za-z0-9._+-]*\.zip$/

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const key = new URL(req.url).searchParams.get("key") ?? ""
    if (!KEY_SHAPE.test(key) && !BUNDLE_SHAPE.test(key)) return NextResponse.json({ error: "Not a valid installer key" }, { status: 400 })

    const manifest = await readManifest()
    const file = manifest.apps.flatMap(a => a.versions).flatMap(v => v.files).find(f => f.key === key)
      ?? (manifest.bundles ?? []).map(b => ({ name: b.fileName, key: b.key })).find(b => b.key === key)
    if (!file) return NextResponse.json({ error: "Installer not found" }, { status: 404 })

    // ASCII only and no quotes — this goes inside a quoted header value.
    const safe = file.name.replace(/[^\x20-\x7E]/g, "").replace(/["\\]/g, "").trim() || "installer"
    const url = await getSignedUrl(r2, new GetObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: key,
      ResponseContentType: "application/octet-stream",
      ResponseContentDisposition: `attachment; filename="${safe}"`,
    }), { expiresIn: 3600 })
    return NextResponse.json({ url })
  } catch (e: any) {
    console.error("it-tools/craft-apps/download GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
