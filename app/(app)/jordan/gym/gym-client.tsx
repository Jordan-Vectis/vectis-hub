"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import ModelPicker, { getJordanModel } from "../model-picker"
import Session from "./session"
import SwapPicker from "./swap-picker"
import { EXPERIENCE, goalLabel, missingMuscles, weeklySets, type GoalKey, type LiftInfo, type Programme, type SwapOption } from "@/lib/jordan-gym"

// JORDAN.SYS → GYM. Four screens: TODAY (start or carry on), PROGRAMME (the AI-written block),
// HISTORY (what's actually been lifted) and SETUP (days, kit, injuries).
//
// ⚠⚠ The AI writes the STRUCTURE — sets, rep ranges, rest. It never writes a weight: that comes
// from the log, at session start, by double progression (lib/jordan-gym.ts).
// ⚠ The GOAL is read from the linked MEAL PLANNER profile, never copied here — training in a
// deficit is a different job from training in a surplus, and two copies would drift.

const box   = "border border-(--j-dim) rounded-lg bg-(--j-box)"
const input = "w-full bg-(--j-bg) border border-(--j-dim) rounded px-2.5 py-1.5 text-sm text-(--j-text) placeholder:text-(--j-dim) focus:outline-none focus:border-(--j-acc)"
const btn   = "px-3 py-1.5 text-xs border border-(--j-dim) rounded hover:bg-(--j-glow) transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const btnGo = "px-4 py-2 text-sm font-bold rounded bg-(--j-acc) text-(--j-on-acc) hover:bg-(--j-acc-hi) transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const label = "block text-[10px] tracking-widest opacity-60 mb-1"

type Profile = {
  id: string; mealProfileId: string | null; daysPerWeek: number; sessionMinutes: number
  experience: string; equipment: string; injuries: string; preferences: string
  barKg: number; plates: string
}
type Person = { name: string; sex: string; age: number | null; weightKg: number | null; goal: GoalKey; goalDelta: number }
type SavedProgramme = {
  id: string; title: string; goal: string; daysPerWeek: number; weeks: number
  digest: string; brief: string; model: string
  startedAt: string | null; endedAt: string | null; createdAt: string
  plan: Programme; inputs: Record<string, unknown>
}
type WorkoutRow = {
  id: string; dayKey: string; status: string; startedAt: string; finishedAt: string | null
  bodyweightKg: number | null; feeling: number | null; sets: number
}

const when = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
const mins = (a: string, b: string | null) => (b ? Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : null)

