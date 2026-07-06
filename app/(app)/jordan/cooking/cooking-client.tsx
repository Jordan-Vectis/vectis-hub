"use client"

import { useRef, useState } from "react"
import ChatPanel from "../chat-panel"
import ModelPicker, { getJordanModel } from "../model-picker"

// 03 · COOKING — two tools in one: the Air Fryer Converter (photo → settings)
// and a cooking-expert chat.

const GREEN = "#33ff66"

type AirfryerResult = {
  food: string; state: string; tempC: number; time: string
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
