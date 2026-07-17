"use client"

import { useEffect, useRef, useState } from "react"
import ModelPicker, { getJordanModel } from "../model-picker"
import { classColour, normChampName } from "@/lib/mcoc"
import { addWarFight, removeWarFight, setWarFightDefender, reorderWarFights } from "@/lib/actions/mcoc"
import type { Champ } from "./mcoc-hub"

// 🏰 ALLIANCE WAR — two planners:
//   PATH: a SAVED, per-fight attack path. Each fight is a defender + a photo of
//   that fight's nodes; the path persists (server-side) so next war you just
//   overtype the defenders. "Plan my path" reads each fight's nodes photo and
//   returns the best attackers per fight + a few 3-champ teams.
//   DEFENCE: recommend which of your champs to place on which defence nodes.

const GREEN = "#33ff66"
// AW season reward brackets — passed to the AI as difficulty context.
const AW_TIERS = ["Bronze", "Silver", "Gold", "Platinum", "Challenger", "Master", "Vibranium"]
// localStorage keys — remember tier + defence inputs between visits (the path
// itself is saved server-side now, not here).
const TIER_KEY = "mcoc_aw_tier"
const DEF_KEY = "mcoc_aw_defence"

type PathResult = {
  teams: { name: string; summary: string; champions: { champion: string; why: string }[] }[]
  fights: { defender: string; nodeBuff?: string; options: { attacker: string; how: string }[] }[]
  risks: string; notes: string
}
type DefResult = { placements: { node: string; champion: string; why: string }[]; notes: string }
// A saved war fight: defender (overtyped each war) + optional nodes photo URL.
type WarFight = { id: string; defender: string; nodesImageUrl: string | null }

