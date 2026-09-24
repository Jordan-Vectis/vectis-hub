"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Puck, type Data } from "@puckeditor/core"
import "@puckeditor/core/no-external.css"
import "../../../../(site)/site.css"
import "./editor.css"
import { editorConfig } from "./editor-config"
import {
  deleteSitePage, discardSitePageDraft, getSitePageVersion, listSitePageVersions, publishSitePage, saveSitePageDraft, sitePageSeed, unpublishSitePage,
  type VersionRow,
} from "@/lib/actions/site-pages"

// The page editor for ONE page of the test website (Website → Pages → Edit). Puck does the
// dragging and the fields; this adds what the Hub needs around it:
//  • every change saves itself as a DRAFT a moment after you stop (the site doesn't change);
//  • Publish puts the page live and keeps a copy in its history;
//  • History loads any earlier publish back into the editor; "Start again" loads the built-in
//    design; "Take off the site" gives the site its built-in design back.
// The status line always says what has happened — saved, publishing, live, or what went wrong.

type Status = { kind: "idle" | "saving" | "saved" | "publishing" | "published" | "error"; text: string }

export type EditorProps = {
  slug: string
  path: string
  title: string
  initialData: Data
  live: boolean
  publishedAt: string | null
  builtIn: boolean
  startedFrom: "draft" | "published" | "built-in" | "new"
}

const clock = (iso: string) => new Date(iso).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", timeZone: "Europe/London" })

