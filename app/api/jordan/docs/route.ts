import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { deleteObjectsFromR2 } from "@/lib/r2"

// /api/jordan/docs — the whole personal store in one route: every folder and
// every file. There are only ever a few hundred rows here, so the client holds
// the lot and navigates in memory rather than fetching per folder.
function missingTable(e: any): boolean {
  return /does not exist|relation .* does not exist|P2021|P2022/i.test(String(e?.message ?? e))
}

export async function GET() {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const [folders, files] = await Promise.all([
      prisma.jordanDocFolder.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, parentId: true } }),
      prisma.jordanDocFile.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, key: true, size: true, mimeType: true, folderId: true, createdAt: true },
      }),
    ])
    return NextResponse.json({ folders, files })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ folders: [], files: [], needsMigration: true })
    console.error("jordan/docs GET:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

/** Every folder from `id` downwards, so a move can be checked and a delete can
 *  re-parent. ⚠ Guarded against a cycle in the data: without `seen`, a folder
 *  that somehow ended up its own ancestor would spin here for ever. */
function descendantIds(all: { id: string; parentId: string | null }[], id: string): Set<string> {
  const out = new Set<string>([id])
  const seen = new Set<string>()
  let frontier = [id]
  while (frontier.length) {
    const next: string[] = []
    for (const p of frontier) {
      if (seen.has(p)) continue
      seen.add(p)
      for (const f of all) if (f.parentId === p && !out.has(f.id)) { out.add(f.id); next.push(f.id) }
    }
    frontier = next
  }
  return out
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { name, parentId } = await req.json()
    const clean = String(name ?? "").trim().slice(0, 120)
    if (!clean) return NextResponse.json({ error: "Give the folder a name" }, { status: 400 })
    const folder = await prisma.jordanDocFolder.create({
      data: { name: clean, parentId: parentId ? String(parentId) : null },
    })
    return NextResponse.json({ id: folder.id })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: "Run Migrations first — the document tables aren't there yet." }, { status: 503 })
    console.error("jordan/docs POST:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// PUT — rename or move, for a folder or a file. Neither exists on the shared
// Admin → Documents page; they are the point of this one.
export async function PUT(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { kind, id, name, parentId, folderId } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    if (kind === "folder") {
      const data: any = {}
      if (name !== undefined) {
        const clean = String(name).trim().slice(0, 120)
        if (!clean) return NextResponse.json({ error: "A folder needs a name" }, { status: 400 })
        data.name = clean
      }
      if (parentId !== undefined) {
        const target = parentId ? String(parentId) : null
        if (target === id) return NextResponse.json({ error: "A folder can't go inside itself." }, { status: 400 })
        if (target) {
          // ⚠ Moving a folder INTO ITS OWN DESCENDANT would detach that whole
          // branch from the tree — it would vanish from the screen while its rows
          // sat in the database for ever. Refuse it.
          const all = await prisma.jordanDocFolder.findMany({ select: { id: true, parentId: true } })
          if (descendantIds(all, String(id)).has(target)) {
            return NextResponse.json({ error: "You can't move a folder into one of its own subfolders." }, { status: 400 })
          }
        }
        data.parentId = target
      }
      await prisma.jordanDocFolder.update({ where: { id: String(id) }, data })
      return NextResponse.json({ ok: true })
    }

    const data: any = {}
    if (name !== undefined) {
      const clean = String(name).trim().slice(0, 200)
      if (!clean) return NextResponse.json({ error: "A file needs a name" }, { status: 400 })
      data.name = clean
    }
    if (folderId !== undefined) data.folderId = folderId ? String(folderId) : null
    await prisma.jordanDocFile.update({ where: { id: String(id) }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/docs PUT:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { kind, id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    if (kind === "folder") {
      // ⚠ NOTHING IS EVER DELETED WITH THE FOLDER. Its subfolders and files move
      // up to its parent instead. Deleting a folder is a tidying-up action and
      // must never be capable of silently destroying a document inside it.
      const folder = await prisma.jordanDocFolder.findUnique({ where: { id: String(id) }, select: { parentId: true } })
      if (!folder) return NextResponse.json({ ok: true })
      await prisma.jordanDocFolder.updateMany({ where: { parentId: String(id) }, data: { parentId: folder.parentId } })
      await prisma.jordanDocFile.updateMany({ where: { folderId: String(id) }, data: { folderId: folder.parentId } })
      await prisma.jordanDocFolder.delete({ where: { id: String(id) } })
      return NextResponse.json({ ok: true })
    }

    const file = await prisma.jordanDocFile.findUnique({ where: { id: String(id) }, select: { key: true } })
    await prisma.jordanDocFile.delete({ where: { id: String(id) } })
    if (file?.key) await deleteObjectsFromR2([file.key]).catch(() => {})
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("jordan/docs DELETE:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
