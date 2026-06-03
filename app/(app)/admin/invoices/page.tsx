"use client"

import { useEffect, useState, useRef, DragEvent } from "react"

interface InvoiceFile {
  id: string
  name: string
  key: string
  size: number
  mimeType: string
  uploadedBy: string
  createdAt: string
}

interface UploadingFile {
  tmpId: string
  name: string
  progress: "uploading" | "saving" | "error"
  error?: string
}

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
  if (mimeType === "application/pdf") return "📄"
  if (mimeType.startsWith("image/")) return "🖼️"
  if (
    mimeType === "application/msword" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) return "📝"
  if (
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) return "📊"
  return "📁"
}

export default function InvoicesPage() {
  const [files, setFiles]       = useState<InvoiceFile[]>([])
  const [uploading, setUploading] = useState<UploadingFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadFiles() {
    try {
      const res = await fetch("/api/invoices/files")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setFiles(data)
    } catch (e: any) {
      setError(e.message)
    }
  }

  useEffect(() => { loadFiles() }, [])

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
      const urlRes = await fetch("/api/invoices/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      })
      const urlData = await urlRes.json()
      if (!urlRes.ok) throw new Error(urlData.error)

      // 2. PUT to R2
      const putRes = await fetch(urlData.url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      })
      if (!putRes.ok) throw new Error("Upload to storage failed")

      // 3. Save to DB
      setProgress("saving")
      const saveRes = await fetch("/api/invoices/files/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          key: urlData.key,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
        }),
      })
      const saveData = await saveRes.json()
      if (!saveRes.ok) throw new Error(saveData.error)

      removeUploading()
      loadFiles()
    } catch (e: any) {
      setProgress("error", e.message)
      setTimeout(removeUploading, 4000)
    }
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return
    for (const file of Array.from(fileList)) uploadFile(file)
  }

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

  async function openFile(id: string) {
    try {
      const res = await fetch(`/api/invoices/files/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      window.open(data.url, "_blank", "noopener,noreferrer")
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function deleteFile(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/invoices/files/${id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setFiles(prev => prev.filter(f => f.id !== id))
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div
      className={`flex flex-col h-[calc(100vh-4rem)] overflow-hidden transition-colors ${isDragOver ? "bg-blue-50" : "bg-gray-50 dark:bg-gray-800"}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Invoices</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Upload and access invoices. Drag and drop or click to upload any file type.
          </p>
        </div>
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
      <div className="flex-1 overflow-y-auto p-6 relative">

        {isDragOver && (
          <div className="pointer-events-none fixed inset-0 border-4 border-dashed border-blue-400 rounded-xl z-10 flex items-center justify-center bg-blue-50/60">
            <p className="text-2xl font-bold text-blue-600">Drop files here</p>
          </div>
        )}

        {uploading.length === 0 && files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <p className="text-5xl mb-4">🧾</p>
            <p className="text-lg font-semibold text-gray-500 dark:text-gray-400 mb-1">No invoices yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Click &ldquo;Upload Files&rdquo; or drag and drop files onto this area.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">

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
                  {u.progress === "saving"    && "Saving…"}
                  {u.progress === "error"     && (u.error ?? "Upload failed")}
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
                <p className="text-xs text-gray-300 dark:text-gray-600 truncate">{file.uploadedBy}</p>
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
    </div>
  )
}
