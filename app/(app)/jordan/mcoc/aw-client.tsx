"use client"

import { useEffect, useRef, useState } from "react"
import ModelPicker, { getJordanModel } from "../model-picker"
import { classColour, normChampName } from "@/lib/mcoc"
import { addWarFight, removeWarFight, setWarFightDefender, reorderWarFights, addMiniNode, removeMiniNode, setMiniNodeLabel, setMiniNodeDefender, setMiniNodeTaking, setMiniNodeSlot } from "@/lib/actions/mcoc"
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
const FORCED_KEY = "mcoc_aw_forced"
const MINI_MODE_KEY = "mcoc_aw_mini_mode"

const RATING_COL: Record<string, string> = {
  best:  "border-[#33ff66] text-[#33ff66]",
  good:  "border-emerald-500 text-emerald-400",
  risky: "border-amber-500 text-amber-400",
  avoid: "border-red-500 text-red-400",
}

type ForcedPlan = { attacker: string; fights: { fight: number; defender: string; rating: string; how: string }[] }
type MiniRec = { section: string; side: string; slot: string; label: string; defender: string; attacker: string; why: string }
type PathResult = {
  teams: { name: string; summary: string; champions: { champion: string; why: string }[] }[]
  fights: { defender: string; miniLabel?: string | null; nodeBuff?: string; options: { attacker: string; how: string }[] }[]
  forced?: ForcedPlan[]
  miniRecs?: MiniRec[]
  risks: string; notes: string; groundedFallback?: boolean
}
type DefResult = { placements: { node: string; champion: string; why: string }[]; notes: string }
// A saved war fight: defender (overtyped each war) + optional nodes photo URL.
type WarFight = { id: string; defender: string; nodesImageUrl: string | null }
// A mini boss node in the library: photo uploaded once; taking + defender change per war.
// slot = its fixed position on the war map (null = not placed yet, sits in the tray).
type MiniNode = { id: string; label: string; defender: string; taking: boolean; slot: string | null; nodesImageUrl: string | null }

