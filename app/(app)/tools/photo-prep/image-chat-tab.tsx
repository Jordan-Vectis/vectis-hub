"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// Photo Prep → 💬 Image chat (2026-09-29, Jordan: "a nano banana chat bot where I can ask it to make
// me posters etc"). Type what you want, optionally attach pictures (a lot photo, the logo, a style
// to copy), get a picture back, keep asking for changes, download the one you like.
//
// ⚠ EVERY CHAT SAVES ITSELF as it goes (Jordan: "Can we save chats?") and is PRIVATE to the person
// who made it — the list on the left is only ever your own. The server keeps the conversation and
// the pictures (see app/api/photo-prep/create and lib/image-chat.ts); this tab just shows them.
// ⚠ For MARKETING pictures. The model redraws what it is given, so a lot photo that comes out of here
// is no longer evidence of the item's condition — never use one as a catalogue photo.

type Turn =
  | { who: "you"; text: string; thumbs: string[] }
  | { who: "ai";  image?: string; text?: string; error?: string }
type ChatRow = { id: string; title: string; updatedAt: string }

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

const BTN  = "min-h-[44px] px-4 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
const PILL = (on: boolean) => `px-3 min-h-[40px] rounded-lg border text-sm ${on ? "border-[#0078D4] text-[#0078D4] bg-[#0078D4]/10" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"}`
const CARD = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0d0f1a]"

const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

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

