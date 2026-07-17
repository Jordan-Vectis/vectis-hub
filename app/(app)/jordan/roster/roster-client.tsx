"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { MCOC_CLASSES, classColour, normChampName } from "@/lib/mcoc"
import { addChampions, updateChampion, deleteChampion, applyBgsDeck, clearRoster, renameChampion } from "@/lib/actions/mcoc"
import ModelPicker, { getJordanModel } from "../model-picker"

type Champ = { id: string; name: string; class: string; stars: number; rank: number; bgsDeck: boolean; imageUrl: string | null }
type ReadChamp = { name: string; class: string; rank: number | null; inCatalog?: boolean; imageKey?: string; imageUrl?: string }
type Scanned = ReadChamp & { include: boolean; rank: number | null }
// A picked screenshot waiting to be read, with the rank Jordan says it contains.
// He filters his roster by rank in-game and shoots each tier, so the rank is a
// property of the PICTURE — which beats the AI reading the small rank badges
// (it misreads them) and beats one rank for the whole batch (that forced a
// separate upload per tier).
type Pending = { file: File; url: string; rank: number }
type BgsReview = { champs: Champ[]; selected: Set<string>; unmatched: string[] }
type Gap = { tag: string; whyItMatters: string; fixes: string[] }
type RankUp = { champion: string; class: string; priority: string; why: string; fills: string[] }
type Unmatched = { name: string; suggestions: string[] }
type Analysis = {
  missingTags: string[]; coveredTags: string[]; highRankCount: number
  unmatched?: Unmatched[]; unprofiled: string[]
  groundedFallback?: boolean
  summary: string; gaps: Gap[]; rankUps: RankUp[]
}
const GREEN = "#33ff66"
const PRIORITY_COL: Record<string, string> = {
  high:   "border-[#33ff66] text-[#33ff66]",
  medium: "border-amber-500 text-amber-400",
  low:    "border-[#1f5c33] opacity-60",
}

