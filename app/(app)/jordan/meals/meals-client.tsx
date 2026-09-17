"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import ModelPicker, { getJordanModel } from "../model-picker"
import {
  ACTIVITY, GOAL_DEFS, MACRO_PRESETS, MEAL_SLOT_OPTIONS, defaultMealKeys,
  kgFromStone, cmFromFeet, stoneFromKg, feetFromCm,
  goalDef, deltaFor, goalSummary, gbp, shoppingTotals, chosenMeals,
  targets as workOut, dayTotals, shoppingText,
  type GoalKey, type Plan, type Shopping, type Targets,
} from "@/lib/jordan-meals"

// JORDAN.SYS → MEAL PLANNER. Private to /jordan (every route 404s for anyone else).
//
// Three parts, top to bottom: the PROFILES strip (one per person), YOUR NUMBERS (the BMR
// calculator — everything the plan is written against, worked out live as you type), and the
// PLANS: make one, read it day by day, then make its shopping list and tick it off in the shop.
//
// ⚠ Full width, no centred column. ⚠ Touch targets: the shopping ticks are used on a phone.

const GREEN = "#33ff66"
const box   = "border border-[#1f5c33] rounded-lg bg-[#040f08]"
const input = "w-full bg-black border border-[#1f5c33] rounded px-2.5 py-1.5 text-sm text-[#33ff66] placeholder:text-[#1f5c33] focus:outline-none focus:border-[#33ff66]"
const btn   = "px-3 py-1.5 text-xs border border-[#1f5c33] rounded hover:bg-[#0a2214] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const btnGo = "px-4 py-2 text-sm font-bold rounded bg-[#33ff66] text-black hover:bg-[#5cff88] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const label = "block text-[10px] tracking-widest opacity-60 mb-1"

type Profile = {
  id: string; name: string; sex: string; age: number | null; heightCm: number | null; weightKg: number | null
  activity: string; goal: string; goalDelta: number; kcalOverride: number | null
  proteinPct: number; carbsPct: number; fatPct: number; meals: string[]; mealsPerDay: number
  likes: string; dislikes: string; notes: string; plans: number
}
type SavedPlan = {
  id: string; title: string; days: number; brief: string; model: string; createdAt: string
  targets: Record<string, number>; plan: Plan; shopping: Shopping | null
}

/** The form holds what's typed, in the units Jordan types them in. */
type Form = {
  sex: string; age: string; st: string; lb: string; ft: string; in: string
  activity: string; goal: string; goalDelta: number; kcalOverride: string
  proteinPct: string; carbsPct: string; fatPct: string; meals: string[]
  likes: string; dislikes: string; notes: string
}

function formFrom(p: Profile): Form {
  const w = p.weightKg ? stoneFromKg(p.weightKg) : null
  const h = p.heightCm ? feetFromCm(p.heightCm) : null
  return {
    sex: p.sex, age: p.age ? String(p.age) : "",
    st: w ? String(w.st) : "", lb: w ? String(w.lb) : "",
    ft: h ? String(h.ft) : "", in: h ? String(h.in) : "",
    activity: p.activity, goal: goalDef(p.goal).key, goalDelta: deltaFor(p.goal, p.goalDelta),
    kcalOverride: p.kcalOverride ? String(p.kcalOverride) : "",
    proteinPct: String(p.proteinPct), carbsPct: String(p.carbsPct), fatPct: String(p.fatPct),
    // An old profile with nothing ticked keeps the day it already had, turned into ticks.
    meals: p.meals?.length ? p.meals : defaultMealKeys(p.mealsPerDay),
    likes: p.likes, dislikes: p.dislikes, notes: p.notes,
  }
}

const n = (s: string) => { const v = Number(s); return Number.isFinite(v) ? v : 0 }

/** Days per AI call. Two days of full recipes comfortably fits one reply; seven does not. */
const CHUNK_DAYS = 2

/** The saved numbers a form works out to — the same maths the plan route uses. */
function numbersOf(f: Form) {
  const st = n(f.st), lb = n(f.lb), ft = n(f.ft), inch = n(f.in)
  return {
    sex: f.sex, age: n(f.age) || null,
    weightKg: st || lb ? Math.round(kgFromStone(st, lb) * 10) / 10 : null,
    heightCm: ft || inch ? Math.round(cmFromFeet(ft, inch) * 10) / 10 : null,
    activity: f.activity, goal: f.goal, goalDelta: deltaFor(f.goal, f.goalDelta),
    kcalOverride: n(f.kcalOverride) || null,
    proteinPct: n(f.proteinPct), carbsPct: n(f.carbsPct), fatPct: n(f.fatPct),
  }
}

const when = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" })

export default function MealsClient() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeId, setActiveId] = useState("")
  const [form, setForm]         = useState<Form | null>(null)
  const [dirty, setDirty]       = useState(false)
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [note, setNote]         = useState<string | null>(null)
  const [needsMigration, setNeedsMigration] = useState(false)

  const [plans, setPlans]       = useState<SavedPlan[]>([])
  const [openId, setOpenId]     = useState<string | null>(null)
  const [days, setDays]         = useState(3)
  const [brief, setBrief]       = useState("")
  const [since, setSince]       = useState<number | null>(null) // when the current AI call started
  const [madeDays, setMadeDays] = useState(0)                    // days written so far, this run
  const [now, setNow]           = useState(Date.now())
  const abortRef = useRef<AbortController | null>(null)
  const planTopRef = useRef<HTMLDivElement>(null)

  const active = profiles.find(p => p.id === activeId) ?? null
  const t: Targets | null = form ? workOut(numbersOf(form)) : null

  // A live clock for the "42 s" on a running AI call — real progress, never a made-up bar.
  useEffect(() => {
    if (!since) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [since])
  const secs = since ? Math.floor((now - since) / 1000) : 0

  const loadProfiles = useCallback(async (selectId?: string) => {
    setLoading(true)
    try {
      const r = await fetch("/api/jordan/meals/profiles")
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't load profiles")
      setNeedsMigration(!!j.needsMigration)
      const list: Profile[] = j.profiles ?? []
      setProfiles(list)
      const pick = selectId ?? (list.some(p => p.id === activeId) ? activeId : list[0]?.id ?? "")
      setActiveId(pick)
      const chosen = list.find(p => p.id === pick)
      setForm(chosen ? formFrom(chosen) : null)
      setDirty(false)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  useEffect(() => { void loadProfiles() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  // Plans follow the selected profile.
  useEffect(() => {
    if (!activeId) { setPlans([]); return }
    fetch(`/api/jordan/meals/plans?profileId=${encodeURIComponent(activeId)}`)
      .then(r => r.json()).then(j => setPlans(j.plans ?? [])).catch(() => {})
  }, [activeId])

  async function api(url: string, body: any, method = "POST", signal?: AbortSignal) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? "Something went wrong")
    return j
  }

  function selectProfile(id: string) {
    if (dirty && !confirm("You have unsaved changes to these numbers. Switch anyway?")) return
    setActiveId(id)
    const p = profiles.find(x => x.id === id)
    setForm(p ? formFrom(p) : null)
    setDirty(false); setOpenId(null)
  }

  function edit(patch: Partial<Form>) { setForm(f => (f ? { ...f, ...patch } : f)); setDirty(true) }

  /** Picking a goal sets THREE things: the goal, a calorie gap that goal actually offers, and its
   *  suggested macro split. The split changes on screen where you can see it (and change it back),
   *  rather than the goal quietly meaning something different from the numbers underneath. */
  function pickGoal(key: GoalKey) {
    const g = goalDef(key)
    setForm(f => f ? {
      ...f, goal: key, goalDelta: deltaFor(key, f.goalDelta),
      proteinPct: String(g.macros.protein), carbsPct: String(g.macros.carbs), fatPct: String(g.macros.fat),
    } : f)
    setDirty(true)
  }

  async function newProfile() {
    const name = prompt("Whose numbers are these? (e.g. Me, Kate)")?.trim()
    if (!name) return
    setError(null); setBusy("new")
    try {
      const j = await api("/api/jordan/meals/profiles", { name })
      await loadProfiles(j.id)
      setNote(`Created "${name}" — fill in the numbers below and save.`)
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  async function saveProfile() {
    if (!activeId || !form) return
    const pct = n(form.proteinPct) + n(form.carbsPct) + n(form.fatPct)
    if (pct !== 100 && !confirm(`The macro split adds up to ${pct}%, not 100%. Save anyway? (It will be scaled to 100.)`)) return
    setError(null); setBusy("save")
    try {
      await api("/api/jordan/meals/profiles", { id: activeId, ...numbersOf(form), meals: form.meals, likes: form.likes, dislikes: form.dislikes, notes: form.notes }, "PUT")
      setDirty(false); setNote("Saved.")
      await loadProfiles(activeId)
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  async function renameProfile() {
    if (!active) return
    const name = prompt("Rename this profile", active.name)?.trim()
    if (!name || name === active.name) return
    try {
      await api("/api/jordan/meals/profiles", { id: active.id, name }, "PUT")
      setProfiles(ps => ps.map(p => p.id === active.id ? { ...p, name } : p))
    } catch (e: any) { setError(e.message) }
  }

  async function deleteProfile() {
    if (!active) return
    if (!confirm(`Delete "${active.name}" and its ${active.plans} saved plan(s)? This can't be undone.`)) return
    try {
      await api("/api/jordan/meals/profiles", { id: active.id }, "DELETE")
      await loadProfiles("")
    } catch (e: any) { setError(e.message) }
  }

  /**
   * ⚠⚠ A LONG PLAN IS WRITTEN A FEW DAYS AT A TIME (2026-09-17). A week of full recipes does not
   * fit in one reply — the model ran out of room mid-JSON and a two-minute wait ended in
   * "couldn't read the AI's answer" with nothing to show for it. Two days per call, each one
   * SAVED as it lands, so stopping (or a failure on day 5) keeps days 1–4.
   * The counter moves a day at a time: real progress, never a made-up bar.
   */
  async function makePlan() {
    if (!activeId) return
    if (dirty) { setError("Save your numbers first — the plan is written against the saved ones."); return }
    if (!t) { setError("Fill in sex, age, height and weight first."); return }
    if (form && form.meals.length === 0) { setError("Tick the meals you have first."); return }
    setError(null); setNote(null); setBusy("plan"); setSince(Date.now()); setMadeDays(0)
    const ac = new AbortController(); abortRef.current = ac
    let made: SavedPlan | null = null
    try {
      while (!made || made.plan.days.length < days) {
        const from = (made?.plan.days.length ?? 0) + 1
        const j = await api("/api/jordan/meals/plan", {
          profileId: activeId, days, brief, model: getJordanModel(),
          planId: made?.id ?? null, fromDay: from, toDay: Math.min(from + CHUNK_DAYS - 1, days),
        }, "POST", ac.signal)
        const next: SavedPlan = j.plan
        // ⚠ Stop if a chunk adds nothing, or this loops forever on a model that keeps returning
        // the same day. What is already saved still stands.
        if (made && next.plan.days.length <= made.plan.days.length) { made = next; break }
        made = next
        setMadeDays(made.plan.days.length)
        setPlans(ps => [made!, ...ps.filter(p => p.id !== made!.id)])
        setOpenId(made.id)
        if (j.done) break
      }
      setProfiles(ps => ps.map(p => p.id === activeId ? { ...p, plans: p.plans + 1 } : p))
      setBrief("")
      if (made && made.plan.days.length < days) setNote(`Stopped at ${made.plan.days.length} of ${days} days — what's written is saved.`)
      setTimeout(() => planTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
    } catch (e: any) {
      const got = made?.plan.days.length ?? 0
      if (e?.name === "AbortError") setNote(got ? `Stopped — days 1 to ${got} are saved.` : "Stopped.")
      else setError(got ? `${e.message} Days 1 to ${got} are saved.` : e.message)
      if (made) { setPlans(ps => [made!, ...ps.filter(p => p.id !== made!.id)]); setOpenId(made.id) }
    } finally { setBusy(null); setSince(null); setMadeDays(0); abortRef.current = null }
  }

  async function makeShopping(plan: SavedPlan) {
    setError(null); setBusy(`shop:${plan.id}`); setSince(Date.now())
    const ac = new AbortController(); abortRef.current = ac
    try {
      const j = await api("/api/jordan/meals/shopping", { planId: plan.id, model: getJordanModel() }, "POST", ac.signal)
      setPlans(ps => ps.map(p => p.id === plan.id ? { ...p, shopping: j.shopping } : p))
    } catch (e: any) {
      if (e?.name === "AbortError") setNote("Stopped.")
      else setError(e.message)
    } finally { setBusy(null); setSince(null); abortRef.current = null }
  }

  /** Ticks save straight away — the whole list, so a tap in the shop can't lose an earlier one. */
  function setShopping(plan: SavedPlan, shopping: Shopping) {
    setPlans(ps => ps.map(p => p.id === plan.id ? { ...p, shopping } : p))
    api("/api/jordan/meals/plans", { id: plan.id, shopping }, "PUT").catch((e: any) => setError(`Tick not saved: ${e.message}`))
  }

  async function renamePlan(plan: SavedPlan) {
    const title = prompt("Rename this plan", plan.title)?.trim()
    if (!title || title === plan.title) return
    try {
      await api("/api/jordan/meals/plans", { id: plan.id, title }, "PUT")
      setPlans(ps => ps.map(p => p.id === plan.id ? { ...p, title } : p))
    } catch (e: any) { setError(e.message) }
  }

  async function deletePlan(plan: SavedPlan) {
    if (!confirm(`Delete "${plan.title}"? This can't be undone.`)) return
    try {
      await api("/api/jordan/meals/plans", { id: plan.id }, "DELETE")
      setPlans(ps => ps.filter(p => p.id !== plan.id))
      setProfiles(ps => ps.map(p => p.id === activeId ? { ...p, plans: Math.max(0, p.plans - 1) } : p))
      if (openId === plan.id) setOpenId(null)
    } catch (e: any) { setError(e.message) }
  }

  const stop = () => abortRef.current?.abort()

  return (
    <div className="space-y-5 text-sm pb-16">
      {needsMigration && (
        <div className="border border-amber-600 bg-amber-950/30 text-amber-300 rounded-lg px-4 py-2.5 text-xs">
          The meal planner tables aren&apos;t in the database yet — press <strong>Run Migrations</strong> on the Admin page, then reload.
        </div>
      )}
      {error && <div className="border border-red-700 bg-red-950/40 text-red-300 rounded-lg px-4 py-2.5 text-xs">{error}</div>}
      {note && !error && <div className="border border-[#1f5c33] rounded-lg px-4 py-2.5 text-xs opacity-80">{note}</div>}

      {/* ── Profiles ── */}
      <div className={`${box} p-3 flex flex-wrap items-center gap-2`}>
        <span className="text-[10px] tracking-widest opacity-60 mr-1">PROFILES</span>
        {loading && profiles.length === 0 ? <span className="text-xs opacity-60">LOADING…</span> : profiles.map(p => (
          <button key={p.id} onClick={() => selectProfile(p.id)}
            className={`min-h-[44px] px-3 rounded border text-xs transition-colors ${p.id === activeId ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] hover:bg-[#0a2214]"}`}>
            {p.name} <span className="opacity-50">· {p.plans} plan{p.plans === 1 ? "" : "s"}</span>
          </button>
        ))}
        <button className={`${btn} min-h-[44px]`} onClick={newProfile} disabled={busy === "new"}>+ NEW PROFILE</button>
        {active && (
          <span className="ml-auto flex gap-2">
            <button className={btn} onClick={renameProfile}>RENAME</button>
            <button className={`${btn} hover:border-red-700 hover:text-red-400`} onClick={deleteProfile}>DELETE</button>
          </span>
        )}
        <span className="w-full sm:w-auto sm:ml-auto"><ModelPicker /></span>
      </div>

      {!active || !form ? (
        !loading && <p className="text-xs opacity-50">Add a profile to start — one for you, one for anyone else you cook for.</p>
      ) : (
        <>
          {/* ── Your numbers ── */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className={`${box} p-4 space-y-4`}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs tracking-widest opacity-60">YOUR NUMBERS — {active.name.toUpperCase()}</span>
                <button className={btnGo} onClick={saveProfile} disabled={busy === "save" || !dirty}>{busy === "save" ? "SAVING…" : dirty ? "SAVE" : "SAVED"}</button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <span className={label}>SEX</span>
                  <div className="flex gap-1">
                    {(["male", "female"] as const).map(s => (
                      <button key={s} onClick={() => edit({ sex: s })}
                        className={`flex-1 min-h-[44px] rounded border text-xs ${form.sex === s ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33]"}`}>{s === "male" ? "Male" : "Female"}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={label} htmlFor="m-age">AGE</label>
                  <input id="m-age" className={input} inputMode="numeric" value={form.age} onChange={e => edit({ age: e.target.value })} placeholder="years" />
                </div>
                <div>
                  <span className={label}>HEIGHT</span>
                  <div className="flex gap-1 items-center">
                    <input className={input} inputMode="numeric" value={form.ft} onChange={e => edit({ ft: e.target.value })} placeholder="ft" aria-label="feet" />
                    <span className="text-xs opacity-60">ft</span>
                    <input className={input} inputMode="numeric" value={form.in} onChange={e => edit({ in: e.target.value })} placeholder="in" aria-label="inches" />
                    <span className="text-xs opacity-60">in</span>
                  </div>
                </div>
                <div>
                  <span className={label}>WEIGHT</span>
                  <div className="flex gap-1 items-center">
                    <input className={input} inputMode="numeric" value={form.st} onChange={e => edit({ st: e.target.value })} placeholder="st" aria-label="stone" />
                    <span className="text-xs opacity-60">st</span>
                    <input className={input} inputMode="numeric" value={form.lb} onChange={e => edit({ lb: e.target.value })} placeholder="lb" aria-label="pounds" />
                    <span className="text-xs opacity-60">lb</span>
                  </div>
                </div>
              </div>

              {/* The goal comes first and is a row of buttons, not a dropdown — it is the choice
                  everything else hangs off, and it was invisible inside a select. */}
              <div>
                <span className={label}>GOAL — WHAT ARE YOU TRYING TO DO?</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                  {GOAL_DEFS.map(g => (
                    <button key={g.key} onClick={() => pickGoal(g.key)}
                      className={`min-h-[44px] px-2 rounded border text-xs ${form.goal === g.key ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] hover:bg-[#0a2214]"}`}>
                      {g.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] opacity-60 mt-1">{goalDef(form.goal).blurb}</p>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className={label} htmlFor="m-act">ACTIVITY</label>
                  <select id="m-act" className={input} value={form.activity} onChange={e => edit({ activity: e.target.value })}>
                    {ACTIVITY.map(a => <option key={a.key} value={a.key}>{a.label} — {a.hint}</option>)}
                  </select>
                </div>
                {goalDef(form.goal).rates.length > 0 && (
                  <div>
                    <label className={label} htmlFor="m-rate">HOW FAST</label>
                    <select id="m-rate" className={input} value={form.goalDelta} onChange={e => edit({ goalDelta: Number(e.target.value) })}>
                      {goalDef(form.goal).rates.map(r => <option key={r.delta} value={r.delta}>{r.label}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className={`${label} mb-0`}>MACRO SPLIT (% OF CALORIES)</span>
                  {MACRO_PRESETS.map(m => (
                    <button key={m.label} className={btn} onClick={() => edit({ proteinPct: String(m.protein), carbsPct: String(m.carbs), fatPct: String(m.fat) })}>
                      {m.label} {m.protein}/{m.carbs}/{m.fat}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 max-w-md">
                  {([["proteinPct", "PROTEIN"], ["carbsPct", "CARBS"], ["fatPct", "FAT"]] as const).map(([k, l]) => (
                    <div key={k}>
                      <label className={label} htmlFor={`m-${k}`}>{l} %</label>
                      <input id={`m-${k}`} className={input} inputMode="numeric" value={form[k]} onChange={e => edit({ [k]: e.target.value } as Partial<Form>)} />
                    </div>
                  ))}
                </div>
                {n(form.proteinPct) + n(form.carbsPct) + n(form.fatPct) !== 100 && (
                  <p className="text-[11px] text-amber-400 mt-1">Adds up to {n(form.proteinPct) + n(form.carbsPct) + n(form.fatPct)}% — should be 100.</p>
                )}
                {/* Say where the split came from — picking a goal changed these boxes. */}
                {(() => {
                  const g = goalDef(form.goal)
                  const same = n(form.proteinPct) === g.macros.protein && n(form.carbsPct) === g.macros.carbs && n(form.fatPct) === g.macros.fat
                  return (
                    <p className="text-[11px] opacity-60 mt-1 flex flex-wrap items-center gap-2">
                      <span>
                        {g.label} suggests <strong>{g.macros.protein}/{g.macros.carbs}/{g.macros.fat}</strong> — {g.macroWhy}.
                        {same ? " That's what's set; change it if you want." : ""}
                      </span>
                      {!same && (
                        <button className={btn} onClick={() => edit({ proteinPct: String(g.macros.protein), carbsPct: String(g.macros.carbs), fatPct: String(g.macros.fat) })}>
                          USE IT
                        </button>
                      )}
                    </p>
                  )
                })()}
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                {/* Tick what you actually eat (Jordan, 2026-09-17) — a count forced the day into
                    someone else's shape: "4 meals" used to mean breakfast, lunch, a snack and
                    dinner whether or not that was how he ate. */}
                <div>
                  <span className={label}>MEALS YOU HAVE</span>
                  <div className="flex flex-wrap gap-1">
                    {MEAL_SLOT_OPTIONS.map(o => {
                      const on = form.meals.includes(o.key)
                      return (
                        <button key={o.key} onClick={() => edit({ meals: on ? form.meals.filter(k => k !== o.key) : [...form.meals, o.key] })}
                          className={`min-h-[44px] px-3 rounded border text-xs ${on ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] hover:bg-[#0a2214]"}`}>
                          {on ? "✓ " : ""}{o.label}
                        </button>
                      )
                    })}
                  </div>
                  {form.meals.length === 0 && (
                    <p className="text-[11px] text-amber-400 mt-1">Tick at least one — nothing ticked means no meals to plan.</p>
                  )}
                </div>
                <div>
                  <label className={label} htmlFor="m-over">DAILY CALORIES BY HAND (OPTIONAL)</label>
                  <input id="m-over" className={input} inputMode="numeric" value={form.kcalOverride} onChange={e => edit({ kcalOverride: e.target.value })} placeholder="leave empty to use the calculation" />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <label className={label} htmlFor="m-likes">LIKES / USUAL FOODS</label>
                  <textarea id="m-likes" rows={3} className={input} value={form.likes} onChange={e => edit({ likes: e.target.value })} placeholder="chicken, rice, pasta, curries, Greek yoghurt…" />
                </div>
                <div>
                  <label className={label} htmlFor="m-dislikes">DISLIKES &amp; ALLERGIES — NEVER USED</label>
                  <textarea id="m-dislikes" rows={3} className={input} value={form.dislikes} onChange={e => edit({ dislikes: e.target.value })} placeholder="mushrooms, shellfish, nuts…" />
                </div>
                <div>
                  <label className={label} htmlFor="m-notes">ANYTHING ELSE</label>
                  <textarea id="m-notes" rows={3} className={input} value={form.notes} onChange={e => edit({ notes: e.target.value })} placeholder="air fryer, no time on weekdays, cooking for two…" />
                </div>
              </div>
            </div>

            {/* ── The results ── */}
            <div className={`${box} p-4 space-y-3`}>
              <span className="text-xs tracking-widest opacity-60">WHAT THAT WORKS OUT TO</span>
              {!t ? (
                <p className="text-xs opacity-60">Fill in sex, age, height and weight and the numbers appear here.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Stat label="BMR — burned at rest" value={`${t.bmr.toLocaleString()} kcal`} />
                    <Stat label="Maintenance (with activity)" value={`${t.tdee.toLocaleString()} kcal`} />
                  </div>
                  <div className="border border-[#33ff66] rounded-lg p-3 text-center">
                    <div className="text-[10px] tracking-widest opacity-60">DAILY TARGET{t.overridden ? " (BY HAND)" : ""}</div>
                    <div className="text-3xl font-bold">{t.kcal.toLocaleString()} <span className="text-sm font-normal opacity-60">kcal</span></div>
                    <div className="text-[11px] opacity-70 mt-1">{goalSummary(form.goal, form.goalDelta)}</div>
                    {!t.overridden && t.kcal === t.bmr && t.tdee + deltaFor(form.goal, form.goalDelta) < t.bmr && (
                      <p className="text-[11px] text-amber-400 mt-1">Held at your BMR — the goal would take it lower than the body burns at rest.</p>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <Stat label={`Protein ${t.proteinPct}%`} value={`${t.protein} g`} />
                    <Stat label={`Carbs ${t.carbsPct}%`} value={`${t.carbs} g`} />
                    <Stat label={`Fat ${t.fatPct}%`} value={`${t.fat} g`} />
                  </div>
                  <p className="text-[11px] opacity-50 leading-relaxed">
                    Mifflin–St Jeor formula, the one dietitians use. {numbersOf(form).weightKg ? `You're ${numbersOf(form).weightKg} kg and ${numbersOf(form).heightCm} cm.` : ""} A 500 kcal daily deficit is about a pound a week.
                  </p>
                  {dirty && <p className="text-[11px] text-amber-400">Unsaved — press SAVE before making a plan.</p>}
                </>
              )}
            </div>
          </div>

          {/* ── Make a plan ── */}
          <div className={`${box} p-4 space-y-3`} ref={planTopRef}>
            <span className="text-xs tracking-widest opacity-60">MAKE A PLAN</span>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <span className={label}>DAYS</span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5, 6, 7].map(d => (
                    <button key={d} onClick={() => setDays(d)}
                      className={`w-11 min-h-[44px] rounded border text-sm ${days === d ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] hover:bg-[#0a2214]"}`}>{d}</button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-w-[240px]">
                <label className={label} htmlFor="m-brief">ANYTHING FOR THIS PLAN? (OPTIONAL)</label>
                <input id="m-brief" className={input} value={brief} onChange={e => setBrief(e.target.value)} placeholder="use up the chicken in the freezer, big batch of chilli, quick breakfasts…" />
              </div>
              {busy === "plan" ? (
                <div className="flex items-center gap-3">
                  <span className="text-xs">
                    <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2 align-middle" />
                    {madeDays > 0
                      ? `Day ${Math.min(madeDays + 1, days)} of ${days}… (${madeDays} written and saved) ${secs} s`
                      : `Writing day 1 of ${days}… ${secs} s`}
                  </span>
                  <button className={`${btn} min-h-[44px]`} onClick={stop}>STOP</button>
                </div>
              ) : (
                <button className={`${btnGo} min-h-[44px]`} onClick={makePlan} disabled={!t || dirty || !!busy}>
                  ✨ MAKE {days}-DAY PLAN
                </button>
              )}
            </div>
            {t && <p className="text-[11px] opacity-50">Written for <strong>{goalDef(form.goal).label.toLowerCase()}</strong> — {t.kcal.toLocaleString()} kcal · {t.protein} g protein a day, across {chosenMeals(form.meals, form.meals.length || 3).join(", ").toLowerCase()}{form.dislikes.trim() ? ", never using what's under dislikes" : ""}.{days > CHUNK_DAYS ? ` Written ${CHUNK_DAYS} days at a time and saved as it goes.` : ""}</p>}
          </div>

          {/* ── Plans ── */}
          {plans.length > 0 && (
            <div className="space-y-3">
              <span className="text-xs tracking-widest opacity-60">PLANS ({plans.length})</span>
              {plans.map(plan => (
                <PlanCard key={plan.id} plan={plan} open={openId === plan.id}
                  shopBusy={busy === `shop:${plan.id}`} secs={secs} anyBusy={!!busy}
                  onToggle={() => setOpenId(openId === plan.id ? null : plan.id)}
                  onShopping={() => makeShopping(plan)} onStop={stop}
                  onTick={s => setShopping(plan, s)} onRename={() => renamePlan(plan)} onDelete={() => deletePlan(plan)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label: l, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#1f5c33] rounded p-2">
      <div className="text-[10px] tracking-wide opacity-60">{l}</div>
      <div className="text-base font-bold">{value}</div>
    </div>
  )
}

/** Green when a day lands within 5% of its target, amber otherwise. */
function toneFor(actual: number, target: number): string {
  if (!target) return GREEN
  return Math.abs(actual - target) / target <= 0.05 ? GREEN : "#ffc94d"
}

function PlanCard({ plan, open, shopBusy, secs, anyBusy, onToggle, onShopping, onStop, onTick, onRename, onDelete }: {
  plan: SavedPlan; open: boolean; shopBusy: boolean; secs: number; anyBusy: boolean
  onToggle: () => void; onShopping: () => void; onStop: () => void
  onTick: (s: Shopping) => void; onRename: () => void; onDelete: () => void
}) {
  const [dayIdx, setDayIdx] = useState(0)
  const [view, setView] = useState<"meals" | "shopping">("meals")
  const [copied, setCopied] = useState(false)
  const tg = plan.targets
  const day = plan.plan.days[Math.min(dayIdx, plan.plan.days.length - 1)]
  const totals = day ? dayTotals(day) : null
  const shop = plan.shopping
  const ticked = shop ? shop.groups.reduce((a, g) => a + g.items.filter(i => i.done).length, 0) : 0
  const items  = shop ? shop.groups.reduce((a, g) => a + g.items.length, 0) : 0
  // ⚠ An estimate, and shown as one. A list made before prices existed has priced = 0, and then
  // nothing is shown at all — a confident "£0" would be worse than no figure.
  const cost   = shop ? shoppingTotals(shop) : null
  const hasCost = !!cost && cost.priced > 0

  function tick(gi: number, ii: number) {
    if (!shop) return
    onTick({ groups: shop.groups.map((g, x) => x !== gi ? g : { ...g, items: g.items.map((it, y) => y !== ii ? it : { ...it, done: !it.done }) }) })
  }
  function untickAll() {
    if (!shop) return
    onTick({ groups: shop.groups.map(g => ({ ...g, items: g.items.map(it => ({ ...it, done: false })) })) })
  }
  async function copy() {
    if (!shop) return
    try { await navigator.clipboard.writeText(shoppingText(shop, plan.title)); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }

  return (
    <div className={`${box}`}>
      <button onClick={onToggle} className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left min-h-[44px]">
        <span className="font-bold">{open ? "▼" : "▶"} {plan.title}</span>
        <span className="text-xs opacity-60">{plan.days} day{plan.days === 1 ? "" : "s"} · {when(plan.createdAt)} · {tg.kcal?.toLocaleString()} kcal / {tg.protein} g protein a day</span>
        {shop && <span className="text-xs opacity-60">· 🛒 {ticked}/{items} ticked{hasCost ? ` · about ${gbp(cost!.total)}` : ""}</span>}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-[#1f5c33] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button className={`${btn} min-h-[44px] ${view === "meals" ? "border-[#33ff66] bg-[#0a2214]" : ""}`} onClick={() => setView("meals")}>🍽 MEALS</button>
            <button className={`${btn} min-h-[44px] ${view === "shopping" ? "border-[#33ff66] bg-[#0a2214]" : ""}`} onClick={() => setView("shopping")}>🛒 SHOPPING LIST{shop ? ` (${items - ticked} to get)` : ""}</button>
            <span className="ml-auto flex gap-2">
              <button className={btn} onClick={onRename}>RENAME</button>
              <button className={`${btn} hover:border-red-700 hover:text-red-400`} onClick={onDelete}>DELETE</button>
            </span>
          </div>
          {plan.brief && <p className="text-xs opacity-60">Asked for: {plan.brief}</p>}

          {view === "meals" && day && totals && (
            <>
              {plan.plan.tips && <p className="text-xs opacity-70 border border-[#1f5c33] rounded px-3 py-2">💡 {plan.plan.tips}</p>}
              <div className="flex flex-wrap gap-1">
                {plan.plan.days.map((d, i) => (
                  <button key={d.day} onClick={() => setDayIdx(i)}
                    className={`min-h-[44px] px-3 rounded border text-xs ${i === dayIdx ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] hover:bg-[#0a2214]"}`}>DAY {d.day}</button>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs border border-[#1f5c33] rounded px-3 py-2">
                <span className="opacity-60">DAY {day.day} TOTAL</span>
                <span style={{ color: toneFor(totals.kcal, tg.kcal) }}>{totals.kcal} / {tg.kcal} kcal</span>
                <span style={{ color: totals.protein >= (tg.protein ?? 0) * 0.9 ? GREEN : "#ffc94d" }}>P {totals.protein} / {tg.protein} g</span>
                <span className="opacity-80">C {totals.carbs} / {tg.carbs} g</span>
                <span className="opacity-80">F {totals.fat} / {tg.fat} g</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {day.meals.map((m, i) => (
                  <div key={i} className="border border-[#1f5c33] rounded-lg p-3 space-y-2">
                    <div className="text-[10px] tracking-widest opacity-60">{m.slot.toUpperCase()}{m.prepMinutes ? ` · ${m.prepMinutes} MIN` : ""}</div>
                    <div className="font-bold">{m.name}</div>
                    <div className="text-xs opacity-80">{m.kcal} kcal · P {m.protein} g · C {m.carbs} g · F {m.fat} g</div>
                    <ul className="text-xs space-y-0.5">
                      {m.ingredients.map((ing, k) => <li key={k}>· {ing.qty ? <span className="opacity-60">{ing.qty} </span> : null}{ing.item}</li>)}
                    </ul>
                    {m.method.length > 0 && (
                      <ol className="text-xs opacity-80 space-y-1 list-decimal list-inside">
                        {m.method.map((s, k) => <li key={k}>{s}</li>)}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {view === "shopping" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {shopBusy ? (
                  <>
                    <span className="text-xs"><span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2 align-middle" />Working out the list… {secs} s</span>
                    <button className={`${btn} min-h-[44px]`} onClick={onStop}>STOP</button>
                  </>
                ) : (
                  <button className={`${shop ? btn : btnGo} min-h-[44px]`} onClick={onShopping} disabled={anyBusy}>{shop ? "↻ REMAKE THE LIST" : "🛒 MAKE THE SHOPPING LIST"}</button>
                )}
                {shop && (
                  <>
                    <button className={`${btn} min-h-[44px]`} onClick={copy}>{copied ? "COPIED ✓" : "COPY AS TEXT"}</button>
                    <button className={`${btn} min-h-[44px]`} onClick={untickAll} disabled={!ticked}>UNTICK ALL</button>
                    <span className="text-xs opacity-60 ml-auto">{ticked} of {items} ticked</span>
                    {hasCost && (
                      <span className="text-xs border border-[#1f5c33] rounded px-2 py-1">
                        ABOUT <strong>{gbp(cost!.total)}</strong>
                        {ticked > 0 && <span className="opacity-60"> · {gbp(cost!.toGet)} still to get</span>}
                      </span>
                    )}
                  </>
                )}
              </div>
              {!shop && !shopBusy && <p className="text-xs opacity-50">Every ingredient across the {plan.days} day{plan.days === 1 ? "" : "s"}, combined and grouped by aisle, with an estimated price. Ticks are saved, so it works on your phone in the shop.</p>}
              {shop && (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {shop.groups.map((g, gi) => {
                    const groupCost = g.items.reduce((a, i) => a + i.price, 0)
                    return (
                    <div key={gi} className="border border-[#1f5c33] rounded-lg p-3">
                      <div className="text-[10px] tracking-widest opacity-60 mb-2 flex items-center justify-between gap-2">
                        <span>{g.name.toUpperCase()}</span>
                        {groupCost > 0 && <span>{gbp(groupCost)}</span>}
                      </div>
                      <ul className="space-y-1">
                        {g.items.map((it, ii) => (
                          <li key={ii}>
                            <button onClick={() => tick(gi, ii)} className="w-full min-h-[44px] flex items-center gap-3 text-left text-sm rounded px-2 hover:bg-[#0a2214]">
                              <span className={`w-5 h-5 shrink-0 rounded border flex items-center justify-center text-xs ${it.done ? "border-[#33ff66] bg-[#33ff66] text-black" : "border-[#1f5c33]"}`}>{it.done ? "✓" : ""}</span>
                              <span className={it.done ? "line-through opacity-50" : ""}>{it.qty ? <span className="opacity-60">{it.qty} </span> : null}{it.item}</span>
                              {it.price > 0 && <span className={`ml-auto shrink-0 text-xs tabular-nums ${it.done ? "opacity-40" : "opacity-70"}`}>{gbp(it.price)}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                    )
                  })}
                </div>
              )}
              {shop && hasCost && (
                <p className="text-[11px] opacity-50">
                  Prices are the AI&apos;s estimate at mid-range supermarket own-brand prices, for the whole pack you&apos;d buy — a rough guide for budgeting, not real prices.
                  {cost!.priced < cost!.items && ` ${cost!.items - cost!.priced} item${cost!.items - cost!.priced === 1 ? " has" : "s have"} no estimate, so the total is low.`}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
