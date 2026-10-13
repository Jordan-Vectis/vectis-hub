import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getObjectBuffer } from "@/lib/r2"

// GET /api/it-tools/craft-apps — the Craft app installers the Hub holds, for
// IT Tools → Craft Apps. The list is craft-apps/manifest.json in R2, written by
// scripts/upload-craft-apps.mjs on the PC that builds the apps, so a rebuild
// shows up here after the next upload with no code change. Signed in = can see
// it, the same as the rest of IT Tools (allUsers).

export const MANIFEST_KEY = "craft-apps/manifest.json"

export type CraftFile = { name: string; key: string; sizeBytes: number; sha256: string }
export type CraftVersion = { version: string; source: "built" | "official"; notes: string; files: CraftFile[] }
export type CraftApp = {
  id: string; name: string; icon: string; group: string; tagline: string; like: string
  versions: CraftVersion[]
}
// A "Download all" zip: every app's newest installer of one kind (built here / official).
export type CraftBundle = { id: string; label: string; key: string; fileName: string; sizeBytes: number; sha256: string; fileCount: number }
export type CraftManifest = { generatedAt: string; apps: CraftApp[]; bundles?: CraftBundle[] }

export async function readManifest(): Promise<CraftManifest> {
  const buf = await getObjectBuffer(MANIFEST_KEY)
  const parsed = JSON.parse(buf.toString("utf8")) as CraftManifest
  if (!parsed || !Array.isArray(parsed.apps)) throw new Error("The installer list is unreadable")
  return parsed
}

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    let manifest: CraftManifest
    try {
      manifest = await readManifest()
    } catch (e: any) {
      // No manifest yet means nothing has been uploaded — an empty list, not a crash.
      if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return NextResponse.json({ generatedAt: null, apps: [] })
      throw e
    }
    return NextResponse.json(manifest)
  } catch (e: any) {
    console.error("it-tools/craft-apps GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
