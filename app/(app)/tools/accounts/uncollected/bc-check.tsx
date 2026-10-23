"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { checkBcNow, lastSyncRun, stopBcCheck } from "@/lib/actions/uncollected"
import {
  UNCOLLECTED_AFTER_DAYS, UNCOLLECTED_LOOKBACK_MONTHS, UNCOLLECTED_NIGHTLY_AT, UNCOLLECTED_RUN_STALE_MINUTES, bcConnectHref,
  formatDateTime, isStoppedRun, sentence, syncResultWords, triggerWords, type UncollectedCheckState, type UncollectedSyncRunInfo,
} from "@/lib/uncollected"
import { PANEL_PATH, btn, card, inlineLink, plural } from "./ui"

// The panel's BC line: "Last checked from BC: 22 Oct 2026, 08:31 (nightly) — 46 open cases from BC",
// Check BC now (admins; their OWN BC sign-in) and Stop. The check runs in the background on the
// server (checkBcNow answers at once); this asks lastSyncRun() every couple of seconds while one runs —
// this page's, or the nightly one found running — and shows what it is doing with the time so far,
// then the result in numbers (design rules 7 and 7b), and refreshes the list. Stop asks first, then
// the check stops within seconds and says what it kept. Nothing here writes to BC; the check only
// reads it.

/** How often a running check is asked about. */
const POLL_MS = 2_000
/** The nightly check runs every day; older than this and the line says it may not be running. */
const STALE_AFTER_MS = 36 * 60 * 60_000

// A finished run's notes aren't repeated here: the line above shows that run (as the last check, or
// the one that went wrong) with its notes folded under it.
// `runId`: the run a note reports on — the red line for that same run isn't repeated under it.
type Note = { tone: "ok" | "error" | "info"; text: string; connect?: boolean; runId?: string }

const TONE: Record<Note["tone"], string> = {
  ok: "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200",
  error: "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200",
  info: "border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-200",
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)

/** "1 min 05 s" / "42 s". */
function elapsedWords(totalMs: number): string {
  const s = Math.max(0, Math.round(totalMs / 1000))
  const m = Math.floor(s / 60)
  return m ? `${m} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`
}

/** "(nightly)" / "(Check BC now, by Sam)". */
function whoWords(trigger: string | null | undefined, byName: string | null | undefined): string {
  const t = triggerWords(trigger)
  return trigger === "manual" && byName ? `${t}, by ${byName}` : t
}

/** "08:45" (London). */
const clock = (at: number) => new Date(at).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })

/** BC refused the sign-in a Check BC now ran with — that admin's own, so theirs to put right. */
const signInRefused = (r: Pick<UncollectedSyncRunInfo, "trigger" | "error">) => r.trigger === "manual" && /\b401\b/.test(r.error ?? "")

/** The run's notes, folded away (the same box under every line that has them). */
function RunNotes({ note }: { note: string | null | undefined }) {
  if (!note) return null
  return (
    <details className="mt-1">
      <summary className="cursor-pointer select-none min-h-11 inline-flex items-center font-semibold">What the check noted</summary>
      <p className="whitespace-pre-wrap break-words text-xs mt-1">{note}</p>
    </details>
  )
}

