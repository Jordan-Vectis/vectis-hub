"use client"

// 📝 Hub feedback — the person's side: the survey popup, and the temporary top-bar button for a
// survey they put off. Rendered by the top bar (so it lives as long as the Hub shell does and is
// not remounted on every page change), and only once the iPad policy has been signed.
//
// Jordan, 2026-09-10: send the survey out as a popup on the tablets, with "Fill it out later".
// His call on "later": it does NOT pop up again. Instead an amber "📝 Feedback to finish" button
// sits in that person's top bar — only while they have a survey they put off, and only until they
// send it or the survey is closed.
//
// Quiet on failure: a survey is never urgent, so a failed background fetch shows nothing at all.
// Only a failed SAVE says so. A failed Submit keeps the form open with everything they typed; a
// failed "Fill it out later" still puts the form away (it must never trap someone — see send())
// and keeps their text in this tab behind the button, saying plainly that it isn't saved.
//
// ⚠ Nobody may answer on someone else's behalf: both APIs judge the REAL signed-in user, not an
// admin's "view as" person, and read their role fresh from the database.

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import FeedbackForm from "@/components/feedback-form"
import { acquireAppSocket, releaseAppSocket } from "@/lib/app-socket"
import type { FeedbackQuestion, MySurveys, SurveyForUser } from "@/lib/feedback-types"

const NOTHING: MySurveys = { popup: null, later: [] }

/** After the page loads, wait this long before the first popup — the patch-notes popup fetches
 *  its notes on load too, and if ours won that race the two would end up stacked. */
const SETTLE_MS = 3_000
/** A short breather before a popup appears (and after one closes, before the next survey) so it
 *  never reads as the same form bouncing straight back. */
const SHOW_DELAY_MS = 1_500
/** While something else is in the way, look again this often. */
const RECHECK_MS = 4_000
/** Don't pop up within this long of a keystroke — it would land mid-word in someone's lot. */
const TYPING_QUIET_MS = 4_000
const TOAST_MS = 6_000

type OpenSurvey = { survey: SurveyForUser; from: "popup" | "later" }
type Toast = { tone: "ok" | "info"; text: string; ms?: number }
type Action = "submit" | "later"
/** What POST /api/feedback/respond sends back. `gone` = the survey can no longer take this
 *  person's answers: closed, deleted, they're no longer in its audience, or already submitted. */
type RespondReply = { ok?: boolean; error?: string; gone?: "closed" | "missing" | "audience" | "submitted" }

