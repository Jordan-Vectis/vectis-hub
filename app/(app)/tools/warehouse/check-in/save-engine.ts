"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { saveCheckIn, type CheckInInput, type CheckInRowSaved } from "@/lib/actions/goods-in-checkin"

// Check in — keeping the Hub's copy of the check-in up to date as the clerk works.
//
// From the goods step on, the check-in is a receipt that isn't booked in yet (status "draft"), and
// every row is numbered as soon as it exists — so its label can be printed there and then. This
// hook does the saving:
//
//   • ONE save at a time. A change made while one is out is saved straight after it lands, so two
//     saves can never race to number the same new row twice.
//   • When: at once for anything that adds, removes or renumbers a row, changes the customer or the
//     step; ~800 ms after the last key for typing; and a removed row waits ~10 s (or the next save,
//     whichever comes first) so an Undo before then keeps the same number.
//   • The answer is merged by each row's own key, and never writes over text typed since it was
//     sent (only the numbers and label dates come back from the Hub).
//   • A save that hasn't answered within SAVE_TIME_LIMIT counts as not answered ("Not saved — the
//     Hub didn't answer", with Retry), so printing and Book in are never left waiting on a dropped
//     connection. Its answer is still used if it turns up and nothing newer has been sent since —
//     an older answer arriving after a newer save could hand back a number that save gave up.
//   • Every save also says which numbers this screen has taken off (`removed`), so the Hub can tell
//     a tote the clerk removed from one this screen never had (another tab's) — a labelled one of
//     those is refused rather than taken off unseen.
//   • Nothing is saved before the clerk reaches the goods step — until then there is no receipt.
//   • Leaving the screen, or the tab being hidden (the iPad switching app, the tab closing — iPad
//     Safari never shows a leave-page warning), sends whatever is waiting at once.
//
// `flush()` waits until everything is saved (printing and Book in use it); `reset()` starts again
// (a new check-in, or one carried on) and makes any answer still on its way be ignored.

export type SaveWhen = "now" | "typing" | "removal"
export type SaveOutcome = { ok: true } | { ok: false; error: string; lost?: boolean }
export type SavedCheckIn = { receiptId: string; rows: CheckInRowSaved[]; removed: string[] }
/** What the save says about the rows: the answer, and the rows that lost their number because the Hub had already let it go. */
export type SaveAnswer = SavedCheckIn & { renumbered: { key: string; oldId: string }[] }

const WAIT: Record<SaveWhen, number> = { now: 0, typing: 800, removal: 10_000 }
/** Longer than the Hub's own 20-second limit on a save, so a slow save that will still land isn't given up on. */
const SAVE_TIME_LIMIT = 30_000
export const LOST = "The Hub didn't answer — the connection may have dropped."

type Latest = { active: boolean; input: CheckInInput | null; version: number }

/** The input with the numbers from an answer filled in — so a save sent before the screen redraws carries them. */
function withNumbers(input: CheckInInput, a: SavedCheckIn): CheckInInput {
  const byKey = new Map(a.rows.map(r => [r.key, r]))
  const gone = new Set(a.removed)
  return {
    ...input,
    receiptId: a.receiptId,
    rows: input.rows.map(r => {
      const s = byKey.get(r.key)
      if (s) return { ...r, id: s.id }
      return r.id && gone.has(r.id) ? { ...r, id: null } : r
    }),
  }
}