export default function BcCheck({ initial, notReady, readError }: {
  initial: UncollectedCheckState | null
  notReady: boolean
  readError: string | null
}) {
  const router = useRouter()
  const [st, setSt] = useState<UncollectedCheckState | null>(initial)
  const [note, setNote] = useState<Note | null>(null)
  const [pressing, startPressing] = useTransition()
  const [stopping, startStopping] = useTransition()
  /** Stop asks first: true while "Stop the check?" is showing. */
  const [askStop, setAskStop] = useState(false)
  /** The start of the run this page is following (set when it is seen running). */
  const following = useRef<string | null>(initial?.running ? initial.startedAt : null)
  /** Device clock − server clock, so "so far" counts from the server's start time. */
  const [skew, setSkew] = useState(0)
  const [tick, setTick] = useState<number | null>(null)
  const [pollFails, setPollFails] = useState(0)
  const running = !!st?.running

  // While a check runs: ask how it's doing every couple of seconds, and count the seconds.
  useEffect(() => {
    if (!running) return
    let live = true
    const timer = setInterval(() => setTick(Date.now()), 1_000)
    const poll = setInterval(async () => {
      try {
        const res = await lastSyncRun()
        if (!live) return
        if (!res.ok) { setPollFails(n => n + 1); return }
        setPollFails(0)
        setSkew(Date.now() - ms(res.data.now))
        setSt(res.data)
        if (!res.data.running) finished(res.data)
      } catch {
        if (live) setPollFails(n => n + 1)
      }
    }, POLL_MS)
    return () => { live = false; clearInterval(timer); clearInterval(poll) }
    // `finished` only reads refs and setters — the effect restarts on `running` alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  /** A followed check has ended: say how it went, in numbers, and bring the list up to date. */
  function finished(s: UncollectedCheckState) {
    const since = following.current ? ms(following.current) - 5_000 : -Infinity
    following.current = null
    setAskStop(false)
    const run = s.latest && ms(s.latest.startedAt) >= since ? s.latest : null
    if (run && run.ok === true) {
      setNote({ tone: "ok", text: syncResultWords(run), runId: run.id })
    } else if (run && isStoppedRun(run)) {
      setNote({ tone: "info", text: sentence(run.error), runId: run.id })
    } else if (run && run.ok === false) {
      setNote({
        tone: "error",
        text: `The check stopped before the end: ${sentence(run.error)}${run.found != null ? ` What it did get through: ${syncResultWords(run)}` : ""}`,
        connect: signInRefused(run),
        runId: run.id,
      })
    } else {
      setNote({ tone: "info", text: "The check has finished — see the line above for what it found." })
    }
    router.refresh()
  }

  function press() {
    if (pressing || running || notReady) return
    setNote(null)
    const pressedAt = Date.now()
    startPressing(async () => {
      try {
        const res = await checkBcNow()
        if (!res.ok) {
          setNote({ tone: "error", text: res.error, connect: !!res.needsBc })
          return
        }
        const s = res.data.state
        const diff = Date.now() - ms(s.now)
        setSkew(diff)
        setTick(Date.now())
        // The run to report on: the one running, or else whatever this press left behind (on the
        // server's clock — never an older run's result passed off as this one's).
        following.current = s.running && s.startedAt ? s.startedAt : new Date(pressedAt - diff).toISOString()
        setSt(s)
        if (!res.data.started) {
          setNote(s.running
            ? { tone: "info", text: `A check is already running — started ${formatDateTime(s.startedAt)} (${whoWords(s.trigger, s.byName)}). Following that one here.` }
            : { tone: "info", text: "Nothing was started." })
        } else if (!s.running) {
          // It was over before the answer came back (refused at once, or very quick).
          finished(s)
        }
      } catch {
        setNote({ tone: "error", text: "The Hub didn't answer — check the connection and try again. Nothing was started." })
      }
    })
  }

  function stop() {
    if (stopping) return
    startStopping(async () => {
      try {
        const res = await stopBcCheck()
        setAskStop(false)
        if (!res.ok) { setNote({ tone: "error", text: res.error }); return }
        setSt(res.data.state)
        if (!res.data.stopping) {
          setNote({ tone: "info", text: "The check had already finished — there was nothing to stop." })
          if (!res.data.state.running) finished(res.data.state)
          return
        }
        // Follow it to the end from here, if this page wasn't already (a nightly run found running).
        if (!following.current && res.data.state.startedAt) following.current = res.data.state.startedAt
        setNote({ tone: "info", text: "Stopping — it stops within a few seconds, then says here what it kept." })
      } catch {
        setNote({ tone: "error", text: "The Hub didn't answer — check the connection and try again. The check carries on until it's stopped." })
      }
    })
  }

  /** The server's time now: the device's clock (ticking) less its difference, else the server's last answer. */
  const now = tick != null ? tick - skew : ms(st?.now)
  const lastOk = st?.lastOk ?? null
  const latest = st?.latest ?? null
  // The newest run, when it went wrong, was stopped, or never finished — after the last one that worked.
  const latestBad: UncollectedSyncRunInfo | null =
    latest && !running && latest.ok !== true && (!lastOk || ms(latest.startedAt) > ms(lastOk.startedAt)) ? latest : null
  const lastOkAt = lastOk ? ms(lastOk.finishedAt ?? lastOk.startedAt) : NaN
  const stale = !running && Number.isFinite(lastOkAt) && Number.isFinite(now) && now - lastOkAt > STALE_AFTER_MS
  // A run that never recorded its end, while nothing runs: Check BC now waits until it's stale.
  const stuck = !!latestBad && !latestBad.finishedAt && !!st?.stuckSince && st.stuckSince === latestBad.startedAt
  const openFromBc = st?.openFromBc ?? null

  return (
    <section className={`${card} p-4 mb-5`} aria-labelledby="bc-check-title">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0 text-sm text-gray-700 dark:text-gray-200">
          <h2 id="bc-check-title" className="sr-only">Filled from Business Central</h2>
          {notReady ? (
            <p className="text-amber-800 dark:text-amber-200">
              <b>Checking BC needs Run Migrations.</b> An admin presses Run Migrations (the banner at the top of the Hub);
              then the nightly check and Check BC now work. Cases can still be added by hand.
            </p>
          ) : readError ? (
            <p className="text-red-700 dark:text-red-300">{readError}</p>
          ) : running ? (
            <>
              {/* The ticking time is NOT in a live region — a screen reader would read it out every second. */}
              <p className="inline-flex flex-wrap items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
                <span className="block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
                Checking BC — started {formatDateTime(st?.startedAt)} ({whoWords(st?.trigger, st?.byName)})
                {Number.isFinite(now) && st?.startedAt ? <span className="font-normal tabular-nums">· {elapsedWords(now - ms(st.startedAt))} so far</span> : null}
              </p>
              <p className="mt-1 text-gray-600 dark:text-gray-300" aria-live="polite">
                {st?.stopBy
                  ? <>Stopping — asked by {st.stopBy}. It stops within a few seconds and keeps every case already saved.</>
                  : st?.progress ?? `Reading every lot sold in the last ${UNCOLLECTED_LOOKBACK_MONTHS} months that isn't collected, then each buyer's invoices — it takes a few minutes. You can leave this page; it carries on.`}
              </p>
              {pollFails >= 3 && (
                <p className="mt-1 text-amber-700 dark:text-amber-300">The Hub hasn&apos;t answered for a few seconds — still asking. The check itself carries on.</p>
              )}
            </>
          ) : lastOk ? (
            <>
              <p>
                <b>Last checked from BC:</b> {formatDateTime(lastOk.finishedAt ?? lastOk.startedAt)} ({whoWords(lastOk.trigger, lastOk.byName)})
                {openFromBc != null && <>{" — "}{plural(openFromBc, "open case")} from BC</>}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{syncResultWords(lastOk)}</p>
              <RunNotes note={lastOk.note} />
              {stale && (
                <p className="mt-1 text-amber-700 dark:text-amber-300">
                  That&apos;s over a day ago — the nightly check ({UNCOLLECTED_NIGHTLY_AT}) may not be running. Press Check BC now, and tell whoever looks after the Hub.
                </p>
              )}
            </>
          ) : (
            <p>
              <b>Not checked from BC yet.</b> The check runs every morning at {UNCOLLECTED_NIGHTLY_AT}, or press Check BC now.
            </p>
          )}

          {!notReady && !readError && latestBad && (
            <div className="mt-1">
              {note?.runId === latestBad.id ? null : isStoppedRun(latestBad) ? (
                <p className="text-gray-600 dark:text-gray-300">
                  The check on {formatDateTime(latestBad.startedAt)} ({whoWords(latestBad.trigger, latestBad.byName)}) didn&apos;t run to the end: {sentence(latestBad.error)}
                </p>
              ) : latestBad.finishedAt ? (
                <p className="text-red-700 dark:text-red-300">
                  The check on {formatDateTime(latestBad.startedAt)} ({whoWords(latestBad.trigger, latestBad.byName)}) didn&apos;t finish properly: {sentence(latestBad.error)}
                  {signInRefused(latestBad) && <> <a href={bcConnectHref(PANEL_PATH)} className={inlineLink}>Sign in to BC →</a></>}
                </p>
              ) : stuck ? (
                <p className="text-red-700 dark:text-red-300">
                  The check started {formatDateTime(latestBad.startedAt)} ({whoWords(latestBad.trigger, latestBad.byName)}) hasn&apos;t recorded an end — it
                  most likely stopped part-way. Check BC now can run again from {clock(ms(latestBad.startedAt) + UNCOLLECTED_RUN_STALE_MINUTES * 60_000)}.
                </p>
              ) : (
                <p className="text-red-700 dark:text-red-300">
                  The check started {formatDateTime(latestBad.startedAt)} ({whoWords(latestBad.trigger, latestBad.byName)}) never finished — the Hub may have restarted. The next check will run it again.
                </p>
              )}
              <RunNotes note={latestBad.note} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap sm:flex-col gap-2 shrink-0">
          <button
            type="button"
            onClick={press}
            disabled={pressing || running || notReady}
            className={btn}
            title={`Runs the same check as the nightly one, now, with your own BC sign-in. It only reads BC — sold, paid, not collected after ${UNCOLLECTED_AFTER_DAYS} days.`}
          >
            {pressing ? "Starting…" : running ? "Checking BC…" : "🔄 Check BC now"}
          </button>
          {running && !st?.stopBy && !askStop && (
            <button type="button" onClick={() => setAskStop(true)} className={btn}>
              <span aria-hidden>■</span> Stop the check
            </button>
          )}
        </div>
      </div>

      {running && askStop && !st?.stopBy && (
        <div role="group" aria-labelledby="bc-stop-q" className={`mt-3 rounded-xl border px-4 py-3 text-sm ${TONE.info}`}>
          <p id="bc-stop-q">
            <b>Stop the check?</b> Every case it has already saved stays saved; what it hasn&apos;t got to waits for the next check.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={stop} disabled={stopping} className={btn}>{stopping ? "Stopping…" : "Yes, stop it"}</button>
            <button type="button" onClick={() => setAskStop(false)} disabled={stopping} className={btn}>Keep it going</button>
          </div>
        </div>
      )}

      {note && (
        <div role={note.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-xl border px-4 py-3 text-sm ${TONE[note.tone]}`}>
          {note.tone === "ok" && "✓ "}{note.text}
          {note.connect && (
            <> <a href={bcConnectHref(PANEL_PATH)} className={inlineLink}>Sign in to BC →</a></>
          )}
        </div>
      )}
    </section>
  )
}
