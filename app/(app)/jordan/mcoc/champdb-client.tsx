"use client"

import { useEffect, useState, useTransition } from "react"
import { MCOC_CLASSES, classColour, normChampName } from "@/lib/mcoc"
import { addMyCounter, removeMyCounter, deleteChampionProfile } from "@/lib/actions/mcoc"
import ModelPicker, { getJordanModel } from "../model-picker"
import type { Champ } from "./mcoc-hub"

// 🧬 Champion DB — build & browse the all-champions database that powers the
// instant counter engine. Two build steps (grounded AI): ① enumerate every
// champion by class, ② compute each champ's full profile (immunities, tags,
// abilities breakdown, best counters, defender notes). Click a champion in the
// browse list to expand its full spotlight-style detail.

const GREEN = "#33ff66"
// A re-scan (Update meta) persists its staleBefore here so it can RESUME after a
// stop (rate limits / closed tab) instead of redoing every champion.
const RESCAN_KEY = "mcoc_meta_rescan_at"

// Name → token SET, for duplicate detection. Splits on non-alphanumerics and
// lowercases: "Hulk (Immortal)" and "Immortal Hulk" both give {hulk, immortal}.
// (normChampName can't be used — it strips separators, so word-order variants
// collapse to different strings, e.g. "immortalhulk" vs "hulkimmortal".)
function nameTokens(name: string): Set<string> {
  return new Set((name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
}
// Two names are the SAME champ if their token sets are equal — a pure word
// reorder ("Immortal Hulk" == "Hulk (Immortal)"). This is high-precision: the
// game names a champ one way, so two orderings are always a catalogue
// inconsistency, never two real champs. A looser subset test ("Bishop" ⊂ "Kate
// Bishop", "Warlock" ⊂ "Adam Warlock") flooded the list with false pairs, so
// it's NOT used — the per-row 🗑 covers the few bare-vs-qualified dupes.
const sameTokenSet = (a: Set<string>, b: Set<string>) =>
  a.size > 0 && a.size === b.size && [...a].every((t) => b.has(t))

type Status = { total: number; profiled: number; unbuilt: number }
type Ability = { name: string; details: string[] }
type Profile = {
  name: string; class: string; immunities: string[]; tags: string[]; summary: string
  abilities?: Ability[] | null; counters: string[]; myCounters?: string[]; defenderNotes: string; profileAt: string | null
}

export default function ChampDbClient({ roster }: { roster: Champ[] }) {
  const ownedByName = new Map<string, Champ>()
  for (const c of roster) {
    const k = normChampName(c.name)
    const cur = ownedByName.get(k)
    if (!cur || c.stars > cur.stars || (c.stars === cur.stars && c.rank > cur.rank)) ownedByName.set(k, c)
  }
  const [open, setOpen] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [list, setList] = useState<Profile[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [query, setQuery] = useState("")
  const [dbAdd, setDbAdd] = useState("")
  const [metaPending, setMetaPending] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)  // row awaiting delete confirm
  const [delBusy, setDelBusy] = useState<string | null>(null)        // row being deleted
  const [, startTransition] = useTransition()

  const rosterNames = Array.from(new Set(roster.map((c) => c.name))).sort()

  // Add/remove Jordan's own counters straight from the DB detail (optimistic +
  // persisted). Matched by defender name — same server actions as the instant view.
  function setMy(champName: string, next: string[], action: () => Promise<unknown>) {
    setList((l) => l.map((p) => (p.name === champName ? { ...p, myCounters: next } : p)))
    startTransition(async () => { await action() })
  }
  function addMy(champName: string, current: string[], raw: string) {
    const name = raw.replace(/\s+/g, " ").trim()
    setDbAdd("")
    if (!name || current.some((c) => normChampName(c) === normChampName(name))) return
    setMy(champName, [...current, name], () => addMyCounter(champName, name))
  }
  function removeMy(champName: string, current: string[], name: string) {
    setMy(champName, current.filter((c) => normChampName(c) !== normChampName(name)), () => removeMyCounter(champName, name))
  }

  async function refreshData() {
    try {
      const [s, l] = await Promise.all([
        fetch("/api/jordan/mcoc/profiles/status").then((r) => r.json()),
        fetch("/api/jordan/mcoc/profiles/list?full=1").then((r) => r.json()),
      ])
      setStatus(s)
      setList(Array.isArray(l?.champions) ? l.champions : [])
    } catch {}
  }
  useEffect(() => { refreshData() }, [])
  useEffect(() => {
    // Surface a half-finished re-scan so the button offers Resume (deferred a
    // tick to avoid a synchronous setState in the effect).
    queueMicrotask(() => { try { setMetaPending(!!localStorage.getItem(RESCAN_KEY)) } catch {} })
  }, [])

  const model = () => { const m = getJordanModel(); return m || undefined }

  async function buildList() {
    if (busy) return
    setBusy(true); setMsg(null); setProg({ done: 0, total: MCOC_CLASSES.length })
    try {
      for (let i = 0; i < MCOC_CLASSES.length; i++) {
        const cls = MCOC_CLASSES[i]
        setMsg(`Listing ${cls} champions…`)
        const res = await fetch("/api/jordan/mcoc/catalog", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ class: cls, model: model() }),
        })
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Failed on ${cls}`) }
        setProg({ done: i + 1, total: MCOC_CLASSES.length })
        await refreshData()
      }
      setMsg("✓ Champion list built. Now build the profiles below.")
    } catch (e: any) {
      setMsg("✗ " + (e?.message ?? "Failed."))
    } finally { setBusy(false); setProg(null) }
  }

  async function buildProfiles(refresh: boolean) {
    if (busy) return
    setBusy(true); setProg(null)

    // Re-scan (Update meta) is RESUMABLE: persist the run's staleBefore so a stop
    // half-way resumes rather than redoing every champion. (② Build profiles is
    // already resumable — it just targets champs with no profile yet.)
    let staleBefore: string | null = null
    let resuming = false
    if (refresh) {
      try { staleBefore = localStorage.getItem(RESCAN_KEY) } catch {}
      resuming = !!staleBefore
      if (!staleBefore) {
        staleBefore = new Date().toISOString()
        try { localStorage.setItem(RESCAN_KEY, staleBefore) } catch {}
      }
      setMetaPending(true)
    }
    setMsg(refresh
      ? (resuming ? "Resuming the meta re-scan…" : "Re-scanning the meta — reading the first batch (this can take a moment)…")
      : "Building profiles — reading the first batch (this can take a moment)…")

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const resumeHint = refresh ? "Resume update meta" : "② Build profiles"
    let runTotal = 0
    let stalls = 0
    try {
      // Keep looping until nothing remains. Nothing is ever lost — every profiled
      // champ is saved immediately — so on rate limits we just back off and carry
      // on, only pausing (never restarting) after a long run of no progress.
      for (let guard = 0; guard < 3000; guard++) {
        let j: { error?: string; remaining?: number; done?: number; failed?: number; rateLimited?: boolean; names?: string[] } = {}
        try {
          const res = await fetch("/api/jordan/mcoc/profiles/build", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ limit: 3, staleBefore, model: model() }),
          })
          j = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(j?.error || "Build failed")
        } catch {
          stalls++
          if (stalls >= 6) { setMsg(`Paused — the connection keeps failing. Progress is saved; press ${resumeHint} to carry on.`); break }
          const wait = Math.min(15000 * stalls, 60000)
          setMsg(`Hit a snag — waiting ${Math.round(wait / 1000)}s then continuing… (progress saved)`)
          await sleep(wait)
          continue
        }

        const remaining = j.remaining ?? 0
        // Progress = work done THIS run. Total = what's left + what we've done so
        // far, captured on the first response. (Don't use profiled/total: on a
        // re-scan every champ already has a profileAt, so profiled sits at total
        // the whole time and the bar looks frozen — that was the old bug.)
        if (runTotal === 0) runTotal = remaining + (j.done ?? 0)
        const completed = Math.max(0, runTotal - remaining)
        setProg({ done: completed, total: runTotal })
        await refreshData()

        if (remaining <= 0) {
          if (refresh) { try { localStorage.removeItem(RESCAN_KEY) } catch {}; setMetaPending(false) }
          setMsg(`✓ Done — ${refresh ? "re-scanned" : "profiled"} ${completed} champion${completed === 1 ? "" : "s"}.`)
          break
        }

        if (j.rateLimited || (j.done ?? 0) === 0) {
          // No progress (rate limits). Back off and keep going — the run is saved,
          // so it never starts over. Give up only after a long run of nothing.
          stalls++
          if (stalls >= 6) {
            setMsg(`Paused at ${completed}/${runTotal} — the AI is rate-limiting hard. Progress is saved; press ${resumeHint} in a few minutes to carry on.`)
            break
          }
          const wait = Math.min(20000 * stalls, 90000)
          setMsg(`Rate limited — waiting ${Math.round(wait / 1000)}s, then continuing… ${completed}/${runTotal} done (saved)`)
          await sleep(wait)
        } else {
          stalls = 0
          const just = Array.isArray(j.names) && j.names.length ? ` · just did ${j.names.slice(0, 3).join(", ")}${j.names.length > 3 ? "…" : ""}` : ""
          setMsg(`${refresh ? "Re-scanning" : "Building"} champion profiles… ${completed}/${runTotal}${j.failed ? ` · ${j.failed} will retry` : ""}${just}`)
          await sleep(1200)   // gentle pace between good batches
        }
      }
    } catch (e: any) {
      setMsg("✗ " + (e?.message ?? "Build failed."))
    } finally { setBusy(false); setProg(null) }
  }

  function clearRescan() {
    try { localStorage.removeItem(RESCAN_KEY) } catch {}
    setMetaPending(false)
    setMsg("Cleared the paused re-scan — 'Update meta' will start fresh.")
  }

  const shown = list.filter((c) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return c.name.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q)) || c.immunities.some((t) => t.toLowerCase().includes(q))
  })
  const pct = status && status.total ? Math.round((status.profiled / status.total) * 100) : 0

  // Possible-duplicate hint: a row with an EQUAL token set to another (a word
  // reorder — "Immortal Hulk" / "Hulk (Immortal)") is the same champ catalogued
  // twice. High-precision, so it's shown as a real hint. The bare-vs-qualified
  // dupes it can't safely detect (Spider-Woman, Maestro) are left to the 🗑,
  // which is on every row. Keyed by name → its twin(s).
  const dupHint = new Map<string, string[]>()
  for (const c of list) {
    const ct = nameTokens(c.name)
    const twins = list.filter((o) => o.name !== c.name && sameTokenSet(ct, nameTokens(o.name))).map((o) => o.name)
    if (twins.length) dupHint.set(c.name, twins)
  }

  async function deleteEntry(name: string) {
    if (delBusy) return
    setDelBusy(name)
    try {
      const res = await deleteChampionProfile(name)
      if (!res.ok) throw new Error("error" in res ? String(res.error) : "Delete failed")
      setConfirmDel(null)
      if (open === name) setOpen(null)
      await refreshData()
    } catch {
      // A failed delete just leaves the row in place — Jordan can try again.
    } finally { setDelBusy(null) }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto font-mono space-y-4" style={{ color: GREEN }}>
      <datalist id="champdb-roster">
        {rosterNames.map((n) => <option key={n} value={n} />)}
      </datalist>
      <div className="border border-[#1f5c33] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm opacity-70">Build the all-champions database that powers instant counters. Grounded (live meta) — the build takes a while; leave it running.</p>
          <ModelPicker />
        </div>

        {status && (
          <div className="text-sm">
            <p>{status.total} champions catalogued · <span className="text-[#33ff66] font-bold">{status.profiled} profiled</span>{status.unbuilt > 0 ? ` · ${status.unbuilt} to build` : ""}</p>
            {status.total > 0 && (
              <div className="h-2 rounded-full bg-[#0a2214] overflow-hidden mt-1.5 border border-[#1f5c33]">
                <div className="h-full bg-[#33ff66] transition-all" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button onClick={buildList} disabled={busy}
            className="px-4 py-2 rounded-lg border border-[#33ff66] text-sm font-bold hover:bg-[#0a2214] disabled:opacity-40 transition-colors">
            ① Build champion list
          </button>
          <button onClick={() => buildProfiles(false)} disabled={busy || !status?.total}
            className="px-4 py-2 rounded-lg text-sm font-bold text-black disabled:opacity-40 transition-colors" style={{ background: GREEN }}>
            ② Build profiles{status && status.unbuilt > 0 ? ` (${status.unbuilt})` : ""}
          </button>
          <button onClick={() => buildProfiles(true)} disabled={busy || !status?.profiled}
            className="px-4 py-2 rounded-lg border text-sm hover:border-[#33ff66] disabled:opacity-40 transition-colors"
            style={{ borderColor: metaPending ? GREEN : "#1f5c33" }}>
            {metaPending ? "▶ Resume update meta" : "🔄 Update meta (re-scan all)"}
          </button>
          {metaPending && !busy && (
            <button onClick={clearRescan}
              className="px-3 py-2 rounded-lg border border-[#1f5c33] text-xs opacity-60 hover:opacity-100 transition-opacity">
              ✕ start fresh
            </button>
          )}
        </div>
        {msg && <p className={`text-xs ${msg.startsWith("✗") ? "text-red-400" : "opacity-80"}`}>{busy && <span className="animate-pulse">▮ </span>}{msg}</p>}
        {prog && prog.total > 0 ? (
          <div className="space-y-1">
            <div className="h-2.5 rounded-full bg-[#0a2214] overflow-hidden border border-[#1f5c33]">
              <div className="h-full bg-[#33ff66] transition-all duration-500" style={{ width: `${Math.round((prog.done / prog.total) * 100)}%` }} />
            </div>
            <p className="text-[10px] opacity-60 text-right">{Math.round((prog.done / prog.total) * 100)}% · {prog.done}/{prog.total}</p>
          </div>
        ) : busy ? (
          // Indeterminate — the first batch can take 20–40s before it reports back.
          <div className="h-2.5 rounded-full bg-[#0a2214] overflow-hidden border border-[#1f5c33] relative">
            <div className="absolute inset-y-0 w-1/3 bg-[#33ff66] rounded-full champdb-indet" />
          </div>
        ) : null}
        <style>{`@keyframes champdbIndet { 0%{left:-35%} 100%{left:100%} } .champdb-indet{ animation: champdbIndet 1.15s ease-in-out infinite; }`}</style>
      </div>

      {/* Browse */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="opacity-60">Browse &amp; manage — search name, tag or immunity</span>
        {dupHint.size > 0 && (
          <span className="text-[10px] text-amber-400/80">· {dupHint.size} flagged ⚠ as a possible duplicate — delete the junk ones with 🗑</span>
        )}
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. nullify, incinerate, Hercules…"
          className="bg-black border border-[#1f5c33] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#33ff66] placeholder:text-[#1f5c33] ml-auto w-64" style={{ color: GREEN }} />
      </div>

      <div className="space-y-1.5">
        {shown.map((c) => {
          const isOpen = open === c.name
          return (
            <div key={c.name} className={`border rounded-lg px-3 py-2 ${isOpen ? "border-[#33ff66]" : dupHint.has(c.name) ? "border-amber-700/50" : "border-[#1f5c33]"}`}>
              <div className="flex items-start gap-2">
                <button onClick={() => { setDbAdd(""); setOpen(isOpen ? null : c.name) }} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white">{c.name}</span>
                    {c.class && <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border" style={{ color: classColour(c.class), borderColor: classColour(c.class) + "88" }}>{c.class}</span>}
                    {ownedByName.has(normChampName(c.name)) && <span className="text-[10px] text-[#33ff66]">✓ owned</span>}
                    {!c.profileAt && <span className="text-[10px] opacity-40">not profiled yet</span>}
                    {dupHint.has(c.name) && (
                      <span className="text-[10px] text-amber-400" title={`Might be the same champion as: ${dupHint.get(c.name)!.join(", ")}. If it's a duplicate, delete it — if it's a real separate champ, leave it.`}>
                        ⚠ maybe same as {dupHint.get(c.name)!.join(", ")}
                      </span>
                    )}
                  </div>
                  {!isOpen && c.summary && <p className="text-xs opacity-70 mt-1">{c.summary}</p>}
                </button>
                {/* Two-step confirm inline — no browser confirm() anywhere in /jordan. */}
                {confirmDel === c.name ? (
                  <span className="flex items-center gap-1 shrink-0">
                    <button onClick={() => deleteEntry(c.name)} disabled={delBusy === c.name}
                      className="text-[10px] px-2 py-0.5 rounded border border-red-500 text-red-400 hover:bg-red-950/40 disabled:opacity-40 transition-colors">
                      {delBusy === c.name ? "…" : "Delete?"}
                    </button>
                    <button onClick={() => setConfirmDel(null)} disabled={delBusy === c.name}
                      className="text-[10px] px-2 py-0.5 rounded border border-[#1f5c33] opacity-60 hover:opacity-100 transition-opacity">No</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDel(c.name)} title="Delete this entry from the Champion DB"
                    className="shrink-0 opacity-30 hover:opacity-100 hover:text-red-400 transition-opacity text-sm">🗑</button>
                )}
                <button onClick={() => { setDbAdd(""); setOpen(isOpen ? null : c.name) }} className="shrink-0 opacity-40 text-xs pt-0.5">{isOpen ? "▾" : "▸"}</button>
              </div>

              {isOpen && (
                <div className="mt-2 space-y-3 border-t border-[#1f5c33] pt-2">
                  {c.summary && <p className="text-xs opacity-80">{c.summary}</p>}
                  {c.defenderNotes && <p className="text-xs text-amber-300">⚠ On defence: {c.defenderNotes}</p>}

                  {(c.immunities.length > 0 || c.tags.length > 0) && (
                    <div className="flex flex-wrap gap-1">
                      {c.immunities.map((t) => <span key={"i" + t} className="text-[10px] px-1.5 py-0.5 rounded border border-sky-700/60 text-sky-300">🛡 {t}</span>)}
                      {c.tags.map((t) => <span key={"t" + t} className="text-[10px] px-1.5 py-0.5 rounded border border-[#1f5c33] opacity-80">{t}</span>)}
                    </div>
                  )}

                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[#ffd23f] mb-1">👑 My counters</p>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {(c.myCounters ?? []).map((n) => {
                        const owned = ownedByName.get(normChampName(n))
                        return (
                          <span key={n} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border border-[#8a6d1a] text-white">
                            {owned?.imageUrl && <img src={owned.imageUrl} alt="" width={18} height={18} className="rounded object-cover" />}
                            {n}
                            {owned && <span className="text-[9px] text-[#33ff66]">{owned.stars}★R{owned.rank}</span>}
                            <button onClick={() => removeMy(c.name, c.myCounters ?? [], n)} className="text-[#ffd23f]/60 hover:text-red-400 ml-0.5 leading-none" title="Remove">×</button>
                          </span>
                        )
                      })}
                      <input
                        list="champdb-roster"
                        value={dbAdd}
                        onChange={(e) => setDbAdd(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMy(c.name, c.myCounters ?? [], dbAdd) } }}
                        placeholder="+ add your counter"
                        className="bg-black border border-[#8a6d1a]/60 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-[#ffd23f] placeholder:text-[#8a6d1a] w-40"
                        style={{ color: "#ffd23f" }}
                      />
                      {dbAdd.trim() && (
                        <button onClick={() => addMy(c.name, c.myCounters ?? [], dbAdd)} className="text-[11px] px-2 py-1 rounded-lg border border-[#ffd23f] text-[#ffd23f] hover:bg-[#ffd23f]/10">Add</button>
                      )}
                    </div>
                    <p className="text-[10px] opacity-40 mt-1">Your own picks — never overwritten by Update meta.</p>
                  </div>

                  {c.counters.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest opacity-50 mb-1">Best counters (when it defends)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {c.counters.map((n) => {
                          const owned = ownedByName.get(normChampName(n))
                          return (
                            <span key={n} className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border ${owned ? "border-[#33ff66] text-white" : "border-[#1f5c33] opacity-60"}`}>
                              {owned?.imageUrl && <img src={owned.imageUrl} alt="" width={18} height={18} className="rounded object-cover" />}
                              {n}
                              {owned && <span className="text-[9px] text-[#33ff66]">{owned.stars}★R{owned.rank}</span>}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {Array.isArray(c.abilities) && c.abilities.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase tracking-widest opacity-50">Abilities</p>
                      {c.abilities.map((a, i) => (
                        <div key={i} className="border border-[#1f5c33] rounded-lg p-2.5">
                          <p className="text-xs font-bold text-[#b8ff66] uppercase tracking-wide mb-1">{a.name}</p>
                          <ul className="space-y-0.5">
                            {a.details.map((d, j) => (
                              <li key={j} className="text-xs opacity-80 flex gap-1.5"><span className="opacity-40 shrink-0">•</span><span>{d}</span></li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : (
                    c.profileAt && <p className="text-[11px] opacity-50">No ability breakdown stored yet — run 🔄 Update meta to enrich this profile.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {status && status.total === 0 && <p className="text-sm opacity-50 text-center py-8">Empty — press ① Build champion list to start.</p>}
      </div>
    </div>
  )
}
