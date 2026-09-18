"use client"

import { useEffect, useState } from "react"
import { getJordanModel } from "../model-picker"
import type { SwapOption } from "@/lib/jordan-gym"

// The list of things you could do instead. Shared by the programme view ("swap it for good") and
// the session ("the machine's taken, just for today").
//
// ⚠ The catalogue list appears IMMEDIATELY — same movement pattern, no AI, no waiting. Standing
// at a taken machine watching a spinner is not a feature. The AI list is a deliberate extra tap,
// for when he wants a reasoned answer rather than a name.

const btn = "px-3 py-1.5 text-xs border border-(--j-dim) rounded hover:bg-(--j-glow) transition-colors disabled:opacity-40 disabled:cursor-not-allowed"

type Cat = { slug: string; name: string; equipment: string; perHand: boolean; sessions: number }

export default function SwapPicker({ slug, name, onPick, onClose }: {
  slug: string
  name: string
  onPick: (o: SwapOption) => void
  onClose: () => void
}) {
  const [catalogue, setCatalogue] = useState<Cat[]>([])
  const [options, setOptions] = useState<SwapOption[]>([])
  const [why, setWhy] = useState("")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function ask(ai: boolean) {
    ai ? setBusy(true) : setLoading(true)
    setError(null); setNote(null)
    try {
      const r = await fetch("/api/jordan/gym/swap", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, ai, why, model: ai ? getJordanModel() : "" }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't get a list")
      setCatalogue(j.catalogue ?? [])
      if (ai) setOptions(j.options ?? [])
      if (j.note) setNote(j.note)
    } catch (e: any) { setError(e.message) } finally { setBusy(false); setLoading(false) }
  }

  useEffect(() => { void ask(false) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slug])

  return (
    <div className="border border-(--j-acc) rounded-lg p-3 space-y-3 bg-(--j-box)">
      <div className="flex items-center gap-2">
        <span className="text-xs tracking-widest opacity-60">INSTEAD OF {name.toUpperCase()}</span>
        <button className={`${btn} ml-auto`} onClick={onClose}>CLOSE</button>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      {note && <p className="text-xs opacity-60">{note}</p>}

      {/* The AI's own suggestions, when asked for — each with the one line that matters. */}
      {options.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] tracking-widest opacity-60">THE AI SUGGESTS</span>
          {options.map(o => (
            <button key={o.slug} onClick={() => onPick(o)}
              className="w-full text-left min-h-[52px] px-3 py-2 rounded border border-(--j-dim) hover:bg-(--j-glow)">
              <div className="text-sm font-bold">{o.name}</div>
              {o.why && <div className="text-[11px] opacity-60">{o.why}</div>}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <span className="text-[10px] tracking-widest opacity-60">SAME MOVEMENT{catalogue.length ? ` · ${catalogue.length}` : ""}</span>
        {loading ? <p className="text-xs opacity-60">LOOKING…</p> : catalogue.length === 0 ? (
          <p className="text-xs opacity-60">Nothing else in the list trains this pattern — ask the AI below.</p>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {catalogue.map(c => (
              <button key={c.slug} onClick={() => onPick({ slug: c.slug, name: c.name, equipment: c.equipment, why: "" })}
                className="text-left min-h-[48px] px-3 py-2 rounded border border-(--j-dim) hover:bg-(--j-glow)">
                <span className="text-sm">{c.name}</span>
                <span className="text-[11px] opacity-50">
                  {" "}— {c.equipment}{c.perHand ? ", each hand" : ""}
                  {c.sessions > 0 ? ` · you've done this ${c.sessions}×` : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] tracking-widest opacity-60 mb-1" htmlFor={`why-${slug}`}>WHY? (OPTIONAL — HELPS THE AI)</label>
          <input id={`why-${slug}`} value={why} onChange={e => setWhy(e.target.value)}
            placeholder="machine's always taken, hurts my shoulder, bored of it…"
            className="w-full bg-(--j-bg) border border-(--j-dim) rounded px-2.5 py-1.5 text-sm text-(--j-acc) placeholder:text-(--j-dim) focus:outline-none focus:border-(--j-acc)" />
        </div>
        <button className={`${btn} min-h-[44px]`} onClick={() => ask(true)} disabled={busy}>
          {busy ? "THINKING…" : "✨ ASK THE AI"}
        </button>
      </div>
    </div>
  )
}
