"use client"

import { useEffect, useState, useRef, useCallback, DragEvent } from "react"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Folder {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

interface DocFile {
  id: string
  name: string
  key: string
  size: number
  mimeType: string
  folderId: string | null
  uploadedBy: string
  createdAt: string
}

interface UploadingFile {
  tmpId: string
  name: string
  progress: "uploading" | "saving" | "error"
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "🖼️"
  if (mimeType === "application/pdf") return "📄"
  if (
    mimeType === "application/msword" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "📝"
  return "📁"
}

// ── Folder tree helpers ───────────────────────────────────────────────────────

function buildTree(folders: Folder[]): (Folder & { depth: number })[] {
  const childrenMap = new Map<string | null, Folder[]>()
  for (const f of folders) {
    const key = f.parentId ?? null
    if (!childrenMap.has(key)) childrenMap.set(key, [])
    childrenMap.get(key)!.push(f)
  }

  const result: (Folder & { depth: number })[] = []

  function walk(parentId: string | null, depth: number) {
    const children = childrenMap.get(parentId) ?? []
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      result.push({ ...child, depth })
      walk(child.id, depth + 1)
    }
  }

  walk(null, 0)
  return result
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [files, setFiles] = useState<DocFile[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null) // null = root
  const [uploading, setUploading] = useState<UploadingFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Data fetching ─────────────────────────────────────────────────────────

  const loadFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/documents/folders")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setFolders(data)
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  const loadFiles = useCallback(async (folderId: string | null) => {
    try {
      const qs = folderId === null ? "root" : folderId
      const res = await fetch(`/api/documents/files?folderId=${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setFiles(data)
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    loadFolders()
  }, [loadFolders])

  useEffect(() => {
    loadFiles(selectedFolderId)
  }, [selectedFolderId, loadFiles])

  // ── Upload ────────────────────────────────────────────────────────────────

  async function uploadFile(file: File) {
    const tmpId = `${Date.now()}-${Math.random()}`
    setUploading(prev => [...prev, { tmpId, name: file.name, progress: "uploading" }])

    const setProgress = (progress: UploadingFile["progress"], errorMsg?: string) =>
      setUploading(prev =>
        prev.map(u => (u.tmpId === tmpId ? { ...u, progress, error: errorMsg } : u))
      )

    const removeUploading = () =>
      setUploading(prev => prev.filter(u => u.tmpId !== tmpId))

    try {
      // 1. Get presigned URL
      const urlRes = await fetch("/api/documents/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      })
      const urlData = await urlRes.json()
      if (!urlRes.ok) throw new Error(urlData.error)

      // 2. PUT to R2
      const putRes = await fetch(urlData.url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      })
      if (!putRes.ok) throw new Error("Upload to storage failed")

      // 3. Save to DB
      setProgress("saving")
      const saveRes = await fetch("/api/documents/files/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          key: urlData.key,
          size: file.size,
          mimeType: file.type,
          folderId: selectedFolderId,
        }),
      })
      const saveData = await saveRes.json()
      if (!saveRes.ok) throw new Error(saveData.error)

      removeUploading()
      loadFiles(selectedFolderId)
    } catch (e: any) {
      setProgress("error", e.message)
      setTimeout(removeUploading, 4000)
    }
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return
    for (const file of Array.from(fileList)) {
      uploadFile(file)
    }
  }

  // ── Drag and drop ─────────────────────────────────────────────────────────

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  // ── Create folder ─────────────────────────────────────────────────────────

  async function createFolder() {
    if (!newFolderName.trim()) return
    setCreatingFolder(true)
    try {
      const res = await fetch("/api/documents/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim(), parentId: selectedFolderId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNewFolderName("")
      loadFolders()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreatingFolder(false)
    }
  }

  // ── Delete folder ─────────────────────────────────────────────────────────

  async function deleteFolder(id: string, name: string) {
    if (!window.confirm(`Delete folder "${name}"?\n\nAll files inside will be moved to the root.`)) return
    try {
      const res = await fetch(`/api/documents/folders/${id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (selectedFolderId === id) setSelectedFolderId(null)
      loadFolders()
      loadFiles(selectedFolderId === id ? null : selectedFolderId)
    } catch (e: any) {
      setError(e.message)
    }
  }

  // ── Delete file ───────────────────────────────────────────────────────────

  async function deleteFile(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/documents/files/${id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setFiles(prev => prev.filter(f => f.id !== id))
    } catch (e: any) {
      setError(e.message)
    }
  }

  // ── Open file ─────────────────────────────────────────────────────────────

  async function openFile(id: string) {
    try {
      const res = await fetch(`/api/documents/files/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      window.open(data.url, "_blank", "noopener,noreferrer")
    } catch (e: any) {
      setError(e.message)
    }
  }

  // ── Breadcrumb ────────────────────────────────────────────────────────────

  function getBreadcrumb(): { id: string | null; name: string }[] {
    if (selectedFolderId === null) return [{ id: null, name: "All Files" }]
    const crumbs: { id: string | null; name: string }[] = [{ id: null, name: "All Files" }]
    let current: Folder | undefined = folders.find(f => f.id === selectedFolderId)
    const chain: Folder[] = []
    while (current) {
      chain.unshift(current)
      current = current.parentId ? folders.find(f => f.id === current!.parentId) : undefined
    }
    for (const f of chain) crumbs.push({ id: f.id, name: f.name })
    return crumbs
  }

  const treeItems = buildTree(folders)
  const breadcrumb = getBreadcrumb()

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-900">
        <div className="px-4 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Folders</h2>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {/* All Files root item */}
          <button
            onClick={() => setSelectedFolderId(null)}
            className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors ${
              selectedFolderId === null
                ? "bg-slate-100 text-slate-800 font-semibold"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50"
            }`}
          >
            <span>📂</span>
            <span>All Files</span>
          </button>

          {/* Folder tree */}
          {treeItems.map(folder => (
            <div
              key={folder.id}
              className="group flex items-center"
              style={{ paddingLeft: `${(folder.depth + 1) * 16}px` }}
            >
              <button
                onClick={() => setSelectedFolderId(folder.id)}
                className={`flex-1 flex items-center gap-2 py-2 pr-2 text-sm text-left transition-colors truncate ${
                  selectedFolderId === folder.id
                    ? "text-slate-800 font-semibold"
                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white dark:text-white"
                }`}
              >
                <span>🗂️</span>
                <span className="truncate">{folder.name}</span>
              </button>
              <button
                onClick={() => deleteFolder(folder.id, folder.name)}
                className="opacity-0 group-hover:opacity-100 mr-3 text-gray-400 dark:text-gray-500 hover:text-red-500 text-xs transition-all leading-none"
                title="Delete folder"
              >
                ✕
              </button>
            </div>
          ))}
        </nav>

        {/* New folder input */}
        <div className="px-3 py-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex gap-1">
            <input
              type="text"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") createFolder() }}
              placeholder="New folder…"
              className="flex-1 min-w-0 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
            <button
              onClick={createFolder}
              disabled={creatingFolder || !newFolderName.trim()}
              className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              +
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <main
        className={`flex-1 flex flex-col overflow-hidden transition-colors ${isDragOver ? "bg-blue-50" : "bg-gray-50 dark:bg-gray-800"}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Header */}
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between gap-4 shrink-0">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 min-w-0">
            {breadcrumb.map((crumb, i) => (
              <span key={crumb.id ?? "root"} className="flex items-center gap-1 min-w-0">
                {i > 0 && <span className="text-gray-300">/</span>}
                {i < breadcrumb.length - 1 ? (
                  <button
                    onClick={() => setSelectedFolderId(crumb.id)}
                    className="hover:text-slate-700 transition-colors"
                  >
                    {crumb.name}
                  </button>
                ) : (
                  <span className="font-semibold text-gray-800 dark:text-gray-200 truncate">{crumb.name}</span>
                )}
              </span>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {isDragOver && (
              <span className="text-sm text-blue-600 font-medium">Drop files to upload</span>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Upload Files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => handleFiles(e.target.files)}
            />
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between shrink-0">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
          </div>
        )}

        {/* File grid */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* Drag-over overlay hint */}
          {isDragOver && (
            <div className="pointer-events-none fixed inset-0 border-4 border-dashed border-blue-400 rounded-xl z-10 flex items-center justify-center bg-blue-50/60">
              <p className="text-2xl font-bold text-blue-600">Drop files here</p>
            </div>
          )}

          {uploading.length === 0 && files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <p className="text-5xl mb-4">📂</p>
              <p className="text-lg font-semibold text-gray-500 dark:text-gray-400 mb-1">No files here yet</p>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                Click &ldquo;Upload Files&rdquo; or drag and drop files onto this area.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">

              {/* Uploading skeleton cards */}
              {uploading.map(u => (
                <div
                  key={u.tmpId}
                  className={`bg-white dark:bg-gray-900 border rounded-xl p-4 flex flex-col gap-2 ${
                    u.progress === "error" ? "border-red-200 bg-red-50" : "border-gray-200 dark:border-gray-700 animate-pulse"
                  }`}
                >
                  <div className={`h-10 w-10 rounded-lg ${u.progress === "error" ? "bg-red-200" : "bg-gray-200"}`} />
                  <div className="h-3 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
                  <p className={`text-xs mt-1 ${u.progress === "error" ? "text-red-600" : "text-slate-500"}`}>
                    {u.progress === "uploading" && "Uploading…"}
                    {u.progress === "saving" && "Saving…"}
                    {u.progress === "error" && (u.error ?? "Upload failed")}
                  </p>
                </div>
              ))}

              {/* File cards */}
              {files.map(file => (
                <div
                  key={file.id}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col gap-2 hover:border-slate-300 hover:shadow-sm transition-all group cursor-pointer"
                  onClick={() => openFile(file.id)}
                >
                  <div className="text-4xl leading-none">{fileIcon(file.mimeType)}</div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {formatBytes(file.size)} · {formatDate(file.createdAt)}
                  </p>
                  <button
                    onClick={e => { e.stopPropagation(); deleteFile(file.id, file.name) }}
                    className="mt-auto self-start opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:text-red-600 transition-all"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