// Same approach as the AI edit tab: the share sheet first on phones (that's how "Save Image" reaches
// Photos on iOS), then a Blob download from an anchor that is actually in the document. The picture
// comes through the Hub, so fetch() works without any CORS rule on the bucket.
async function download(url: string, n: number) {
  const blob = await (await fetch(url)).blob()
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
  const [chats, setChats]     = useState<ChatRow[] | null>(null)
  const [listErr, setListErr] = useState<string | null>(null)
  const [chatId, setChatId]   = useState<string | null>(null)
  const [turns, setTurns]     = useState<Turn[]>([])
  const [opening, setOpening] = useState<string | null>(null)
  const [text, setText]       = useState("")
  const [shape, setShape]     = useState<string>("portrait")
  const [files, setFiles]     = useState<File[]>([])
  const [busy, setBusy]       = useState(false)
  const [changeLast, setChangeLast] = useState(true)
  const sending = useRef(false)
  const endRef  = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const hasImage = turns.some(t => t.who === "ai" && t.image)
  const editing  = hasImage && changeLast

  const loadList = useCallback(async () => {
    try {
      const res  = await fetch("/api/photo-prep/chats")
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`)
      setChats(json.chats ?? []); setListErr(null)
    } catch (e: any) { setListErr(e?.message ?? "Couldn't load your chats") }
  }, [])
  useEffect(() => { loadList() }, [loadList])

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

  async function open(id: string) {
    if (busy) return
    setOpening(id)
    try {
      const res  = await fetch(`/api/photo-prep/chats/${id}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`)
      setChatId(json.id); setTurns(json.turns ?? []); setChangeLast(true); setFiles([])
    } catch (e: any) {
      setListErr(e?.message ?? "Couldn't open that chat")
    } finally { setOpening(null) }
  }

  function startNew() {
    if (busy) return
    setChatId(null); setTurns([]); setChangeLast(true); setFiles([]); setText("")
  }

  async function remove(c: ChatRow) {
    if (!window.confirm(`Delete "${c.title}" and its pictures? This can't be undone.`)) return
    try {
      const res = await fetch(`/api/photo-prep/chats/${c.id}`, { method: "DELETE" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`)
      if (chatId === c.id) startNew()
      setChats(cs => (cs ?? []).filter(x => x.id !== c.id))
    } catch (e: any) { setListErr(e?.message ?? "Couldn't delete that chat") }
  }

  async function send() {
    const prompt = text.trim()
    if (!prompt || sending.current) return
    // ⚠ Lit BEFORE the first await, re-entry guarded by a ref (a double tap sent two requests).
    sending.current = true
    setBusy(true)
    const attached = files
    setTurns(t => [...t, { who: "you", text: prompt, thumbs: attached.map(f => URL.createObjectURL(f)) }])
    setText(""); setFiles([])
    try {
      const fd = new FormData()
      fd.set("prompt", prompt)
      fd.set("shape", shape)
      if (chatId) fd.set("chatId", chatId)
      if (editing) fd.set("edit", "1")
      for (const f of attached) fd.append("attach", await shrink(f), f.name)
      const res  = await fetch("/api/photo-prep/create", { method: "POST", body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`)
      // The server's copy of the answer (its request turn is already on screen, with local thumbnails).
      const answer = (json.added ?? [])[1] as Turn | undefined
      if (answer) setTurns(t => [...t, answer])
      if (answer && answer.who === "ai" && answer.image) setChangeLast(true)
      if (!chatId) setChatId(json.chatId)
      loadList()
    } catch (e: any) {
      const msg = String(e?.message ?? "Something went wrong")
      setTurns(t => [...t, { who: "ai", error: /ImageChat|does not exist/i.test(msg) ? "Saved chats need a database update that hasn't been applied here yet." : msg }])
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  let n = 0
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
        For posters, banners and social posts. The AI redraws anything you give it, so never use a picture from here as a lot photo — it is no longer a true picture of the item. What you type and attach is sent to Google. Your chats save as you go, and only you can see them.
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Your saved chats */}
        <aside className={`${CARD} p-3 space-y-2 lg:max-h-[80vh] lg:overflow-y-auto`}>
          <button onClick={startNew} disabled={busy} className={`${BTN} w-full bg-[#0078D4] text-white hover:bg-[#006abc]`}>＋ New chat</button>
          <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 pt-1">Your chats</p>
          {listErr && <p className="text-xs text-red-600 dark:text-red-400">⚠ {listErr}</p>}
          {chats === null && !listErr && <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
          {chats?.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">None yet — your first one saves itself.</p>}
          {chats?.map(c => (
            <div key={c.id} className={`group flex items-start gap-1 rounded-lg border px-2 py-2 ${chatId === c.id ? "border-[#0078D4] bg-[#0078D4]/10" : "border-transparent hover:border-gray-300 dark:hover:border-gray-700"}`}>
              <button onClick={() => open(c.id)} disabled={busy} className="flex-1 min-w-0 text-left min-h-[40px]">
                <span className="block text-sm text-gray-900 dark:text-gray-100 line-clamp-2">{opening === c.id ? "Opening…" : c.title}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{fmtWhen(c.updatedAt)}</span>
              </button>
              <button onClick={() => remove(c)} disabled={busy} aria-label={`Delete ${c.title}`} title="Delete this chat"
                className="shrink-0 w-9 h-9 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">🗑</button>
            </div>
          ))}
        </aside>

        <div className="flex flex-col gap-4 min-w-0">
          {/* The conversation */}
          <div className={`${CARD} p-4 min-h-[300px] space-y-4`}>
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
            {turns.map((t, i) => t.who === "you" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl bg-[#0078D4] text-white px-4 py-2 text-sm whitespace-pre-wrap">
                  {t.text}
                  {t.thumbs.length > 0 && (
                    <div className="flex gap-2 mt-2">{t.thumbs.map((u, j) => <img key={j} src={u} alt="" className="h-14 w-14 object-cover rounded" />)}</div>
                  )}
                </div>
              </div>
            ) : (
              <div key={i} className="flex">
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
          <div className={`${CARD} p-4 space-y-3`}>
            {hasImage && (
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setChangeLast(true)}  className={PILL(changeLast)}>✏ Change the last picture</button>
                <button onClick={() => setChangeLast(false)} className={PILL(!changeLast)}>✨ Make a new one in this chat</button>
              </div>
            )}
            {!editing && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-600 dark:text-gray-400">Shape</span>
                {SHAPES.map(s => <button key={s.key} onClick={() => setShape(s.key)} className={PILL(shape === s.key)}>{s.label}</button>)}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
