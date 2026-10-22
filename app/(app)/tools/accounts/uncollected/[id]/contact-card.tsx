"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { logContact } from "@/lib/actions/uncollected"
import {
  CONTACT_KINDS, EVENT_META, STATUS_META, UNCOLLECTED_LIMITS, addDays, formatDay,
  type ContactKind, type UncollectedCaseDetail,
} from "@/lib/uncollected"
import { Flash, NO_ANSWER, btn, btnGo, card, cardTitle, field, input, label, type FlashMessage } from "../ui"

// Log contact: a call, email, letter or note on the timeline, with an optional next chase date.
// A call, email or letter on a case still "waiting" moves it to "We've been in touch" — the server
// does that and says so, and so does this card.
//
// The next chase date: an empty box KEEPS the date the case has (logContact leaves it alone), a date
// sets it, and "No more chasing" clears it (null). When the case's chase date is today or has
// passed, the card says so — logging a call and leaving the box empty would otherwise leave the
// case red and in Chases due after it has been chased.

const PLACEHOLDER: Record<ContactKind, string> = {
  call: "e.g. Spoke to them — coming in on Friday to collect",
  email: "e.g. Sent the collection reminder",
  letter: "e.g. Posted the storage charges letter",
  note: "Anything worth keeping on the case",
}

const SAVE_WORDS: Record<ContactKind, string> = { call: "Save the call", email: "Save the email", letter: "Save the letter", note: "Save the note" }

/** A button that stays pressed (the kind of contact, No more chasing). */
const toggle = "min-h-11 rounded-xl border px-3 text-sm font-semibold transition-colors"
const toggleOn = "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-500/40"
const toggleOff = "border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] text-gray-700 dark:text-gray-300 hover:border-emerald-500/60"

export default function ContactCard({ c, today }: { c: UncollectedCaseDetail; today: string }) {
  const router = useRouter()
  const [kind, setKind] = useState<ContactKind>("call")
  const [text, setText] = useState("")
  /** A YYYY-MM-DD to set, or "" to keep the case's date as it is. */
  const [chase, setChase] = useState("")
  /** true = clear the case's next chase date ("No more chasing"). */
  const [stopChasing, setStopChasing] = useState(false)
  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [saving, startSaving] = useTransition()
  const needsText = kind === "note" && !text.trim()
  const due = c.chase === "overdue" || c.chase === "today"

  function pickChase(day: string) {
    setChase(day)
    if (day) setStopChasing(false)
  }

  function save() {
    if (needsText || saving) return
    const sentKind = kind
    const sentChase = chase
    const sentStop = stopChasing
    startSaving(async () => {
      try {
        // Left out = keep the date as it is; null = clear it; a day = set it.
        const nextChase = sentStop ? { nextChaseAt: null } : sentChase ? { nextChaseAt: sentChase } : {}
        const res = await logContact(c.id, { kind: sentKind, text: text.trim() || null, ...nextChase })
        if (!res.ok) { setMsg({ tone: "error", text: res.error }); return }
        const parts = [`${EVENT_META[sentKind].label} saved on the timeline`]
        if (sentStop) parts.push(c.nextChaseAt ? "next chase date cleared" : "no chase date set")
        else if (sentChase) parts.push(`next chase ${formatDay(`${sentChase}T12:00:00Z`)}`)
        if (res.data.statusChangedTo) parts.push(`moved to "${STATUS_META[res.data.statusChangedTo].label}"`)
        setMsg({ tone: "ok", text: `${parts.join(" — ")}.` })
        setText("")
        setChase("")
        setStopChasing(false)
        router.refresh()
      } catch {
        setMsg({ tone: "error", text: NO_ANSWER })
      }
    })
  }

  const quick: { label: string; days: number }[] = [
    { label: "In 3 days", days: 3 }, { label: "In a week", days: 7 }, { label: "In 2 weeks", days: 14 },
  ]

  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="contact-title">
      <h2 id="contact-title" className={`${cardTitle} mb-3`}>Log contact</h2>
      <form onSubmit={e => { e.preventDefault(); save() }}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="What kind of contact">
          {CONTACT_KINDS.map(k => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`${toggle} ${kind === k ? toggleOn : toggleOff}`}
            >
              <span aria-hidden>{EVENT_META[k].icon}</span> {k === "call" ? "Call" : EVENT_META[k].label}
            </button>
          ))}
        </div>

        <label className="block mt-3">
          <span className={label}>{kind === "note" ? <>The note <span className="text-red-600 dark:text-red-400">*</span></> : "What happened (optional)"}</span>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            maxLength={UNCOLLECTED_LIMITS.eventText}
            rows={3}
            placeholder={PLACEHOLDER[kind]}
            className={input}
          />
          <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">Never type bank or card details here.</span>
        </label>

        <div className="mt-3">
          <span className={label}>Next chase (optional)</span>
          {due && !chase && !stopChasing && (
            <p role="status" className="mb-2 rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-3 py-2 text-sm">
              {c.chase === "overdue" ? `The chase date (${formatDay(c.nextChaseAt)}) has passed` : "The chase date is today"} — pick the
              next one, or press <b>No more chasing</b>. Left empty, the case stays red and in Chases due.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={chase} onChange={e => pickChase(e.target.value)} min={today} aria-label="Next chase date" className={field} />
            {quick.map(q => (
              <button key={q.days} type="button" onClick={() => pickChase(addDays(today, q.days))} className={btn}>{q.label}</button>
            ))}
            {c.nextChaseAt && (
              <button
                type="button"
                aria-pressed={stopChasing}
                onClick={() => { setStopChasing(true); setChase("") }}
                className={`${toggle} ${stopChasing ? toggleOn : toggleOff}`}
              >
                No more chasing
              </button>
            )}
            {(chase || stopChasing) && (
              <button type="button" onClick={() => { setChase(""); setStopChasing(false) }} className={btn}>
                {c.nextChaseAt ? "Keep the current date" : "Don't set one"}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {stopChasing
              ? `The next chase date (${formatDay(c.nextChaseAt)}) will be cleared.`
              : chase
                ? `The next chase will be ${formatDay(`${chase}T12:00:00Z`)}.`
                : c.nextChaseAt
                  ? `Now set for ${formatDay(c.nextChaseAt)} — left empty, it stays as it is.`
                  : "None set yet."}
          </p>
        </div>

        <div className="mt-4">
          <button type="submit" disabled={saving || needsText} className={btnGo}>{saving ? "Saving…" : SAVE_WORDS[kind]}</button>
        </div>
      </form>
      <Flash msg={msg} />
    </section>
  )
}
