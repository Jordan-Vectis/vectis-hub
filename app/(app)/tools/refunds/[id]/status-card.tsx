"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { pickUp, setAccountsDone, setDealtWith, setProcessedDate, setRefundStatus } from "@/lib/actions/refunds"
import { CLOSED_REFUND_STATUSES, REFUND_LIMITS, REFUND_STATUS_META, type RefundDetail, type RefundStatus } from "@/lib/refunds"
import { dateInputValue, formatDateTime, formatDay } from "@/lib/uncollected"
import { StatusChip } from "../bits"
import { Flash, NO_ANSWER, btn, btnGo, card, cardTitle, field, input, label, muted, type FlashMessage } from "../ui"

// Where the request stands, and the next steps as buttons. A tap never changes anything by itself: it
// opens a small confirm underneath (a reason for Decline and Close; the date processed for Paid; an
// optional note otherwise), so a stray tap on an iPad can't close a request. Then who's dealing with
// it (Pick it up, or a name), the date processed once it's paid, and Complete for accounts — only
// once it's paid. Every answer is said in words, "nothing changed" included (design rule 7).

type Step = { status: RefundStatus; label: string; help: string }

const STEPS: Step[] = [
  { status: "looking", label: "Being looked at", help: "Checking the lot, the photos and what happened" },
  { status: "awaiting_return", label: "Waiting for return", help: "A return is agreed — wait for the item back before paying" },
  { status: "agreed", label: "Agreed — to pay", help: "The amount is agreed and needs paying" },
  { status: "paid", label: "Paid…", help: "Refunded or paid out — with the date processed" },
  { status: "declined", label: "Decline…", help: "No refund — say why" },
  { status: "closed", label: "Close another way…", help: "Withdrawn, a duplicate, sorted without a refund — say why" },
  { status: "new", label: "Back to New", help: "Nobody has really looked at it yet" },
]