export default function PageEditor({ slug, path, title, initialData, live: initiallyLive, publishedAt, builtIn, startedFrom }: EditorProps) {
  const router = useRouter()
  const [data, setData] = useState<Data>(initialData)
  const [mount, setMount] = useState(0)            // remounts Puck when a different version is loaded
  const [live, setLive] = useState(initiallyLive)
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    text: startedFrom === "draft" ? "Your saved draft is open."
      : startedFrom === "published" ? `This is the live version${publishedAt ? ` (published ${clock(publishedAt)})` : ""}.`
      : startedFrom === "new" ? "New page — it isn't on the site until you publish it."
      : "Starting from the page's built-in design — the site doesn't change until you publish.",
  })
  const latest = useRef<Data>(initialData)
  const dirty = useRef(false)
  const saving = useRef(false)
  const publishing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The More menu is drawn OUTSIDE Puck's header, at a fixed spot under its button: inside the header
  // it was clipped and the header just grew a scrollbar (found testing on the sandbox, 2026-09-24).
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null)
  const moreButton = useRef<HTMLButtonElement | null>(null)
  const openMenu = () => {
    const r = moreButton.current?.getBoundingClientRect()
    setMenu(m => (m || !r ? null : { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }))
  }
  useEffect(() => {
    if (!menu) return
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null) }
    window.addEventListener("keydown", esc)
    return () => window.removeEventListener("keydown", esc)
  }, [menu])
  const [history, setHistory] = useState<VersionRow[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const saveDraft = useCallback(async () => {
    if (saving.current || publishing.current) { timer.current = setTimeout(() => void saveDraft(), 800); return }
    if (!dirty.current) return
    saving.current = true
    dirty.current = false
    setStatus({ kind: "saving", text: "Saving the draft…" })
    const res = await saveSitePageDraft(slug, latest.current)
    saving.current = false
    if (res.ok) setStatus({ kind: "saved", text: `Draft saved ${clock(res.at)} — the site changes only when you publish.` })
    else { dirty.current = true; setStatus({ kind: "error", text: `Couldn't save the draft — ${res.error}` }) }
  }, [slug])

  const onChange = useCallback((d: Data) => {
    latest.current = d
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void saveDraft(), 1500)
    setStatus(s => (s.kind === "saving" ? s : { kind: "idle", text: "Changes not saved yet…" }))
  }, [saveDraft])

  // Leaving with a draft still to save asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current || saving.current || publishing.current) { e.preventDefault(); e.returnValue = "" } }
    window.addEventListener("beforeunload", warn)
    return () => { window.removeEventListener("beforeunload", warn); if (timer.current) clearTimeout(timer.current) }
  }, [])

  async function publish(d: Data) {
    if (publishing.current) return
    publishing.current = true
    if (timer.current) clearTimeout(timer.current)
    latest.current = d
    setStatus({ kind: "publishing", text: "Publishing…" })
    const res = await publishSitePage(slug, d)
    publishing.current = false
    if (res.ok) {
      dirty.current = false
      setLive(true)
      setStatus({ kind: "published", text: `Published ${clock(res.at)} — this is what the site shows now.` })
    } else {
      dirty.current = true
      setStatus({ kind: "error", text: `Couldn't publish — ${res.error}` })
    }
  }

  // Put different blocks in the editor (an earlier version, or the built-in design) and save them as the draft.
  function load(d: Data, text: string) {
    latest.current = d
    setData(d)
    setMount(m => m + 1)
    dirty.current = true
    setStatus({ kind: "idle", text })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void saveDraft(), 300)
  }

  async function discard() {
    setMenu(null)
    if (!confirm(live
      ? "Throw away the changes that aren't published? The editor goes back to what the site shows now."
      : "Throw away this draft? The editor goes back to the page's built-in design, which is what the site shows.")) return
    if (timer.current) clearTimeout(timer.current)
    const res = await discardSitePageDraft(slug)
    if (res.ok) { dirty.current = false; window.location.reload() }
    else setStatus({ kind: "error", text: `Couldn't throw the draft away — ${res.error}` })
  }

  async function startAgain() {
    setMenu(null)
    if (!confirm("Replace what's in the editor with the page's built-in design? Your draft is replaced; the live page doesn't change until you publish.")) return
    setStatus({ kind: "saving", text: "Loading the built-in design…" })
    const res = await sitePageSeed(slug)
    if (res.ok) load(res.data as Data, "The built-in design is loaded — publish to put it on the site.")
    else setStatus({ kind: "error", text: `Couldn't load the built-in design — ${res.error}` })
  }

  async function takeOff() {
    setMenu(null)
    if (!confirm("Take the edited version off the site? The page goes back to its built-in design. Your draft and history are kept.")) return
    const res = await unpublishSitePage(slug)
    if (res.ok) { setLive(false); setStatus({ kind: "saved", text: "Taken off the site — it shows the built-in design again. Your draft is kept here." }) }
    else setStatus({ kind: "error", text: `Couldn't take it off — ${res.error}` })
  }

  async function remove() {
    setMenu(null)
    if (!confirm(`Delete this page (${path}) and its history? This can't be undone.`)) return
    const res = await deleteSitePage(slug)
    if (res.ok) { dirty.current = false; router.push("/website/pages") }
    else setStatus({ kind: "error", text: `Couldn't delete it — ${res.error}` })
  }

  async function openHistory() {
    setMenu(null)
    setHistory([])
    setHistoryError(null)
    const res = await listSitePageVersions(slug)
    if (res.ok) setHistory(res.versions)
    else setHistoryError(res.error)
  }

  async function restore(v: VersionRow) {
    const res = await getSitePageVersion(v.id)
    if (!res.ok) { setHistoryError(res.error); return }
    setHistory(null)
    load(res.data as Data, `The version published ${clock(v.publishedAt)}${v.publishedBy ? ` by ${v.publishedBy}` : ""} is loaded — publish to put it back on the site.`)
  }

  const statusColour =
    status.kind === "error" ? "text-red-700" :
    status.kind === "published" ? "text-green-700" :
    status.kind === "saved" ? "text-gray-600" :
    status.kind === "saving" || status.kind === "publishing" ? "text-[#32348A]" : "text-amber-700"

  return (
    <div className="page-editor-light relative" style={{ height: "calc(100vh - 56px)" }}>
      <Puck
        key={mount}
        config={editorConfig}
        data={data}
        onChange={onChange}
        onPublish={publish}
        headerTitle={title}
        headerPath={path}
        height="100%"
        iframe={{ enabled: true }}
        viewports={[
          { width: 390, height: "auto", label: "Phone", icon: "Smartphone" },
          { width: 834, height: "auto", label: "Tablet", icon: "Tablet" },
          { width: 1440, height: "auto", label: "Computer", icon: "Monitor" },
        ]}
        overrides={{
          headerActions: ({ children }) => (
            <div className="flex items-center gap-2">
              <span className={`hidden lg:inline max-w-[420px] truncate text-xs font-semibold ${statusColour}`} title={status.text}>{status.text}</span>
              <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${live ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                {live ? "Live" : builtIn ? "Built-in design on the site" : "Not on the site"}
              </span>
              <a href={path} target="_blank" rel="noreferrer" className="rounded border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-700 hover:border-[#32348A]">View on site ↗</a>
              <button ref={moreButton} type="button" onClick={openMenu} className="rounded border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-700 hover:border-[#32348A]">More ▾</button>
              {children}
            </div>
          ),
        }}
      />

      {menu && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setMenu(null)} />
          <div className="fixed z-[95] w-72 rounded border border-gray-200 bg-white py-1 text-left text-gray-800 shadow-lg" style={{ top: menu.top, right: menu.right }}>
            <button type="button" onClick={openHistory} className="block w-full px-4 py-2 text-left text-xs hover:bg-gray-50">🕘 History — earlier published versions</button>
            {(builtIn || live) && <button type="button" onClick={discard} className="block w-full px-4 py-2 text-left text-xs hover:bg-gray-50">✕ Throw away the unpublished changes</button>}
            {builtIn && <button type="button" onClick={startAgain} className="block w-full px-4 py-2 text-left text-xs hover:bg-gray-50">↺ Start again from the built-in design</button>}
            {builtIn && live && <button type="button" onClick={takeOff} className="block w-full px-4 py-2 text-left text-xs hover:bg-gray-50">⤺ Take the edited version off the site</button>}
            {!builtIn && <button type="button" onClick={remove} className="block w-full px-4 py-2 text-left text-xs text-red-700 hover:bg-red-50">🗑 Delete this page</button>}
            <a href="/website/pages" className="block w-full px-4 py-2 text-left text-xs hover:bg-gray-50">← All pages</a>
          </div>
        </>
      )}

      {/* On a narrow screen the status line has no room in the header — it sits over the canvas instead. */}
      <div className={`lg:hidden absolute bottom-2 left-2 right-2 z-40 rounded bg-white/95 px-3 py-2 text-xs font-semibold shadow ${statusColour}`}>{status.text}</div>

      {history && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={() => setHistory(null)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-black text-gray-900">History — every time this page was published</h2>
              <button type="button" onClick={() => setHistory(null)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            {historyError ? (
              <p className="text-sm text-red-700">⚠ {historyError}</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing published yet — the history starts with the first Publish.</p>
            ) : (
              <ul className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto">
                {history.map((v, i) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-gray-700">{clock(v.publishedAt)}{v.publishedBy ? ` · ${v.publishedBy}` : ""}{i === 0 && live ? " · live now" : ""}</span>
                    <button type="button" onClick={() => void restore(v)} className="rounded border border-gray-300 px-3 py-1 text-xs font-bold text-gray-700 hover:border-[#32348A]">Load into the editor</button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-gray-500">Loading a version replaces what's in the editor and saves it as your draft. The site changes only when you publish.</p>
          </div>
        </div>
      )}
    </div>
  )
}
