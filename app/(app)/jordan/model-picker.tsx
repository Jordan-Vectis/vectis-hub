"use client"

import { useEffect, useState } from "react"

// Model selector for the secret menu's AI tools. The choice is stored per
// browser and read at send-time by the chat panel + air fryer converter;
// blank = the configured default for the jordan_fun slot (Admin → AI Models).
// Options come from /api/auction-ai/models, which already respects the
// enable/disable toggles in Auction AI → Models.

export const JORDAN_MODEL_KEY = "jordan_ai_model"

export function getJordanModel(): string {
  try { return localStorage.getItem(JORDAN_MODEL_KEY) ?? "" } catch { return "" }
}

export default function ModelPicker() {
  const [models, setModels] = useState<string[]>([])
  const [value, setValue] = useState("")

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) setValue(getJordanModel()) })
    fetch("/api/auction-ai/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && Array.isArray(d?.models)) setModels(d.models) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  function pick(v: string) {
    setValue(v)
    try {
      if (v) localStorage.setItem(JORDAN_MODEL_KEY, v)
      else localStorage.removeItem(JORDAN_MODEL_KEY)
    } catch {}
  }

  return (
    <label className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest opacity-70 hover:opacity-100 transition-opacity">
      MODEL
      <select
        value={value}
        onChange={(e) => pick(e.target.value)}
        className="bg-black border border-[#1f5c33] rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:border-[#33ff66] max-w-[14rem]"
        style={{ color: "#33ff66" }}
      >
        <option value="">AUTO (default)</option>
        {models.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </label>
  )
}