export default function FeedbackPrompt() {
  const [mine, setMine] = useState<MySurveys>(NOTHING)
  const [open, setOpen] = useState<OpenSurvey | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [settled, setSettled] = useState(false)
  // ⚠ Every load and every successful save bumps this. A load that was asked BEFORE a save
  // answers with the world as it was — applying it would put a just-sent survey straight back.
  const seq = useRef(0)
  const lastTypedAt = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  // A hidden marker inside the top bar, so we can ask whether the top bar is actually visible.
  const anchorRef = useRef<HTMLSpanElement>(null)
  // `busy` is state, so two taps inside one render both see false — this ref is the real guard.
  const sending = useRef(false)
  // ⚠ Surveys put off while the Hub couldn't save them (see send()). Held in this tab only and
  // laid over every load, so the server — which still thinks the survey is unanswered — can't pop
  // it straight back up, and the text they typed stays behind the button. Lost on a reload; the
  // note shown at the time says so.
  const unsaved = useRef(new Map<string, SurveyForUser>())

  const load = useCallback(async () => {
    const n = ++seq.current
    try {
      const res = await fetch("/api/feedback/mine", { cache: "no-store" })
      if (!res.ok) return // signed out or a hiccup — keep what we had, say nothing
      const data: unknown = await res.json()
      if (n !== seq.current) return
      setMine(withUnsaved(readMine(data), unsaved.current))
    } catch {
      /* feedback is never urgent — try again on the next trigger */
    }
  }, [])

  // Asked on mount, whenever the tab comes back into view (iPads sleep with the Hub open), when an
  // admin sends out or closes a survey ("feedback:changed"), and after the socket reconnects — a
  // deploy or a sleep drops it, and any event sent meanwhile is gone.
  useEffect(() => {
    void load()
    const socket = acquireAppSocket()
    const refresh = () => { void load() }
    socket.on("feedback:changed", refresh)
    socket.io.on("reconnect", refresh)
    const onVisible = () => { if (document.visibilityState === "visible") void load() }
    document.addEventListener("visibilitychange", onVisible)
    // Capture phase, so a field that stops propagation still counts as typing.
    const onTyped = () => { lastTypedAt.current = Date.now() }
    window.addEventListener("keydown", onTyped, true)
    window.addEventListener("input", onTyped, true)
    const settle = window.setTimeout(() => setSettled(true), SETTLE_MS)
    return () => {
      socket.off("feedback:changed", refresh)
      socket.io.off("reconnect", refresh)
      releaseAppSocket()
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("keydown", onTyped, true)
      window.removeEventListener("input", onTyped, true)
      window.clearTimeout(settle)
    }
  }, [load])

  // Pop the waiting survey up — but ⚠ never on top of another popup, never into a hidden tab, and
  // never mid-keystroke. Anything in the way just means "look again in a few seconds".
  const waiting = mine.popup
  useEffect(() => {
    if (!waiting || open || !settled) return
    let timer = 0
    const attempt = () => {
      const typing = Date.now() - lastTypedAt.current < TYPING_QUIET_MS
      if (document.visibilityState !== "visible" || typing || anotherPopupOnScreen()) {
        timer = window.setTimeout(attempt, RECHECK_MS)
        return
      }
      setError(null)
      setListOpen(false)
      setOpen({ survey: waiting, from: "popup" })
    }
    timer = window.setTimeout(attempt, SHOW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [waiting, open, settled])

  // The pick-a-survey list closes on a tap outside it, or Escape.
  useEffect(() => {
    if (!listOpen) return
    const onDown = (e: PointerEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) setListOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setListOpen(false) }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [listOpen])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), toast.ms ?? TOAST_MS)
    return () => window.clearTimeout(t)
  }, [toast])

  /** Close the form and show the change straight away, then ask the server for the truth (another
   *  survey may be waiting). The bump throws away any load that was already on its way. */
  function finish(update: (m: MySurveys) => MySurveys) {
    seq.current++
    setMine(update)
    setOpen(null)
    setListOpen(false)
    void load()
  }

  async function send(action: Action, answers: Record<string, string>) {
    if (!open || sending.current) return
    sending.current = true
    const survey = open.survey
    const drop = (m: MySurveys): MySurveys => ({
      popup: m.popup?.id === survey.id ? null : m.popup,
      later: m.later.filter(s => s.id !== survey.id),
    })
    const kept: SurveyForUser = { ...survey, draft: answers }
    const putAway = (m: MySurveys): MySurveys => ({ ...drop(m), later: [...drop(m).later, kept] })

    /** ⚠ "Fill it out later" must ALWAYS get the popup out of the way, even when the save fails.
     *  Live mode has no ✕, and this sits over the tablet cataloguing screen: keeping it open on a
     *  failed save would leave someone unable to catalogue until the Hub could save again — and on
     *  a reload the server, still thinking it unanswered, would pop it straight back. (The
     *  read-only database day, 2026-09-09: reads fine, every save refused, all day.) So it is put
     *  away with what they typed kept in this tab, and the note says plainly it isn't saved. */
    const putAwayUnsaved = () => {
      unsaved.current.set(survey.id, kept)
      finish(putAway)
      setToast({
        tone: "info",
        ms: 15_000,
        text: `The Hub couldn't save that just now, so your answers are only being kept on this screen. Press “📝 Feedback to finish” ${buttonWhere(anchorRef.current)} to send them when you're ready — if the page is reloaded first, they'll be lost.`,
      })
    }

    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/feedback/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surveyId: survey.id, action, answers }),
      })
      const data = (await res.json().catch(() => null)) as RespondReply | null

      if (res.ok && data?.ok) {
        unsaved.current.delete(survey.id)
        if (action === "submit") {
          finish(drop)
          setToast({ tone: "ok", text: "✓ Thank you — your answers have been sent." })
        } else {
          finish(putAway)
          setToast({ tone: "info", text: `Saved for later. Press “📝 Feedback to finish” ${buttonWhere(anchorRef.current)} whenever you're ready.` })
        }
        return
      }

      const why = typeof data?.error === "string" && data.error ? data.error : "Couldn't save your answers just now — please try again."
      if (data?.gone === "submitted") {
        // Sent already (another tab or device). Nothing to put off or send again.
        unsaved.current.delete(survey.id)
        finish(drop)
        setToast({ tone: "ok", text: why })
        return
      }
      if (data?.gone && action === "later") {
        // They asked to put it away and it no longer wants answers — close it, and say why.
        unsaved.current.delete(survey.id)
        finish(drop)
        setToast({ tone: "info", text: why })
        return
      }
      // ⚠ The form stays open with everything they typed. A closed survey can't be sent, so tell
      // them the one way out rather than leaving two buttons that both fail.
      if (data?.gone) {
        setError(`${why} Press “Fill it out later” to close this.`)
        void load()
        return
      }
      if (action === "later") {
        putAwayUnsaved()
        return
      }
      setError(res.status >= 500 ? `${why} Nothing you've typed has been lost — try again, or press “Fill it out later” to put it away for now.` : why)
    } catch {
      if (action === "later") {
        putAwayUnsaved()
        return
      }
      setError("Couldn't reach the Hub — check the Wi-Fi and try again, or press “Fill it out later” to put it away for now. Nothing you've typed has been lost.")
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  function openLater(s: SurveyForUser) {
    setError(null)
    setListOpen(false)
    setOpen({ survey: s, from: "later" })
  }

  const later = mine.later

  return (
    <>
      {/* display:none, so it takes no room (and no flex gap) in the top bar. */}
      <span ref={anchorRef} hidden />
      {later.length > 0 && (
        // Phones: the list hangs full width from the top bar (see help-button.tsx).
        <div ref={listRef} className="relative flex-shrink-0 max-sm:static">
          {/* The hit area is 44px tall for a finger; the visible pill is 32px, so the 48px top bar
              doesn't grow. */}
          <button
            type="button"
            onClick={() => (later.length === 1 ? openLater(later[0]) : setListOpen(o => !o))}
            title={later.length === 1 ? "You put off a feedback survey — tap to finish it" : `You put off ${later.length} feedback surveys — tap to pick one`}
            aria-haspopup={later.length > 1 ? "menu" : undefined}
            aria-expanded={later.length > 1 ? listOpen : undefined}
            className="group flex h-11 items-center px-0.5 focus:outline-none"
          >
            <span className="flex h-8 items-center gap-1.5 rounded-full bg-amber-400 px-3 text-xs font-semibold text-gray-900 shadow-sm transition-colors group-hover:bg-amber-300 group-focus-visible:ring-2 group-focus-visible:ring-white">
              <span aria-hidden>📝</span>
              <span className="hidden sm:inline">Feedback to finish</span>
              <span className="sm:hidden">Feedback</span>
              {later.length > 1 && (
                <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-900 px-1.5 text-[11px] font-bold text-amber-300">
                  {later.length}
                </span>
              )}
            </span>
          </button>

          {listOpen && later.length > 1 && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1 w-[min(92vw,22rem)] max-sm:inset-x-2 max-sm:w-auto overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl shadow-black/30 dark:border-gray-700 dark:bg-[#1C1C1E] dark:shadow-black/50"
            >
              <p className="px-4 pb-2 pt-3 text-xs text-gray-500 dark:text-gray-400">You put these off — pick one to finish:</p>
              {later.map(s => {
                const done = s.questions.filter(q => (s.draft[q.id] ?? "").trim()).length
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="menuitem"
                    onClick={() => openLater(s)}
                    className="block min-h-[52px] w-full border-t border-gray-100 px-4 py-2.5 text-left transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
                  >
                    <span className="block text-sm font-semibold text-gray-900 dark:text-white">{s.title || "Hub feedback"}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {done} of {s.questions.length} answered so far
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {open && (
        <FeedbackForm
          key={open.survey.id}
          survey={open.survey}
          initialAnswers={open.survey.draft}
          mode="live"
          busy={busy}
          error={error}
          onSubmit={a => { void send("submit", a) }}
          onLater={a => { void send("later", a) }}
        />
      )}

      {/* Portalled: this component sits inside the top bar, and the note must float over the page
          (including the tablet cataloguing screen, a fixed overlay at z-9999). Toast only ever
          exists after a click, so there's no server render to mismatch. */}
      {toast && typeof document !== "undefined" && createPortal(
        <button
          type="button"
          role="status"
          onClick={() => setToast(null)}
          className={`fixed right-3 top-14 z-[10000] max-w-[min(92vw,24rem)] rounded-xl border px-4 py-3 text-left text-sm font-medium shadow-2xl ${
            toast.tone === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          }`}
        >
          {toast.text}
        </button>,
        document.body,
      )}
    </>
  )
}

/** Is some OTHER popup on screen right now? Anything marked data-hub-popup (the patch-notes popup,
 *  the admin's preview of this form), plus any modal that announces itself the standard way
 *  (role="dialog" aria-modal — the announcement's full-message view, for one).
 *
 *  ⚠ "On screen" is tested at the popup's centre with elementFromPoint, not just "is it in the
 *  page". The patch-notes popup (z-190) sits UNDERNEATH the tablet cataloguing screen (z-9999):
 *  it's in the page but nobody can see it or dismiss it from there, so treating it as "in the way"
 *  would hold the survey back for as long as they catalogue. */
function anotherPopupOnScreen(): boolean {
  const els = document.querySelectorAll<HTMLElement>('[data-hub-popup], [role="dialog"][aria-modal="true"]')
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1)
    const y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1)
    const top = document.elementFromPoint(x, y)
    if (top && (top === el || el.contains(top))) return true
  }
  return unmarkedModalOnScreen()
}

/** ⚠ Most of the Hub's popups carry no marker — the lot wizard's activity prompt and its confirm
 *  boxes, the lens, the cataloguing guide, the photo viewer — and those are exactly what's on the
 *  iPads mid-lot. They all share one shape: a `position: fixed` backdrop over the whole screen in a
 *  see-through colour (bg-black/60 and the like), with the box in the middle. So: whatever is
 *  showing at the centre of the screen, does it sit inside one of those?
 *
 *  Deliberately NOT counted: the tablet cataloguing screen (fixed and full-screen, but a solid
 *  colour — it's a page, not a popup), and anything that lets taps through (pointer-events: none —
 *  elementFromPoint skips it), since a decoration can't be what someone is busy with. */
function unmarkedModalOnScreen(): boolean {
  const w = window.innerWidth
  const h = window.innerHeight
  let el: Element | null = document.elementFromPoint(w / 2, h / 2)
  for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const cs = getComputedStyle(el)
    if (cs.position !== "fixed") continue
    const r = el.getBoundingClientRect()
    if (r.width < w * 0.9 || r.height < h * 0.9) continue
    if (seeThrough(cs.backgroundColor)) return true
  }
  return false
}

/** Is this computed background colour partly transparent? Browsers report Tailwind's `bg-black/60`
 *  as "rgba(0, 0, 0, 0.6)", "oklab(0 0 0 / 0.6)" or "color(srgb 0 0 0 / 0.6)" depending on
 *  version, so read the alpha from any of them. Fully transparent doesn't count (a click-catcher
 *  behind a menu); no alpha at all means solid. */
function seeThrough(color: string): boolean {
  const m = color.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/) ?? color.match(/\/\s*([\d.]+%?)\s*\)$/)
  if (!m) return false
  const a = m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1])
  return a > 0.05 && a < 1
}

