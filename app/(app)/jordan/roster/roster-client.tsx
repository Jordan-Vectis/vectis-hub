"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { MCOC_CLASSES, classColour } from "@/lib/mcoc"
import { addChampions, updateChampion, deleteChampion } from "@/lib/actions/mcoc"
import ModelPicker, { getJordanModel } from "../model-picker"

type Champ = { id: string; name: string; class: string; stars: number; rank: number; bgsDeck: boolean }
type Scanned = { name: string; class: string; include: boolean }
const GREEN = "#33ff66"

export default function RosterClient({ initial }: { initial: Champ[] }) {
  const router = useRouter()
  const [champs, setChamps] = useState<Champ[]>(initial)
  useEffect(() => { setChamps(initial) }, [initial])
  const [, startTransition] = useTransition()
  const run = (fn: () => Promise<unknown>) => startTransition(async () => { await fn(); router.refresh() })

  const [filter, setFilter] = useState<"all" | "bgs">("all")
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<string | null>(null)

  // Add-by-photo
  const scanInput = useRef<HTMLInputElement>(null)
  const [addStars, setAddStars] = useState(7)
  const [addRank, setAddRank] = useState(5)
  const [addToBgs, setAddToBgs] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<Scanned[] | null>(null)
  const [scanMsg, setScanMsg] = useState<string | null>(null)

  // Manual add
  const [mName, setMName] = useState("")
  const [mClass, setMClass] = useState("")

  const bgsCount = champs.filter((c) => c.bgsDeck).length
  const shown = champs
    .filter((c) => (filter === "bgs" ? c.bgsDeck : true))
    .filter((c) => { const q = query.trim().toLowerCase(); return !q || c.name.toLowerCase().includes(q) })
  const byRank = [5, 4, 3, 2, 1].map((r) => ({ rank: r, list: shown.filter((c) => c.rank === r) })).filter((g) => g.list.length)

  async function scan(f: File | null) {
    if (!f || scanning) return
    setScanning(true); setScanMsg(null); setScanned(null)
    try {
      const fd = new FormData(); fd.append("image", f)
      const model = getJordanModel(); if (model) fd.append("model", model)
      const res = await fetch("/api/jordan/mcoc/scan-roster", { method: "POST", body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Couldn't read that screenshot.")
      const list: Scanned[] = (j.champions ?? []).map((c: { name: string; class: string }) => ({ name: c.name, class: c.class, include: true }))
      if (!list.length) { setScanMsg("No champions read — try a clearer screenshot, or add by hand below."); return }
      setScanned(list)
    } catch (e: any) {
      setScanMsg("✗ " + (e?.message ?? "Scan failed."))
    } finally {
      setScanning(false)
    }
  }

  function saveScanned() {
    const list = (scanned ?? []).filter((s) => s.include).map((s) => ({ name: s.name, class: s.class, stars: addStars, rank: addRank, bgsDeck: addToBgs }))
    if (!list.length) { setScanned(null); return }
    setScanned(null); setScanMsg(null)
    run(() => addChampions(list))
  }

  function addManual() {
    const name = mName.trim()
    if (!name) return
    setMName(""); setMClass("")
    run(() => addChampions([{ name, class: mClass, stars: addStars, rank: addRank, bgsDeck: addToBgs }]))
  }

  function toggleBgs(c: Champ) {
    setChamps((cs) => cs.map((x) => (x.id === c.id ? { ...x, bgsDeck: !x.bgsDeck } : x)))
    run(() => updateChampion(c.id, { bgsDeck: !c.bgsDeck }))
  }
  function remove(c: Champ) {
    setChamps((cs) => cs.filter((x) => x.id !== c.id))
    run(() => deleteChampion(c.id))
  }
  function saveEdit(c: Champ, patch: Partial<Champ>) {
    setChamps((cs) => cs.map((x) => (x.id === c.id ? { ...x, ...patch } : x)))
    setEditing(null)
    run(() => updateChampion(c.id, { rank: patch.rank, stars: patch.stars, class: patch.class }))
  }

  const input = "bg-black border border-[#1f5c33] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#33ff66] placeholder:text-[#1f5c33]"

  return (
    <div className="flex-1 min-h-0 overflow-y-auto font-mono space-y-4" style={{ color: GREEN }}>
      {/* Add tools */}
      <div className="border border-[#1f5c33] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm opacity-70">Add champions — snap a roster screenshot, or type them in.</p>
          <ModelPicker />
        </div>

        {/* Shared: what rank / stars these are */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="opacity-60 uppercase tracking-widest">These are:</span>
          <select value={addStars} onChange={(e) => setAddStars(Number(e.target.value))} className={input} style={{ color: GREEN }}>
            <option value={7}>7★</option>
            <option value={6}>6★</option>
          </select>
          <select value={addRank} onChange={(e) => setAddRank(Number(e.target.value))} className={input} style={{ color: GREEN }}>
            {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>Rank {r}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={addToBgs} onChange={(e) => setAddToBgs(e.target.checked)} className="accent-[#33ff66]" />
            <span className="opacity-80">Add to BGS deck</span>
          </label>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => scanInput.current?.click()} disabled={scanning}
            className="px-4 py-2 rounded-lg border border-[#33ff66] text-sm font-bold hover:bg-[#0a2214] disabled:opacity-40 transition-colors">
            {scanning ? "READING…" : "📷 Scan roster screenshot"}
          </button>
        </div>
        {scanMsg && <p className={`text-xs ${scanMsg.startsWith("✗") ? "text-red-400" : "opacity-70"}`}>{scanMsg}</p>}

        {/* Scan confirm */}
        {scanned && (
          <div className="border border-[#33ff66] rounded-lg p-3 space-y-2">
            <p className="text-xs opacity-70">Read {scanned.length} champ{scanned.length === 1 ? "" : "s"} — untick any wrong ones, then add as {addStars}★ Rank {addRank}{addToBgs ? " · BGS deck" : ""}.</p>
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {scanned.map((s, i) => (
                <button key={i} onClick={() => setScanned((list) => list!.map((x, j) => j === i ? { ...x, include: !x.include } : x))}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs ${s.include ? "border-[#33ff66]" : "border-[#1f5c33] opacity-40 line-through"}`}
                  style={{ borderLeft: `3px solid ${classColour(s.class)}` }}>
                  {s.name}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={saveScanned} className="px-4 py-1.5 rounded-lg text-sm font-bold text-black" style={{ background: GREEN }}>Add {scanned.filter((s) => s.include).length} →</button>
              <button onClick={() => setScanned(null)} className="px-4 py-1.5 rounded-lg border border-[#1f5c33] text-sm opacity-60 hover:opacity-100">Cancel</button>
            </div>
          </div>
        )}

        {/* Manual add */}
        <div className="flex gap-2 flex-wrap items-center">
          <input value={mName} onChange={(e) => setMName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addManual() }}
            placeholder="Champion name…" className={`${input} flex-1 min-w-[10rem]`} style={{ color: GREEN }} />
          <select value={mClass} onChange={(e) => setMClass(e.target.value)} className={input} style={{ color: GREEN }}>
            <option value="">Class…</option>
            {MCOC_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={addManual} disabled={!mName.trim()} className="px-4 py-2 rounded-lg border border-[#1f5c33] text-sm hover:border-[#33ff66] disabled:opacity-30 transition-colors">ADD</button>
        </div>
      </div>

      {/* Roster */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="opacity-70">{champs.length} champ{champs.length === 1 ? "" : "s"} · {bgsCount} in BGS deck</span>
        <div className="flex gap-1">
          <button onClick={() => setFilter("all")} className={`px-2.5 py-1 rounded border ${filter === "all" ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] opacity-60"}`}>All</button>
          <button onClick={() => setFilter("bgs")} className={`px-2.5 py-1 rounded border ${filter === "bgs" ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] opacity-60"}`}>★ BGS deck</button>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" className={`${input} py-1 ml-auto w-40`} style={{ color: GREEN }} />
      </div>

      {champs.length === 0 && <p className="text-sm opacity-50 text-center py-8">No champions yet — scan a roster screenshot above to get started.</p>}

      {byRank.map((g) => (
        <div key={g.rank}>
          <p className="text-[10px] uppercase tracking-widest opacity-50 mb-1.5">Rank {g.rank} · {g.list.length}</p>
          <div className="flex flex-wrap gap-1.5">
            {g.list.map((c) => (
              editing === c.id ? (
                <EditChip key={c.id} champ={c} onSave={(patch) => saveEdit(c, patch)} onCancel={() => setEditing(null)} onDelete={() => { setEditing(null); remove(c) }} />
              ) : (
                <span key={c.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs group"
                  style={{ borderColor: "#1f5c33", borderLeft: `3px solid ${classColour(c.class)}` }}>
                  <button onClick={() => toggleBgs(c)} title="Toggle BGS deck" className={c.bgsDeck ? "text-[#33ff66]" : "opacity-30 hover:opacity-70"}>★</button>
                  <button onClick={() => setEditing(c.id)} className="text-white hover:underline">{c.name}</button>
                  <span className="opacity-40">{c.stars}★</span>
                  <button onClick={() => remove(c)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-red-400" title="Remove">×</button>
                </span>
              )
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function EditChip({ champ, onSave, onCancel, onDelete }: { champ: Champ; onSave: (p: Partial<Champ>) => void; onCancel: () => void; onDelete: () => void }) {
  const [cls, setCls] = useState(champ.class)
  const [stars, setStars] = useState(champ.stars)
  const [rank, setRank] = useState(champ.rank)
  const sel = "bg-black border border-[#1f5c33] rounded px-1.5 py-0.5 text-[11px]"
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-[#33ff66] text-xs" style={{ color: "#33ff66" }}>
      <span className="text-white font-bold">{champ.name}</span>
      <select value={cls} onChange={(e) => setCls(e.target.value)} className={sel} style={{ color: "#33ff66" }}>
        <option value="">—</option>
        {MCOC_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={stars} onChange={(e) => setStars(Number(e.target.value))} className={sel} style={{ color: "#33ff66" }}><option value={7}>7★</option><option value={6}>6★</option></select>
      <select value={rank} onChange={(e) => setRank(Number(e.target.value))} className={sel} style={{ color: "#33ff66" }}>{[5,4,3,2,1].map((r) => <option key={r} value={r}>R{r}</option>)}</select>
      <button onClick={() => onSave({ class: cls, stars, rank })} className="text-[#33ff66] font-bold">✓</button>
      <button onClick={onCancel} className="opacity-60">×</button>
      <button onClick={onDelete} className="text-red-400" title="Delete">🗑</button>
    </span>
  )
}