export default function GymClient() {
  const [view, setView] = useState<"today" | "programme" | "history" | "setup">("today")
  const [profile, setProfile] = useState<Profile | null>(null)
  const [person, setPerson]   = useState<Person | null>(null)
  const [mealProfiles, setMealProfiles] = useState<{ id: string; name: string; goal: string }[]>([])
  const [lifts, setLifts]     = useState<LiftInfo[]>([])
  const [current, setCurrent] = useState<{ id: string; title: string; startedAt: string } | null>(null)
  const [openWorkout, setOpenWorkout] = useState<{ id: string; dayKey: string; startedAt: string } | null>(null)
  const [recent, setRecent]   = useState<WorkoutRow[]>([])
  const [needsMigration, setNeedsMigration] = useState(false)

  const [programmes, setProgrammes] = useState<SavedProgramme[]>([])
  const [history, setHistory] = useState<{ pbs: any[]; sessions: any[] } | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const [form, setForm]   = useState<Profile | null>(null)
  const [dirty, setDirty] = useState(false)
  const [brief, setBrief] = useState("")
  const [weeks, setWeeks] = useState(4)
  const [busy, setBusy]   = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [since, setSince] = useState<number | null>(null)
  const [now, setNow]     = useState(Date.now())
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!since) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [since])
  const secs = since ? Math.floor((now - since) / 1000) : 0

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/jordan/gym/profile")
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't load the gym")
      setNeedsMigration(!!j.needsMigration)
      setProfile(j.profile); setForm(j.profile); setPerson(j.person ?? null)
      setMealProfiles(j.mealProfiles ?? []); setLifts(j.lifts ?? [])
      setCurrent(j.programme ?? null); setOpenWorkout(j.openWorkout ?? null); setRecent(j.recent ?? [])
      setDirty(false)
      // The blocks come with the first load, not only when the PROGRAMME tab is opened — TODAY
      // needs the day names to put "Upper A" on a button.
      fetch("/api/jordan/gym/programme").then(r => r.json()).then(p => setProgrammes(p.programmes ?? [])).catch(() => {})
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (view === "programme") fetch("/api/jordan/gym/programme").then(r => r.json()).then(j => setProgrammes(j.programmes ?? [])).catch(() => {})
    if (view === "history")   fetch("/api/jordan/gym/history").then(r => r.json()).then(j => setHistory(j)).catch(() => {})
  }, [view])

  async function api(url: string, body: any, method = "POST", signal?: AbortSignal) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? "Something went wrong")
    return j
  }

  function edit(patch: Partial<Profile>) { setForm(f => (f ? { ...f, ...patch } : f)); setDirty(true) }

  async function saveProfile() {
    if (!form) return
    setError(null); setBusy("save")
    try {
      await api("/api/jordan/gym/profile", form, "PUT")
      setDirty(false); setNote("Saved.")
      await load()
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  async function makeProgramme() {
    if (dirty) { setError("Save your setup first — the programme is written against the saved one."); return }
    setError(null); setNote(null); setBusy("programme"); setSince(Date.now())
    const ac = new AbortController(); abortRef.current = ac
    try {
      const j = await api("/api/jordan/gym/programme", { brief, weeks, model: getJordanModel() }, "POST", ac.signal)
      setProgrammes(p => [j.programme, ...p.map(x => ({ ...x, endedAt: x.endedAt ?? new Date().toISOString() }))])
      setCurrent({ id: j.programme.id, title: j.programme.title, startedAt: j.programme.startedAt })
      setBrief(""); setView("programme")
    } catch (e: any) {
      if (e?.name === "AbortError") setNote("Stopped. (The server may still finish it — reload in a minute to see.)")
      else setError(e.message)
    } finally { setBusy(null); setSince(null); abortRef.current = null }
  }

  async function startSession(dayKey: string, offPlan = false) {
    setError(null); setBusy("start")
    try {
      const j = await api("/api/jordan/gym/workout", { dayKey, programmeId: offPlan ? null : current?.id ?? null, offPlan })
      setSessionId(j.workout.id)
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  async function endBlock(id: string) {
    if (!confirm("End this block? The next programme will be written from what you actually did.")) return
    try { await api("/api/jordan/gym/programme", { id, end: true }, "PUT"); await load(); setProgrammes(p => p.map(x => x.id === id ? { ...x, endedAt: new Date().toISOString() } : x)) }
    catch (e: any) { setError(e.message) }
  }

  async function deleteProgramme(id: string) {
    if (!confirm("Delete this programme? Your logged sessions are kept.")) return
    try { await api("/api/jordan/gym/programme", { id }, "DELETE"); setProgrammes(p => p.filter(x => x.id !== id)); await load() }
    catch (e: any) { setError(e.message) }
  }

  const liveProgramme = programmes.find(p => p.id === current?.id) ?? null
  const plates = (form?.plates ?? "").split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0)

  // ── A session takes the whole screen. Nothing else matters while he's in the gym. ──
  if (sessionId) {
    return (
      <Session
        workoutId={sessionId}
        lifts={lifts}
        barKg={form?.barKg ?? 20}
        plates={plates.length ? plates : [25, 20, 15, 10, 5, 2.5, 1.25]}
        onFinished={() => { setSessionId(null); setNote("Session saved."); void load() }}
        onClose={() => { setSessionId(null); void load() }}
      />
    )
  }

  return (
    <div className="space-y-5 text-sm pb-16">
      {needsMigration && (
        <div className="border border-amber-600 bg-amber-950/30 text-amber-300 rounded-lg px-4 py-2.5 text-xs">
          The gym tables aren&apos;t in the database yet — press <strong>Run Migrations</strong> on the Admin page, then reload.
        </div>
      )}
      {error && <div className="border border-red-700 bg-red-950/40 text-red-300 rounded-lg px-4 py-2.5 text-xs">{error}</div>}
      {note && !error && <div className="border border-(--j-dim) rounded-lg px-4 py-2.5 text-xs opacity-80">{note}</div>}

      <div className={`${box} p-3 flex flex-wrap items-center gap-2`}>
        {([["today", "TODAY"], ["programme", "PROGRAMME"], ["history", "HISTORY"], ["setup", "SETUP"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)}
            className={`min-h-[44px] px-3 rounded border text-xs ${view === k ? "border-(--j-acc) bg-(--j-glow)" : "border-(--j-dim) hover:bg-(--j-glow)"}`}>{l}</button>
        ))}
        {person && (
          <span className="text-xs opacity-60 ml-2">
            {person.name} · {goalLabel(person.goal)}
            {!profile?.mealProfileId && " (no meal profile linked)"}
          </span>
        )}
        <span className="w-full sm:w-auto sm:ml-auto"><ModelPicker /></span>
      </div>

      {loading && <p className="text-xs opacity-60">LOADING…</p>}

      {/* ── TODAY ─────────────────────────────────────────────────────────── */}
      {view === "today" && !loading && (
        <div className="space-y-4">
          {openWorkout && (
            <div className={`${box} p-4 flex flex-wrap items-center gap-3`}>
              <div className="flex-1">
                <div className="font-bold">{openWorkout.dayKey || "Session"} — still open</div>
                <p className="text-xs opacity-60">Started {new Date(openWorkout.startedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}, {when(openWorkout.startedAt)}.</p>
              </div>
              <button className={`${btnGo} min-h-[44px]`} onClick={() => setSessionId(openWorkout.id)}>CARRY ON →</button>
            </div>
          )}

          <div className={`${box} p-4 space-y-3`}>
            <span className="text-xs tracking-widest opacity-60">START A SESSION</span>
            {!current ? (
              <p className="text-xs opacity-60">No programme yet — write one on the PROGRAMME tab, or just start an off-plan session and add exercises as you go.</p>
            ) : !liveProgramme ? (
              <p className="text-xs opacity-60">Loading <strong>{current.title}</strong>…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {liveProgramme.plan.days.map(d => {
                  const last = recent.find(w => w.dayKey === d.name)
                  return (
                    <button key={d.day} onClick={() => startSession(d.name)} disabled={busy === "start"}
                      className="min-h-[56px] px-4 rounded border border-(--j-dim) hover:bg-(--j-glow) text-left">
                      <div className="font-bold text-sm">{d.name}</div>
                      <div className="text-[11px] opacity-60">
                        {d.exercises.length} exercises{d.estimatedMinutes ? ` · ~${d.estimatedMinutes} min` : ""}
                        {last ? ` · last ${when(last.startedAt)}` : " · never done"}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            <button className={`${btn} min-h-[44px]`} onClick={() => startSession("Off-plan", true)} disabled={busy === "start"}>
              {busy === "start" ? "STARTING…" : "+ OFF-PLAN SESSION"}
            </button>
          </div>

          <div className={`${box} p-4 space-y-2`}>
            <span className="text-xs tracking-widest opacity-60">RECENT SESSIONS</span>
            {recent.length === 0 ? (
              <p className="text-xs opacity-60">Nothing logged yet.</p>
            ) : recent.map(w => (
              <div key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs border-t border-(--j-dim) pt-2 first:border-0">
                <span className="font-bold">{w.dayKey || "Session"}</span>
                <span className="opacity-60">{when(w.startedAt)}</span>
                <span className="opacity-60">{w.sets} sets</span>
                {mins(w.startedAt, w.finishedAt) && <span className="opacity-60">{mins(w.startedAt, w.finishedAt)} min</span>}
                {w.status === "IN_PROGRESS" && <span className="text-amber-400">still open</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PROGRAMME ─────────────────────────────────────────────────────── */}
      {view === "programme" && !loading && (
        <div className="space-y-4">
          <div className={`${box} p-4 space-y-3`}>
            <span className="text-xs tracking-widest opacity-60">WRITE A NEW BLOCK</span>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <span className={label}>WEEKS</span>
                <div className="flex gap-1">
                  {[3, 4, 6, 8].map(w => (
                    <button key={w} onClick={() => setWeeks(w)}
                      className={`w-11 min-h-[44px] rounded border text-sm ${weeks === w ? "border-(--j-acc) bg-(--j-glow)" : "border-(--j-dim) hover:bg-(--j-glow)"}`}>{w}</button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-w-[240px]">
                <label className={label} htmlFor="g-brief">ANYTHING FOR THIS BLOCK? (OPTIONAL)</label>
                <input id="g-brief" className={input} value={brief} onChange={e => setBrief(e.target.value)}
                  placeholder="more upper body, shorter sessions on Fridays, bench is stalling…" />
              </div>
              {busy === "programme" ? (
                <div className="flex items-center gap-3">
                  <span className="text-xs">
                    <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2 align-middle" />
                    Writing the block… {secs} s
                  </span>
                  <button className={`${btn} min-h-[44px]`} onClick={() => abortRef.current?.abort()}>STOP</button>
                </div>
              ) : (
                <button className={`${btnGo} min-h-[44px]`} onClick={makeProgramme} disabled={!!busy}>✨ WRITE IT</button>
              )}
            </div>
            <p className="text-[11px] opacity-50">
              Written for <strong>{person ? goalLabel(person.goal).toLowerCase() : "your goal"}</strong>, {profile?.daysPerWeek} days a week, {profile?.sessionMinutes} minutes a session — and from what you actually lifted last block. It never picks the weights: those come from your log.
              {" "}{profile?.equipment?.trim()
                ? "Using the kit you listed on SETUP."
                : "It assumes a normal commercial gym — swap anything your gym hasn't got, below."}
            </p>
          </div>

          {programmes.map(p => (
            <ProgrammeCard key={p.id} p={p} lifts={lifts} live={p.id === current?.id}
              onSwapped={next => setProgrammes(ps => ps.map(x => x.id === next.id ? next : x))}
              onEnd={() => endBlock(p.id)} onDelete={() => deleteProgramme(p.id)} />
          ))}
          {programmes.length === 0 && <p className="text-xs opacity-50">No programmes yet.</p>}
        </div>
      )}

      {/* ── HISTORY ───────────────────────────────────────────────────────── */}
      {view === "history" && !loading && (
        <div className="space-y-4">
          <div className={`${box} p-4 space-y-2`}>
            <span className="text-xs tracking-widest opacity-60">BESTS — MAIN LIFTS</span>
            {!history?.pbs?.length ? (
              <p className="text-xs opacity-60">Nothing yet. Log a session and they appear here.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {history.pbs.map((p: any) => (
                  <div key={p.lift.slug} className="border border-(--j-dim) rounded p-2">
                    <div className="text-[10px] tracking-wide opacity-60">{p.lift.name.toUpperCase()}{p.lift.perHand ? " (EACH)" : ""}</div>
                    <div className="text-base font-bold">{p.best.weightKg} kg × {p.best.reps}</div>
                    <div className="text-[11px] opacity-50">
                      {p.best.est1rm ? `about ${Math.round(p.best.est1rm)} kg for one · ` : ""}{when(p.best.loggedAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] opacity-50">Estimated one-rep maxes are Epley off sets of 10 or fewer, warm-ups excluded — a guide, not a tested max.</p>
          </div>

          <div className={`${box} p-4 space-y-2`}>
            <span className="text-xs tracking-widest opacity-60">SESSIONS</span>
            {!history?.sessions?.length ? (
              <p className="text-xs opacity-60">Nothing logged yet.</p>
            ) : history.sessions.map((s: any) => (
              <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs border-t border-(--j-dim) pt-2 first:border-0">
                <span className="font-bold">{s.dayKey || "Session"}</span>
                <span className="opacity-60">{when(s.startedAt)}</span>
                <span className="opacity-60">{s.sets} sets</span>
                <span className="opacity-60">{s.volumeKg.toLocaleString()} kg lifted</span>
                {mins(s.startedAt, s.finishedAt) && <span className="opacity-60">{mins(s.startedAt, s.finishedAt)} min</span>}
                {s.feeling && <span>{["😵", "😮‍💨", "🙂", "💪", "🔥"][s.feeling - 1]}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SETUP ─────────────────────────────────────────────────────────── */}
      {view === "setup" && form && !loading && (
        <div className={`${box} p-4 space-y-4`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs tracking-widest opacity-60">SETUP</span>
            <button className={btnGo} onClick={saveProfile} disabled={busy === "save" || !dirty}>{busy === "save" ? "SAVING…" : dirty ? "SAVE" : "SAVED"}</button>
          </div>

          <div>
            <label className={label} htmlFor="g-meal">WHOSE NUMBERS (FROM THE MEAL PLANNER)</label>
            <select id="g-meal" className={input} value={form.mealProfileId ?? ""} onChange={e => edit({ mealProfileId: e.target.value || null })}>
              <option value="">— not linked —</option>
              {mealProfiles.map(m => <option key={m.id} value={m.id}>{m.name} — {goalLabel(m.goal as GoalKey)}</option>)}
            </select>
            {/* ⚠ Linked, not copied: the goal is read through this every time, so the gym tool can
                never be adding weight every week while the meal planner has you in a deficit. */}
            <p className="text-[11px] opacity-50 mt-1">
              Your age, weight and <strong>goal</strong> are read from that profile — change the goal in the meal planner and the training follows it. Training in a deficit is a different job from training in a surplus.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className={label} htmlFor="g-days">DAYS A WEEK</label>
              <select id="g-days" className={input} value={form.daysPerWeek} onChange={e => edit({ daysPerWeek: Number(e.target.value) })}>
                {[2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="g-mins">MINUTES A SESSION</label>
              <select id="g-mins" className={input} value={form.sessionMinutes} onChange={e => edit({ sessionMinutes: Number(e.target.value) })}>
                {[30, 45, 60, 75, 90, 120].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={label} htmlFor="g-exp">EXPERIENCE</label>
              <select id="g-exp" className={input} value={form.experience} onChange={e => edit({ experience: e.target.value })}>
                {EXPERIENCE.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div>
              {/* Optional on purpose — blank assumes a normal commercial gym, and anything it
                  picks that yours hasn't got is two taps to swap. */}
              <label className={label} htmlFor="g-kit">WHAT THE GYM HAS (OPTIONAL)</label>
              <textarea id="g-kit" rows={3} className={input} value={form.equipment} onChange={e => edit({ equipment: e.target.value })}
                placeholder="leave empty for a normal gym — only worth filling in if yours is unusual (no squat rack, dumbbells only to 30 kg, a machine nobody else has…)" />
            </div>
            <div>
              <label className={label} htmlFor="g-inj">INJURIES — NEVER PRESCRIBED</label>
              <textarea id="g-inj" rows={3} className={input} value={form.injuries} onChange={e => edit({ injuries: e.target.value })}
                placeholder="left shoulder — no barbell overhead press, no dips…" />
            </div>
            <div>
              <label className={label} htmlFor="g-pref">LIKES &amp; DISLIKES</label>
              <textarea id="g-pref" rows={3} className={input} value={form.preferences} onChange={e => edit({ preferences: e.target.value })}
                placeholder="hate burpees, like heavy compounds, happy with machines…" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className={label} htmlFor="g-bar">BAR WEIGHT (KG)</label>
              <input id="g-bar" className={input} inputMode="decimal" value={form.barKg} onChange={e => edit({ barKg: Number(e.target.value) })} />
            </div>
            <div className="col-span-3">
              <label className={label} htmlFor="g-plates">PLATES YOU HAVE (KG, EACH)</label>
              <input id="g-plates" className={input} value={form.plates} onChange={e => edit({ plates: e.target.value })} placeholder="25,20,15,10,5,2.5,1.25" />
            </div>
          </div>
          {/* The smallest jump on a bar is TWICE the smallest plate — "add 2.5 kg" is impossible
              with 2.5 kg as your smallest pair, and that is the difference between a suggestion
              he can load and one he can't. */}
          <p className="text-[11px] opacity-50 -mt-2">
            Used for the plate maths and the size of the jumps. The smallest change you can make on a bar is two of your smallest plate
            {plates.length ? ` — ${Math.min(...plates) * 2} kg for you.` : "."}
          </p>
        </div>
      )}
    </div>
  )
}

function ProgrammeCard({ p, lifts, live, onSwapped, onEnd, onDelete }: {
  p: SavedProgramme; lifts: LiftInfo[]; live: boolean
  onSwapped: (next: SavedProgramme) => void; onEnd: () => void; onDelete: () => void
}) {
  const [open, setOpen] = useState(live)
  const [swapping, setSwapping] = useState<{ day: string; slug: string; name: string } | null>(null)
  const [swapErr, setSwapErr] = useState<string | null>(null)
  const volume  = weeklySets(p.plan, lifts)
  const thin    = volume.filter(v => v.low)
  const missing = missingMuscles(volume)
  const asked   = Number((p.inputs as any)?.daysAsked) || 0

  async function doSwap(option: SwapOption) {
    if (!swapping) return
    setSwapErr(null)
    try {
      const r = await fetch("/api/jordan/gym/swap", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programmeId: p.id, dayName: swapping.day, slug: swapping.slug, option }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't swap it")
      onSwapped(j.programme)
      setSwapping(null)
    } catch (e: any) { setSwapErr(e.message) }
  }
  return (
    <div className={box}>
      <button onClick={() => setOpen(!open)} className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left min-h-[44px]">
        <span className="font-bold">{open ? "▼" : "▶"} {p.title}</span>
        <span className="text-xs opacity-60">
          {p.plan.days.length} days · {p.weeks} weeks · {when(p.createdAt)} · for {goalLabel(p.goal as GoalKey).toLowerCase()}
        </span>
        {live ? <span className="text-xs text-(--j-acc)">● RUNNING</span> : <span className="text-xs opacity-40">finished</span>}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-(--j-dim) pt-3">
          {p.plan.notes && <p className="text-xs opacity-70 border border-(--j-dim) rounded px-3 py-2">💡 {p.plan.notes}</p>}
          {p.brief && <p className="text-xs opacity-60">Asked for: {p.brief}</p>}
          {asked > 0 && asked !== p.plan.days.length && (
            <p className="text-xs text-amber-400">
              ⚠ You asked for {asked} days a week and it wrote {p.plan.days.length}. Write the block again if you want the {asked}.
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {p.plan.days.map(d => (
              <div key={d.day} className="border border-(--j-dim) rounded-lg p-3 space-y-2">
                <div className="text-[10px] tracking-widest opacity-60">{d.name.toUpperCase()}{d.estimatedMinutes ? ` · ~${d.estimatedMinutes} MIN` : ""}</div>
                <ul className="text-xs space-y-1">
                  {d.exercises.map((e, i) => (
                    <li key={i}>
                      <span className="font-bold">{e.name}</span>
                      <span className="opacity-60"> — {e.sets} × {e.repLow}–{e.repHigh} @ {e.rir} left, {Math.round(e.restSeconds / 60 * 10) / 10} min rest</span>
                      {live && (
                        <button onClick={() => { setSwapErr(null); setSwapping({ day: d.name, slug: e.slug, name: e.name }) }}
                          className="ml-2 opacity-60 hover:opacity-100 underline" title="Something else instead">swap</button>
                      )}
                      {e.note && <div className="opacity-50">{e.note}</div>}
                      {swapping?.day === d.name && swapping?.slug === e.slug && (
                        <div className="mt-2">
                          {swapErr && <p className="text-xs text-red-300 mb-1">{swapErr}</p>}
                          <SwapPicker slug={e.slug} name={e.name} onPick={doSwap} onClose={() => setSwapping(null)} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* ⚠ Say when it's thin. Printing "ten to twenty is the range" under a programme that
              gives a muscle six is the screen arguing with itself — and a thin block read as a
              normal one is exactly "nothing happened looking like success". */}
          {volume.length > 0 && (
            <div className="text-[11px] space-y-1">
              <p className="opacity-50">
                Hard sets a week: {volume.map(v => (
                  <span key={v.muscle} className={v.low ? "text-amber-400" : ""}>{v.muscle} {v.sets} · </span>
                ))}
                <span>ten to twenty a muscle is the range that grows it. Sets count once for the muscle a lift actually trains, and a half where it only helps.</span>
              </p>
              {(thin.length > 0 || missing.length > 0) && (
                <p className="text-amber-400">
                  ⚠ Light on {[...thin.map(v => `${v.muscle} (${v.sets})`), ...missing.map(m => `${m} (nothing)`)].join(", ")}.
                  {live ? " Swap an exercise, or write the block again — the AI is told to clear 10 a muscle." : ""}
                </p>
              )}
            </div>
          )}
          {p.digest && (
            <details className="text-[11px] opacity-60">
              <summary className="cursor-pointer">What it was told about last block</summary>
              <pre className="whitespace-pre-wrap mt-1">{p.digest}</pre>
            </details>
          )}

          <div className="flex flex-wrap gap-2">
            {live && <button className={`${btn} min-h-[44px]`} onClick={onEnd}>END THIS BLOCK</button>}
            <button className={`${btn} min-h-[44px] hover:border-red-700 hover:text-red-400`} onClick={onDelete}>DELETE</button>
          </div>
        </div>
      )}
    </div>
  )
}