/** Where the "📝 Feedback to finish" button can be seen from here, for the notes that point to it.
 *  ⚠ The tablet cataloguing screen is a full-screen overlay over the whole Hub, top bar included —
 *  "at the top of the Hub" would send a cataloguer looking for a button that isn't on their screen. */
function buttonWhere(anchor: HTMLElement | null): string {
  return topBarOnScreen(anchor) ? "at the top of the Hub" : "in the Hub's top bar (you'll see it once you leave this screen)"
}

function topBarOnScreen(anchor: HTMLElement | null): boolean {
  const bar = anchor?.closest("header")
  if (!bar) return true // can't tell — assume the ordinary case
  const r = bar.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return false
  const x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1)
  const y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1)
  // ⚠ Skip our own form: it is still on screen at the moment this is asked, and covers everything.
  const first = document.elementsFromPoint(x, y).find(el => !el.closest('[data-hub-popup="feedback"]'))
  return !!first && bar.contains(first)
}

/** Lay the surveys put off without a save (see `unsaved`) over what the server says. The server
 *  still lists such a survey as one to pop up, so it moves to "later" with the text they typed.
 *  One the server no longer lists at all stays too: a failed read looks exactly like a closed
 *  survey from here, and losing typed text is the worse mistake — if it really has closed, trying
 *  to send it says so and takes it away. */
