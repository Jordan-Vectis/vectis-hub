"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { setStatus } from "@/lib/actions/uncollected"
import { CLOSED_STATUSES, STATUS_META, UNCOLLECTED_LIMITS, UNCOLLECTED_STATUSES, formatDay, type UncollectedCaseDetail, type UncollectedStatus } from "@/lib/uncollected"
import { Flash, NO_ANSWER, btn, btnGo, card, cardTitle, input, label, type CaseHref, type FlashMessage } from "../ui"

// The status buttons. A tap never changes anything by itself: it opens a small confirm underneath
// (with a note — needed for "Closed another way", optional otherwise), so a stray tap on an iPad
// can't close a case. Reopening a case whose invoice has another open case is refused by the server,
// with a link to that case.

export default function StatusCard({ c, caseHref }: { c: UncollectedCaseDetail; caseHref: CaseHref }) {
  const router = useRouter()
  const [picked, setPicked] = useState<UncollectedStatus | null>(null)
  const [note, setNote] = useState("")
  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [saving, startSaving] = useTransition()

  const isClosed = CLOSED_STATUSES.includes(c.status)
  const meta = picked ? STATUS_META[picked] : null
  const reasonMissing = !!meta?.needsReason && !note.trim()

  function pick(s: UncollectedStatus) {
    if (s === c.status) return
    setPicked(s)
    setNote("")
    setMsg(null)
  }

  function confirm() {
    if (!picked || reasonMissing) return
    const to = picked
    startSaving(async () => {
      try {
        const res = await setStatus(c.id, to, note.trim() || null)
        if (!res.ok) {
          setMsg({ tone: "error", text: res.error, link: res.existingId ? { href: caseHref(res.existingId), text: "Open that case →" } : undefined })
          return
        }
        setMsg(res.data.changed
          ? { tone: "ok", text: `Now: ${STATUS_META[to].label}.` }
          : { tone: "info", text: `It was already "${STATUS_META[to].label}" — nothing changed.` })
        setPicked(null)
        setNote("")
        router.refresh()
      } catch {
        setMsg({ tone: "error", text: NO_ANSWER })
      }
    })
  }

  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="status-title">
      <h2 id="status-title" className={`${cardTitle} mb-3`}>Status</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {UNCOLLECTED_STATUSES.map(s => {
          const m = STATUS_META[s]
          const now = s === c.status
          const chosen = s === picked
          return (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              disabled={saving}
              aria-pressed={now}
              className={`text-left min-h-11 rounded-xl border px-3 py-2.5 transition-colors ${
                now ? `${m.chip} cursor-default` :
                chosen ? "border-emerald-500 ring-2 ring-emerald-500/40 bg-white dark:bg-[#1C1C1E]" :
                "border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] hover:border-emerald-500/60"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${m.dot}`} aria-hidden />
                {m.label}
                {now && <span className="ml-auto text-[11px] font-bold uppercase tracking-wide">Now</span>}
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{m.help}</span>
            </button>
          )
        })}
      </div>

      {picked && meta && (
        <div className="mt-4 rounded-xl border border-emerald-500/50 bg-emerald-50/60 dark:bg-emerald-500/5 p-4">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Change to &ldquo;{meta.label}&rdquo;?</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
            {meta.closes
              ? isClosed ? "It stays closed, on the day it first closed." : "This closes the case — it leaves the open list."
              : isClosed ? "This reopens the case — it goes back on the open list." : "It stays on the open list."}
            {picked === "storage" && !c.storageFrom && (c.storage.standardFrom
              ? ` Storage is counted from ${formatDay(`${c.storage.standardFrom}T12:00:00Z`)} — the day after the free days from when they paid. Change the date under Storage charges if they started another day.`
              : " There's no paid date, so storage charges will start from today — change the date under Storage charges if they started another day.")}
          </p>
          <label className="block mt-3">
            <span className={label}>
              {meta.needsReason ? <>Why is it being closed? <span className="text-red-600 dark:text-red-400">*</span></> : "A note for the timeline (optional)"}
            </span>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={UNCOLLECTED_LIMITS.eventText}
              rows={2}
              placeholder={meta.needsReason ? "e.g. Refunded, or re-offered in the next sale" : ""}
              className={input}
            />
          </label>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={confirm} disabled={saving || reasonMissing} className={btnGo}>
              {saving ? "Changing…" : "Change status"}
            </button>
            <button type="button" onClick={() => setPicked(null)} disabled={saving} className={btn}>Cancel</button>
          </div>
        </div>
      )}

      <Flash msg={msg} />
    </section>
  )
}
