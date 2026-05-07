import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import fs from "fs/promises"
import path from "path"

const MEMORY_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".claude", "projects", "C--Dev-apps", "memory"
)

async function diskAvailable(): Promise<boolean> {
  try { await fs.access(MEMORY_DIR); return true } catch { return false }
}

async function syncFromDisk() {
  const files = await fs.readdir(MEMORY_DIR)
  const mdFiles = files.filter(f => f.endsWith(".md"))
  await Promise.all(mdFiles.map(async filename => {
    const content = await fs.readFile(path.join(MEMORY_DIR, filename), "utf-8")
    await prisma.claudeMemory.upsert({
      where: { filename },
      update: { content },
      create: { filename, content },
    })
  }))
}

// GET — return all entries from DB (auto-sync from disk on first load if DB empty)
export async function GET() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    let rows = await prisma.claudeMemory.findMany({ orderBy: { filename: "asc" } })

    if (rows.length === 0 && await diskAvailable()) {
      await syncFromDisk()
      rows = await prisma.claudeMemory.findMany({ orderBy: { filename: "asc" } })
    }

    const entries = rows.map(r => ({ filename: r.filename, content: r.content }))
    return NextResponse.json({ entries })
  } catch (e: any) {
    console.error("memory GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// PATCH — save edited content to DB (and disk if available)
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

    await prisma.claudeMemory.upsert({
      where: { filename },
      update: { content },
      create: { filename, content },
    })

    if (await diskAvailable()) {
      await fs.writeFile(path.join(MEMORY_DIR, filename), content, "utf-8")
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("memory PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// POST — sync all disk files → DB (call after Claude writes new memory files)
export async function POST() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    if (!await diskAvailable()) {
      return NextResponse.json({ error: "Disk not available on this environment" }, { status: 400 })
    }

    await syncFromDisk()
    const rows = await prisma.claudeMemory.findMany({ orderBy: { filename: "asc" } })
    return NextResponse.json({ ok: true, synced: rows.length })
  } catch (e: any) {
    console.error("memory POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
