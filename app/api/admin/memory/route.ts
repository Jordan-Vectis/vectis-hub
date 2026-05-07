import { NextResponse } from "next/server"
import { auth } from "@/auth"
import fs from "fs/promises"
import path from "path"

const MEMORY_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".claude", "projects", "C--Dev-apps", "memory"
)

export async function GET() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    let files: string[]
    try {
      files = await fs.readdir(MEMORY_DIR)
    } catch {
      return NextResponse.json({ unavailable: true, reason: "Memory directory not found — only accessible when running locally." })
    }

    const mdFiles = files.filter(f => f.endsWith(".md")).sort()

    const entries = await Promise.all(
      mdFiles.map(async filename => {
        const content = await fs.readFile(path.join(MEMORY_DIR, filename), "utf-8")
        return { filename, content }
      })
    )

    return NextResponse.json({ entries })
  } catch (e: any) {
    console.error("memory route error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const { filename, content } = await req.json()
    if (!filename || typeof content !== "string") {
      return NextResponse.json({ error: "filename and content required" }, { status: 400 })
    }
    if (filename.includes("..") || filename.includes("/") || !filename.endsWith(".md")) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 })
    }

    await fs.writeFile(path.join(MEMORY_DIR, filename), content, "utf-8")
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("memory PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
