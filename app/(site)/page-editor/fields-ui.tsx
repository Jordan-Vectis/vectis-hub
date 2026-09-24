"use client"

// The page editor's own field controls — a colour picker, a picture picker that uploads to the
// Hub, and a department picker. Editor-only: the site never renders these (it imports this file
// only as a reference from the blocks' field lists).

import { useEffect, useRef, useState } from "react"
import { FieldLabel } from "@puckeditor/core"
import { HEX, SWATCHES, pictureSrc } from "./look"

type CustomProps<V> = {
  field: { label?: string }
  name: string
  id: string
  value: V
  onChange: (value: V) => void
  readOnly?: boolean
}

// ── Colour ──────────────────────────────────────────────────────────────────
// Swatches of the site's colours first; then the browser's picker or a typed hex. "None" clears it
// (the block then uses its automatic colour — light words on a dark background and the reverse).
export function ColourFieldUI({ field, value, onChange, readOnly }: CustomProps<string>) {
  const v = typeof value === "string" ? value : ""
  const [typed, setTyped] = useState(v)
  useEffect(() => setTyped(v), [v])
  return (
    <FieldLabel label={field.label ?? "Colour"} el="div" readOnly={readOnly}>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange("")}
          title="None — use the automatic colour"
          className={`h-7 px-2 rounded-full border text-[10px] font-bold ${v === "" ? "border-[#32348A] ring-2 ring-[#32348A]/30 text-[#32348A]" : "border-gray-300 text-gray-500"}`}
        >
          Auto
        </button>
        {SWATCHES.map(s => (
          <button
            key={s.hex}
            type="button"
            disabled={readOnly}
            title={s.name}
            onClick={() => onChange(s.hex)}
            className={`h-7 w-7 rounded-full border-2 ${v === s.hex ? "border-[#32348A] ring-2 ring-[#32348A]/30" : "border-gray-200"}`}
            style={{ background: s.hex }}
          />
        ))}
        <label className="relative h-7 w-7 rounded-full border-2 border-dashed border-gray-300 overflow-hidden cursor-pointer" title="Any colour">
          <input type="color" disabled={readOnly} value={HEX.test(v) ? v : "#ffffff"} onChange={e => onChange(e.target.value.toLowerCase())} className="absolute -inset-2 w-[200%] h-[200%] cursor-pointer" />
        </label>
        <input
          value={typed}
          disabled={readOnly}
          onChange={e => { const t = e.target.value.trim().toLowerCase(); setTyped(t); if (HEX.test(t)) onChange(t) }}
          placeholder="#rrggbb"
          maxLength={7}
          className="w-20 border border-gray-300 rounded px-2 py-1 text-xs font-mono"
        />
      </div>
    </FieldLabel>
  )
}

// ── Picture ─────────────────────────────────────────────────────────────────
// Upload a picture into the Hub's storage (straight to it, on a signed address — the same way the
// Banner Manager does), or paste a web address. The value kept is the storage key or the address.
export function PictureFieldUI({ field, value, onChange, readOnly }: CustomProps<string>) {
  const v = typeof value === "string" ? value : ""
  const fileRef = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [pct, setPct] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pasted, setPasted] = useState(/^https?:\/\//i.test(v) ? v : "")
  const src = pictureSrc(v)

  async function upload(file: File) {
    if (busy.current) return
    busy.current = true
    setError(null)
    setPct(0)
    try {
      const res = await fetch("/api/website/page-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error ?? `Couldn't get an upload address (${res.status})`)
      // XHR rather than fetch so the upload can report how far it has got — the size is known, so
      // the percentage is a real one.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", j.url)
        xhr.setRequestHeader("Content-Type", j.contentType ?? file.type)
        xhr.upload.onprogress = e => { if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100)) }
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage refused the picture (${xhr.status})`)))
        xhr.onerror = () => reject(new Error("The upload was cut off — check the connection and try again"))
        xhr.send(file)
      })
      onChange(j.key)
      setPasted("")
    } catch (e: any) {
      setError(e?.message ?? "The picture couldn't be uploaded")
    } finally {
      setPct(null)
      busy.current = false
    }
  }

  return (
    <FieldLabel label={field.label ?? "Picture"} el="div" readOnly={readOnly}>
      <div className="space-y-2">
        <div className="relative w-full h-28 rounded border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
          {src ? <img src={src} alt="" className="absolute inset-0 w-full h-full object-contain" /> : <span className="text-[11px] text-gray-400">No picture</span>}
          {pct !== null && (
            <div className="absolute inset-0 bg-white/85 flex flex-col items-center justify-center gap-1">
              <span className="text-xs font-bold text-[#32348A]">Uploading… {pct}%</span>
              <div className="w-3/4 h-1.5 bg-gray-200 rounded"><div className="h-1.5 bg-[#32348A] rounded" style={{ width: `${pct}%` }} /></div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={readOnly || pct !== null} onClick={() => fileRef.current?.click()} className="px-3 py-1.5 rounded bg-[#32348A] text-white text-xs font-bold disabled:opacity-50">
            {src ? "Change picture" : "Upload a picture"}
          </button>
          {src && (
            <button type="button" disabled={readOnly} onClick={() => { onChange(""); setPasted("") }} className="px-3 py-1.5 rounded border border-gray-300 text-xs font-bold text-gray-600">
              Remove
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f) }} />
        <input
          value={pasted}
          disabled={readOnly}
          onChange={e => { const t = e.target.value; setPasted(t); if (/^https?:\/\/\S+$/i.test(t.trim())) onChange(t.trim()) }}
          placeholder="…or paste a picture's web address"
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs"
        />
        {error && <p className="text-[11px] text-red-700">⚠ {error}</p>}
      </div>
    </FieldLabel>
  )
}

// ── Department ──────────────────────────────────────────────────────────────
// The departments collected from vectis.co.uk (Databases → Departments), for the blocks that show a
// department's highlighted lots, news or past auctions.
let deptCache: Promise<{ slug: string; name: string }[]> | null = null
function loadDepartments() {
  if (!deptCache) {
    deptCache = fetch("/api/website/departments")
      .then(r => (r.ok ? r.json() : { departments: [] }))
      .then(j => (Array.isArray(j?.departments) ? j.departments : []))
      .catch(() => { deptCache = null; return [] })
  }
  return deptCache
}

export function DepartmentFieldUI({ field, value, onChange, readOnly }: CustomProps<string>) {
  const [list, setList] = useState<{ slug: string; name: string }[] | null>(null)
  useEffect(() => { let live = true; loadDepartments().then(l => { if (live) setList(l) }); return () => { live = false } }, [])
  return (
    <FieldLabel label={field.label ?? "Department"} el="div" readOnly={readOnly}>
      {list === null ? (
        <p className="text-xs text-gray-400">Loading the departments…</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-amber-700">No departments are held yet — load them at Databases → Departments.</p>
      ) : (
        <select value={value ?? ""} disabled={readOnly} onChange={e => onChange(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
          <option value="">— choose a department —</option>
          {list.map(d => <option key={d.slug} value={d.slug}>{d.name}</option>)}
        </select>
      )}
    </FieldLabel>
  )
}
