"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import SwapPicker from "./swap-picker"
import { platesFor, type LiftInfo, type Suggestion } from "@/lib/jordan-gym"

// JORDAN.SYS → GYM → the in-gym logger. Standing up, out of breath, one hand, often no signal.
//
// The rules this screen is built to, all of them learned the hard way by every gym app:
// ⚠ ONE TAP logs a set that went to plan — the weight and reps are already filled in.
// ⚠ ± steppers, not a keyboard (the number is still tappable when a figure is genuinely odd).
// ⚠ "Last time" sits BESIDE today, per set — 8,8,7 and 8,8,6 are different decisions.
// ⚠ The suggested weight always carries its reason. An unexplained number gets ignored.
// ⚠ The rest timer is computed from a TIMESTAMP, never a tick — phones freeze background timers.
// ⚠ Nothing is ever lost: every set is kept on the phone the instant it is tapped, and an
//   unsaved one shows in an amber bar that does not go away on its own.
// ⚠ A miss is as easy to log as a hit. No "failed" styling: the whole progression rule depends
//   on honest reps, and a tool that sulks gets lied to.

const box = "border border-[#1f5c33] rounded-lg bg-[#040f08]"
const btn = "px-3 py-1.5 text-xs border border-[#1f5c33] rounded hover:bg-[#0a2214] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const label = "block text-[10px] tracking-widest opacity-60 mb-1"

export type DayPlan = {
  slug: string; liftId: string; name: string; pattern: string; equipment: string
  sets: number; repLow: number; repHigh: number; rir: number; restSeconds: number
  note: string; substitute: string
  perHand: boolean; bodyweight: boolean; incrementKg: number; main: boolean
  suggestion: Suggestion
  newLift: boolean
}

type SetRow = {
  clientId: string; liftId: string; position: number; setNo: number; warmup: boolean
  targetReps: string; targetWeightKg: number | null
  weightKg: number; reps: number; rir: number | null; note: string
  loggedAt: string
  saved: boolean
}

