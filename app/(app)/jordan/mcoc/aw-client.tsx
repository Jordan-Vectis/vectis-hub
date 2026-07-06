"use client"

import { useRef, useState } from "react"
import ModelPicker, { getJordanModel } from "../model-picker"
import { classColour, normChampName } from "@/lib/mcoc"
import type { Champ } from "./mcoc-hub"

// 🏰 ALLIANCE WAR — two planners:
//   PATH: pick the defenders on your war path → best 3-champ attack team from
//   your roster, with per-fight assignments.
//   DEFENCE: recommend which of your champs to place on which defence nodes.

const GREEN = "#33ff66"

type PathResult = {
  team: { champion: string; why: string }[]
  assignments: { defender: string; attacker: string; how: string }[]
  risks: string; alternates: string
}
type DefResult = { placements: { node: string; champion: string; why: string }[]; notes: string }

export default function AwClient({ roster }: { roster: Champ[] }) {
  const [mode, setMode] = useState<"path" | "defence">("path")
  const ownedByName = new Map(roster.map((c) => [normChampName(c.name), c]))
  const rosterPayload = () => JSON.stringify(roster.map((c) => ({ name: c.name, stars: c.stars, rank: c.rank })))

  // ── Path planner ──
  const [defenders, setDefenders] = useState<string[]>([])
  const [defInput, setDefInput] = useState("")
  const [nodes, setNodes] = useState("")
  const [pathBusy, setPathBusy] = useState(false)
  const [pathErr, setPathErr] = useState<string | null>(null)
  const [path, setPath] = useState<PathResult | null>(null)

  function addDefender(raw: string) {
    const d = raw.replace(/\s+/g, " ").trim()
    if (!d || defenders.some((x) => normChampName(x) === normChampName(d))) { setDefInput(""); return }
    setDefenders((l) => [...l, d]); setDefInput("")
  }

  async function planPath() {
    if (pathBusy || !defenders.length) return
    setPathBusy(true); setPathErr(null); setPath(null)
    try {
      const res = await fetch("/api/jordan/mcoc/aw-path", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defenders, nodes: nodes.trim() || undefined, roster: JSON.parse(rosterPayload()), model: getJordanModel() || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Planning failed — try again.")
      setPath(j)
    } catch (e: any) {
      setPathErr(e?.message ?? "Planning failed — try again.")
    } finally { setPathBusy(false) }
  }

  // ── Defence placer ──
  const defFile = useRef<HTMLInputElement>(null)
  const [mapFile, setMapFile] = useState<File | null>(null)
  const [mapPreview, setMapPreview] = useState<string | null>(null)
  const [defNotes, setDefNotes] = useState("")
  const [defCount, setDefCount] = useState(5)
  const [defBusy, setDefBusy] = useState(false)
  const [defErr, setDefErr] = useState<string | null>(null)
  const [defence, setDefence] = useState<DefResult | null>(null)

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
          <span className="ml-auto"><ModelPicker /></span>
        </div>

        {mode === "path" && (
          <div className="space-y-3">
            <p className="text-sm opacity-70">Add the defenders on your path — get the best 3-champ team from your roster to clear them all.</p>

            <div className="flex gap-2 items-center flex-wrap">
              <input value={defInput} onChange={(e) => setDefInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDefender(defInput) } }}
                placeholder="Defender name + Enter…"
                className={`${input} flex-1 min-w-[12rem]`} style={{ color: GREEN }} />
              <button onClick={() => addDefender(defInput)} disabled={!defInput.trim()}
                className="px-3 py-2 rounded-lg border border-[#1f5c33] text-xs hover:border-[#33ff66] disabled:opacity-30 transition-colors">ADD</button>
            </div>

            {defenders.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {defenders.map((d, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border border-[#1f5c33]">
                    <span className="opacity-40">{i + 1}</span> <span className="text-white">{d}</span>
                    <button onClick={() => setDefenders((l) => l.filter((_, j) => j !== i))} className="text-red-400">×</button>
                  </span>
                ))}
              </div>
            )}

            <textarea value={nodes} onChange={(e) => setNodes(e.target.value)} rows={2}
              placeholder="Optional — node buffs on this path (e.g. node 24 Flow, node 25 Aggression Regen)…"
              className={`${input} w-full resize-none`} style={{ color: GREEN }} />

            <button onClick={planPath} disabled={pathBusy || !defenders.length}
              className="px-5 py-2.5 rounded-lg text-sm font-bold text-black disabled:opacity-40 transition-colors"
              style={{ background: GREEN }}>
              {pathBusy ? "PLANNING…" : "🗡 PLAN MY PATH"}
            </button>
            {pathErr && <p className="text-sm text-red-400">✗ {pathErr}</p>}

            {path && (
              <div className="space-y-3 border-t border-[#1f5c33] pt-3">
                <p className="text-[10px] uppercase tracking-widest opacity-50">Your team</p>
                <div className="space-y-1.5">
                  {path.team.map((t, i) => (
                    <div key={i} className="border border-[#33ff66] rounded-lg px-3 py-2">
                      <ChampInline name={t.champion} />
                      {t.why && <p className="text-xs opacity-70 mt-1">{t.why}</p>}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] uppercase tracking-widest opacity-50">Fight by fight</p>
                <div className="space-y-1.5">
                  {path.assignments.map((a, i) => (
                    <div key={i} className="border border-[#1f5c33] rounded-lg px-3 py-2 text-sm">
                      <p><span className="opacity-60">{a.defender}</span> <span className="opacity-40">→</span> <ChampInline name={a.attacker} /></p>
                      {a.how && <p className="text-xs opacity-70 mt-0.5">{a.how}</p>}
                    </div>
                  ))}
                </div>
                {path.risks && <p className="text-xs text-amber-300">⚠ {path.risks}</p>}
                {path.alternates && <p className="text-xs opacity-60">Alternates: {path.alternates}</p>}
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
