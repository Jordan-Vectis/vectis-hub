"use client"

import { useRef, useState } from "react"
import { EDIT_PRESETS, ASPECTS, GROW, DIRECTIONS, type EditPreset } from "@/lib/photo-edit-presets"

// Photo Prep → AI Edit. Drop photos in, pick a preset, keep what you like.
//
// ⚠ Deliberately SEPARATE from the main Prepare tab, which crops and brightens
// entirely on this computer and uploads nothing. This tab DOES send the photo
// it's editing to Google, and says so on screen — keeping the two apart is the
// whole reason it's a tab rather than a step in the run.
//
// ⚠ Every preset fixes the PHOTOGRAPH, never the ITEM — see CONDITION_RULE in
// lib/photo-edit-presets. Bidders bid on these pictures.

type Shot = {
  id:       string
  name:     string
  file:     File
  url:      string          // object URL of the original
  edited?:  string          // data URL of the result
  busy?:    boolean
  error?:   string
  preset?:  string          // which preset produced `edited`
}

const BTN  = "px-3 py-2 text-sm font-medium rounded-lg border transition-colors"
const CARD = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0d0f1a]"

const GROUPS: EditPreset["group"][] = ["Framing", "Background", "Light", "Quality"]

function Pills({ label, options, value, onPick }: {
  label:   string
  options: readonly { key: string; label: string }[]
  value:   string
  onPick:  (key: string) => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-600 dark:text-gray-400 w-full sm:w-16 sm:shrink-0">{label}</span>
      {options.map(o => (
        <button key={o.key} onClick={() => onPick(o.key)}
          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
            value === o.key ? "border-[#0078D4] text-[#0078D4] bg-[#0078D4]/10"
                            : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400"}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function AiEditTab() {
  const [shots, setShots]     = useState<Shot[]>([])
  const [selId, setSelId]     = useState<string | null>(null)
  const [preset, setPreset]   = useState<string>("extend")
  const [aspect, setAspect]   = useState<string>("keep")
  const [grow, setGrow]       = useState<string>("some")
  const [dir, setDir]         = useState<string>("all")
  const [extra, setExtra]     = useState("")
  const [compare, setCompare] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  const sel     = shots.find(s => s.id === selId) ?? null
  const chosen  = EDIT_PRESETS.find(p => p.key === preset)
  const anyEdit = shots.some(s => s.edited)

  function addFiles(list: FileList | File[] | null) {
    const pics = [...(list ?? [])].filter(f => f.type.startsWith("image/"))
    if (pics.length === 0) return
    const next: Shot[] = pics.map((file, i) => ({
      id:   `${Date.now()}-${i}-${file.name}`,
      name: file.name,
      file,
      url:  URL.createObjectURL(file),
    }))
    setShots(prev => [...prev, ...next])
    setSelId(prev => prev ?? next[0].id)
  }

  function patch(id: string, changes: Partial<Shot>) {
    setShots(prev => prev.map(s => (s.id === id ? { ...s, ...changes } : s)))
  }

  async function runEdit() {
    if (!sel || sel.busy) return
    patch(sel.id, { busy: true, error: undefined })
    try {
      const fd = new FormData()
      fd.append("image", sel.file, sel.name)
      fd.append("preset", preset)
      fd.append("aspect", aspect)
      fd.append("grow", grow)
      fd.append("direction", dir)
      fd.append("extra", extra)
      const res  = await fetch("/api/photo-prep/edit", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok || json.error) {
        patch(sel.id, { busy: false, error: json.error ?? "Edit failed" })
        return
      }
      patch(sel.id, {
        busy: false,
        edited: `data:${json.mimeType};base64,${json.image}`,
        preset,
      })
    } catch (e: any) {
      patch(sel.id, { busy: false, error: e?.message ?? "Edit failed" })
    }
  }

  // Keep the original filename — Photo Prep's whole promise is that names don't
  // change — with a suffix so an edit can't silently overwrite the original.
  //
  // ⚠ MOBILE: the button used to do nothing on a phone. It set `href` to the
  // data: URL and clicked a detached anchor — iOS Safari ignores `download` on a
  // data: URL, and some browsers won't act on an anchor that isn't in the DOM.
  // So: turn it into a Blob, offer the share sheet first (that's how you get
  // "Save Image" into Photos on iOS), and fall back to a real object-URL anchor
  // that IS in the document.
  async function download(shot: Shot, allowShare = true) {
    if (!shot.edited) return
    const dot  = shot.name.lastIndexOf(".")
    const stem = dot > 0 ? shot.name.slice(0, dot) : shot.name
    const blob = await (await fetch(shot.edited)).blob()
    const name = `${stem}-edited.${blob.type === "image/png" ? "png" : "jpg"}`

    const nav = navigator as Navigator & { canShare?: (d: any) => boolean }
    if (allowShare && typeof nav.share === "function") {
      const file = new File([blob], name, { type: blob.type })
      if (nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file] }); return }
        // Cancelling the share sheet is a decision, not a failure — don't then
        // fire a download they just backed out of.
        catch (e: any) { if (e?.name === "AbortError") return }
      }
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  // Never the share sheet here — one sheet per photo would be unusable.
  async function downloadAll() {
    for (const s of shots) if (s.edited) await download(s, false)
  }

  return (
    <div className="space-y-4">

      <div className={`${CARD} p-4`}>
        <div className="flex items-center gap-3 flex-wrap">
          <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { addFiles(e.target.files); e.target.value = "" }} />
          <button onClick={() => inputRef.current?.click()}
            className="px-4 py-2 bg-[#0078D4] hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors">
            🖼 Choose photos
          </button>
          {shots.length > 0 && (
            <>
              <span className="text-sm text-gray-600 dark:text-gray-400">{shots.length} loaded</span>
              {anyEdit && (
                <button onClick={downloadAll} className={`${BTN} border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300`}>
                  ⬇ Download all edited
                </button>
              )}
              <button onClick={() => { setShots([]); setSelId(null) }}
                className="ml-auto text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                Clear
              </button>
            </>
          )}
        </div>
        <p className="text-xs text-amber-600 dark:text-amber-500 mt-2">
          ⚠ Photos on this tab <span className="font-semibold">are sent to Google</span> to be edited — unlike the Prepare tab, which never uploads anything.
          Results carry an invisible AI watermark. Edits change the photo, never the item: scratches, chips, wear and damage are always left as they are.
        </p>
      </div>

      {shots.length === 0 ? (
        <div className={`${CARD} p-12 text-center`}>
          <p className="text-3xl mb-2">🎨</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Choose some photos to edit.</p>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-start">

          {/* Filmstrip */}
          <div className={`${CARD} p-2 flex gap-2 overflow-x-auto md:w-44 md:shrink-0 md:block md:space-y-2 md:max-h-[70vh] md:overflow-y-auto md:overflow-x-visible`}>
            {shots.map(s => (
              <button key={s.id} onClick={() => setSelId(s.id)}
                className={`w-28 shrink-0 md:w-full text-left rounded-lg overflow-hidden border transition-colors ${
                  selId === s.id ? "border-[#0078D4]" : "border-transparent hover:border-gray-300 dark:hover:border-gray-700"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.edited ?? s.url} alt="" className="w-full h-24 object-cover" />
                <span className="block px-1.5 py-1 text-[11px] truncate text-gray-600 dark:text-gray-400">
                  {s.edited && <span className="text-green-500">✓ </span>}{s.name}
                </span>
              </button>
            ))}
          </div>

          {/* Editor */}
          <div className="flex-1 min-w-0 space-y-3">
            {sel && (
              <>
                <div className={`${CARD} p-3`}>
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{sel.name}</span>
                    {sel.edited && (
                      <>
                        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                          <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)}
                            className="w-3.5 h-3.5 accent-[#0078D4]" />
                          Show before &amp; after
                        </label>
                        <button onClick={() => download(sel)} className={`${BTN} !py-1.5 border-green-600 text-green-600 dark:text-green-400`}>
                          ⬇ Download
                        </button>
                        <button onClick={() => patch(sel.id, { edited: undefined, preset: undefined })}
                          className="text-xs text-gray-500 hover:text-red-500">Discard edit</button>
                      </>
                    )}
                  </div>

                  <div className={sel.edited && compare ? "grid grid-cols-1 sm:grid-cols-2 gap-3" : ""}>
                    {(!sel.edited || compare) && (
                      <figure>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={sel.url} alt="Original" className="w-full max-h-[55vh] object-contain rounded bg-gray-100 dark:bg-black/30" />
                        {sel.edited && compare && <figcaption className="text-[11px] text-gray-500 text-center mt-1">Before</figcaption>}
                      </figure>
                    )}
                    {sel.edited && (
                      <figure>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={sel.edited} alt="Edited" className="w-full max-h-[55vh] object-contain rounded bg-gray-100 dark:bg-black/30" />
                        {compare && <figcaption className="text-[11px] text-gray-500 text-center mt-1">After — {sel.preset}</figcaption>}
                      </figure>
                    )}
                  </div>

                  {sel.error && <p className="text-sm text-red-500 mt-2">{sel.error}</p>}
                </div>

                {/* Presets */}
                <div className={`${CARD} p-4 space-y-3`}>
                  {GROUPS.map(group => (
                    <div key={group}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">{group}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {EDIT_PRESETS.filter(p => p.group === group).map(p => (
                          <button key={p.key} onClick={() => setPreset(p.key)} title={p.blurb}
                            className={`${BTN} !py-1.5 ${preset === p.key
                              ? "border-[#0078D4] text-[#0078D4] bg-[#0078D4]/10"
                              : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400"}`}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  {chosen && <p className="text-xs text-gray-500 dark:text-gray-400">{chosen.blurb}</p>}

                  {chosen?.aspect && (
                    <div className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
                      <Pills label="Direction" options={DIRECTIONS} value={dir}    onPick={setDir} />
                      <Pills label="How much"  options={GROW}       value={grow}  onPick={setGrow} />
                      <Pills label="Shape"     options={ASPECTS}    value={aspect} onPick={setAspect} />
                      <p className="text-[11px] text-gray-500 dark:text-gray-500">
                        The space is added to the picture for real before it's sent, then filled in — so
                        &ldquo;{DIRECTIONS.find(d => d.key === dir)?.label}&rdquo; genuinely gains room on that side.
                        A shape only ever adds more space; it never crops the photo to fit.
                      </p>
                    </div>
                  )}

                  <input value={extra} onChange={e => setExtra(e.target.value)}
                    placeholder="Anything else? e.g. 'the backdrop should be white, not grey' (optional)"
                    className="w-full bg-gray-100 dark:bg-[#151824] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#0078D4]" />

                  <button onClick={runEdit} disabled={sel.busy}
                    className="w-full sm:w-auto px-4 py-2 bg-[#0078D4] hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50">
                    {sel.busy ? "Editing… (up to a minute)" : sel.edited ? "✨ Edit again" : "✨ Edit this photo"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
