"use client"

import { useCallback, useEffect, useMemo, useRef, useState, DragEvent } from "react"

// JORDAN.SYS → DOCUMENTS. Private to /jordan, separate tables from the shared
// Admin → Documents store so nothing here can appear on a page other admins open.
//
// What this does that the shared one doesn't: RENAME and MOVE, for folders as
// well as files, drag-and-drop between folders, and a search across everything.

const box   = "border border-[#1f5c33] rounded-lg bg-[#040f08]"
const input = "w-full bg-black border border-[#1f5c33] rounded px-2.5 py-1.5 text-sm text-[#33ff66] placeholder:text-[#1f5c33] focus:outline-none focus:border-[#33ff66]"
const btn   = "px-3 py-1.5 text-xs border border-[#1f5c33] rounded hover:bg-[#0a2214] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"

type Folder = { id: string; name: string; parentId: string | null }
type DocFile = { id: string; name: string; key: string; size: number; mimeType: string; folderId: string | null; createdAt: string }
type Uploading = { name: string; pct: number; error?: string }

const ROOT = "__root__"

function bytes(n: number): string {
  if (!n) return ""
  const u = ["B", "KB", "MB", "GB"]
  let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)}${u[i]}`
}

function icon(mime: string, name: string): string {
  const n = name.toLowerCase()
  if (mime.startsWith("image/")) return "🖼"
  if (mime === "application/pdf" || n.endsWith(".pdf")) return "📕"
  if (/\.(xlsx?|csv)$/.test(n)) return "📊"
  if (/\.(docx?|rtf|odt)$/.test(n)) return "📝"
  if (/\.(zip|rar|7z)$/.test(n)) return "🗜"
  if (mime.startsWith("video/")) return "🎬"
  if (mime.startsWith("audio/")) return "🎵"
  return "📄"
}

export default function DocsClient() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [files, setFiles]     = useState<DocFile[]>([])
  const [here, setHere]       = useState<string | null>(null)   // null = root
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [uploading, setUploading] = useState<Uploading[]>([])
  const [dragOver, setDragOver]   = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [search, setSearch]   = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const dragItem = useRef<{ kind: "file" | "folder"; id: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/jordan/docs")
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't load")
      setNeedsMigration(!!j.needsMigration)
      setFolders(j.folders ?? []); setFiles(j.files ?? [])
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function api(body: any, method: "POST" | "PUT" | "DELETE") {
    const r = await fetch("/api/jordan/docs", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? "Something went wrong")
    return j
  }
  const run = (p: Promise<any>) => p.then(load).catch((e: any) => setError(e.message))

  // ── Tree helpers ───────────────────────────────────────────────────────────
  const childFolders = (id: string | null) => folders.filter(f => f.parentId === id)
  const filesIn      = (id: string | null) => files.filter(f => f.folderId === id)

  const breadcrumb = useMemo(() => {
    const path: Folder[] = []
    let cur = here ? folders.find(f => f.id === here) : null
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); path.unshift(cur); cur = cur.parentId ? folders.find(f => f.id === cur!.parentId) ?? null : null }
    return path
  }, [here, folders])

  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    return {
      folders: folders.filter(f => f.name.toLowerCase().includes(q)),
      files:   files.filter(f => f.name.toLowerCase().includes(q)),
    }
  }, [search, folders, files])

  // ── Upload: presigned PUT straight to R2, so a big document never goes
  //    through a serverless request body. ────────────────────────────────────
  const uploadOne = useCallback(async (file: File, folderId: string | null) => {
    const row: Uploading = { name: file.name, pct: 0 }
    setUploading(u => [...u, row])
    const patch = (p: Partial<Uploading>) =>
      setUploading(u => u.map(x => x === row ? Object.assign(row, p) : x).map(x => ({ ...x })))
    try {
      const startRes = await fetch("/api/jordan/docs/file", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }),
      })
      const start = await startRes.json()
      if (!startRes.ok) throw new Error(start.error ?? "Couldn't start the upload")

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", start.url)
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")
        xhr.upload.onprogress = e => { if (e.lengthComputable) patch({ pct: Math.round((e.loaded / e.total) * 100) }) }
        xhr.onload  = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed (${xhr.status})`))
        xhr.onerror = () => reject(new Error("Upload failed"))
        xhr.send(file)
      })

      // Only record it once the bytes are actually in the bucket — a row whose
      // file never arrived would be a permanently broken download.
      const saveRes = await fetch("/api/jordan/docs/file", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: start.key, name: file.name, size: file.size, mimeType: file.type, folderId }),
      })
      const saved = await saveRes.json()
      if (!saveRes.ok) throw new Error(saved.error ?? "Couldn't save it")

      setUploading(u => u.filter(x => x !== row))
      await load()
    } catch (e: any) {
      patch({ error: e.message })
      setTimeout(() => setUploading(u => u.filter(x => x !== row)), 6000)
    }
  }, [load])

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragOver(false)
    const list = e.dataTransfer?.files
    if (list?.length) for (const f of Array.from(list)) void uploadOne(f, here)
  }

  /** Drop an item onto a folder row — the move that the shared store can't do. */
  async function dropOnFolder(targetId: string | null) {
    const it = dragItem.current
    dragItem.current = null
    setDropTarget(null)
    if (!it) return
    if (it.kind === "folder" && it.id === targetId) return
    await run(it.kind === "file"
      ? api({ kind: "file", id: it.id, folderId: targetId }, "PUT")
      : api({ kind: "folder", id: it.id, parentId: targetId }, "PUT"))
  }

  const shownFolders = results ? results.folders : childFolders(here)
  const shownFiles   = results ? results.files   : filesIn(here)

  return (
    <div className="space-y-4 text-sm pb-16">
      {needsMigration && (
        <div className="border border-amber-600 bg-amber-950/30 text-amber-300 rounded-lg px-4 py-2.5 text-xs">
          The document tables aren&apos;t in the database yet — press <strong>Run Migrations</strong> on the Admin page, then reload.
        </div>
      )}
      {error && (
        <div className="border border-red-700 bg-red-950/40 text-red-300 rounded-lg px-4 py-2.5 text-xs flex items-start gap-3">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className={`${box} p-3 flex flex-wrap items-center gap-2`}>
        <button className={btn} onClick={() => {
          const name = prompt("New folder name")?.trim()
          if (name) void run(api({ name, parentId: here }, "POST"))
        }}>+ NEW FOLDER</button>
        <button className={btn} onClick={() => fileRef.current?.click()}>⬆ UPLOAD</button>
        <input ref={fileRef} type="file" multiple className="hidden"
          onChange={e => { const l = e.target.files; if (l) for (const f of Array.from(l)) void uploadOne(f, here); if (fileRef.current) fileRef.current.value = "" }} />
        <div className="ml-auto w-full sm:w-64">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search everything…" className={input} />
        </div>
      </div>

      {/* ── Breadcrumb ── */}
      {!results && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <button
            onClick={() => setHere(null)}
            onDragOver={e => { e.preventDefault(); setDropTarget(ROOT) }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={e => { e.preventDefault(); void dropOnFolder(null) }}
            className={`px-2 py-1 rounded border transition-colors ${dropTarget === ROOT ? "border-[#33ff66] bg-[#0a2214]" : "border-transparent hover:bg-[#0a2214]"}`}>
            🏠 HOME
          </button>
          {breadcrumb.map(f => (
            <span key={f.id} className="flex items-center gap-1">
              <span className="opacity-30">/</span>
              <button onClick={() => setHere(f.id)}
                onDragOver={e => { e.preventDefault(); setDropTarget(f.id) }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={e => { e.preventDefault(); void dropOnFolder(f.id) }}
                className={`px-2 py-1 rounded border transition-colors ${dropTarget === f.id ? "border-[#33ff66] bg-[#0a2214]" : "border-transparent hover:bg-[#0a2214]"}`}>
                {f.name}
              </button>
            </span>
          ))}
        </div>
      )}
      {results && (
        <p className="text-xs opacity-60">
          {results.folders.length + results.files.length} match{results.folders.length + results.files.length === 1 ? "" : "es"} for &ldquo;{search}&rdquo;
          <button className="ml-3 underline opacity-70 hover:opacity-100" onClick={() => setSearch("")}>clear</button>
        </p>
      )}

      {/* ── Uploads in progress ── */}
      {uploading.length > 0 && (
        <div className={`${box} p-3 space-y-2`}>
          {uploading.map((u, i) => (
            <div key={i} className="text-xs">
              <div className="flex justify-between gap-3">
                <span className="truncate">{u.name}</span>
                <span className={u.error ? "text-red-400" : "opacity-60"}>{u.error ?? `${u.pct}%`}</span>
              </div>
              {!u.error && (
                <div className="h-1 bg-[#0a2214] rounded mt-1 overflow-hidden">
                  <div className="h-full bg-[#33ff66] transition-all" style={{ width: `${u.pct}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Listing ── */}
      <div
        onDragOver={e => { e.preventDefault(); if (!dragItem.current) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`${box} p-2 min-h-[260px] transition-colors ${dragOver ? "border-[#33ff66] bg-[#0a2214]" : ""}`}>

        {loading ? <p className="text-xs opacity-60 p-3">LOADING…</p>
          : shownFolders.length === 0 && shownFiles.length === 0 ? (
            <p className="text-xs opacity-50 p-3">
              {results ? "Nothing matches that." : "Empty. Drop files here, or make a folder."}
            </p>
          ) : (
          <div className="divide-y divide-[#0f2d1a]">
            {shownFolders.map(f => (
              <div key={f.id}
                draggable
                onDragStart={() => { dragItem.current = { kind: "folder", id: f.id } }}
                onDragOver={e => { e.preventDefault(); if (dragItem.current) setDropTarget(f.id) }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={e => { e.preventDefault(); e.stopPropagation(); void dropOnFolder(f.id) }}
                className={`flex items-center gap-3 px-3 py-2 group ${dropTarget === f.id ? "bg-[#0a2214] outline outline-1 outline-[#33ff66]" : ""}`}>
                <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => { setSearch(""); setHere(f.id) }}>
                  <span>📁</span>
                  <span className="truncate">{f.name}</span>
                  <span className="text-[11px] opacity-40">
                    {childFolders(f.id).length + filesIn(f.id).length} item{childFolders(f.id).length + filesIn(f.id).length === 1 ? "" : "s"}
                  </span>
                </button>
                <span className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className={btn} onClick={() => {
                    const name = prompt("Rename folder", f.name)?.trim()
                    if (name && name !== f.name) void run(api({ kind: "folder", id: f.id, name }, "PUT"))
                  }}>RENAME</button>
                  <button className={`${btn} hover:border-red-500 hover:text-red-400`} onClick={() => {
                    if (confirm(`Delete the folder "${f.name}"?\n\nAnything inside moves up a level — nothing is deleted with it.`)) {
                      void run(api({ kind: "folder", id: f.id }, "DELETE"))
                    }
                  }}>DELETE</button>
                </span>
              </div>
            ))}

            {shownFiles.map(f => (
              <div key={f.id}
                draggable
                onDragStart={() => { dragItem.current = { kind: "file", id: f.id } }}
                className="flex items-center gap-3 px-3 py-2 group">
                <a href={`/api/jordan/docs/file?key=${encodeURIComponent(f.key)}`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-3 flex-1 min-w-0 hover:underline">
                  <span>{icon(f.mimeType, f.name)}</span>
                  <span className="truncate">{f.name}</span>
                  {f.size > 0 && <span className="text-[11px] opacity-40 shrink-0">{bytes(f.size)}</span>}
                </a>
                <span className="text-[11px] opacity-30 hidden md:block shrink-0">
                  {new Date(f.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
                <span className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a className={btn} href={`/api/jordan/docs/file?key=${encodeURIComponent(f.key)}&download=1&name=${encodeURIComponent(f.name)}`}>⬇</a>
                  <button className={btn} onClick={() => {
                    const name = prompt("Rename file", f.name)?.trim()
                    if (name && name !== f.name) void run(api({ kind: "file", id: f.id, name }, "PUT"))
                  }}>RENAME</button>
                  <button className={`${btn} hover:border-red-500 hover:text-red-400`} onClick={() => {
                    if (confirm(`Delete "${f.name}"? This removes the file itself and can't be undone.`)) {
                      void run(api({ kind: "file", id: f.id }, "DELETE"))
                    }
                  }}>DELETE</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] opacity-40">
        Drag a file or folder onto another folder — or onto the breadcrumb — to move it. Drop files anywhere on the list to upload them here.
      </p>
    </div>
  )
}