export default function RosterClient({ initial }: { initial: Champ[] }) {
  const router = useRouter()
  const [champs, setChamps] = useState<Champ[]>(initial)
  useEffect(() => { setChamps(initial) }, [initial])
  const [, startTransition] = useTransition()
  const run = (fn: () => Promise<unknown>) => startTransition(async () => { await fn(); router.refresh() })

  const [filter, setFilter] = useState<"all" | "bgs">("all")
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  // Champion DB names — to spot roster champs whose name doesn't match one (so
  // they can't be matched in analysis / counters) and offer to correct them.
  const [catalogNames, setCatalogNames] = useState<string[] | null>(null)
  const [showFixNames, setShowFixNames] = useState(false)
  const [fixBusy, setFixBusy] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch("/api/jordan/mcoc/profiles/list")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setCatalogNames(Array.isArray(d?.champions) ? d.champions.map((c: { name: string }) => c.name).filter(Boolean) : []) })
      .catch(() => { if (!cancelled) setCatalogNames([]) })
    return () => { cancelled = true }
  }, [])

  // Roster champs with no exact Champion DB match, each with the closest catalog
  // names (prefix either way) to pick from. normChampName is the same key the
  // analysis/counters match on, so "no match here" = "won't match there".
  const catalogSet = new Set((catalogNames ?? []).map((n) => normChampName(n)))
  const unmatched = catalogNames === null ? [] : champs.filter((c) => !catalogSet.has(normChampName(c.name))).map((c) => {
    const key = normChampName(c.name)
    const suggestions = (catalogNames ?? [])
      .filter((n) => { const nn = normChampName(n); return nn.startsWith(key) || key.startsWith(nn) })
      .slice(0, 6)
    return { champ: c, suggestions }
  })

  async function fixName(id: string, newName: string) {
    const name = newName.trim()
    if (!name || fixBusy) return
    setFixBusy(id)
    try {
      const res = await renameChampion(id, name)
      if (res.ok) router.refresh()
    } finally { setFixBusy(null) }
  }

  // Add / update by photo
  const scanInput = useRef<HTMLInputElement>(null)
  const [addStars, setAddStars] = useState(7)
  const [addRank, setAddRank] = useState(5)
  const [scanning, setScanning] = useState(false)
  const [pending, setPending] = useState<Pending[] | null>(null)
  const [scanned, setScanned] = useState<Scanned[] | null>(null)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  // Per-file failures, kept so the real server reason is shown per screenshot
  // rather than collapsed into one vague line.
  const [failures, setFailures] = useState<{ name: string; why: string }[]>([])

  // Roster analysis — what to rank up + what utility is missing. Reads the
  // roster that's already stored (no uploading) and treats the whole Champion
  // DB as rankable.
  const [analysing, setAnalysing] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analysisErr, setAnalysisErr] = useState<string | null>(null)
  const [showAnalysis, setShowAnalysis] = useState(false)

  async function analyseRoster() {
    if (analysing) return
    setAnalysing(true); setAnalysisErr(null); setAnalysis(null); setShowAnalysis(true)
    try {
      const res = await fetch("/api/jordan/mcoc/roster-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: getJordanModel() || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "That didn't work — try again.")
      setAnalysis(j)
    } catch (e: any) {
      setAnalysisErr(e?.message ?? "That didn't work — try again.")
    } finally {
      setAnalysing(false)
    }
  }

  // BGS deck photo
  const bgsInput = useRef<HTMLInputElement>(null)
  const [replaceDeck, setReplaceDeck] = useState(true)
  const [bgsScanning, setBgsScanning] = useState(false)
  const [bgsMsg, setBgsMsg] = useState<string | null>(null)
  const [bgsReview, setBgsReview] = useState<BgsReview | null>(null)
  const [deckAdd, setDeckAdd] = useState("")

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
    // Keep the HTTP status when the body isn't our JSON — a 413/502/504 returns
    // an HTML proxy page, and without this it collapsed to a vague message that
    // hid the real "too big"/"gateway" cause.
    if (!res.ok) throw new Error(j.error || `Couldn't read that screenshot (HTTP ${res.status}).`)
    return j.champions ?? []
  }

  // Pick first, tag each shot's rank, THEN read — so several tiers go up in one
  // go instead of one upload per tier.
  function pickShots(files: File[]) {
    if (!files.length) return
    pending?.forEach((p) => URL.revokeObjectURL(p.url))
    setScanMsg(null); setScanned(null)
    setPending(files.map((f) => ({ file: f, url: URL.createObjectURL(f), rank: addRank })))
  }

  function cancelPending() {
    pending?.forEach((p) => URL.revokeObjectURL(p.url))
    setPending(null)
  }

  // Each image is read on its own call rather than batched into one prompt — the
  // grids stay separate, each keeps its own rank, and one unreadable shot can't
  // sink the others.
  async function scan(shots: Pending[]) {
    if (!shots.length || scanning) return
    setScanning(true); setScanMsg(null); setScanned(null); setFailures([])
    try {
      const merged: Scanned[] = []
      const seen = new Map<string, number>()   // normalised name -> index in merged
      const failed: { name: string; why: string }[] = []

      for (let i = 0; i < shots.length; i++) {
        if (shots.length > 1) setScanMsg(`Reading screenshot ${i + 1} of ${shots.length}…`)
        let list: ReadChamp[] = []
        try {
          list = await readChampions(shots[i].file)
        } catch (e: any) {
          // Keep going — losing 2 of 3 screenshots to one bad shot is worse —
          // but KEEP THE REASON. This used to swallow it and blame image
          // clarity, which sent Jordan off trying to take a sharper screenshot
          // when the real error was something else entirely.
          failed.push({ name: shots[i].file.name || `#${i + 1}`, why: e?.message ?? "Unknown error" })
          continue
        }
        for (const c of list) {
          // Scrolling screenshots overlap, so the same champ appears in several.
          // Keep the first, but take a portrait from a later one if the first
          // didn't get a usable crop.
          const key = normChampName(c.name)
          const at = seen.get(key)
          if (at === undefined) {
            // The PICTURE's rank wins, not the AI's read of the badge — same
            // rule as before, just per-shot now.
            seen.set(key, merged.length)
            merged.push({ ...c, include: true, rank: shots[i].rank })
            continue
          }
          if (!merged[at].imageUrl && c.imageUrl) merged[at] = { ...merged[at], imageKey: c.imageKey, imageUrl: c.imageUrl }
        }
      }

      // Show what the server actually said, verbatim. Deduped because the same
      // reason on 5 screenshots is one problem, not five.
      const reasons = [...new Set(failed.map((f) => f.why))]
      setFailures(failed)

      if (!merged.length) {
        setScanMsg(failed.length
          ? `✗ Couldn't read ${failed.length === 1 ? "that screenshot" : `any of those ${failed.length} screenshots`}: ${reasons.join(" · ")}`
          : "No champions read — the screenshot didn't look like a roster grid. Add by hand below, or try a different shot.")
        return
      }

      setScanMsg([
        shots.length > 1 ? `Read ${shots.length - failed.length} of ${shots.length} screenshots.` : "",
        failed.length ? `⚠ ${failed.length} failed: ${reasons.join(" · ")}` : "",
      ].filter(Boolean).join(" ") || null)

      setScanned(merged)
      cancelPending()
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
    if (!champs.length) { setBgsMsg("✗ Add champions to your roster first — the deck photo matches against them."); return }
    setBgsScanning(true); setBgsMsg(null); setBgsReview(null)
    try {
      // A deck screen is mostly portraits (few/no names), so instead of reading
      // names blind we hand the AI the roster and ask which of THOSE appear —
      // recognition against a known list, far more reliable + can't return a
      // champ Jordan doesn't own.
      const fd = new FormData()
      fd.append("image", f)
      fd.append("roster", JSON.stringify(champs.map((c) => c.name)))
      const model = getJordanModel(); if (model) fd.append("model", model)
      const res = await fetch("/api/jordan/mcoc/scan-bgs", { method: "POST", body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Couldn't read that deck screenshot.")
      const wantedSet = new Set((j.matched ?? []).map((n: string) => normChampName(n)))
      const matched = champs.filter((c) => wantedSet.has(normChampName(c.name)))
      if (!matched.length) { setBgsMsg("✗ Couldn't spot any of your champions in that photo — try a clearer, full-deck screenshot."); return }
      setBgsReview({ champs: matched, selected: new Set(matched.map((c) => c.id)), unmatched: [] })
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
  function clearAll() {
    setConfirmClear(false)
    setChamps([])
    setAnalysis(null)          // it described a roster that no longer exists
    run(() => clearRoster())
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

      {/* ── Full-width work panels — only while a step is in progress. These need
             room, so they sit above the two-column layout rather than in the
             narrow rail. ── */}

      {/* Tag each shot's rank before reading — one upload for the whole roster. */}
      {pending && !scanned && (
        <div className="border border-[#33ff66] rounded-xl p-4 space-y-2">
          <p className="text-xs opacity-70">
            Which rank is in each screenshot? You filtered them, so set each one — all of them go in at {addStars}★.
          </p>
          <div className="flex flex-wrap gap-3">
            {pending.map((p, i) => (
              <div key={i} className="space-y-1">
                <img src={p.url} alt={`Screenshot ${i + 1}`} className="h-28 rounded-lg border border-[#1f5c33] object-cover" />
                <select
                  value={p.rank}
                  onChange={(e) => setPending((l) => l!.map((x, j) => (j === i ? { ...x, rank: Number(e.target.value) } : x)))}
                  className="w-full bg-black border border-[#1f5c33] rounded px-1 py-1 text-[11px]"
                  style={{ color: GREEN }}
                >
                  {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>Rank {r}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={() => scan(pending)} disabled={scanning}
              className="px-4 py-1.5 rounded-lg text-sm font-bold text-black disabled:opacity-40" style={{ background: GREEN }}>
              {scanning ? "READING…" : `Read ${pending.length} screenshot${pending.length === 1 ? "" : "s"} →`}
            </button>
            <button onClick={cancelPending} disabled={scanning}
              className="px-4 py-1.5 rounded-lg border border-[#1f5c33] text-sm opacity-60 hover:opacity-100 disabled:opacity-30">
              Cancel
            </button>
            {pending.length > 1 && (
              <span className="text-[10px] opacity-40 uppercase tracking-widest ml-auto">
                Same champ in two shots? The first wins — fix it on the next screen.
              </span>
            )}
          </div>
        </div>
      )}

      {scanned && (
        <div className="border border-[#33ff66] rounded-xl p-4 space-y-2">
          <p className="text-xs opacity-70">
            Read {scanned.length} champ{scanned.length === 1 ? "" : "s"} at {addStars}★, each on the rank of the screenshot it came from —
            untick wrong ones, fix any exceptions, then save. ⚠ = not in the Champion DB.
          </p>
          <div className="flex flex-wrap gap-1.5 max-h-72 overflow-y-auto">
            {scanned.map((s, i) => (
              <span key={i} className={`inline-flex items-center gap-1.5 px-1.5 py-1 rounded-lg border text-xs ${s.include ? "border-[#33ff66]" : "border-[#1f5c33] opacity-40"}`}>
                <button onClick={() => setScanned((l) => l!.map((x, j) => j === i ? { ...x, include: !x.include } : x))} className="inline-flex items-center gap-1.5">
                  <Portrait url={s.imageUrl} cls={s.class} size={26} />
                  <span className={s.include ? "text-white" : "line-through"}>{s.name}</span>
                  {/* Not in the Champion DB = it'll contribute no utility to the
                      roster analysis. Better seen now than as a mystery gap later. */}
                  {s.inCatalog === false && (
                    <span title="Not in the Champion DB — its utility won't count in the roster analysis" className="text-amber-400 text-[10px]">⚠</span>
                  )}
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

      {bgsReview && (
        <div className="border border-[#33ff66] rounded-xl p-4 space-y-2">
          <p className="text-xs opacity-70">Matched {bgsReview.champs.length} — untick any wrong ones, then set as your deck{replaceDeck ? " (replacing the old one)" : ""}.</p>
          <div className="flex flex-wrap gap-1.5 max-h-60 overflow-y-auto">
            {bgsReview.champs.map((c) => {
              const on = bgsReview.selected.has(c.id)
              return (
                <button key={c.id} onClick={() => setBgsReview((r) => { if (!r) return r; const s = new Set(r.selected); if (s.has(c.id)) s.delete(c.id); else s.add(c.id); return { ...r, selected: s } })}
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

      {/* Fix names — roster champs that don't match a Champion DB entry, so they
          can't be counted in the analysis. Full width for the pickers. */}
      {showFixNames && unmatched.length > 0 && (
        <div className="border border-amber-600/50 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-300">🔤 Fix unmatched names ({unmatched.length})</p>
              <p className="text-xs opacity-60 mt-0.5">
                These don&apos;t match a Champion DB entry, so their utility isn&apos;t counted. Pick the right name and rename — the picker
                suggests the closest matches. If one genuinely isn&apos;t in the Champion DB, build it there first.
              </p>
            </div>
            <button onClick={() => setShowFixNames(false)}
              className="text-[10px] uppercase tracking-widest px-2 py-1.5 rounded border border-[#1f5c33] opacity-60 hover:opacity-100 transition-opacity shrink-0">▲ Hide</button>
          </div>
          <div className="space-y-1.5">
            {unmatched.map(({ champ, suggestions }) => (
              <FixNameRow key={champ.id} champ={champ} suggestions={suggestions} busy={fixBusy === champ.id} onFix={(name) => fixName(champ.id, name)} />
            ))}
          </div>
        </div>
      )}

      {/* Full analysis breakdown — full width so the rank-up cards have room.
          The rail's Analyse card is the launcher + gap summary. */}
      {analysis && showAnalysis && (
        <div className="border border-[#1f5c33] rounded-xl p-4 space-y-4">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold flex-1">🔬 Rank-up plan</p>
            <button onClick={() => setShowAnalysis(false)}
              className="text-[10px] uppercase tracking-widest px-2 py-1.5 rounded border border-[#1f5c33] opacity-60 hover:opacity-100 transition-opacity">▲ Hide</button>
          </div>

          {analysis.summary && <p className="text-sm leading-relaxed">{analysis.summary}</p>}

          <p className="text-[10px] opacity-40 uppercase tracking-widest">
            Based on {analysis.highRankCount} rank 4+ champion{analysis.highRankCount === 1 ? "" : "s"}
          </p>

          {analysis.groundedFallback && (
            <p className="text-[11px] text-amber-400">
              ⚠ Live search didn&apos;t work on this run, so this is from the model&apos;s own knowledge and the meta may be out
              of date — that&apos;s how dated champs creep in. Re-run it, or switch model above.
            </p>
          )}

          {/* Two different problems, two different fixes — telling him to run
              Build profiles for a name mismatch is a ~250-champ rebuild that
              cannot help. */}
          {(analysis.unmatched?.length ?? 0) > 0 && (
            <div className="text-[11px] text-amber-400/80 space-y-1">
              <p>
                ⚠ {analysis.unmatched!.length} of your rank 4+ champs don&apos;t match any Champion DB entry, so their utility isn&apos;t
                counted and some &quot;missing&quot; tags may be wrong. The roster and the Champion DB name champs separately, so variants
                drift apart — Build profiles won&apos;t fix this:
              </p>
              <ul className="pl-3 space-y-0.5">
                {analysis.unmatched!.map((u) => (
                  <li key={u.name}>
                    • <span className="font-bold">{u.name}</span>
                    {u.suggestions.length > 0
                      ? <> — the Champion DB calls it {u.suggestions.map((s) => `"${s}"`).join(" or ")}. Delete and re-add it under that name.</>
                      : <> — not in the Champion DB at all. Run Build champion list in the 🧬 CHAMPION DB tab.</>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.unprofiled.length > 0 && (
            <p className="text-[11px] text-amber-400/80">
              ⚠ {analysis.unprofiled.length} of your rank 4+ champs are in the Champion DB but not profiled yet, so their utility isn&apos;t
              counted: {analysis.unprofiled.join(", ")}. Run Build profiles in the 🧬 CHAMPION DB tab.
            </p>
          )}

          {analysis.rankUps.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] opacity-50 uppercase tracking-widest">Rank these up</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {analysis.rankUps.map((r, i) => {
                  const owned = champs.find((c) => normChampName(c.name) === normChampName(r.champion))
                  return (
                    <div key={`${r.champion}-${i}`} className="border border-[#1f5c33] rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold" style={{ color: classColour(r.class || owned?.class || "") }}>{r.champion}</span>
                        {r.class && <span className="text-[10px] opacity-50 uppercase tracking-widest">{r.class}</span>}
                        <span className={`text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${PRIORITY_COL[r.priority] ?? PRIORITY_COL.medium}`}>
                          {r.priority}
                        </span>
                        {owned && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[#1f5c33] opacity-70">
                            you have {owned.stars}★ r{owned.rank}
                          </span>
                        )}
                      </div>
                      {r.why && <p className="text-xs opacity-80 leading-relaxed">{r.why}</p>}
                      {r.fills.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap items-center">
                          <span className="text-[10px] opacity-40 uppercase tracking-widest">Fills</span>
                          {r.fills.map((f) => (
                            <span key={f} className="text-[10px] px-1.5 py-0.5 rounded-full border border-[#1f5c33]">{f}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {analysis.gaps.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] opacity-50 uppercase tracking-widest">The gaps that cost you most</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {analysis.gaps.map((g, i) => (
                  <div key={`${g.tag}-${i}`} className="border border-[#1f5c33] rounded-lg p-3 space-y-1">
                    <span className="text-sm font-bold text-amber-400">{g.tag}</span>
                    {g.whyItMatters && <p className="text-xs opacity-80 leading-relaxed">{g.whyItMatters}</p>}
                    {g.fixes.length > 0 && (
                      <p className="text-xs opacity-60">Best fixes: {g.fixes.join(" · ")}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Roster left, tools right ── */}
      <div className="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_340px]">

        {/* LEFT — the roster (rail comes first on a narrow screen so the actions
            aren't buried under 50+ champs). */}
        <div className="space-y-4 min-w-0 order-2 lg:order-1">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className="opacity-70">{champs.length} champ{champs.length === 1 ? "" : "s"}</span>
            <div className="flex gap-1">
              <button onClick={() => setFilter("all")} className={`px-2.5 py-1 rounded border ${filter === "all" ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] opacity-60"}`}>All</button>
              <button onClick={() => setFilter("bgs")} className={`px-2.5 py-1 rounded border ${filter === "bgs" ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] opacity-60"}`}>★ BGS deck</button>
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" className={`${input} py-1 ml-auto w-40`} style={{ color: GREEN }} />

            {/* Two-step rather than a browser confirm(): nothing else in /jordan uses
                one, and this deletes the lot with no undo. */}
            {champs.length > 0 && (
              confirmClear ? (
                <span className="inline-flex items-center gap-1.5">
                  <button onClick={clearAll}
                    className="px-2.5 py-1 rounded border border-red-500 text-red-400 hover:bg-red-950/40 transition-colors">
                    Delete all {champs.length}?
                  </button>
                  <button onClick={() => setConfirmClear(false)}
                    className="px-2.5 py-1 rounded border border-[#1f5c33] opacity-60 hover:opacity-100 transition-opacity">
                    Cancel
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirmClear(true)}
                  className="px-2.5 py-1 rounded border border-[#1f5c33] opacity-50 hover:opacity-100 hover:border-red-500 hover:text-red-400 transition-colors">
                  Clear all
                </button>
              )
            )}
          </div>

          {confirmClear && (
            <p className="text-[11px] text-amber-400/90 -mt-2">
              ⚠ Deletes all {champs.length} champions and your BGS deck with them (the deck is stored on these rows). Can&apos;t be undone —
              you&apos;d re-scan from screenshots. Your personal counters are safe: they&apos;re stored per champion, not on the roster.
            </p>
          )}

          {champs.length === 0 && <p className="text-sm opacity-50 text-center py-8">No champions yet — scan a roster screenshot in the panel on the right to get started.</p>}

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
        </div>

        {/* RIGHT — tools. Sticky so they stay in reach while scrolling a long roster. */}
        <div className="space-y-3 order-1 lg:order-2 lg:sticky lg:top-2 self-start">

          {/* Scan / add champions */}
          <div className="border border-[#1f5c33] rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold">📷 Add champions</p>
              <ModelPicker />
            </div>
            <p className="text-[11px] opacity-55">Filter by rank in-game, shoot each tier, then pick them all at once — you set which rank each shot is. Overlapping shots merge.</p>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="opacity-60 uppercase tracking-widest text-[10px]">These are</span>
              <select value={addStars} onChange={(e) => setAddStars(Number(e.target.value))} className={`${input} py-1.5`} style={{ color: GREEN }}>
                <option value={7}>7★</option><option value={6}>6★</option>
              </select>
              <select value={addRank} onChange={(e) => setAddRank(Number(e.target.value))} className={`${input} py-1.5`} style={{ color: GREEN }}
                title="Starting rank for each screenshot — set them individually after picking">
                {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>Rank {r}</option>)}
              </select>
            </div>
            <button onClick={() => scanInput.current?.click()} disabled={scanning}
              className="w-full px-4 py-2 rounded-lg text-sm font-bold text-black disabled:opacity-40 transition-colors" style={{ background: GREEN }}>
              {scanning ? "READING…" : "📷 Scan roster screenshots"}
            </button>
            {scanMsg && <p className={`text-[11px] ${scanMsg.startsWith("✗") ? "text-red-400" : "opacity-70"}`}>{scanMsg}</p>}
            {/* The server's own words, per file — so a real cause is never hidden
                behind a guess about image quality. */}
            {failures.length > 0 && (
              <ul className="text-[11px] text-red-400/90 space-y-0.5">
                {failures.map((f, i) => (
                  <li key={i}>• <span className="opacity-70">{f.name}</span> — {f.why}</li>
                ))}
              </ul>
            )}
            {/* Only when some champ doesn't match the Champion DB. */}
            {unmatched.length > 0 && (
              <button onClick={() => setShowFixNames((s) => !s)}
                className="w-full px-3 py-1.5 rounded-lg border border-amber-600/60 text-amber-300 text-xs font-bold hover:bg-amber-950/30 transition-colors">
                🔤 Fix {unmatched.length} unmatched name{unmatched.length === 1 ? "" : "s"} {showFixNames ? "▲" : "▼"}
              </button>
            )}
            <div className="border-t border-[#1f5c33] pt-2.5 space-y-2">
              <p className="text-[10px] opacity-40 uppercase tracking-widest">or add one by hand</p>
              <input value={mName} onChange={(e) => setMName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addManual() }}
                placeholder="Champion name…" className={`${input} w-full py-1.5 text-xs`} style={{ color: GREEN }} />
              <div className="flex gap-2">
                <select value={mClass} onChange={(e) => setMClass(e.target.value)} className={`${input} py-1.5 flex-1`} style={{ color: GREEN }}>
                  <option value="">Class…</option>
                  {MCOC_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={addManual} disabled={!mName.trim()} className="px-4 py-1.5 rounded-lg border border-[#1f5c33] text-sm hover:border-[#33ff66] disabled:opacity-30 transition-colors">ADD</button>
              </div>
            </div>
          </div>

          {/* Battlegrounds deck */}
          <div className="border border-[#1f5c33] rounded-xl p-3.5 space-y-2.5">
            <p className="text-sm font-bold">🃏 Battlegrounds deck <span className="opacity-50 font-normal">— {bgsCount}</span></p>
            <p className="text-[11px] opacity-55">Scan a deck photo (matched against your roster by portrait) or tap ★ on any champ.</p>
            <label className="inline-flex items-center gap-1.5 text-[11px] opacity-70 cursor-pointer">
              <input type="checkbox" checked={replaceDeck} onChange={(e) => setReplaceDeck(e.target.checked)} className="accent-[#33ff66]" /> Replace deck on scan
            </label>
            <button onClick={() => bgsInput.current?.click()} disabled={bgsScanning}
              className="w-full px-4 py-2 rounded-lg border border-[#33ff66] text-sm font-bold hover:bg-[#0a2214] disabled:opacity-40 transition-colors">
              {bgsScanning ? "READING…" : "📷 Scan BGS deck photo"}
            </button>
            <input
              value={deckAdd}
              onChange={(e) => setDeckAdd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return
                e.preventDefault()
                const norm = normChampName(deckAdd)
                const hit = champs.find((c) => normChampName(c.name) === norm) ?? champs.find((c) => c.name.toLowerCase().startsWith(deckAdd.trim().toLowerCase()))
                if (hit && !hit.bgsDeck) { toggleBgs(hit); setDeckAdd("") }
                else if (hit) setDeckAdd("")
              }}
              list="deck-add-names"
              placeholder="Add by name — type + Enter…"
              className={`${input} w-full py-1.5 text-xs`}
              style={{ color: GREEN }}
            />
            <datalist id="deck-add-names">
              {champs.filter((c) => !c.bgsDeck).map((c) => <option key={c.id} value={c.name} />)}
            </datalist>
            {bgsCount > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {champs.filter((c) => c.bgsDeck).map((c) => (
                  <button key={c.id} onClick={() => toggleBgs(c)} title="Remove from deck"
                    className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border border-[#33ff66] text-white hover:opacity-70 transition-opacity">
                    {c.imageUrl && <img src={c.imageUrl} alt="" width={18} height={18} className="rounded object-cover" />}
                    {c.name} <span className="opacity-50">{c.stars}★</span> <span className="text-red-400">×</span>
                  </button>
                ))}
              </div>
            )}
            {bgsMsg && <p className={`text-[11px] ${bgsMsg.startsWith("✗") ? "text-red-400" : "opacity-80"}`}>{bgsMsg}</p>}
          </div>

          {/* Analyse */}
          <div className="border border-[#1f5c33] rounded-xl p-3.5 space-y-2.5">
            <p className="text-sm font-bold">🔬 What should I rank up?</p>
            <p className="text-[11px] opacity-55">Rank 4+ champs count as what you can field; every Champion DB champ is treated as rankable. Nothing to upload.</p>
            <button onClick={analyseRoster} disabled={analysing || champs.length === 0}
              className="w-full px-4 py-2 rounded-lg text-sm font-bold text-black disabled:opacity-40 transition-colors" style={{ background: GREEN }}>
              {analysing ? "ANALYSING…" : "🔬 Analyse roster"}
            </button>
            {analysing && <p className="text-[11px] opacity-50 animate-pulse">Reading your roster, working out the gaps and checking the current meta…</p>}
            {analysisErr && <p className="text-[11px] text-red-400">✗ {analysisErr}</p>}
            {analysis && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] opacity-50 uppercase tracking-widest">Missing utility ({analysis.missingTags.length})</p>
                  <button onClick={() => setShowAnalysis((s) => !s)}
                    className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border border-[#1f5c33] opacity-60 hover:opacity-100 transition-opacity">
                    {showAnalysis ? "▲ Hide plan" : "▼ Full plan"}
                  </button>
                </div>
                {analysis.missingTags.length === 0 ? (
                  <p className="text-[11px] opacity-60">Nothing — your rank 4+ champs cover every tracked utility.</p>
                ) : (
                  <div className="flex gap-1.5 flex-wrap">
                    {analysis.missingTags.map((t) => (
                      <span key={t} className="text-[11px] px-2 py-0.5 rounded-full border border-amber-600/60 text-amber-400">{t}</span>
                    ))}
                  </div>
                )}
                {!showAnalysis && (analysis.rankUps.length > 0 || analysis.gaps.length > 0) && (
                  <p className="text-[10px] opacity-40">{analysis.rankUps.length} rank-ups · tap Full plan for the detail (shown above).</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <input ref={scanInput} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => { pickShots(Array.from(e.target.files ?? [])); e.currentTarget.value = "" }} />
      <input ref={bgsInput} type="file" accept="image/*" className="hidden"
        onChange={(e) => { scanBgs(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
    </div>
  )
}

// One unmatched champ + a picker to rename it to a Champion DB name. Holds its
// own input so each row edits independently; seeds with the top suggestion.
function FixNameRow({ champ, suggestions, busy, onFix }: {
  champ: Champ; suggestions: string[]; busy: boolean; onFix: (name: string) => void
}) {
  const [val, setVal] = useState(suggestions[0] ?? "")
  const listId = `fix-${champ.id}`
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs border border-[#1f5c33] rounded-lg px-2.5 py-1.5">
      <span className="text-white font-bold">{champ.name}</span>
      <span className="opacity-40">{champ.stars}★ R{champ.rank}</span>
      <span className="opacity-40">→</span>
      <input value={val} onChange={(e) => setVal(e.target.value)} list={listId}
        placeholder={suggestions.length ? "" : "type the Champion DB name…"}
        className="flex-1 min-w-[10rem] bg-black border border-[#1f5c33] rounded px-2 py-1 focus:outline-none focus:border-[#33ff66]" style={{ color: "#33ff66" }} />
      <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      <button onClick={() => onFix(val)} disabled={busy || !val.trim()}
        className="px-3 py-1 rounded border border-[#33ff66] font-bold hover:bg-[#0a2214] disabled:opacity-30 transition-colors">
        {busy ? "…" : "Rename"}
      </button>
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
