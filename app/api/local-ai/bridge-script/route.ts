import { NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { auth } from "@/auth"

// Download the bridge the office PC runs (scripts/local-ai-bridge.mjs) from the Hub itself, so
// nobody has to find the repo. Admins only — the script is harmless but it is the half of the
// trial that lives outside the Hub, and there is one place to get it from.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const file = path.join(process.cwd(), "scripts", "local-ai-bridge.mjs")
    const body = await readFile(file, "utf8")
    return new NextResponse(body, {
      headers: {
        "Content-Type":        "text/javascript; charset=utf-8",
        "Content-Disposition": 'attachment; filename="local-ai-bridge.mjs"',
        "Cache-Control":       "no-store",
      },
    })
  } catch (e: any) {
    console.error("local-ai/bridge-script GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Could not read the bridge script" }, { status: 500 })
  }
}
