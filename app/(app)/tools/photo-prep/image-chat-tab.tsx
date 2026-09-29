"use client"

import { useEffect, useRef, useState } from "react"

// Photo Prep → 💬 Image chat (2026-09-29, Jordan: "a nano banana chat bot where I can ask it to make
// me posters etc"). Type what you want, optionally attach pictures (a lot photo, the logo, a style
// to copy), get a picture back, keep asking for changes, download the one you like.
//
// ⚠ The conversation lives in this tab only — nothing is saved in the Hub. Each follow-up sends the
// latest picture back with the new request (see app/api/photo-prep/create).
// ⚠ For MARKETING pictures. The model redraws what it is given, so a lot photo that comes out of here
// is no longer evidence of the item's condition — never use one as a catalogue photo.

type Turn =
  | { id: string; who: "you";  text: string; thumbs: string[] }
  | { id: string; who: "ai";   image?: string; text?: string; error?: string }

const SHAPES = [
  { key: "square",    label: "Square" },
  { key: "portrait",  label: "Portrait (A4)" },
  { key: "landscape", label: "Landscape (16:9)" },
  { key: "story",     label: "Phone story (9:16)" },
] as const

const IDEAS = [
  "A poster for our Model Trains auction on Tuesday 14 October — bold title, a steam locomotive, space at the bottom for the Vectis logo",
  "An Instagram post announcing a Star Wars toys sale, fun and bright",
  "A 'We're recruiting — Cataloguer' banner for the website",
]

const BTN = "min-h-[44px] px-4 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"

// Shrink in the browser first: the server's body limit is 20 MB and a few phone photos pass that.
async function shrink(file: File, max = 2048): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement("canvas")
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height)
    return await new Promise<Blob>((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("toBlob")), "image/png"))
  } catch {
    return file   // a type the browser can't draw (e.g. HEIC in Chrome) — let the server try
  }
}

function dataUrlToBlob(url: string): Blob {
  const [head, b64] = url.split(",")
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/png"
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

// Same approach as the AI edit tab: the share sheet first on phones (that's how "Save Image" reaches
// Photos on iOS), then a Blob download from an anchor that is actually in the document.
async function download(url: string, n: number) {
  const blob = dataUrlToBlob(url)
  const ext = blob.type.includes("jpeg") ? "jpg" : "png"
  const file = new File([blob], `vectis-image-${n}.${ext}`, { type: blob.type })
  const nav: any = navigator
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file] }); return } catch (e: any) { if (e?.name === "AbortError") return }
  }
  const href = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = href; a.download = file.name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 30_000)
}

