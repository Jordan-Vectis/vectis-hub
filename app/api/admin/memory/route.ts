import { NextResponse } from "next/server"
import { auth } from "@/auth"
import fs from "fs/promises"
import path from "path"

const MEMORY_DIR = path.join(
  process.env.HOME ?? process.env.USERPROFILE ?? "",
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
