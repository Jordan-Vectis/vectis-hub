"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { MCOC_CLASSES, classColour, normChampName } from "@/lib/mcoc"
import { addChampions, updateChampion, deleteChampion, applyBgsDeck } from "@/lib/actions/mcoc"
import ModelPicker, { getJordanModel } from "../model-picker"

type Champ = { id: string; name: string; class: string; stars: number; rank: number; bgsDeck: boolean; imageUrl: string | null }
type ReadChamp = { name: string; class: string; rank: number | null; imageKey?: string; imageUrl?: string }
type Scanned = ReadChamp & { include: boolean; rank: number | null }
type BgsReview = { champs: Champ[]; selected: Set<string>; unmatched: string[] }
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

  // Add / update by photo
  const scanInput = useRef<HTMLInputElement>(null)
  const [addStars, setAddStars] = useState(7)
  const [addRank, setAddRank] = useState(5)
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<Scanned[] | null>(null)
  const [scanMsg, setScanMsg] = useState<string | null>(null)

  // BGS deck photo
  const bgsInput = useRef<HTMLInputElement>(null)
  const [replaceDeck, setReplaceDeck] = useState(true)
  const [bgsScanning, setBgsScanning] = useState(false)
  const [bgsMsg, setBgsMsg] = useState<string | null>(null)
  const [bgsReview, setBgsReview] = useState<BgsReview | null>(null)

  // Manual add
  const [mName, setMName] = useState("")
  const [mClass, setMClass] = useState("")

  const bgsCount = champs.filter((c) => c.bgsDeck).length
  const shown = champs
    .filter((c) => (filter === "bgs" ? c.bgsDeck : true))
    .filter((c) => { const q = query.trim().toLowerCase(); return !q || c.name.toLowerCase().includes(q) })
  const byRank = [5, 4, 3, 2, 1].map((r) => ({ rank: r, list: shown.filter((c) => c.rank === r) })).filter((g) => g.list.length)

  async function readChampions(f: File): Promise<ReadChamp[]> {
    const fd = new FormData(); fd.append("image", f)
    const model = getJordanModel(); if (model) fd.append("model", model)
    const res = await fetch("/api/jordan/mcoc/scan-roster", { method: "POST", body: fd })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error || "Couldn't read that screenshot.")
    return j.champions ?? []
  }

  async function scan(f: File | null) {
    if (!f || scanning) return
    setScanning(true); setScanMsg(null); setScanned(null)
    try {
      const list = await readChampions(f)
      if (!list.length) { setScanMsg("No champions read — try a clearer screenshot, or add by hand below."); return }
      setScanned(list.map((c) => ({ ...c, include: true, rank: c.rank })))
    } catch (e: any) {
      setScanMsg("✗ " + (e?.message ?? "Scan failed."))
    } finally { setScanning(false) }
  }

  function saveScanned() {
    const list = (scanned ?? []).filter((s) => s.include).map((s) => ({
      name: s.name, class: s.class, stars: addStars, rank: s.rank ?? addRank, imageKey: s.imageKey,
    }))
    setScanned(null); setScanMsg(null)
    if (list.length) run(() => addChampions(list))
  }

  async function scanBgs(f: File | null) {
    if (!f || bgsScanning) return
    setBgsScanning(true); setBgsMsg(null); setBgsReview(null)
    try {
      const list = await readChampions(f)
      const wanted = list.map((c) => normChampName(c.name)).filter(Boolean)
      if (!wanted.length) { setBgsMsg("✗ No champions read — try a clearer deck screenshot."); return }
      const wantedSet = new Set(wanted)
      // Exact normalised match against the roster (no loose contains — that was
      // matching the wrong champs). A name can hit both 6★ and 7★ copies.
      const matched = champs.filter((c) => wantedSet.has(normChampName(c.name)))
      const rosterNorms = new Set(champs.map((c) => normChampName(c.name)))
      const unmatched = list.filter((c) => !rosterNorms.has(normChampName(c.name))).map((c) => c.name)
      if (!matched.length) {
        setBgsMsg(`✗ None of those matched your roster${unmatched.length ? ` (${unmatched.join(", ")})` : ""} — add them to the roster first, then re-scan.`)
        return
      }
      setBgsReview({ champs: matched, selected: new Set(matched.map((c) => c.id)), unmatched })
    } catch (e: any) {
      setBgsMsg("✗ " + (e?.message ?? "Scan failed."))
    } finally { setBgsScanning(false) }
  }

  function applyReview() {
    if (!bgsReview) return
    const ids = [...bgsReview.selected]
    const replace = replaceDeck
    setChamps((cs) => cs.map((c) => ({ ...c, bgsDeck: ids.includes(c.id) ? true : (replace ? false : c.bgsDeck) })))
    setBgsReview(null)
    setBgsMsg(`✓ ${ids.length} champ${ids.length === 1 ? "" : "s"} set as your BGS deck.`)
    run(() => applyBgsDeck(ids, replace))
  }

  function addManual() {
    const name = mName.trim()
    if (!name) return
    setMName(""); setMClass("")
    run(() => addChampions([{ name, class: mClass, stars: addStars, rank: addRank }]))
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

  function Portrait({ url, cls, size = 22 }: { url: string | null | undefined; cls: string; size?: number }) {
    if (url) return <img src={url} alt="" width={size} height={size} className="rounded object-cover shrink-0" style={{ width: size, height: size, boxShadow: `0 0 0 1.5px ${classColour(cls)}` }} />
    return <span className="rounded shrink-0" style={{ width: size, height: size, background: classColour(cls) + "22", boxShadow: `0 0 0 1.5px ${classColour(cls)}` }} />
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto font-mono space-y-4" style={{ color: GREEN }}>
      {/* Add / update champions */}
      <div className="border border-[#1f5c33] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm opacity-70">Scan a roster screenshot — it reads names, ranks &amp; portraits. Re-scan any time to update ranks.</p>
          <ModelPicker />
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="opacity-60 uppercase tracking-widest">These are:</span>
          <select value={addStars} onChange={(e) => setAddStars(Number(e.target.value))} className={input} style={{ color: GREEN }}>
            <option value={7}>7★</option><option value={6}>6★</option>
          </select>
          <span className="opacity-40">rank if unreadable:</span>
          <select value={addRank} onChange={(e) => setAddRank(Number(e.target.value))} className={input} style={{ color: GREEN }}>
            {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>Rank {r}</option>)}
          </select>
          <button onClick={() => scanInput.current?.click()} disabled={scanning}
            className="px-4 py-2 rounded-lg border border-[#33ff66] text-sm font-bold hover:bg-[#0a2214] disabled:opacity-40 transition-colors ml-auto">
            {scanning ? "READING…" : "📷 Scan roster screenshot"}
          </button>
        </div>
        {scanMsg && <p className={`text-xs ${scanMsg.startsWith("✗") ? "text-red-400" : "opacity-70"}`}>{scanMsg}</p>}

        {scanned && (
          <div className="border border-[#33ff66] rounded-lg p-3 space-y-2">
            <p className="text-xs opacity-70">Read {scanned.length} champ{scanned.length === 1 ? "" : "s"} as {addStars}★ — untick wrong ones, fix any rank, then save.</p>
            <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
              {scanned.map((s, i) => (
                <span key={i} className={`inline-flex items-center gap-1.5 px-1.5 py-1 rounded-lg border text-xs ${s.include ? "border-[#33ff66]" : "border-[#1f5c33] opacity-40"}`}>
                  <button onClick={() => setScanned((l) => l!.map((x, j) => j === i ? { ...x, include: !x.include } : x))} className="inline-flex items-center gap-1.5">
                    <Portrait url={s.imageUrl} cls={s.class} size={26} />
                    <span className={s.include ? "text-white" : "line-through"}>{s.name}</span>
                  </button>
                  <select value={s.rank ?? addRank} onChange={(e) => setScanned((l) => l!.map((x, j) => j === i ? { ...x, rank: Number(e.target.value) } : x))}
                    className="bg-black border border-[#1f5c33] rounded px-1 text-[10px]" style={{ color: GREEN }}>
                    {[5,4,3,2,1].map((r) => <option key={r} value={r}>R{r}</option>)}
                  </select>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={saveScanned} className="px-4 py-1.5 rounded-lg text-sm font-bold text-black" style={{ background: GREEN }}>Save {scanned.filter((s) => s.include).length} →</button>
              <button onClick={() => setScanned(null)} className="px-4 py-1.5 rounded-lg border border-[#1f5c33] text-sm opacity-60 hover:opacity-100">Cancel</button>
            </div>
          </div>
        )}

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

      {/* Battlegrounds deck */}
      <div className="border border-[#1f5c33] rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm font-bold">★ Battlegrounds deck <span className="opacity-50 font-normal">— {bgsCount} champ{bgsCount === 1 ? "" : "s"}</span></p>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="inline-flex items-center gap-1.5 text-[11px] opacity-70 cursor-pointer">
              <input type="checkbox" checked={replaceDeck} onChange={(e) => setReplaceDeck(e.target.checked)} className="accent-[#33ff66]" /> Replace deck
            </label>
            <button onClick={() => bgsInput.current?.click()} disabled={bgsScanning}
              className="px-4 py-2 rounded-lg border border-[#33ff66] text-sm font-bold hover:bg-[#0a2214] disabled:opacity-40 transition-colors">
              {bgsScanning ? "READING…" : "📷 Scan BGS deck photo"}
            </button>
          </div>
        </div>
        <p className="text-[11px] opacity-50">Reads your deck photo, matches to your roster, and shows the matches to confirm before setting.</p>
        {bgsMsg && <p className={`text-xs ${bgsMsg.startsWith("✗") ? "text-red-400" : "opacity-80"}`}>{bgsMsg}</p>}

        {bgsReview && (
          <div className="border border-[#33ff66] rounded-lg p-3 space-y-2">
            <p className="text-xs opacity-70">Matched {bgsReview.champs.length} — untick any wrong ones, then set as your deck{replaceDeck ? " (replacing the old one)" : ""}.</p>
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {bgsReview.champs.map((c) => {
                const on = bgsReview.selected.has(c.id)
                return (
                  <button key={c.id} onClick={() => setBgsReview((r) => { if (!r) return r; const s = new Set(r.selected); s.has(c.id) ? s.delete(c.id) : s.add(c.id); return { ...r, selected: s } })}
                    className={`inline-flex items-center gap-1.5 px-1.5 py-1 rounded-lg border text-xs ${on ? "border-[#33ff66]" : "border-[#1f5c33] opacity-40"}`}>
                    <Portrait url={c.imageUrl} cls={c.class} size={26} />
                    <span className={on ? "text-white" : "line-through"}>{c.name}</span>
                    <span className="opacity-40">{c.stars}★</span>
                  </button>
                )
              })}
            </div>
            {bgsReview.unmatched.length > 0 && <p className="text-[11px] text-amber-400">Not in your roster: {bgsReview.unmatched.join(", ")} — add them first.</p>}
            <div className="flex gap-2">
              <button onClick={applyReview} className="px-4 py-1.5 rounded-lg text-sm font-bold text-black" style={{ background: GREEN }}>Set {bgsReview.selected.size} as deck →</button>
              <button onClick={() => setBgsReview(null)} className="px-4 py-1.5 rounded-lg border border-[#1f5c33] text-sm opacity-60 hover:opacity-100">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Roster */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="opacity-70">{champs.length} champ{champs.length === 1 ? "" : "s"}</span>
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
                <span key={c.id} className="inline-flex items-center gap-1.5 px-1.5 py-1 rounded-lg border text-xs group" style={{ borderColor: "#1f5c33" }}>
                  <button onClick={() => toggleBgs(c)} title="Toggle BGS deck" className={c.bgsDeck ? "text-[#33ff66]" : "opacity-30 hover:opacity-70"}>★</button>
                  <Portrait url={c.imageUrl} cls={c.class} />
                  <button onClick={() => setEditing(c.id)} className="text-white hover:underline">{c.name}</button>
                  <span className="opacity-40">{c.stars}★</span>
                  <button onClick={() => remove(c)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-red-400" title="Remove">×</button>
                </span>
              )
            ))}
          </div>
        </div>
      ))}

      <input ref={scanInput} type="file" accept="image/*" className="hidden"
        onChange={(e) => { scan(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
      <input ref={bgsInput} type="file" accept="image/*" className="hidden"
        onChange={(e) => { scanBgs(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
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