function withUnsaved(m: MySurveys, unsaved: Map<string, SurveyForUser>): MySurveys {
  if (!unsaved.size) return m
  return {
    popup: m.popup && unsaved.has(m.popup.id) ? null : m.popup,
    later: [...m.later.filter(s => !unsaved.has(s.id)), ...unsaved.values()],
  }
}

// The server is ours, but an old cached bundle on a shared iPad can meet a newer API — take only
// what's the right shape rather than trusting it blindly.
function readMine(v: unknown): MySurveys {
  const d = (v && typeof v === "object" ? v : {}) as { popup?: unknown; later?: unknown }
  return {
    popup: readSurvey(d.popup),
    later: Array.isArray(d.later) ? d.later.map(readSurvey).filter((s): s is SurveyForUser => !!s) : [],
  }
}

function readSurvey(v: unknown): SurveyForUser | null {
  if (!v || typeof v !== "object") return null
  const s = v as Record<string, unknown>
  if (typeof s.id !== "string" || !Array.isArray(s.questions)) return null
  const questions = (s.questions as unknown[]).filter(
    (q): q is FeedbackQuestion => !!q && typeof q === "object" && typeof (q as FeedbackQuestion).id === "string" && typeof (q as FeedbackQuestion).text === "string",
  )
  const draft: Record<string, string> = {}
  if (s.draft && typeof s.draft === "object") {
    for (const [k, val] of Object.entries(s.draft as Record<string, unknown>)) if (typeof val === "string") draft[k] = val
  }
  return {
    id: s.id,
    title: typeof s.title === "string" ? s.title : "",
    intro: typeof s.intro === "string" ? s.intro : null,
    questions,
    draft,
  }
}