export default function StatusCard({ r, today, me }: { r: RefundDetail; today: string; me: { id: string; name: string } }) {
  const router = useRouter()
  const [picked, setPicked] = useState<RefundStatus | null>(null)
  const [note, setNote] = useState("")
  const [day, setDay] = useState(today)
  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [saving, startSaving] = useTransition()
  /** The "someone else" box for who's dealing with it. */
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState("")
  /** The date processed box, once it's paid. */
  const processed = dateInputValue(r.processedAt)
  const [paidDay, setPaidDay] = useState(processed)
  const [seenProcessed, setSeenProcessed] = useState(processed)
  if (seenProcessed !== processed) { setSeenProcessed(processed); setPaidDay(processed) }

  const mine = r.dealtWithId === me.id
  const needsReason = picked === "declined" || picked === "closed"
  const reasonMissing = needsReason && !note.trim()
  const isClosed = CLOSED_REFUND_STATUSES.includes(r.status)
  const ticked = !!r.accountsDoneAt
  // "Back to New" only while it's open (a closed one goes back to Being looked at).
  const steps = STEPS.filter(s => s.status !== r.status && (s.status !== "new" || !isClosed))

  /** Runs one action and says how it went. */
  function run(work: () => Promise<FlashMessage | null>) {
    startSaving(async () => {
      try {
        const m = await work()
        if (m) setMsg(m)
        router.refresh()
      } catch {
        setMsg({ tone: "error", text: NO_ANSWER })
      }
    })
  }

  function pick(s: RefundStatus) {
    setPicked(s)
    setNote("")
    setDay(processed || today)
    setMsg(null)
  }

  function confirm() {
    if (!picked || reasonMissing) return
    const to = picked
    run(async () => {
      // The status this page shows goes too: if it has moved on since the page was opened, the server
      // refuses rather than moving it from a status nobody here saw.
      const res = await setRefundStatus(r.id, to, note.trim() || null, r.status)
      if (!res.ok) return { tone: "error", text: res.error }
      setPicked(null)
      setNote("")
      if (!res.data.changed) return { tone: "info", text: `It was already "${REFUND_STATUS_META[to].label}" — nothing changed.` }
      // Paid with a date other than the one the status gave it (today, or the one it had).
      if (to === "paid" && day && day !== (processed || today)) {
        const d = await setProcessedDate(r.id, day)
        if (!d.ok) return { tone: "error", text: `Now Paid — but the date processed couldn't be set: ${d.error}` }
        return { tone: "ok", text: `Now: Paid, processed ${formatDay(`${day}T12:00:00Z`)}.` }
      }
      return { tone: "ok", text: `Now: ${REFUND_STATUS_META[to].label}.` }
    })
  }

  function pickItUp() {
    run(async () => {
      const res = await pickUp(r.id)
      if (!res.ok) return { tone: "error", text: res.error }
      if (!res.data.changed) return { tone: "info", text: "You're already dealing with it — nothing changed." }
      return { tone: "ok", text: `You're dealing with it${res.data.status !== r.status ? ` — now ${REFUND_STATUS_META[res.data.status].label}` : ""}.` }
    })
  }

  function saveName(next: string | null) {
    run(async () => {
      const res = await setDealtWith(r.id, next)
      if (!res.ok) return { tone: "error", text: res.error }
      setNaming(false)
      setName("")
      if (!res.data.changed) return { tone: "info", text: "That's who it already says — nothing changed." }
      return { tone: "ok", text: `${next ? `${next} is dealing with it` : "Nobody is dealing with it now"}${res.data.status !== r.status ? ` — now ${REFUND_STATUS_META[res.data.status].label}` : ""}.` }
    })
  }

  function saveProcessed() {
    run(async () => {
      const res = await setProcessedDate(r.id, paidDay || null)
      if (!res.ok) return { tone: "error", text: res.error }
      if (!res.data.changed) return { tone: "info", text: "That's the date it already has — nothing changed." }
      return { tone: "ok", text: paidDay ? `Date processed: ${formatDay(`${paidDay}T12:00:00Z`)}.` : "Date processed cleared." }
    })
  }

  function tick(done: boolean) {
    run(async () => {
      const res = await setAccountsDone(r.id, done)
      if (!res.ok) return { tone: "error", text: res.error }
      if (!res.data.changed) return { tone: "info", text: done ? "It was already ticked — nothing changed." : "It wasn't ticked — nothing changed." }
      return { tone: "ok", text: done ? "Ticked complete for accounts." : "Complete for accounts taken off." }
    })
  }

  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="status-title">
      <h2 id="status-title" className={`${cardTitle} mb-3`}>Status</h2>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={r.status} long />
        <span className="text-sm text-gray-600 dark:text-gray-300">{REFUND_STATUS_META[r.status].help}.</span>
      </div>

      {/* Who's dealing with it */}
      <div className="mt-4 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-4 py-3">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Dealt with by</p>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className="text-sm font-semibold text-gray-900 dark:text-white mr-auto">
            {r.dealtWithName ?? <span className={`font-normal ${muted}`}>Nobody yet</span>}{mine && <span className={`font-normal ${muted}`}> (you)</span>}
          </span>
          {!mine && <button type="button" onClick={pickItUp} disabled={saving} className={btnGo}>🙋 Pick it up</button>}
          {!naming && <button type="button" onClick={() => { setNaming(true); setName(""); setMsg(null) }} disabled={saving} className={btn}>Someone else…</button>}
        </div>
        {naming && (
          <form onSubmit={e => { e.preventDefault(); if (name.trim()) saveName(name.trim()) }} className="mt-2 flex flex-wrap items-center gap-2">
            <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="e.g. Liv" aria-label="Who's dealing with it" autoComplete="off" className={`${field} flex-1 min-w-40`} />
            <button type="submit" disabled={saving || !name.trim()} className={btnGo}>Save</button>
            {r.dealtWithName && <button type="button" onClick={() => saveName(null)} disabled={saving} className={btn}>Nobody</button>}
            <button type="button" onClick={() => setNaming(false)} disabled={saving} className={btn}>Cancel</button>
          </form>
        )}
      </div>

      {/* The next steps */}
      <p className={`${label} mt-4`}>Move it on</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {steps.map(s => {
          const m = REFUND_STATUS_META[s.status]
          const chosen = s.status === picked
          return (
            <button
              key={s.status}
              type="button"
              onClick={() => pick(s.status)}
              disabled={saving}
              aria-pressed={chosen}
              className={`text-left min-h-11 rounded-xl border px-3 py-2.5 transition-colors ${
                chosen ? "border-emerald-500 ring-2 ring-emerald-500/40 bg-white dark:bg-[#1C1C1E]" : "border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] hover:border-emerald-500/60"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${m.dot}`} aria-hidden />
                {s.label}
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.help}</span>
            </button>
          )
        })}
      </div>

      {picked && (
        <div className="mt-4 rounded-xl border border-emerald-500/50 bg-emerald-50/60 dark:bg-emerald-500/5 p-4">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Change to &ldquo;{REFUND_STATUS_META[picked].label}&rdquo;?</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
            {CLOSED_REFUND_STATUSES.includes(picked)
              ? isClosed ? "It stays closed, on the day it first closed." : "This closes it — it leaves the open list."
              : isClosed ? "This reopens it — it goes back on the open list." : "It stays on the open list."}
          </p>
          {picked === "paid" && (
            <label className="block mt-3">
              <span className={label}>Date processed (the day it was refunded or paid out)</span>
              <input type="date" value={day} max={today} onChange={e => setDay(e.target.value)} className={field} />
            </label>
          )}
          <label className="block mt-3">
            <span className={label}>
              {needsReason ? <>Why? <span className="text-red-600 dark:text-red-400">*</span> (kept on the timeline)</> : "A note for the timeline (optional)"}
            </span>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={REFUND_LIMITS.reason}
              rows={2}
              placeholder={picked === "declined" ? "e.g. The damage was there before it was posted (see photos)" : picked === "closed" ? "e.g. Withdrawn by the customer, or a duplicate of RF0041" : ""}
              className={input}
            />
            <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">Never type bank or card details here.</span>
          </label>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={confirm} disabled={saving || reasonMissing || (picked === "paid" && !day)} className={btnGo}>
              {saving ? "Changing…" : "Change status"}
            </button>
            <button type="button" onClick={() => setPicked(null)} disabled={saving} className={btn}>Cancel</button>
          </div>
        </div>
      )}

      {/* Paid: the date processed, and Complete for accounts */}
      {(r.status === "paid" || ticked) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {r.status === "paid" && (
            <form onSubmit={e => { e.preventDefault(); saveProcessed() }} className="rounded-xl bg-gray-50 dark:bg-gray-800/60 px-4 py-3">
              <label htmlFor={`processed-${r.id}`} className="text-xs font-semibold text-gray-500 dark:text-gray-400">Date processed</label>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <input id={`processed-${r.id}`} type="date" value={paidDay} max={today} onChange={e => setPaidDay(e.target.value)} className={field} />
                <button type="submit" disabled={saving || paidDay === processed} className={btn}>Save date</button>
              </div>
              {!processed && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">No date processed yet — set the day it was paid.</p>}
            </form>
          )}
          <div className={`rounded-xl px-4 py-3 ${ticked ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800" : "bg-gray-50 dark:bg-gray-800/60"}`}>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Complete for accounts</p>
            {ticked ? (
              <>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 mt-1">✓ Ticked{r.accountsDoneBy ? ` by ${r.accountsDoneBy}` : ""}</p>
                <p className="text-xs text-gray-600 dark:text-gray-300">{formatDateTime(r.accountsDoneAt)}</p>
                <button type="button" onClick={() => tick(false)} disabled={saving} className={`${btn} mt-2`}>Take the tick off</button>
              </>
            ) : (
              <button type="button" onClick={() => tick(true)} disabled={saving} className={`${btnGo} mt-2`}>☐ Tick complete for accounts</button>
            )}
          </div>
        </div>
      )}
      {r.status !== "paid" && !ticked && (
        <p className={`text-xs ${muted} mt-4`}>Complete for accounts can be ticked once it&apos;s paid.</p>
      )}

      <Flash msg={msg} />
    </section>
  )
}