export function useCheckInSaving(now: { active: boolean; input: CheckInInput | null }, onSaved: (a: SaveAnswer) => void) {
  // `version` counts the clerk's changes; `savedVersion` is the last one the Hub has confirmed.
  const [version, setVersion] = useState(0)
  const [savedVersion, setSavedVersion] = useState(0)
  const [inFlight, setInFlight] = useState(false)
  /** The last save failed: the Hub's message, or null when it didn't answer at all. */
  const [error, setError] = useState<{ message: string | null } | null>(null)
  const [arm, setArm] = useState(0)

  const versionRef = useRef(0)
  const savedRef = useRef(0)
  const latest = useRef<Latest>({ active: false, input: null, version: 0 })
  const onSavedRef = useRef(onSaved)
  const flight = useRef<Promise<SaveOutcome> | null>(null)
  const due = useRef<{ at: number; how: SaveWhen } | null>(null)
  const session = useRef(0)
  const held = useRef(false)
  /** Saves sent so far — an answer is used only while its save is still the newest. */
  const sent = useRef(0)
  /** Every number this screen has shown (since it started or was reset) and not seen given up. */
  const known = useRef(new Set<string>())

  // The screen as it was last drawn — what a save sends.
  useLayoutEffect(() => {
    latest.current = { ...now, version }
    onSavedRef.current = onSaved
    for (const r of now.input?.rows ?? []) if (r.id) known.current.add(r.id)
  })

  /** What the Hub is sent: the input, plus the numbers this screen had and has taken off. */
  const outgoing = (input: CheckInInput): CheckInInput => {
    const on = new Set(input.rows.map(r => r.id).filter((x): x is string => !!x))
    return { ...input, removed: [...known.current].filter(id => !on.has(id)) }
  }

  const schedule = (how: SaveWhen) => {
    const at = Date.now() + WAIT[how]
    const cur = due.current
    // Sooner wins — except that typing pushes an earlier typing save back (a debounce); nothing
    // ever pushes back a save that was asked for at once.
    if (!cur || at < cur.at || (how === "typing" && cur.how === "typing")) due.current = { at, how }
  }

  const runSave = (): Promise<SaveOutcome> => {
    const s = latest.current
    if (!s.input) return Promise.resolve({ ok: false, error: "Pick the customer first." })
    const input = outgoing(s.input)
    const savingVersion = s.version
    const sess = session.current
    const mine = ++sent.current
    const newest = () => sess === session.current && mine === sent.current
    due.current = null
    setInFlight(true)

    const answer = (async (): Promise<SaveOutcome> => {
      try {
        const res = await saveCheckIn(input)
        if (sess !== session.current) return { ok: false, error: "That check-in has been closed." }
        if (mine !== sent.current) return { ok: false, error: "A newer save has been sent since." }
        if (!res.ok) {
          setError({ message: res.error })
          return { ok: false, error: res.error }
        }
        const gone = new Set(res.data.removed)
        const answered = new Set(res.data.rows.map(r => r.key))
        const before = latest.current.input
        const renumbered = (before?.rows ?? [])
          .filter(r => r.id && gone.has(r.id) && !answered.has(r.key))
          .map(r => ({ key: r.key, oldId: r.id! }))
        for (const r of res.data.rows) known.current.add(r.id)
        for (const id of res.data.removed) known.current.delete(id)
        if (before) latest.current = { ...latest.current, input: withNumbers(before, res.data) }
        onSavedRef.current({ ...res.data, renumbered })
        savedRef.current = Math.max(savedRef.current, savingVersion)
        setSavedVersion(savedRef.current)
        setError(null)
        return { ok: true }
      } catch {
        if (newest()) setError({ message: null })
        return { ok: false, error: LOST, lost: true }
      }
    })()

    // A request that never comes back (counter Wi-Fi dropping mid-save) must not leave "Saving…"
    // up for ever, with Print and Book in waiting on it.
    let timer: ReturnType<typeof setTimeout> | undefined
    const gaveUp = new Promise<SaveOutcome>(resolve => {
      timer = setTimeout(() => {
        if (newest()) setError({ message: null })
        resolve({ ok: false, error: LOST, lost: true })
      }, SAVE_TIME_LIMIT)
    })
    const p = Promise.race([answer, gaveUp])
    flight.current = p
    void p.finally(() => {
      clearTimeout(timer)
      if (flight.current === p) flight.current = null
      setInFlight(false)
      // Something changed while it was out — its save is due now (re-armed after the next draw).
      if (sess === session.current && due.current) setArm(a => a + 1)
    })
    return p
  }

  const onTimer = (sess: number) => {
    if (sess !== session.current || held.current || !due.current) return
    if (flight.current) return // it re-arms when it lands
    const s = latest.current
    if (!s.active || !s.input) { due.current = null; return }
    if (s.input.receiptId && savedRef.current >= s.version) { due.current = null; return }
    void runSave()
  }
  const onTimerRef = useRef(onTimer)
  useLayoutEffect(() => { onTimerRef.current = onTimer })

  useEffect(() => {
    const d = due.current
    if (!d) return
    const sess = session.current
    const t = setTimeout(() => onTimerRef.current(sess), Math.max(0, d.at - Date.now()))
    return () => clearTimeout(t)
  }, [version, arm])

  /** Save until nothing is waiting. */
  const flush = async (): Promise<SaveOutcome> => {
    for (let i = 0; i < 6; i++) {
      if (flight.current) { await flight.current; continue }
      const s = latest.current
      if (!s.input) return { ok: false, error: "Pick the customer first." }
      if (s.input.receiptId && savedRef.current >= s.version) return { ok: true }
      const r = await runSave()
      if (!r.ok) return r
    }
    return { ok: false, error: "The check-in kept changing while it was being saved — try again." }
  }

  // Leaving the screen (a link elsewhere in the Hub), or the tab going out of sight: send what's
  // waiting rather than drop it.
  const leaveRef = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    leaveRef.current = () => {
      const s = latest.current
      if (!s.active || !s.input || held.current) return
      if (s.input.receiptId && savedRef.current >= s.version && !flight.current) return
      void flush().catch(() => { /* the tab's own copy (draft.ts) still has it */ })
    }
  })
  useEffect(() => () => leaveRef.current(), [])
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden") leaveRef.current() }
    const leaving = () => leaveRef.current()
    document.addEventListener("visibilitychange", hidden)
    window.addEventListener("pagehide", leaving)
    return () => {
      document.removeEventListener("visibilitychange", hidden)
      window.removeEventListener("pagehide", leaving)
    }
  }, [])

  return {
    /** The clerk changed something: it's unsaved until the Hub confirms it, and is saved after `when`. */
    changed(when: SaveWhen) {
      versionRef.current += 1
      setVersion(versionRef.current)
      schedule(when)
    },
    /** Save whatever is waiting, now (a step change, Retry). */
    saveNow() {
      schedule("now")
      setArm(a => a + 1)
    },
    flush,
    /** Wait for a save that is already out. */
    async settle() {
      if (flight.current) await flight.current
    },
    /** What the Hub has (or is about to have) — the latest input, with every number given so far. */
    current: () => (latest.current.input ? outgoing(latest.current.input) : null),
    /** Hold back timed saves (while booking in, so a late keystroke can't save over a booked receipt). */
    hold(on: boolean) {
      held.current = on
      // Let go: anything that came due meanwhile is saved now.
      if (!on && due.current) setArm(a => a + 1)
    },
    /** Start again: everything on screen counts as saved, and an answer still on its way is ignored. */
    reset() {
      session.current += 1
      due.current = null
      held.current = false
      known.current = new Set()
      latest.current = { active: false, input: null, version: versionRef.current }
      savedRef.current = versionRef.current
      setSavedVersion(versionRef.current)
      setError(null)
      setInFlight(false)
    },
    /** Changes the Hub hasn't confirmed yet. */
    pending: version > savedVersion,
    inFlight,
    error,
  }
}
