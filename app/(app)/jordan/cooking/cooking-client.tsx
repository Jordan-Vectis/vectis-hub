"use client"

import { useEffect, useRef, useState } from "react"
import ChatPanel from "../chat-panel"
import ModelPicker, { getJordanModel } from "../model-picker"

// 03 · COOKING — two tools in one: the Air Fryer Converter (photo → settings)
// and a cooking-expert chat.

const GREEN = "#33ff66"
const PROFILE_KEY = "jordan_airfryer_profile"
const COMMON_MODES = ["Air Fry", "Max Crisp", "Roast", "Bake", "Grill", "Reheat", "Dehydrate", "Frozen", "Fry", "Pizza"]

type AirfryerResult = {
  food: string; state: string; mode: string; tempC: number; time: string
  preheat: boolean; shake: string; safety: string; notes: string; confident: boolean
}

export default function CookingClient() {
  const [tab, setTab] = useState<"airfryer" | "chat">("airfryer")
  const fileInput = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AirfryerResult | null>(null)

  // "My air fryer" profile (persisted per browser).
  const [setupOpen, setSetupOpen] = useState(false)
  const [applianceNotes, setApplianceNotes] = useState("")
  const [modes, setModes] = useState<string[]>([])
  const [modeInput, setModeInput] = useState("")
  const scanInput = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      try {
        const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}")
        if (typeof saved?.notes === "string") setApplianceNotes(saved.notes)
        if (Array.isArray(saved?.modes)) setModes(saved.modes.filter((m: unknown) => typeof m === "string"))
      } catch {}
    })
    return () => { cancelled = true }
  }, [])

  function saveProfile(notes: string, list: string[]) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ notes, modes: list })) } catch {}
  }
  function setNotes(v: string) { setApplianceNotes(v); saveProfile(v, modes) }
  function addMode(raw: string) {
    const m = raw.trim().slice(0, 40)
    if (!m || modes.some((x) => x.toLowerCase() === m.toLowerCase())) { setModeInput(""); return }
    const next = [...modes, m]
    setModes(next); setModeInput(""); saveProfile(applianceNotes, next)
  }
  function removeMode(m: string) {
    const next = modes.filter((x) => x !== m)
    setModes(next); saveProfile(applianceNotes, next)
  }

  async function scanAirFryer(f: File | null) {
    if (!f || scanning) return
    setScanning(true); setScanMsg(null)
    try {
      const fd = new FormData()
      fd.append("image", f)
      const model = getJordanModel()
      if (model) fd.append("model", model)
      const res = await fetch("/api/jordan/airfryer-scan", { method: "POST", body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Couldn't read the air fryer — try a clearer photo of the control panel.")
      const found: string[] = Array.isArray(j.modes) ? j.modes : []
      // Merge new modes in (case-insensitive), keep existing.
      const merged = [...modes]
      for (const m of found) if (!merged.some((x) => x.toLowerCase() === m.toLowerCase())) merged.push(m)
      const nextNotes = j.model && !applianceNotes.trim() ? String(j.model) : applianceNotes
      setModes(merged); setApplianceNotes(nextNotes); saveProfile(nextNotes, merged)
      const added = merged.length - modes.length
      setScanMsg(found.length ? `✓ Found ${found.length} mode${found.length === 1 ? "" : "s"}${added < found.length ? ` (${added} new)` : ""}${j.model ? ` on ${j.model}` : ""}.` : "Couldn't read any modes — add them by hand below.")
    } catch (e: any) {
      setScanMsg("✗ " + (e?.message ?? "Scan failed."))
    } finally {
      setScanning(false)
    }
  }

  function pick(f: File | null) {
    setError(null); setResult(null)
    setFile(f)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(f ? URL.createObjectURL(f) : null)
  }

  async function convert() {
    if (!file || busy) return
    setBusy(true); setError(null); setResult(null)
    try {
      const fd = new FormData()
      fd.append("image", file)
      const model = getJordanModel()
      if (model) fd.append("model", model)
      if (applianceNotes.trim()) fd.append("applianceNotes", applianceNotes.trim())
      if (modes.length) fd.append("applianceModes", JSON.stringify(modes))
      const res = await fetch("/api/jordan/airfryer", { method: "POST", body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Couldn't read that photo — try another.")
      setResult(j)
    } catch (e: any) {
      setError(e?.message ?? "Couldn't read that photo — try another.")
    } finally {
      setBusy(false)
    }
  }

  const tabBtn = (active: boolean) =>
    `px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
      active ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] opacity-60 hover:opacity-100"
    }`
  const suggestable = COMMON_MODES.filter((m) => !modes.some((x) => x.toLowerCase() === m.toLowerCase()))

  return (
    <div className="flex flex-col flex-1 min-h-0 font-mono" style={{ color: GREEN }}>
      <div className="flex gap-2 mb-4 shrink-0">
        <button onClick={() => setTab("airfryer")} className={tabBtn(tab === "airfryer")}>🍟 AIR FRYER CONVERTER</button>
        <button onClick={() => setTab("chat")} className={tabBtn(tab === "chat")}>👨‍🍳 ASK THE CHEF</button>
      </div>

      {tab === "airfryer" && (
        <div className="flex-1 min-h-0 overflow-y-auto border border-[#1f5c33] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm opacity-70">Photograph the food (packaging counts) and get basket-style air-fryer settings back.</p>
            <ModelPicker />
          </div>

          {/* ── My air fryer setup ── */}
          <div className="border border-[#1f5c33] rounded-lg">
            <button onClick={() => setSetupOpen((o) => !o)} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm">
              <span>⚙ MY AIR FRYER {modes.length > 0 || applianceNotes ? <span className="opacity-50">— set up ✓</span> : <span className="opacity-50">— tell it your modes for exact settings</span>}</span>
              <span className="opacity-60">{setupOpen ? "▾" : "▸"}</span>
            </button>
            {setupOpen && (
              <div className="px-3 pb-3 space-y-3 border-t border-[#1f5c33]">
                <div className="pt-3">
                  <label className="block text-[10px] uppercase tracking-widest opacity-60 mb-1">Model / notes (optional)</label>
                  <input value={applianceNotes} onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Ninja Foodi Dual Zone, 2400W"
                    className="w-full bg-black border border-[#1f5c33] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#33ff66] placeholder:text-[#1f5c33]"
                    style={{ color: GREEN }} />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-[10px] uppercase tracking-widest opacity-60">Cooking modes on your machine</label>
                    <button onClick={() => scanInput.current?.click()} disabled={scanning}
                      className="text-[11px] px-2 py-1 rounded border border-[#33ff66] hover:bg-[#0a2214] disabled:opacity-40 transition-colors">
                      {scanning ? "READING…" : "📷 Scan my air fryer"}
                    </button>
                  </div>
                  {scanMsg && <p className={`text-[11px] mb-2 ${scanMsg.startsWith("✗") ? "text-red-400" : "opacity-70"}`}>{scanMsg}</p>}
                  {modes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {modes.map((m) => (
                        <span key={m} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[#33ff66] text-xs">
                          {m}
                          <button onClick={() => removeMode(m)} className="opacity-60 hover:opacity-100 font-bold">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input value={modeInput} onChange={(e) => setModeInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMode(modeInput) } }}
                      placeholder="Type a mode + Enter…"
                      className="flex-1 bg-black border border-[#1f5c33] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#33ff66] placeholder:text-[#1f5c33]"
                      style={{ color: GREEN }} />
                    <button onClick={() => addMode(modeInput)} disabled={!modeInput.trim()}
                      className="px-3 py-2 rounded-lg border border-[#1f5c33] text-xs disabled:opacity-30 hover:border-[#33ff66] transition-colors">ADD</button>
                  </div>
                  {suggestable.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {suggestable.map((m) => (
                        <button key={m} onClick={() => addMode(m)}
                          className="px-2 py-0.5 rounded-lg border border-[#1f5c33] text-[11px] opacity-60 hover:opacity-100 hover:border-[#33ff66] transition-all">+ {m}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <button onClick={() => fileInput.current?.click()} disabled={busy}
              className="px-4 py-2.5 rounded-lg border border-[#33ff66] text-sm font-bold hover:bg-[#0a2214] disabled:opacity-40 transition-colors">
              📷 CHOOSE / TAKE PHOTO
            </button>
            {file && (
              <button onClick={convert} disabled={busy}
                className="px-4 py-2.5 rounded-lg text-sm font-bold text-black disabled:opacity-40 transition-colors"
                style={{ background: GREEN }}>
                {busy ? "ANALYSING…" : "⚡ CONVERT"}
              </button>
            )}
          </div>

          {preview && (
            <img src={preview} alt="Your food" className="max-h-56 rounded-lg border border-[#1f5c33]" />
          )}

          {error && <p className="text-sm text-red-400">✗ {error}</p>}

          {result && (
            <div className="border border-[#33ff66] rounded-xl p-4 space-y-2 text-sm max-w-md">
              <p className="text-xs opacity-60 uppercase tracking-widest">— ANALYSIS COMPLETE —</p>
              <p className="text-base font-bold text-white">{result.food}{result.state && result.state !== "unsure" ? ` (${result.state})` : ""}</p>
              {!result.confident && <p className="text-xs text-amber-400">⚠ Not 100% sure what this is — sanity-check the settings.</p>}
              {result.mode && (
                <div className="border border-[#33ff66] rounded-lg p-3 text-center bg-[#0a2214]">
                  <p className="text-2xl font-bold">{result.mode}</p>
                  <p className="text-[10px] opacity-60 uppercase tracking-widest mt-1">Mode / setting</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="border border-[#1f5c33] rounded-lg p-3 text-center">
                  <p className="text-3xl font-bold">{result.tempC}°C</p>
                  <p className="text-[10px] opacity-60 uppercase tracking-widest mt-1">Temperature</p>
                </div>
                <div className="border border-[#1f5c33] rounded-lg p-3 text-center">
                  <p className="text-3xl font-bold">{result.time}</p>
                  <p className="text-[10px] opacity-60 uppercase tracking-widest mt-1">Minutes</p>
                </div>
              </div>
              <ul className="space-y-1 pt-1">
                {result.preheat && <li>• Preheat first</li>}
                {result.shake && <li>• {result.shake}</li>}
                {result.safety && <li className="text-amber-300">• {result.safety}</li>}
                {result.notes && <li className="opacity-80">• {result.notes}</li>}
              </ul>
            </div>
          )}

          <input ref={fileInput} type="file" accept="image/*" className="hidden"
            onChange={(e) => { pick(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
          <input ref={scanInput} type="file" accept="image/*" className="hidden"
            onChange={(e) => { scanAirFryer(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
        </div>
      )}

      {tab === "chat" && (
        <div className="flex-1 min-h-0 border border-[#1f5c33] rounded-xl p-4">
          <ChatPanel
            mode="cooking"
            storageKey="jordan_cooking_history"
            placeholder="What's for tea? Ask anything cooking…"
            intro={"Recipes, techniques, substitutions, timings, what-to-do-with-what's-in-the-fridge.\nUK measures, real temperatures, air-fryer literate."}
          />
        </div>
      )}
    </div>
  )
}