const uid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`)

const key = (workoutId: string) => `gym_pending_${workoutId}`
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
const kg = (n: number) => `${Math.round(n * 100) / 100} kg`

export default function Session({
  workoutId, lifts, barKg, plates, onFinished, onClose,
}: {
  workoutId: string
  lifts: LiftInfo[]
  barKg: number
  plates: number[]
  onFinished: () => void
  onClose: () => void
}) {
  const [plan, setPlan]   = useState<DayPlan[]>([])
  const [sets, setSets]   = useState<SetRow[]>([])
  const [idx, setIdx]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pb, setPb]       = useState<string | null>(null)
  const [weight, setWeight] = useState("")
  const [reps, setReps]     = useState("")
  const [rir, setRir]       = useState<number | null>(null)
  const [warmup, setWarmup] = useState(false)
  const [restFrom, setRestFrom] = useState<number | null>(null)
  const [restFor, setRestFor]   = useState(120)
  const [now, setNow]     = useState(() => Date.now())
  const [finishing, setFinishing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [swapping, setSwapping] = useState(false)

  const ex = plan[idx] ?? null
  const unsaved = sets.filter(s => !s.saved)

  // ── Load, and recover anything this phone logged but never managed to send ──
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`/api/jordan/gym/workout?id=${encodeURIComponent(workoutId)}`)
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? "Couldn't open the session")
        if (!alive) return
        const saved: SetRow[] = (j.sets ?? []).map((s: any) => ({
          clientId: s.clientId, liftId: s.liftId, position: s.position, setNo: s.setNo, warmup: s.warmup,
          targetReps: s.targetReps, targetWeightKg: s.targetWeightKg, weightKg: s.weightKg, reps: s.reps,
          rir: s.rir, note: s.note ?? "", loggedAt: s.loggedAt, saved: true,
        }))
        let pending: SetRow[] = []
        try { pending = JSON.parse(localStorage.getItem(key(workoutId)) ?? "[]") } catch { /* private mode */ }
        const known = new Set(saved.map(s => s.clientId))
        setSets([...saved, ...pending.filter(p => !known.has(p.clientId))])
        setPlan(j.plan ?? [])
      } catch (e: any) {
        if (alive) setError(e.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [workoutId])

  // The phone's copy. Written on every change, so a locked phone, a closed tab or a dead battery
  // never costs him a set he actually did.
  useEffect(() => {
    if (loading) return
    try { localStorage.setItem(key(workoutId), JSON.stringify(sets.filter(s => !s.saved))) } catch { /* private mode */ }
  }, [sets, workoutId, loading])

  // A clock only for DISPLAY — the rest timer's truth is the timestamp, so a frozen background
  // tab simply shows the right number again the moment it wakes.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Keep the screen awake while a session is on — putting the phone down between sets must not
  // mean unlocking it again with chalky hands.
  useEffect(() => {
    let lock: any = null
    const ask = async () => {
      try { lock = await (navigator as any).wakeLock?.request("screen") } catch { /* refused; harmless */ }
    }
    void ask()
    const wake = () => { if (document.visibilityState === "visible") void ask() }
    document.addEventListener("visibilitychange", wake)
    return () => { document.removeEventListener("visibilitychange", wake); try { lock?.release() } catch { /* gone */ } }
  }, [])

  const setsFor = useCallback((liftId: string) => sets.filter(s => s.liftId === liftId && !s.warmup), [sets])

  // Fill the boxes with what to do next: the suggestion first time, then whatever the last set of
  // this exercise was, so a second set is genuinely one tap.
  useEffect(() => {
    if (!ex) return
    const done = setsFor(ex.liftId)
    const last = done[done.length - 1]
    if (last) { setWeight(String(last.weightKg)); setReps(String(Math.min(ex.repHigh, last.reps))) }
    else {
      // A bodyweight exercise starts at 0, not blank — "what weight?" is a silly question for
      // a press-up, and a blank box would refuse to log one.
      setWeight(ex.suggestion.weightKg != null ? String(ex.suggestion.weightKg) : ex.bodyweight ? "0" : "")
      setReps(String(ex.suggestion.reps))
    }
    setRir(null); setWarmup(false)
    setRestFor(ex.restSeconds || 120)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, ex?.liftId])

  async function send(row: SetRow) {
    const r = await fetch("/api/jordan/gym/sets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...row, workoutId }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? "Save failed")
    return j
  }

  function logSet() {
    if (!ex) return
    const w = Number(weight), rp = Math.round(Number(reps))
    if (!Number.isFinite(rp) || rp < 1) { setError("How many reps?"); return }
    if (!Number.isFinite(w) || w < 0) { setError("What weight?"); return }
    setError(null)
    const done = setsFor(ex.liftId)
    const row: SetRow = {
      clientId: uid(), liftId: ex.liftId, position: idx, setNo: warmup ? 0 : done.length + 1, warmup,
      targetReps: `${ex.repLow}-${ex.repHigh}`, targetWeightKg: ex.suggestion.weightKg,
      weightKg: Math.round(w * 100) / 100, reps: rp, rir, note: "",
      loggedAt: new Date().toISOString(), saved: false,
    }
    setSets(s => [...s, row])
    if (!warmup) { setRestFrom(Date.now()); setRestFor(ex.restSeconds || 120) }
    setPb(null)
    send(row)
      .then(j => {
        setSets(s => s.map(x => x.clientId === row.clientId ? { ...x, saved: true } : x))
        if (j.pb) setPb(j.pb)
      })
      .catch(() => { /* stays unsaved; the amber bar has it and retry picks it up */ })
  }

  /** Retry everything still on the phone. Safe to press twice — the server upserts on clientId. */
  const retry = useCallback(async () => {
    const queue = sets.filter(s => !s.saved)
    if (!queue.length || syncing) return
    setSyncing(true)
    for (const row of queue) {
      try {
        await send(row)
        setSets(s => s.map(x => x.clientId === row.clientId ? { ...x, saved: true } : x))
      } catch { /* leave it; the bar stays up */ }
    }
    setSyncing(false)
  }, [sets, syncing])

  useEffect(() => {
    const back = () => { void retry() }
    window.addEventListener("online", back)
    return () => window.removeEventListener("online", back)
  }, [retry])

  // ⚠ Closing with sets still on the phone must warn — the screen recorder's rule.
  useEffect(() => {
    if (!unsaved.length) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [unsaved.length])

  async function undo(row: SetRow) {
    setSets(s => s.filter(x => x.clientId !== row.clientId))
    try {
      await fetch("/api/jordan/gym/sets", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: row.clientId }),
      })
    } catch { /* it was never saved anyway */ }
  }

  async function finish(feeling: number | null) {
    setFinishing(true)
    await retry()
    try {
      await fetch("/api/jordan/gym/workout", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workoutId, status: "DONE", feeling }),
      })
      try { localStorage.removeItem(key(workoutId)) } catch { /* private mode */ }
      onFinished()
    } catch (e: any) { setError(e.message); setFinishing(false) }
  }

  /** Swap the exercise he's on, just for today — the machine is taken, or it's aggravating
   *  something. ⚠ The sets, reps and rest are KEPT: a swap changes the movement, not the job it
   *  is doing in this session. The programme itself is untouched (swap it there to make it stick).
   *  Sets already logged against the old exercise stay logged against the old exercise. */
  async function swapExercise(o: { slug: string; name: string; equipment: string; why: string }) {
    if (!ex) return
    setSwapping(false)
    try {
      const r = await fetch("/api/jordan/gym/swap", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: ex.slug,
          create: { ...o, sets: ex.sets, repLow: ex.repLow, repHigh: ex.repHigh, rir: ex.rir },
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't swap it")
      const l: LiftInfo = j.lift
      setPlan(p => p.map((row, i) => i !== idx ? row : {
        ...row, slug: l.slug, liftId: l.id!, name: l.name, equipment: l.equipment,
        perHand: l.perHand, bodyweight: l.bodyweight, incrementKg: l.incrementKg, main: l.main,
        note: o.why || row.note, substitute: row.name, suggestion: j.suggestion,
      }))
    } catch (e: any) { setError(e.message) }
  }

  /** A machine is taken, or it's an off-plan session — put any lift in front of him properly,
   *  with a real suggestion rather than an empty box. */
  async function addExercise(slug: string) {
    if (!slug) return
    setAdding(true)
    try {
      const r = await fetch(`/api/jordan/gym/history?slug=${encodeURIComponent(slug)}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't look that up")
      const l: LiftInfo = j.lift
      const extra: DayPlan = {
        slug: l.slug, liftId: l.id!, name: l.name, pattern: l.pattern, equipment: l.equipment,
        sets: 3, repLow: 8, repHigh: 12, rir: 2, restSeconds: l.restSec,
        note: "", substitute: "", perHand: l.perHand, bodyweight: l.bodyweight,
        incrementKg: l.incrementKg, main: l.main, suggestion: j.suggestion, newLift: false,
      }
      setPlan(p => { const next = [...p, extra]; setIdx(next.length - 1); return next })
    } catch (e: any) { setError(e.message) } finally { setAdding(false) }
  }

  const step = (by: number) => {
    const w = Number(weight) || 0
    const inc = (ex?.incrementKg || 2.5) * by
    setWeight(String(Math.max(0, Math.round((w + inc) * 100) / 100)))
  }
  const bump = (by: number) => setReps(String(Math.max(1, (Math.round(Number(reps)) || 0) + by)))

  const rest = restFrom ? Math.floor((now - restFrom) / 1000) : null
  const doneHere = ex ? setsFor(ex.liftId) : []
  const allHere  = ex ? sets.filter(s => s.liftId === ex.liftId) : []
  // What to actually put on the bar — off the lift's EQUIPMENT, not its name (the name test
  // missed the overhead press, the RDL and the hip thrust, which are all barbell lifts).
  const bar = useMemo(
    () => (ex && ex.equipment === "barbell" ? platesFor(Number(weight) || 0, barKg, plates) : null),
    [ex, weight, barKg, plates],
  )

  if (loading) return <p className="text-xs opacity-60">OPENING THE SESSION…</p>

  return (
    <div className="space-y-3 pb-24">
      {/* ⚠ This bar never disappears on its own. A silent failed save is how a session is lost. */}
      {unsaved.length > 0 && (
        <div className="border border-amber-600 bg-amber-950/40 text-amber-300 rounded-lg px-3 py-2 text-xs flex items-center gap-3">
          <span className="flex-1">{unsaved.length} set{unsaved.length === 1 ? "" : "s"} on this phone only — they&apos;re safe, but not saved yet.</span>
          <button className={`${btn} border-amber-600`} onClick={retry} disabled={syncing}>{syncing ? "TRYING…" : "RETRY"}</button>
        </div>
      )}
      {error && <div className="border border-red-700 bg-red-950/40 text-red-300 rounded-lg px-3 py-2 text-xs">{error}</div>}
      {pb && <div className="border border-[#33ff66] rounded-lg px-3 py-2 text-xs font-bold">🏆 {pb}</div>}

      {/* Which exercise */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {plan.map((e, i) => {
          const done = sets.filter(s => s.liftId === e.liftId && !s.warmup).length
          const full = done >= e.sets
          return (
            <button key={`${e.liftId}-${i}`} onClick={() => setIdx(i)}
              className={`shrink-0 min-h-[44px] px-3 rounded border text-xs ${i === idx ? "border-[#33ff66] bg-[#0a2214]" : full ? "border-[#1f5c33] opacity-60" : "border-[#1f5c33]"}`}>
              {full ? "✓ " : ""}{e.name} <span className="opacity-50">{done}/{e.sets}</span>
            </button>
          )
        })}
      </div>

      {!ex ? (
        <div className={`${box} p-4 space-y-3`}>
          <p className="text-xs opacity-70">Nothing planned for this session — add whatever you&apos;re doing.</p>
          <AddExercise lifts={lifts} onAdd={addExercise} busy={adding} />
        </div>
      ) : (
        <div className={`${box} p-4 space-y-4`}>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-base font-bold">{ex.name}</h2>
              <span className="text-xs opacity-60">SET {Math.min(doneHere.length + 1, 99)} OF {ex.sets}</span>
            </div>
            <p className="text-xs opacity-70 mt-0.5">
              {ex.sets} × {ex.repLow}–{ex.repHigh} @ {ex.rir} in reserve · rest {Math.round((ex.restSeconds || 120) / 60 * 10) / 10} min
              {ex.perHand ? " · weight is PER HAND" : ""}
            </p>
            {ex.note && <p className="text-xs opacity-60 mt-1">{ex.note}</p>}
            <button onClick={() => setSwapping(v => !v)} className={`${btn} min-h-[44px] mt-2`}>
              {swapping ? "CLOSE" : "⇄ SWAP FOR TODAY"}
            </button>
          </div>
          {swapping && <SwapPicker slug={ex.slug} name={ex.name} onPick={swapExercise} onClose={() => setSwapping(false)} />}

          {/* The suggestion, and WHY. */}
          <div className="border border-[#1f5c33] rounded-lg p-3 space-y-1">
            <div className="text-lg font-bold">
              {ex.suggestion.weightKg != null ? `${kg(ex.suggestion.weightKg)}${ex.perHand ? " each" : ""} × ${ex.suggestion.reps}` : "First time"}
            </div>
            <p className="text-xs opacity-70">{ex.suggestion.why}</p>
            {ex.suggestion.last && (
              <p className="text-xs">
                <span className="opacity-60">Last: </span>
                {kg(ex.suggestion.last.weightKg)}{ex.perHand ? " each" : ""} × {ex.suggestion.last.reps.join(", ")}
                <span className="opacity-60"> — {fmtDate(ex.suggestion.last.at)}</span>
              </p>
            )}
            {bar && <p className="text-[11px] opacity-50">Bar: {bar}</p>}
          </div>

          {/* The one interaction. Big targets — this is a sweaty thumb at 150 bpm, not a desk. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={label}>WEIGHT{ex.perHand ? " (EACH)" : ""}</span>
              <div className="flex items-stretch gap-1">
                <button onClick={() => step(-1)} className="w-14 min-h-[56px] rounded border border-[#1f5c33] text-xl hover:bg-[#0a2214]">−</button>
                <input value={weight} onChange={e => setWeight(e.target.value)} inputMode="decimal" aria-label="weight in kg"
                  className="flex-1 min-h-[56px] w-full bg-black border border-[#1f5c33] rounded text-center text-2xl font-bold text-[#33ff66] focus:outline-none focus:border-[#33ff66]" />
                <button onClick={() => step(1)} className="w-14 min-h-[56px] rounded border border-[#1f5c33] text-xl hover:bg-[#0a2214]">+</button>
              </div>
            </div>
            <div>
              <span className={label}>REPS</span>
              <div className="flex items-stretch gap-1">
                <button onClick={() => bump(-1)} className="w-14 min-h-[56px] rounded border border-[#1f5c33] text-xl hover:bg-[#0a2214]">−</button>
                <input value={reps} onChange={e => setReps(e.target.value)} inputMode="numeric" aria-label="reps"
                  className="flex-1 min-h-[56px] w-full bg-black border border-[#1f5c33] rounded text-center text-2xl font-bold text-[#33ff66] focus:outline-none focus:border-[#33ff66]" />
                <button onClick={() => bump(1)} className="w-14 min-h-[56px] rounded border border-[#1f5c33] text-xl hover:bg-[#0a2214]">+</button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] tracking-widest opacity-60">LEFT IN RESERVE</span>
            {[0, 1, 2, 3].map(v => (
              <button key={v} onClick={() => setRir(rir === v ? null : v)}
                className={`min-h-[44px] w-11 rounded border text-xs ${rir === v ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33]"}`}>
                {v === 3 ? "3+" : v}
              </button>
            ))}
            <button onClick={() => setWarmup(!warmup)}
              className={`min-h-[44px] px-3 rounded border text-xs ml-auto ${warmup ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33]"}`}>
              {warmup ? "✓ WARM-UP" : "WARM-UP"}
            </button>
          </div>

          <button onClick={logSet}
            className="w-full min-h-[64px] rounded-lg bg-[#33ff66] text-black text-lg font-bold hover:bg-[#5cff88] transition-colors">
            ✓ LOG {warmup ? "WARM-UP" : `SET ${doneHere.length + 1}`}
          </button>

          {/* What's already down for this exercise, with an undo on each. */}
          {allHere.length > 0 && (
            <ul className="space-y-1">
              {allHere.map(s => (
                <li key={s.clientId} className="flex items-center gap-2 text-xs border border-[#1f5c33] rounded px-2 py-1.5">
                  <span className="opacity-60 w-12 shrink-0">{s.warmup ? "W/UP" : `SET ${s.setNo}`}</span>
                  <span className="font-bold">{kg(s.weightKg)} × {s.reps}</span>
                  {s.rir != null && <span className="opacity-60">@ {s.rir} left</span>}
                  <span className="ml-auto opacity-50">{s.saved ? "☁" : "phone only"}</span>
                  <button onClick={() => undo(s)} className="min-h-[36px] px-2 opacity-60 hover:opacity-100" aria-label="Remove this set">✕</button>
                </li>
              ))}
            </ul>
          )}

          {ex.substitute && <p className="text-[11px] opacity-50">If it&apos;s taken: {ex.substitute}</p>}
        </div>
      )}

      {/* Move on, add something, or finish */}
      <div className={`${box} p-3 space-y-3`}>
        <div className="flex flex-wrap gap-2">
          <button className={`${btn} min-h-[44px]`} onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}>‹ PREVIOUS</button>
          <button className={`${btn} min-h-[44px]`} onClick={() => setIdx(i => Math.min(plan.length - 1, i + 1))} disabled={idx >= plan.length - 1}>NEXT EXERCISE ›</button>
          <button className={`${btn} min-h-[44px] ml-auto`} onClick={onClose}>LEAVE IT OPEN</button>
        </div>
        {plan.length > 0 && <AddExercise lifts={lifts} onAdd={addExercise} busy={adding} />}
        {!finishing ? (
          <button className={`${btn} min-h-[44px] w-full`} onClick={() => setFinishing(true)}>FINISH SESSION</button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs opacity-70">How did that feel?</p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(f => (
                <button key={f} onClick={() => finish(f)} className="flex-1 min-h-[52px] rounded border border-[#1f5c33] hover:bg-[#0a2214] text-sm">
                  {["😵", "😮‍💨", "🙂", "💪", "🔥"][f - 1]}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button className={`${btn} flex-1 min-h-[44px]`} onClick={() => finish(null)}>SKIP, JUST FINISH</button>
              <button className={`${btn} flex-1 min-h-[44px]`} onClick={() => setFinishing(false)}>NOT YET</button>
            </div>
          </div>
        )}
      </div>

      {/* Rest timer — counts UP past the target, so "I rested four minutes" is visible. */}
      {rest != null && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#040f08] border-t border-[#1f5c33] px-4 py-3 flex items-center gap-3 font-mono" style={{ color: "#33ff66" }}>
          <span className={`text-2xl font-bold tabular-nums ${rest >= restFor ? "" : "opacity-70"}`}>
            {Math.floor(rest / 60)}:{String(rest % 60).padStart(2, "0")}
          </span>
          <span className="text-xs opacity-60">
            {rest >= restFor ? "ready — go again" : `resting · ${Math.floor(restFor / 60)}:${String(restFor % 60).padStart(2, "0")} target`}
          </span>
          <button className={`${btn} ml-auto`} onClick={() => setRestFor(r => Math.max(30, r - 30))}>−30s</button>
          <button className={btn} onClick={() => setRestFor(r => r + 30)}>+30s</button>
          <button className={btn} onClick={() => setRestFrom(null)}>DONE</button>
        </div>
      )}
    </div>
  )
}

function AddExercise({ lifts, onAdd, busy }: { lifts: LiftInfo[]; onAdd: (slug: string) => void; busy: boolean }) {
  const [slug, setSlug] = useState("")
  return (
    <div className="flex gap-2">
      <select value={slug} onChange={e => setSlug(e.target.value)} aria-label="add an exercise"
        className="flex-1 min-h-[44px] bg-black border border-[#1f5c33] rounded px-2 text-sm text-[#33ff66] focus:outline-none focus:border-[#33ff66]">
        <option value="">Add an exercise…</option>
        {lifts.map(l => <option key={l.slug} value={l.slug}>{l.name}</option>)}
      </select>
      <button className={`${btn} min-h-[44px]`} onClick={() => { onAdd(slug); setSlug("") }} disabled={!slug || busy}>{busy ? "…" : "ADD"}</button>
    </div>
  )
}