export default function ImageChatTab() {
  const [turns, setTurns]   = useState<Turn[]>([])
  const [text, setText]     = useState("")
  const [shape, setShape]   = useState<string>("portrait")
  const [files, setFiles]   = useState<File[]>([])
  const [busy, setBusy]     = useState(false)
  const [changeLast, setChangeLast] = useState(true)
  const sending = useRef(false)
  const endRef  = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const lastImage = [...turns].reverse().find(t => t.who === "ai" && t.image) as Extract<Turn, { who: "ai" }> | undefined
  const editing = !!lastImage && changeLast

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }) }, [turns, busy])

  // Paste a picture straight in.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pics = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith("image/"))
      if (pics.length) setFiles(prev => [...prev, ...pics].slice(0, 4))
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [])

  async function send() {
    const prompt = text.trim()
    if (!prompt || sending.current) return
    // ⚠ Lit BEFORE the first await, re-entry guarded by a ref (a double tap sent two requests).
    sending.current = true
    setBusy(true)
    const attached = files
    const you: Turn = { id: crypto.randomUUID(), who: "you", text: prompt, thumbs: attached.map(f => URL.createObjectURL(f)) }
    setTurns(t => [...t, you])
    setText(""); setFiles([])
    try {
      const fd = new FormData()
      fd.set("prompt", prompt)
      fd.set("shape", shape)
      if (editing && lastImage?.image) fd.set("current", dataUrlToBlob(lastImage.image), "current.png")
      for (const f of attached) fd.append("attach", await shrink(f), f.name)
      const res  = await fetch("/api/photo-prep/create", { method: "POST", body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`)
      setTurns(t => [...t, {
        id: crypto.randomUUID(), who: "ai",
        image: json.image ? `data:${json.mimeType ?? "image/png"};base64,${json.image}` : undefined,
        text: json.text,
      }])
      if (json.image) setChangeLast(true)
    } catch (e: any) {
      setTurns(t => [...t, { id: crypto.randomUUID(), who: "ai", error: e?.message ?? "Something went wrong" }])
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  let n = 0
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
        For posters, banners and social posts. The AI redraws anything you give it, so never use a picture from here as a lot photo — it is no longer a true picture of the item. What you type and attach is sent to Google; nothing is saved in the Hub, so download what you want to keep.
      </div>

      {/* The conversation */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0d0f1a] p-4 min-h-[300px] space-y-4">
        {turns.length === 0 && (
          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
            <p>Say what you&rsquo;d like made. Put in the real details — dates, sale names, wording — the AI won&rsquo;t make them up. Some ideas:</p>
            {IDEAS.map(i => (
              <button key={i} onClick={() => setText(i)} className="block text-left w-full rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 hover:border-[#0078D4] text-gray-800 dark:text-gray-200">
                {i}
              </button>
            ))}
          </div>
        )}
        {turns.map(t => t.who === "you" ? (
          <div key={t.id} className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl bg-[#0078D4] text-white px-4 py-2 text-sm whitespace-pre-wrap">
              {t.text}
              {t.thumbs.length > 0 && (
                <div className="flex gap-2 mt-2">{t.thumbs.map((u, i) => <img key={i} src={u} alt="" className="h-14 w-14 object-cover rounded" />)}</div>
              )}
            </div>
          </div>
        ) : (
          <div key={t.id} className="flex">
            <div className="max-w-[90%] space-y-2">
              {t.error && <p className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm px-3 py-2">⚠ {t.error}</p>}
              {t.image && (() => { const k = ++n; return (
                <div className="space-y-2">
                  <img src={t.image} alt={`Picture ${k}`} className="max-h-[70vh] max-w-full rounded-lg border border-gray-200 dark:border-gray-800" />
                  <button onClick={() => download(t.image!, k)} className={`${BTN} bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700`}>⬇ Download picture {k}</button>
                </div>
              ) })()}
              {t.text && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{t.text}</p>}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">Drawing it — usually 10–40 seconds…</p>}
        <div ref={endRef} />
      </div>

      {/* The box */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0d0f1a] p-4 space-y-3">
        {lastImage ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button onClick={() => setChangeLast(true)} className={`px-3 min-h-[40px] rounded-lg border ${changeLast ? "border-[#0078D4] text-[#0078D4] bg-[#0078D4]/10" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"}`}>✏ Change the last picture</button>
            <button onClick={() => setChangeLast(false)} className={`px-3 min-h-[40px] rounded-lg border ${!changeLast ? "border-[#0078D4] text-[#0078D4] bg-[#0078D4]/10" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"}`}>✨ Start a new one</button>
          </div>
        ) : null}
        {!editing && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-gray-600 dark:text-gray-400">Shape</span>
            {SHAPES.map(s => (
              <button key={s.key} onClick={() => setShape(s.key)} className={`px-3 min-h-[40px] rounded-lg border ${shape === s.key ? "border-[#0078D4] text-[#0078D4] bg-[#0078D4]/10" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"}`}>{s.label}</button>
            ))}
          </div>
        )}
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={editing ? "What should change? e.g. make the title bigger, add 'Viewing from 9am'" : "Describe the poster, banner or post you want…"}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#0b0d17] text-gray-900 dark:text-gray-100 px-3 py-2 text-sm" />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-300">
                🖼 {f.name}
                <button onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} className="ml-1 text-gray-500 hover:text-red-500" aria-label={`Remove ${f.name}`}>✕</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={send} disabled={busy || !text.trim()} className={`${BTN} bg-[#0078D4] text-white hover:bg-[#006abc]`}>{busy ? "Drawing…" : editing ? "Change it" : "Make it"}</button>
          <button onClick={() => fileRef.current?.click()} disabled={files.length >= 4} className={`${BTN} border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300`}>📎 Attach a picture</button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden
            onChange={e => { const add = [...(e.target.files ?? [])]; setFiles(fs => [...fs, ...add].slice(0, 4)); e.target.value = "" }} />
          <span className="text-xs text-gray-500 dark:text-gray-400">Up to 4 — a photo, the logo, or a style to copy. You can paste one in too.</span>
          {turns.length > 0 && (
            <button onClick={() => { if (window.confirm("Clear this conversation? Pictures you haven't downloaded will be gone.")) { setTurns([]); setChangeLast(true) } }}
              disabled={busy} className={`${BTN} ml-auto text-gray-500 dark:text-gray-400 hover:text-red-600`}>Clear</button>
          )}
        </div>
      </div>
    </div>
  )
}
