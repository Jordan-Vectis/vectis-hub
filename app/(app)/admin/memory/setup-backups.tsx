"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// Admin → Claude Memory → Setup backups. The zip of Claude Code's settings, memory and chats,
// kept in the Hub so a new PC can pull it down. Upload goes straight to R2 on a presigned
// PUT with a real byte count (RULES.md 7b) — the file is hundreds of MB.

type F = { key: string; name: string; size: number; uploadedAt: string }
const mb = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`
const when = (d: string) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "")

export default function SetupBackups() {
  const [files, setFiles] = useState<F[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ name: string; sent: number; total: number } | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const busyRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/memory-backups")
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? "Couldn't list the backups")
      setFiles(j.files ?? [])
    } catch (e: any) { setError(e.message); setFiles([]) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function upload(file: File) {
    if (busyRef.current) return
    busyRef.current = true; setError(null)
    setProgress({ name: file.name, sent: 0, total: file.size })
    try {
      const r = await fetch("/api/admin/memory-backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, size: file.size, contentType: file.type || "application/zip" }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? "Couldn't start the upload")
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhrRef.current = xhr
        xhr.open("PUT", j.url)
        xhr.setRequestHeader("Content-Type", file.type || "application/zip")
        xhr.upload.onprogress = ev => setProgress({ name: file.name, sent: ev.loaded, total: ev.total || file.size })
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage answered ${xhr.status} — nothing was saved`)))
        xhr.onerror = () => reject(new Error("The upload failed part-way — nothing was saved"))
        xhr.onabort = () => reject(new Error("Stopped — nothing was saved"))
        xhr.send(file)
      })
      await load()
    } catch (e: any) { setError(e.message) }
    finally { busyRef.current = false; xhrRef.current = null; setProgress(null); if (inputRef.current) inputRef.current.value = "" }
  }

  async function remove(f: F) {
    if (!confirm(`Delete ${f.name} (${mb(f.size)})?`)) return
    try {
      const r = await fetch("/api/admin/memory-backups", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: f.key }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't delete it")
      await load()
    } catch (e: any) { setError(e.message) }
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">📦 Setup backups</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-xl">
            A zip of Claude Code&apos;s settings, memory folder and saved chats, for setting up a new PC.
            Unzip it into <span className="font-mono">C:\Users\&lt;you&gt;\</span> before opening Claude there, keep the repo at the same path, and sign in fresh.
            ⚠ Never upload one that contains <span className="font-mono">.credentials.json</span> — that is a login token.
          </p>
        </div>
        <label className={`shrink-0 cursor-pointer text-sm border px-4 py-2 rounded-lg transition-colors ${progress ? "opacity-40 cursor-not-allowed" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border-gray-200 dark:border-gray-700 hover:border-gray-300"}`}>
          Upload zip
          <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden" disabled={!!progress} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
        </label>
      </div>

      {progress && (
        <div className="mt-4 text-sm">
          <div className="flex justify-between text-xs text-gray-600 dark:text-gray-300 mb-1">
            <span>Uploading {progress.name}</span>
            <span>{mb(progress.sent)} of {mb(progress.total)}</span>
          </div>
          <div className="h-2 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${progress.total ? (progress.sent / progress.total) * 100 : 0}%` }} />
          </div>
          <button className="mt-2 text-xs underline text-gray-500" onClick={() => xhrRef.current?.abort()}>Stop</button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4">
        {files === null ? <p className="text-xs text-gray-500">Loading…</p>
        : files.length === 0 ? <p className="text-xs text-gray-500">Nothing uploaded yet.</p>
        : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {files.map(f => (
              <li key={f.key} className="py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <a href={`/api/admin/memory-backups?key=${encodeURIComponent(f.key)}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">⬇ {f.name}</a>
                <span className="text-xs text-gray-500">{mb(f.size)} · {when(f.uploadedAt)}</span>
                <button className="ml-auto text-xs text-gray-400 hover:text-red-500" onClick={() => remove(f)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