// ── The war map template (drawn from Jordan's map screenshot) ─────────────────
// Boss Island hexagon up top, the Bottleneck diamond (Path B) in the middle,
// Paths A and C diamonds at the bottom. Each diamond has L / R / C mini nodes.
// Coordinates are viewBox units (0-100 wide, 0-130 tall). Node numbers are NOT
// hardcoded — Jordan types each node's own label.
type MapSlot = { key: string; x: number; y: number; hint: string }
const MAP_SLOTS: MapSlot[] = [
  { key: "boss_top", x: 50, y: 7,   hint: "BOSS" },
  { key: "boss_ul",  x: 36, y: 15,  hint: "L↑" },
  { key: "boss_ur",  x: 64, y: 15,  hint: "R↑" },
  { key: "boss_ll",  x: 36, y: 27,  hint: "L" },
  { key: "boss_lr",  x: 64, y: 27,  hint: "R" },
  { key: "pb_l",     x: 36, y: 66,  hint: "L" },
  { key: "pb_r",     x: 64, y: 66,  hint: "R" },
  { key: "pb_c",     x: 50, y: 76,  hint: "C" },
  { key: "pa_l",     x: 8,  y: 104, hint: "L" },
  { key: "pa_r",     x: 36, y: 104, hint: "R" },
  { key: "pa_c",     x: 22, y: 115, hint: "C" },
  { key: "pc_l",     x: 64, y: 104, hint: "L" },
  { key: "pc_r",     x: 92, y: 104, hint: "R" },
  { key: "pc_c",     x: 78, y: 115, hint: "C" },
]
// Connecting lines + decorative path-entry dots, mirroring the in-game map.
const MAP_EDGES: [number, number, number, number][] = [
  // Boss Island hexagon
  [50, 7, 64, 15], [64, 15, 64, 27], [64, 27, 50, 35], [50, 35, 36, 27], [36, 27, 36, 15], [36, 15, 50, 7],
  // Boss Island ← Bottleneck stem
  [50, 35, 50, 56],
  // Path B (Bottleneck) diamond
  [50, 56, 64, 66], [64, 66, 50, 76], [50, 76, 36, 66], [36, 66, 50, 56],
  // Path A diamond
  [22, 93, 36, 104], [36, 104, 22, 115], [22, 115, 8, 104], [8, 104, 22, 93],
  // Path C diamond
  [78, 93, 92, 104], [92, 104, 78, 115], [78, 115, 64, 104], [64, 104, 78, 93],
]
const MAP_DOTS: [number, number][] = [[50, 56], [22, 93], [78, 93]]
const MAP_LABELS: { x: number; y: number; text: string }[] = [
  { x: 80, y: 8,   text: "BOSS ISLAND" },
  { x: 79, y: 60,  text: "BOTTLENECK" },
  { x: 33, y: 57,  text: "PATH B" },
  { x: 10, y: 91,  text: "PATH A" },
  { x: 90, y: 91,  text: "PATH C" },
]

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
  // Attackers the player wants to bring — the planner reports which fights each handles.
  const [forced, setForced] = useState<string[]>([])
  const [forcedInput, setForcedInput] = useState("")
  function addForced(raw: string) {
    const n = raw.replace(/\s+/g, " ").trim()
    setForcedInput("")
    if (!n || forced.some((f) => normChampName(f) === normChampName(n)) || forced.length >= 8) return
    setForced((l) => [...l, n])
  }

  async function loadWarPath() {
    try {
      const r = await fetch("/api/jordan/mcoc/war-path")
      const d = await r.json()
      if (Array.isArray(d?.fights)) setWarFights(d.fights)
      if (Array.isArray(d?.minis)) setMinis(d.minis)
    } catch { /* leave empty */ } finally { setWarLoading(false) }
  }
  useEffect(() => { loadWarPath() }, [])

  // ── Mini boss node library — photos stay, taking + defender change per war ──
  const [minis, setMinis] = useState<MiniNode[]>([])
  const [miniUploadingId, setMiniUploadingId] = useState<string | null>(null)
  const [addingMini, setAddingMini] = useState(false)
  const miniPhotoInput = useRef<HTMLInputElement>(null)
  const pickForMini = useRef<string | null>(null)
  const miniEditorRef = useRef<HTMLDivElement>(null)
  // "pick" = tick which minis you're taking; "recommend" = let the plan choose
  // 1 mini per path + a boss side from the candidate defenders you've typed in.
  const [miniMode, setMiniMode] = useState<"pick" | "recommend">("pick")

  // Map interaction: editingMiniId opens the editor card under the map;
  // placingId = a tray node waiting for an empty slot to be tapped.
  const [editingMiniId, setEditingMiniId] = useState<string | null>(null)
  const [placingId, setPlacingId] = useState<string | null>(null)
  // When a node's editor opens, bring it into view (it appears below the map, so
  // on a phone it's off-screen otherwise).
  useEffect(() => { if (editingMiniId) miniEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }) }, [editingMiniId])

  async function createInSlot(slot: string) {
    if (addingMini) return
    setAddingMini(true)
    try {
      const r = await addMiniNode(slot)
      setMinis((m) => [...m, { id: r.id, label: "", defender: "", taking: false, slot, nodesImageUrl: null }])
      setEditingMiniId(r.id)   // straight into naming + photo
    } catch { /* ignore — try again */ } finally { setAddingMini(false) }
  }
  async function placeMini(id: string, slot: string) {
    editMini(id, { slot })
    setPlacingId(null)
    try { await setMiniNodeSlot(id, slot) } catch { editMini(id, { slot: null }) }
  }
  async function unplaceMini(id: string) {
    editMini(id, { slot: null })
    try { await setMiniNodeSlot(id, null) } catch { /* ignore */ }
  }
  async function removeMini(id: string) {
    setMinis((m) => m.filter((x) => x.id !== id))
    if (editingMiniId === id) setEditingMiniId(null)
    if (placingId === id) setPlacingId(null)
    try { await removeMiniNode(id) } catch { /* ignore */ }
  }
  function editMini(id: string, patch: Partial<MiniNode>) {
    setMinis((m) => m.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }
  async function toggleTaking(id: string) {
    const cur = minis.find((x) => x.id === id)
    if (!cur) return
    const next = !cur.taking
    editMini(id, { taking: next })   // optimistic
    try { await setMiniNodeTaking(id, next) } catch { editMini(id, { taking: !next }) }
  }
  function pickMiniPhoto(id: string) {
    pickForMini.current = id
    miniPhotoInput.current?.click()
  }
  async function uploadMiniPhoto(file: File | null) {
    const id = pickForMini.current
    pickForMini.current = null
    if (!id || !file) return
    setMiniUploadingId(id)
    try {
      const fd = new FormData()
      fd.append("nodeId", id)
      fd.append("image", file)
      const res = await fetch("/api/jordan/mcoc/mini-node-photo", { method: "POST", body: fd })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.imageUrl) editMini(id, { nodesImageUrl: d.imageUrl })
      else setPathErr(d.error || "Couldn't save that photo.")
    } catch { setPathErr("Couldn't save that photo.") } finally { setMiniUploadingId(null) }
  }
  const takenMinis = minis.filter((m) => m.taking)

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
    // Whose defenders matter this run: the ticked minis (pick mode) or every
    // placed candidate with a defender (recommend mode).
    const miniDefsToSave = miniMode === "recommend"
      ? minis.filter((m) => m.slot && m.defender.trim())
      : takenMinis.filter((m) => m.defender.trim())
    if (!warFights.some((f) => f.defender.trim()) && !miniDefsToSave.length) {
      setPathErr(miniMode === "recommend"
        ? "Add a path fight, or type a defender on the mini nodes you're choosing between."
        : "Add at least one fight or selected mini boss with a defender."); return
    }
    setPathBusy(true); setPathErr(null); setPath(null)
    try {
      // Persist any defenders not yet blurred, so the server plans what's on screen.
      await Promise.all([
        ...warFights.map((f) => setWarFightDefender(f.id, f.defender).catch(() => {})),
        ...miniDefsToSave.map((m) => setMiniNodeDefender(m.id, m.defender).catch(() => {})),
      ])
      const fd = new FormData()
      if (tier) fd.append("tier", tier)
      if (forced.length) fd.append("forced", JSON.stringify(forced))
      fd.append("miniMode", miniMode)
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
        const fl = JSON.parse(localStorage.getItem(FORCED_KEY) || "null")
        if (Array.isArray(fl)) setForced(fl.filter((x) => typeof x === "string").slice(0, 8))
        const mm = localStorage.getItem(MINI_MODE_KEY); if (mm === "recommend") setMiniMode("recommend")
      } catch {}
      restored.current = true
    })
  }, [])
  useEffect(() => { if (restored.current) try { localStorage.setItem(TIER_KEY, tier) } catch {} }, [tier])
  useEffect(() => { if (restored.current) try { localStorage.setItem(DEF_KEY, JSON.stringify({ notes: defNotes, count: defCount })) } catch {} }, [defNotes, defCount])
  useEffect(() => { if (restored.current) try { localStorage.setItem(FORCED_KEY, JSON.stringify(forced)) } catch {} }, [forced])
  useEffect(() => { if (restored.current) try { localStorage.setItem(MINI_MODE_KEY, miniMode) } catch {} }, [miniMode])

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
            <p className="text-[10px] uppercase tracking-widest opacity-50">⚔ War Path</p>
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
                            <button onClick={() => move(f.id, -1)} disabled={i === 0} className="w-8 h-8 flex items-center justify-center rounded opacity-50 hover:opacity-100 hover:bg-white/5 active:bg-white/10 disabled:opacity-15 disabled:cursor-default" title="Move up">▲</button>
                            <button onClick={() => move(f.id, 1)} disabled={i === warFights.length - 1} className="w-8 h-8 flex items-center justify-center rounded opacity-50 hover:opacity-100 hover:bg-white/5 active:bg-white/10 disabled:opacity-15 disabled:cursor-default" title="Move down">▼</button>
                            <button onClick={() => removeFight(f.id)} className="w-8 h-8 flex items-center justify-center rounded text-red-400 opacity-70 hover:opacity-100 hover:bg-red-500/10 active:bg-red-500/20" title="Remove fight">×</button>
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

            {/* ── Mini bosses — a node map like the war map. Photos are uploaded ONCE
                per node; each war you just tap the nodes you're taking and type the
                defenders. Selected nodes join the plan after the path fights. ── */}
            <div className="border-t border-[#1f5c33] pt-3 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-[10px] uppercase tracking-widest opacity-50">👑 Mini Bosses</p>
                {/* Pick yourself, or let the plan choose 1 per path + a boss side. */}
                <div className="inline-flex rounded-lg border border-[#1f5c33] overflow-hidden text-[10px]">
                  <button onClick={() => setMiniMode("pick")}
                    className={`px-2.5 py-1 font-bold uppercase tracking-widest transition-colors ${miniMode === "pick" ? "text-black" : "opacity-60 hover:opacity-100"}`}
                    style={miniMode === "pick" ? { background: GREEN } : undefined}>✍ Pick myself</button>
                  <button onClick={() => setMiniMode("recommend")}
                    className={`px-2.5 py-1 font-bold uppercase tracking-widest border-l border-[#1f5c33] transition-colors ${miniMode === "recommend" ? "text-black" : "opacity-60 hover:opacity-100"}`}
                    style={miniMode === "recommend" ? { background: GREEN } : undefined}>🤖 Recommend</button>
                </div>
              </div>
              <p className="text-[11px] opacity-60">
                {miniMode === "pick"
                  ? "Your mini boss node map — add every mini node once with its photo. Each war, tap the nodes you're taking (they light up) and type the defenders. The photos stay, so no re-photographing."
                  : "Type the defender on the mini nodes that are live this war (all the L/C/R + both boss sides). When you plan, it picks the best one per path + boss side for your roster — favouring ones your path team already covers. The winners light up green."}
              </p>
              {!warLoading && (() => {
                const slotKeys = new Set(MAP_SLOTS.map((s) => s.key))
                const bySlot = new Map(minis.filter((m) => m.slot && slotKeys.has(m.slot)).map((m) => [m.slot as string, m]))
                // A node on an unknown slot (e.g. one that was removed) falls back to
                // the tray rather than disappearing off the map.
                const unplaced = minis.filter((m) => !m.slot || !slotKeys.has(m.slot))
                const editing = editingMiniId ? minis.find((m) => m.id === editingMiniId) ?? null : null
                // Recommend mode: the AI's chosen slots (from the last plan) glow green.
                const recommendedSlots = new Set((path?.miniRecs ?? []).map((r) => r.slot))
                const isLive = (m: MiniNode) => miniMode === "pick" ? m.taking : !!(m.slot && recommendedSlots.has(m.slot))
                // Placed candidate nodes (defenders needed on all of them). The boss
                // island lists all 5 — you go up one side, so the AI needs the
                // defenders on both sides + the boss to recommend which way.
                const CAND_SLOTS = ["pa_l", "pa_c", "pa_r", "pb_l", "pb_c", "pb_r", "pc_l", "pc_c", "pc_r", "boss_top", "boss_ul", "boss_ur", "boss_ll", "boss_lr"]
                const candidates = CAND_SLOTS.map((sk) => bySlot.get(sk)).filter((m): m is MiniNode => !!m)
                // The section a slot belongs to, and the node number parsed from its
                // label — so the list below can read in walking/node order (you take
                // ONE from each cluster, not all of one then the next).
                const sectionOf = (slot: string | null) =>
                  slot?.startsWith("pa_") ? "Path A" : slot?.startsWith("pb_") ? "Path B" : slot?.startsWith("pc_") ? "Path C" : slot?.startsWith("boss_") ? "Boss" : ""
                const nodeNum = (label: string) => { const mm = label.match(/\d+/); return mm ? parseInt(mm[0], 10) : Infinity }
                // Group placed minis into clusters, each cluster + its members sorted
                // by node number (fallback: fixed Path A→B→C→Boss / L→C→R order).
                const clusterOrderFallback = ["Path A", "Path B", "Path C", "Boss"]
                const sideOrder = (slot: string | null) => (slot?.endsWith("_l") || slot === "boss_ll" ? 0 : slot?.endsWith("_c") ? 1 : 2)
                // Boss island reads Left (upper, lower), Right (upper, lower), Boss.
                const bossOrder: Record<string, number> = { boss_ul: 0, boss_ll: 1, boss_ur: 2, boss_lr: 3, boss_top: 4 }
                const groupClusters = (list: MiniNode[]) => {
                  const by = new Map<string, MiniNode[]>()
                  for (const m of list) { const sec = sectionOf(m.slot); if (!sec) continue; if (!by.has(sec)) by.set(sec, []); by.get(sec)!.push(m) }
                  const clusters = [...by.entries()].map(([section, nodes]) => ({
                    section,
                    nodes: nodes.sort((a, b) => section === "Boss"
                      ? (bossOrder[a.slot ?? ""] ?? 9) - (bossOrder[b.slot ?? ""] ?? 9)
                      : (nodeNum(a.label) - nodeNum(b.label) || sideOrder(a.slot) - sideOrder(b.slot))),
                    // Boss sorts LAST (it's the end of the run); paths by min node number.
                    min: section === "Boss" ? Infinity : Math.min(...nodes.map((n) => nodeNum(n.label))),
                  }))
                  return clusters.sort((a, b) => a.min - b.min || clusterOrderFallback.indexOf(a.section) - clusterOrderFallback.indexOf(b.section))
                }
                return (
                  <>
                    {/* The map — same shape as the in-game AW map. Tap an empty ring to
                        add that node; tap a filled node to toggle taking it this war. */}
                    <div className="relative w-full max-w-[540px] mx-auto select-none" style={{ aspectRatio: "100/130" }}>
                      <svg viewBox="0 0 100 130" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                        {MAP_EDGES.map(([x1, y1, x2, y2], i) => (
                          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1f5c33" strokeWidth="0.6" />
                        ))}
                        {MAP_DOTS.map(([x, y], i) => (
                          <circle key={i} cx={x} cy={y} r="1.3" fill="#38b6ff" opacity="0.9" />
                        ))}
                        {MAP_LABELS.map((l, i) => (
                          <text key={i} x={l.x} y={l.y} textAnchor="middle" fontSize="3.2" fill={GREEN} opacity="0.45"
                            style={{ letterSpacing: "0.6px" }}>{l.text}</text>
                        ))}
                      </svg>
                      {MAP_SLOTS.map((s) => {
                        const m = bySlot.get(s.key)
                        const pos = { left: `${s.x}%`, top: `${(s.y / 1.3).toFixed(3)}%` }
                        if (!m) {
                          return (
                            <button key={s.key}
                              onClick={() => (placingId ? placeMini(placingId, s.key) : createInSlot(s.key))}
                              disabled={addingMini}
                              className={`absolute -translate-x-1/2 -translate-y-1/2 w-[17%] sm:w-[15%] aspect-square rounded-full border-2 border-dashed flex items-center justify-center text-sm transition-all ${placingId ? "border-[#33ff66] text-[#33ff66] animate-pulse bg-[#33ff66]/10" : "border-[#1f5c33] opacity-50 hover:opacity-100 hover:border-[#33ff66] active:bg-[#33ff66]/10"}`}
                              style={pos}
                              title={placingId ? "Place the node here" : `Add the ${s.hint || "node"} here`}>
                              {s.hint ? <span className="text-[9px] font-bold tracking-widest opacity-80">{s.hint}</span> : "＋"}
                            </button>
                          )
                        }
                        const live = isLive(m)
                        const editingThis = editingMiniId === m.id
                        // In recommend mode, a candidate with a defender typed reads as
                        // "in the running"; the winner (live) glows green after a plan.
                        const candidate = miniMode === "recommend" && !!m.defender.trim()
                        return (
                          <div key={s.key} className="absolute -translate-x-1/2 -translate-y-1/2 w-[18%] sm:w-[15%]" style={pos}>
                            {/* One consistent action: tap the node to open its editor
                                (photo, take, defender). Big target for mobile. */}
                            <button onClick={() => { if (!placingId) setEditingMiniId(editingThis ? null : m.id) }}
                              className={`relative w-full aspect-square rounded-full border-2 overflow-hidden flex items-center justify-center transition-all active:scale-95 ${live ? "border-[#33ff66] shadow-[0_0_12px_rgba(51,255,102,0.45)]" : editingThis ? "border-[#33ff66]" : candidate ? "border-[#38b6ff]/70 opacity-90" : "border-[#1f5c33] opacity-60 hover:opacity-90"}`}
                              title={`${m.label || s.hint || "Node"} — tap to edit / add photo`}>
                              {m.nodesImageUrl
                                ? <img src={m.nodesImageUrl} alt="" className={`absolute inset-0 w-full h-full object-cover ${live ? "" : "grayscale-[40%]"}`} />
                                : <span className="text-base opacity-70">📷</span>}
                              {live && <span className="absolute inset-0 rounded-full ring-2 ring-[#33ff66]/60" />}
                              {live && <span className="absolute bottom-0 inset-x-0 text-[7px] font-bold text-black bg-[#33ff66] text-center leading-tight py-px">TAKING</span>}
                              {candidate && !live && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#38b6ff] border border-black" title="Defender set — in the running" />}
                            </button>
                            <p className={`mt-0.5 text-center text-[9px] uppercase tracking-widest truncate ${live ? "opacity-90" : "opacity-50"}`}
                              style={{ color: live ? GREEN : undefined }}>
                              {m.label || s.hint || "—"}
                            </p>
                          </div>
                        )
                      })}
                    </div>

                    <p className="text-[11px] opacity-50 text-center">
                      {placingId
                        ? "Tap an empty ring to place the node — or press Cancel below."
                        : miniMode === "recommend"
                          ? (path?.miniRecs?.length ? "Green = this war's recommendation. Tap any node to add its photo or change its defender." : "Tap each node to add its photo + defender, then Plan my path for a recommendation.")
                          : "Tap an empty ring to add a node. Tap a node to add its photo or take it this war."}
                    </p>

                    {/* Node editor — one place for everything: photo, take, defender.
                        Big controls so it's easy on a phone. */}
                    {editing && (() => {
                      const sec = editing.slot?.startsWith("pa_") ? "Path A" : editing.slot?.startsWith("pb_") ? "Path B" : editing.slot?.startsWith("pc_") ? "Path C" : editing.slot?.startsWith("boss_") ? "Boss" : ""
                      const hint = MAP_SLOTS.find((s) => s.key === editing.slot)?.hint ?? ""
                      const showDefender = miniMode === "recommend" || editing.taking
                      return (
                        <div ref={miniEditorRef} className="border-2 border-[#33ff66]/40 rounded-xl p-3 space-y-3 max-w-[540px] mx-auto w-full bg-[#33ff66]/[0.04]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] uppercase tracking-widest opacity-70">Editing {sec ? `${sec}${hint ? ` · ${hint}` : ""}` : "node"}</span>
                            <button onClick={() => setEditingMiniId(null)} className="px-4 py-2 rounded-lg border border-[#1f5c33] text-sm hover:border-[#33ff66] active:bg-[#33ff66]/10">✓ Done</button>
                          </div>

                          {/* Photo — big, obvious */}
                          <button onClick={() => pickMiniPhoto(editing.id)} disabled={miniUploadingId === editing.id}
                            className="w-full h-40 rounded-lg border-2 border-dashed border-[#1f5c33] hover:border-[#33ff66] active:border-[#33ff66] overflow-hidden flex items-center justify-center text-sm opacity-80 disabled:opacity-40 transition-colors">
                            {miniUploadingId === editing.id
                              ? <span className="animate-pulse">Saving photo…</span>
                              : editing.nodesImageUrl
                                ? <img src={editing.nodesImageUrl} alt="Node" className="w-full h-full object-contain" />
                                : <span className="text-center leading-relaxed">📷 Tap to add this node&apos;s photo<br /><span className="opacity-60 text-xs">(only needed once)</span></span>}
                          </button>
                          {editing.nodesImageUrl && (
                            <button onClick={() => pickMiniPhoto(editing.id)} className="text-xs opacity-60 hover:opacity-100 underline">Change photo</button>
                          )}

                          {/* Label */}
                          <input
                            value={editing.label}
                            onChange={(e) => editMini(editing.id, { label: e.target.value })}
                            onBlur={(e) => setMiniNodeLabel(editing.id, e.target.value).catch(() => {})}
                            placeholder="Node label (e.g. Node 44)…"
                            className={`${input} w-full py-2.5`} style={{ color: GREEN }} />

                          {/* Take this war (pick mode) */}
                          {miniMode === "pick" && (
                            <button onClick={() => toggleTaking(editing.id)}
                              className={`w-full py-3 rounded-lg text-sm font-bold uppercase tracking-widest border-2 transition-colors ${editing.taking ? "text-black border-transparent" : "border-[#1f5c33] hover:border-[#33ff66] active:bg-[#33ff66]/10"}`}
                              style={editing.taking ? { background: GREEN } : undefined}>
                              {editing.taking ? "✓ Taking this war — tap to drop" : "＋ Take this war"}
                            </button>
                          )}

                          {/* Defender (recommend: always; pick: once taking) */}
                          {showDefender && (
                            <div className="space-y-1">
                              <p className="text-[10px] uppercase tracking-widest opacity-50">Defender on this node this war</p>
                              <input value={editing.defender}
                                onChange={(e) => editMini(editing.id, { defender: e.target.value })}
                                onBlur={(e) => setMiniNodeDefender(editing.id, e.target.value).catch(() => {})}
                                list="mcoc-all-champs"
                                placeholder="Who's defending…"
                                className={`${input} w-full py-2.5`} style={{ color: GREEN }} />
                            </div>
                          )}

                          <div className="flex items-center gap-3 pt-1">
                            {editing.slot && (
                              <button onClick={() => unplaceMini(editing.id)} className="text-xs opacity-60 hover:opacity-100" title="Take it off the map (keeps the photo)">📍 Off the map</button>
                            )}
                            <button onClick={() => removeMini(editing.id)} className="text-xs text-red-400 opacity-70 hover:opacity-100 ml-auto" title="Delete this node entirely">🗑 Delete node</button>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Unplaced nodes (from before the map, or unplaced by hand) */}
                    {unplaced.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-widest opacity-40">Not on the map:</span>
                        {unplaced.map((m) => (
                          <span key={m.id} className="inline-flex items-center gap-1.5 border border-[#1f5c33] rounded-lg pl-1 pr-1.5 py-1">
                            {m.nodesImageUrl && <img src={m.nodesImageUrl} alt="" className="w-6 h-6 rounded object-cover" />}
                            <span className="text-[11px] opacity-80">{m.label || "Unnamed"}</span>
                            {placingId === m.id
                              ? <button onClick={() => setPlacingId(null)} className="text-[10px] text-amber-300 hover:opacity-80">Cancel</button>
                              : <button onClick={() => { setPlacingId(m.id); setEditingMiniId(null) }} className="text-[10px] opacity-60 hover:opacity-100" title="Then tap an empty ring on the map">📍 Place</button>}
                            <button onClick={() => setEditingMiniId(m.id)} className="text-[10px] opacity-60 hover:opacity-100" title="Edit">✎</button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Pick mode: defender per selected (taken) node, in node order */}
                    {miniMode === "pick" && takenMinis.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-widest opacity-50">This war&apos;s minis — in node order</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {[...takenMinis].sort((a, b) =>
                            nodeNum(a.label) - nodeNum(b.label)
                            || (clusterOrderFallback.indexOf(sectionOf(a.slot)) + 1 || 99) - (clusterOrderFallback.indexOf(sectionOf(b.slot)) + 1 || 99)
                          ).map((m) => {
                            const cls = defClass(m.defender)
                            return (
                              <div key={m.id} className="border border-[#33ff66]/50 rounded-lg p-2 flex gap-2.5 items-center">
                                <div className="shrink-0 w-12 h-12 rounded-lg border border-[#1f5c33] overflow-hidden flex items-center justify-center text-[9px] opacity-80">
                                  {m.nodesImageUrl
                                    ? <img src={m.nodesImageUrl} alt="" className="w-full h-full object-cover" />
                                    : <span>📷</span>}
                                </div>
                                <div className="flex-1 min-w-0 space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] uppercase tracking-widest opacity-60 truncate">{m.label || "Node"}</span>
                                    {cls && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: classColour(cls) }} title={cls} />}
                                    <button onClick={() => toggleTaking(m.id)} className="ml-auto text-[10px] opacity-50 hover:opacity-100 shrink-0" title="Not taking this one after all">✕ drop</button>
                                  </div>
                                  <input value={m.defender}
                                    onChange={(e) => editMini(m.id, { defender: e.target.value })}
                                    onBlur={(e) => setMiniNodeDefender(m.id, e.target.value).catch(() => {})}
                                    list="mcoc-all-champs"
                                    placeholder="Defender on this node…"
                                    className={`${input} w-full py-1 text-sm`} style={{ color: GREEN }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Recommend mode: type the defender on every candidate node,
                        grouped by cluster in node order — you take ONE per cluster. */}
                    {miniMode === "recommend" && (
                      candidates.length > 0 ? (
                        <div className="space-y-3">
                          <p className="text-[10px] uppercase tracking-widest opacity-50">Candidate defenders — who&apos;s on each this war (take one per cluster)</p>
                          {groupClusters(candidates).map((cluster) => (
                            <div key={cluster.section} className="space-y-1.5">
                              <p className="text-[10px] uppercase tracking-widest text-[#38b6ff]/80">{cluster.section} <span className="opacity-50 text-white">· {cluster.section === "Boss" ? "go left or right" : "take one"}</span></p>
                              <div className="grid gap-2 sm:grid-cols-3">
                                {cluster.nodes.map((m) => {
                                  const cls = defClass(m.defender)
                                  const won = (path?.miniRecs ?? []).some((r) => r.slot === m.slot)
                                  const slotHint = MAP_SLOTS.find((s) => s.key === m.slot)
                                  return (
                                    <div key={m.id} className={`border rounded-lg p-2 flex gap-2.5 items-center ${won ? "border-[#33ff66]/70 bg-[#33ff66]/5" : "border-[#1f5c33]"}`}>
                                      <div className="shrink-0 w-12 h-12 rounded-lg border border-[#1f5c33] overflow-hidden flex items-center justify-center text-[9px] opacity-80">
                                        {m.nodesImageUrl ? <img src={m.nodesImageUrl} alt="" className="w-full h-full object-cover" /> : <span>📷</span>}
                                      </div>
                                      <div className="flex-1 min-w-0 space-y-1">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] uppercase tracking-widest opacity-60 truncate">{slotHint?.hint}{m.label ? ` · ${m.label}` : ""}</span>
                                          {cls && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: classColour(cls) }} title={cls} />}
                                          {won && <span className="ml-auto text-[9px] font-bold text-[#33ff66] shrink-0">✓ PICKED</span>}
                                        </div>
                                        <input value={m.defender}
                                          onChange={(e) => editMini(m.id, { defender: e.target.value })}
                                          onBlur={(e) => setMiniNodeDefender(m.id, e.target.value).catch(() => {})}
                                          list="mcoc-all-champs"
                                          placeholder="Defender…"
                                          className={`${input} w-full py-1 text-sm`} style={{ color: GREEN }} />
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] opacity-50">Add mini nodes to the paths first (＋ on the map), then their defenders appear here to fill in.</p>
                      )
                    )}

                    <input ref={miniPhotoInput} type="file" accept="image/*" className="hidden"
                      onChange={(e) => { uploadMiniPhoto(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
                  </>
                )
              })()}
            </div>

            {/* Must-use attackers — the plan reports which fights each one handles. */}
            <div className="border-t border-[#1f5c33] pt-3 space-y-2">
              <p className="text-[11px] opacity-60">
                🎯 Must-use attackers <span className="opacity-70">(optional)</span> — champs you want to bring; the plan tells you which fights each one handles.
              </p>
              <div className="flex gap-2 items-center flex-wrap">
                <input value={forcedInput} onChange={(e) => setForcedInput(e.target.value)} list="mcoc-all-champs"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addForced(forcedInput) } }}
                  placeholder="Add an attacker you want to use…"
                  className={`${input} flex-1 min-w-[12rem]`} style={{ color: GREEN }} />
                <button onClick={() => addForced(forcedInput)} disabled={!forcedInput.trim() || forced.length >= 8}
                  className="px-3 py-2 rounded-lg border border-[#1f5c33] text-xs hover:border-[#33ff66] disabled:opacity-30 transition-colors">ADD</button>
              </div>
              {forced.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {forced.map((f) => (
                    <span key={f} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border border-[#33ff66]">
                      {ownedByName.get(normChampName(f))?.imageUrl && <img src={ownedByName.get(normChampName(f))!.imageUrl!} alt="" width={18} height={18} className="rounded object-cover" />}
                      <span className="text-white">{f}</span>
                      <button onClick={() => setForced((l) => l.filter((x) => x !== f))} className="text-red-400" title="Remove">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <button onClick={planPath} disabled={pathBusy || warLoading || (!warFights.some((f) => f.defender.trim()) && !(miniMode === "recommend" ? minis.some((m) => m.slot && m.defender.trim()) : takenMinis.some((m) => m.defender.trim())))}
              className="px-5 py-2.5 rounded-lg text-sm font-bold text-black disabled:opacity-40 transition-colors"
              style={{ background: GREEN }}>
              {pathBusy ? "PLANNING…" : "🗡 PLAN MY PATH"}
            </button>
            {pathErr && <p className="text-sm text-red-400">✗ {pathErr}</p>}

            {path && (
              <div className="space-y-3 border-t border-[#1f5c33] pt-3">
                {path.groundedFallback && (
                  <p className="text-[11px] text-amber-400">
                    ⚠ Live search didn&apos;t work on this run, so this is from the model&apos;s own (older) knowledge — it may miss newer or
                    recently-buffed champs. Try again, or switch model above for better picks.
                  </p>
                )}
                {/* Recommended minis (recommend mode) — 1 per path + a boss side. */}
                {path.miniRecs && path.miniRecs.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-widest opacity-50">👑 Recommended minis — take these this war</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {path.miniRecs.map((r, i) => (
                        <div key={i} className="border border-amber-400/60 rounded-lg px-3 py-2 text-sm">
                          <p className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-400 text-amber-300 shrink-0">{r.section} · {r.side}</span>
                            <span className="text-white font-bold">{r.defender}</span>
                            {r.label && <span className="text-[10px] opacity-50">({r.label})</span>}
                          </p>
                          <div className="flex items-start gap-2">
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded mt-0.5 shrink-0 text-black" style={{ background: GREEN }}>TAKE</span>
                            <div className="min-w-0">
                              <ChampInline name={r.attacker} />
                              {r.why && <p className="text-xs opacity-70 mt-0.5">{r.why}</p>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Must-use attackers → which fights each handles. Shown first —
                    it's what Jordan asked the plan for. */}
                {path.forced && path.forced.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-widest opacity-50">🎯 Your must-use attackers — which fights they handle</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {path.forced.map((f, i) => (
                        <div key={i} className="border border-[#33ff66] rounded-lg p-3 space-y-2">
                          <ChampInline name={f.attacker} />
                          {f.fights.length === 0 ? (
                            <p className="text-[11px] text-red-400">No good fight for this one on this path.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {f.fights.map((x, j) => (
                                <div key={j} className="flex items-start gap-2 text-xs">
                                  <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${RATING_COL[x.rating] ?? RATING_COL.good}`}>{x.rating}</span>
                                  <div className="min-w-0">
                                    <span className="text-white">Fight {x.fight}</span>
                                    {x.defender && <span className="opacity-60"> · {x.defender}</span>}
                                    {x.how && <p className="opacity-70 mt-0.5">{x.how}</p>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${f.miniLabel ? "border-amber-400 text-amber-300" : "border-[#1f5c33] opacity-80"}`}>
                          {f.miniLabel ? `👑 MINI — ${f.miniLabel}` : `FIGHT ${i + 1}`}
                        </span>
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