export default function AwClient({ roster }: { roster: Champ[] }) {
  const [mode, setMode] = useState<"path" | "defence">("path")
  const [tier, setTier] = useState("")   // AW difficulty bracket, remembered per browser
  const restored = useRef(false)
  const ownedByName = new Map(roster.map((c) => [normChampName(c.name), c]))
  const rosterPayload = () => JSON.stringify(roster.map((c) => ({ name: c.name, stars: c.stars, rank: c.rank })))

  // ── Saved war path ──
  const [warFights, setWarFights] = useState<WarFight[]>([])
  const [warLoading, setWarLoading] = useState(true)
  const [pathBusy, setPathBusy] = useState(false)
  const [pathErr, setPathErr] = useState<string | null>(null)
  const [path, setPath] = useState<PathResult | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)   // fight whose photo is uploading
  const fightPhotoInput = useRef<HTMLInputElement>(null)
  const pickForFight = useRef<string | null>(null)                      // which fight the file picker is for
  const [addingFight, setAddingFight] = useState(false)

  async function loadWarPath() {
    try {
      const r = await fetch("/api/jordan/mcoc/war-path")
      const d = await r.json()
      if (Array.isArray(d?.fights)) setWarFights(d.fights)
    } catch { /* leave empty */ } finally { setWarLoading(false) }
  }
  useEffect(() => { loadWarPath() }, [])

  async function addFight() {
    if (addingFight) return
    setAddingFight(true)
    try {
      const r = await addWarFight()
      setWarFights((f) => [...f, { id: r.id, defender: "", nodesImageUrl: null }])
    } catch { /* ignore — try again */ } finally { setAddingFight(false) }
  }
  function editDefender(id: string, v: string) {
    setWarFights((f) => f.map((x) => (x.id === id ? { ...x, defender: v } : x)))
  }
  function saveDefender(id: string, v: string) {
    // Fire-and-forget on blur — local state is the source of truth while typing.
    setWarFightDefender(id, v).catch(() => {})
  }
  async function removeFight(id: string) {
    setWarFights((f) => f.filter((x) => x.id !== id))
    try { await removeWarFight(id) } catch { /* ignore */ }
  }
  async function move(id: string, dir: -1 | 1) {
    const i = warFights.findIndex((f) => f.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= warFights.length) return
    const next = [...warFights]
    ;[next[i], next[j]] = [next[j], next[i]]
    setWarFights(next)
    try { await reorderWarFights(next.map((f) => f.id)) } catch { /* ignore */ }
  }
  function pickFightPhoto(id: string) {
    pickForFight.current = id
    fightPhotoInput.current?.click()
  }
  async function uploadFightPhoto(file: File | null) {
    const id = pickForFight.current
    pickForFight.current = null
    if (!id || !file) return
    setUploadingId(id)
    try {
      const fd = new FormData()
      fd.append("fightId", id)
      fd.append("image", file)
      const res = await fetch("/api/jordan/mcoc/war-fight-photo", { method: "POST", body: fd })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.imageUrl) setWarFights((f) => f.map((x) => (x.id === id ? { ...x, nodesImageUrl: d.imageUrl } : x)))
      else setPathErr(d.error || "Couldn't save that photo.")
    } catch { setPathErr("Couldn't save that photo.") } finally { setUploadingId(null) }
  }

  async function planPath() {
    if (pathBusy) return
    if (!warFights.some((f) => f.defender.trim())) { setPathErr("Add at least one fight with a defender."); return }
    setPathBusy(true); setPathErr(null); setPath(null)
    try {
      // Persist any defenders not yet blurred, so the server plans what's on screen.
      await Promise.all(warFights.map((f) => setWarFightDefender(f.id, f.defender).catch(() => {})))
      const fd = new FormData()
      if (tier) fd.append("tier", tier)
      const model = getJordanModel(); if (model) fd.append("model", model)
      const res = await fetch("/api/jordan/mcoc/aw-path", { method: "POST", body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Planning failed — try again.")
      setPath(j)
    } catch (e: any) {
      setPathErr(e?.message ?? "Planning failed — try again.")
    } finally { setPathBusy(false) }
  }

  // Every champion in the DB — powers the defender type-ahead + class-colour dots.
  const [allNames, setAllNames] = useState<string[]>([])
  const [classByName, setClassByName] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    fetch("/api/jordan/mcoc/profiles/list")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !Array.isArray(d?.champions)) return
        setAllNames(d.champions.map((c: { name: string }) => c.name).filter(Boolean).sort())
        const cls: Record<string, string> = {}
        for (const c of d.champions) if (c?.name) cls[normChampName(c.name)] = c.class || ""
        setClassByName(cls)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  function defClass(name: string) { return classByName[normChampName(name)] || "" }

  // ── Defence placer ──
  const defFile = useRef<HTMLInputElement>(null)
  const [mapFile, setMapFile] = useState<File | null>(null)
  const [mapPreview, setMapPreview] = useState<string | null>(null)
  const [defNotes, setDefNotes] = useState("")
  const [defCount, setDefCount] = useState(5)
  const [defBusy, setDefBusy] = useState(false)
  const [defErr, setDefErr] = useState<string | null>(null)
  const [defence, setDefence] = useState<DefResult | null>(null)

  // Remember tier + defence inputs between visits. Restore once after mount, then
  // save on change (the `restored` guard stops the initial empty state clobbering
  // the saved values first).
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const t = localStorage.getItem(TIER_KEY); if (t) setTier(t)
        const d = JSON.parse(localStorage.getItem(DEF_KEY) || "null")
        if (d) {
          if (typeof d.notes === "string") setDefNotes(d.notes)
          if (Number(d.count)) setDefCount(Number(d.count))
        }
      } catch {}
      restored.current = true
    })
  }, [])
  useEffect(() => { if (restored.current) try { localStorage.setItem(TIER_KEY, tier) } catch {} }, [tier])
  useEffect(() => { if (restored.current) try { localStorage.setItem(DEF_KEY, JSON.stringify({ notes: defNotes, count: defCount })) } catch {} }, [defNotes, defCount])

  function pickMap(f: File | null) {
    setMapFile(f)
    if (mapPreview) URL.revokeObjectURL(mapPreview)
    setMapPreview(f ? URL.createObjectURL(f) : null)
  }

  async function planDefence() {
    if (defBusy) return
    setDefBusy(true); setDefErr(null); setDefence(null)
    try {
      const fd = new FormData()
      if (mapFile) fd.append("image", mapFile)
      if (defNotes.trim()) fd.append("notes", defNotes.trim())
      if (tier) fd.append("tier", tier)
      fd.append("count", String(defCount))
      fd.append("roster", rosterPayload())
      const model = getJordanModel(); if (model) fd.append("model", model)
      const res = await fetch("/api/jordan/mcoc/aw-defence", { method: "POST", body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Planning failed — try again.")
      setDefence(j)
    } catch (e: any) {
      setDefErr(e?.message ?? "Planning failed — try again.")
    } finally { setDefBusy(false) }
  }

  const modeBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
      active ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] opacity-60 hover:opacity-100"
    }`
  const input = "bg-black border border-[#1f5c33] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#33ff66] placeholder:text-[#1f5c33]"

  function ChampInline({ name }: { name: string }) {
    const owned = ownedByName.get(normChampName(name))
    return (
      <span className="inline-flex items-center gap-1.5">
        {owned?.imageUrl && <img src={owned.imageUrl} alt="" width={22} height={22} className="rounded object-cover" style={{ boxShadow: `0 0 0 1.5px ${classColour(owned.class)}` }} />}
        <span className="font-bold text-white">{name}</span>
        {owned && <span className="text-[10px] opacity-50">{owned.stars}★ R{owned.rank}</span>}
      </span>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto font-mono" style={{ color: GREEN }}>
      <div className="border border-[#1f5c33] rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setMode("path")} className={modeBtn(mode === "path")}>🗡 ATTACK PATH</button>
          <button onClick={() => setMode("defence")} className={modeBtn(mode === "defence")}>🛡 DEFENCE PLACER</button>
          <label className="inline-flex items-center gap-1.5 text-xs opacity-70 ml-1" title="Your war bracket — the AI factors in the tougher nodes at higher tiers">
            🗺 Tier
            <select value={tier} onChange={(e) => setTier(e.target.value)}
              className="bg-black border border-[#1f5c33] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#33ff66]" style={{ color: GREEN }}>
              <option value="">— any —</option>
              {AW_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <span className="ml-auto"><ModelPicker /></span>
        </div>

        {mode === "path" && (
          <div className="space-y-3">
            <p className="text-sm opacity-70">
              Your saved war path — one row per fight. Add a photo of each fight&apos;s nodes and type the defender. It all saves, so next
              war you just overtype the defenders. Add or remove fights to match the path you took.
            </p>

            <datalist id="mcoc-all-champs">
              {allNames.map((n) => <option key={n} value={n} />)}
            </datalist>

            {warLoading ? (
              <p className="text-sm opacity-50 animate-pulse">Loading your saved path…</p>
            ) : (
              <div className="space-y-2">
                {warFights.map((f, i) => {
                  const cls = defClass(f.defender)
                  return (
                    <div key={f.id} className="border border-[#1f5c33] rounded-lg p-2.5 flex gap-3 items-start">
                      {/* Nodes photo */}
                      <button onClick={() => pickFightPhoto(f.id)} disabled={uploadingId === f.id}
                        className="shrink-0 w-24 h-16 rounded-lg border border-[#1f5c33] hover:border-[#33ff66] overflow-hidden flex items-center justify-center text-[10px] opacity-70 disabled:opacity-40 transition-colors"
                        title={f.nodesImageUrl ? "Change nodes photo" : "Add a photo of this fight's nodes"}>
                        {uploadingId === f.id
                          ? <span className="animate-pulse">Saving…</span>
                          : f.nodesImageUrl
                            ? <img src={f.nodesImageUrl} alt="Nodes" className="w-full h-full object-cover" />
                            : <span className="text-center leading-tight px-1">📷 Nodes<br />photo</span>}
                      </button>

                      {/* Defender + controls */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-widest opacity-40 shrink-0">Fight {i + 1}</span>
                          {cls && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: classColour(cls) }} title={cls} />}
                          <div className="ml-auto flex items-center gap-0.5 shrink-0">
                            <button onClick={() => move(f.id, -1)} disabled={i === 0} className="px-1 opacity-40 hover:opacity-100 disabled:opacity-15 disabled:cursor-default" title="Move up">▲</button>
                            <button onClick={() => move(f.id, 1)} disabled={i === warFights.length - 1} className="px-1 opacity-40 hover:opacity-100 disabled:opacity-15 disabled:cursor-default" title="Move down">▼</button>
                            <button onClick={() => removeFight(f.id)} className="px-1 text-red-400 opacity-60 hover:opacity-100" title="Remove fight">×</button>
                          </div>
                        </div>
                        <input
                          value={f.defender}
                          onChange={(e) => editDefender(f.id, e.target.value)}
                          onBlur={(e) => saveDefender(f.id, e.target.value)}
                          list="mcoc-all-champs"
                          placeholder="Defender on this node…"
                          className={`${input} w-full py-1.5`} style={{ color: GREEN }} />
                      </div>
                    </div>
                  )
                })}

                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={addFight} disabled={addingFight}
                    className="px-4 py-2 rounded-lg border border-[#1f5c33] text-sm hover:border-[#33ff66] disabled:opacity-40 transition-colors">
                    ＋ Add fight
                  </button>
                  {warFights.length === 0 && <span className="text-[11px] opacity-50">Add your first fight to start building the path.</span>}
                </div>
              </div>
            )}

            <input ref={fightPhotoInput} type="file" accept="image/*" className="hidden"
              onChange={(e) => { uploadFightPhoto(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />

            <button onClick={planPath} disabled={pathBusy || warLoading || !warFights.some((f) => f.defender.trim())}
              className="px-5 py-2.5 rounded-lg text-sm font-bold text-black disabled:opacity-40 transition-colors"
              style={{ background: GREEN }}>
              {pathBusy ? "PLANNING…" : "🗡 PLAN MY PATH"}
            </button>
            {pathErr && <p className="text-sm text-red-400">✗ {pathErr}</p>}

            {path && (
              <div className="space-y-3 border-t border-[#1f5c33] pt-3">
                {path.teams.length > 0 && (
                  <>
                    <p className="text-[10px] uppercase tracking-widest opacity-50">Team options — pick whichever suits you</p>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {path.teams.map((t, i) => (
                        <div key={i} className="border border-[#33ff66] rounded-lg p-3 space-y-2">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0a2214] border border-[#33ff66] shrink-0">{String.fromCharCode(65 + i)}</span>
                            <p className="text-sm font-bold text-white">{t.name || `Team ${i + 1}`}</p>
                          </div>
                          {t.summary && <p className="text-xs opacity-70">{t.summary}</p>}
                          <div className="space-y-1.5 pt-0.5">
                            {t.champions.map((c, j) => (
                              <div key={j}>
                                <ChampInline name={c.champion} />
                                {c.why && <p className="text-[11px] opacity-60 mt-0.5">{c.why}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <p className="text-[10px] uppercase tracking-widest opacity-50">Fight by fight — best options for each</p>
                <div className="grid gap-2 lg:grid-cols-2">
                  {path.fights.map((f, i) => (
                    <div key={i} className="border border-[#1f5c33] rounded-lg px-3 py-2 text-sm">
                      <p className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-[#1f5c33] opacity-80 shrink-0">FIGHT {i + 1}</span>
                        <span className="text-white font-bold">{f.defender}</span>
                      </p>
                      {f.nodeBuff && <p className="text-[11px] text-amber-300 mb-1.5">⚡ {f.nodeBuff}</p>}
                      <div className="space-y-1.5">
                        {f.options.map((o, j) => (
                          <div key={j} className="flex items-start gap-2">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded mt-0.5 shrink-0 ${j === 0 ? "text-black" : "border border-[#1f5c33] opacity-60"}`}
                              style={j === 0 ? { background: GREEN } : undefined}>{j === 0 ? "BEST" : `#${j + 1}`}</span>
                            <div className="min-w-0">
                              <ChampInline name={o.attacker} />
                              {o.how && <p className="text-xs opacity-70 mt-0.5">{o.how}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {path.risks && <p className="text-xs text-amber-300">⚠ {path.risks}</p>}
                {path.notes && <p className="text-xs opacity-60">💡 {path.notes}</p>}
              </div>
            )}
          </div>
        )}

        {mode === "defence" && (
          <div className="space-y-3">
            <p className="text-sm opacity-70">Get your best defence placements — optionally photograph the war map / node screen for node-exact picks.</p>

            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={() => defFile.current?.click()} disabled={defBusy}
                className="px-4 py-2 rounded-lg border border-[#1f5c33] text-sm hover:border-[#33ff66] disabled:opacity-40 transition-colors">
                📷 {mapFile ? "Change map photo" : "Map photo (optional)"}
              </button>
              <label className="text-xs opacity-70 inline-flex items-center gap-1.5">Defenders
                <select value={defCount} onChange={(e) => setDefCount(Number(e.target.value))}
                  className="bg-black border border-[#1f5c33] rounded px-2 py-1 text-xs" style={{ color: GREEN }}>
                  {[5, 6, 7, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button onClick={planDefence} disabled={defBusy || roster.length < defCount}
                className="px-5 py-2.5 rounded-lg text-sm font-bold text-black disabled:opacity-40 transition-colors ml-auto"
                style={{ background: GREEN }}>
                {defBusy ? "PLANNING…" : "🛡 PLACE MY DEFENCE"}
              </button>
            </div>

            <textarea value={defNotes} onChange={(e) => setDefNotes(e.target.value)} rows={2}
              placeholder="Optional — war tier, map style, which nodes you're responsible for…"
              className={`${input} w-full resize-none`} style={{ color: GREEN }} />

            {mapPreview && <img src={mapPreview} alt="War map" className="max-h-48 rounded-lg border border-[#1f5c33]" />}
            {defErr && <p className="text-sm text-red-400">✗ {defErr}</p>}

            {defence && (
              <div className="space-y-1.5 border-t border-[#1f5c33] pt-3">
                {defence.placements.map((p, i) => (
                  <div key={i} className="flex items-start gap-3 border border-[#1f5c33] rounded-lg px-3 py-2">
                    <span className="shrink-0 text-xs font-bold px-2 py-1 rounded border border-[#33ff66] mt-0.5">NODE {p.node}</span>
                    <div className="min-w-0">
                      <ChampInline name={p.champion} />
                      {p.why && <p className="text-xs opacity-70 mt-0.5">{p.why}</p>}
                    </div>
                  </div>
                ))}
                {defence.notes && <p className="text-xs opacity-70 pt-1">{defence.notes}</p>}
              </div>
            )}

            <input ref={defFile} type="file" accept="image/*" className="hidden"
              onChange={(e) => { pickMap(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
          </div>
        )}
      </div>
    </div>
  )
}
