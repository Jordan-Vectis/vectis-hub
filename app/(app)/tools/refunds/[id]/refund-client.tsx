"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { addRefundNote, deleteRefund } from "@/lib/actions/refunds"
import { CLOSED_REFUND_STATUSES, REFUND_LIMITS, refundRefWords, type RefundDetail, type RefundEventRow } from "@/lib/refunds"
import { formatDateTime, formatDay } from "@/lib/uncollected"
import { PartyBadge, SourceBadge, StatusChip, SuspectBadge } from "../bits"
import { BackLink, Flash, NO_ANSWER, btn, btnDanger, btnGo, card, cardTitle, input, leaveListNote, muted, plural, type FlashMessage } from "../ui"
import DetailsCard from "./details-card"
import LotsCard from "./lots-card"
import StatusCard from "./status-card"

// One refund request. Every card writes through lib/actions/refunds.ts (admins only, re-checked there)
// and then refreshes the page from the server, so what's shown is what's saved.
//
// Layout: on a wide screen (lg) Details on the left beside Status, then Lots & money ACROSS THE FULL
// WIDTH (its boxes need the room — nothing scrolls sideways), then Photos and the old log beside Notes
// and the Timeline. Narrower — a phone, an iPad in portrait — one column, Status first: what's done
// most comes first. The Status card comes first in the page too, so the order you tab through matches.

export default function RefundView({ r, today, backHref, me }: { r: RefundDetail; today: string; backHref: string; me: { id: string; name: string } }) {
  const closed = CLOSED_REFUND_STATUSES.includes(r.status)
  return (
    <div className="p-4 sm:p-6 max-w-7xl desk:max-w-[1600px] mx-auto">
      <BackLink href={backHref}>Refunds</BackLink>

      <div className="mt-1 mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white break-words">
            <span className="font-mono">{refundRefWords(r.ref)}</span> <span className="text-gray-400" aria-hidden>·</span> {r.name}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2 text-sm text-gray-600 dark:text-gray-300">
            <StatusChip status={r.status} long />
            {r.customerNo && <span className="font-mono">{r.customerNo}</span>}
            <PartyBadge party={r.party} />
            <SourceBadge source={r.source} />
            {r.suspect && <SuspectBadge />}
            {/* A day set without a time (the old log, or a day put right) is kept as 12:00 UTC — no made-up time is shown. */}
            <span>Came in {r.receivedAt.endsWith("T12:00:00.000Z") ? formatDay(r.receivedAt) : formatDateTime(r.receivedAt)}</span>
            <span className={!closed && r.daysOpen > 14 ? "font-semibold text-red-600 dark:text-red-400" : undefined}>
              {closed ? `closed after ${plural(r.daysOpen, "day")}` : `${plural(r.daysOpen, "day")} open`}
            </span>
          </div>
        </div>
        {r.customerId && (
          <Link href={`/tools/customers/${r.customerId}`} prefetch={false} className={btn}>
            👥 Open in Customers →
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="min-w-0 lg:col-start-2 lg:row-start-1"><StatusCard r={r} today={today} me={me} /></div>
          <div className="min-w-0 lg:col-start-1 lg:row-start-1"><DetailsCard r={r} today={today} /></div>
        </div>
        <div className="min-w-0"><LotsCard r={r} /></div>
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="min-w-0 space-y-4">
            <Photos r={r} />
            {r.importedRaw && <OldLog raw={r.importedRaw} />}
          </div>
          <div className="min-w-0 space-y-4">
            <Notes r={r} />
            <Timeline events={r.events} />
          </div>
        </div>
      </div>

      <DeleteCard r={r} backHref={backHref} />
    </div>
  )
}

// ─── Photos ──────────────────────────────────────────────────────────────────────────────────
// Through the admin-only photo route (never a public address); each opens full size in a new tab.

function Photos({ r }: { r: RefundDetail }) {
  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="photos-title">
      <h2 id="photos-title" className={`${cardTitle} mb-3`}>Photos{r.photoKeys.length ? ` (${r.photoKeys.length})` : ""}</h2>
      {r.photoKeys.length === 0 ? (
        <p className={`text-sm ${muted}`}>No photos.</p>
      ) : (
        <>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {r.photoKeys.map((k, i) => {
              const src = `/api/refunds/photo?key=${encodeURIComponent(k)}`
              return (
                <li key={k}>
                  <a href={src} target="_blank" rel="noopener noreferrer" className="block aspect-square overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800 hover:border-emerald-500/60">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Photo ${i + 1} of ${r.photoKeys.length}`} loading="lazy" className="h-full w-full object-cover" />
                  </a>
                </li>
              )
            })}
          </ul>
          <p className={`text-xs ${muted} mt-2`}>Tap a photo to open it full size.</p>
        </>
      )}
    </section>
  )
}

// ─── The old log's cells, for an imported request ──────────────────────────────────────────

function OldLog({ raw }: { raw: Record<string, string> }) {
  const cells = Object.entries(raw).filter(([k, v]) => k.trim() && v.trim())
  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="oldlog-title">
      <h2 id="oldlog-title" className={`${cardTitle} mb-1`}>From the old log</h2>
      <p className={`text-xs ${muted} mb-3`}>The SharePoint refund log&apos;s row, exactly as it was when it was imported.</p>
      {cells.length === 0 ? (
        <p className={`text-sm ${muted}`}>Every cell was blank.</p>
      ) : (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {cells.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400">{k.trim()}</dt>
              <dd className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">{v.trim()}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

// ─── Notes ───────────────────────────────────────────────────────────────────────────────────
// A note goes on the timeline (kind "note") with who and when — listed here, newest first. The
// request's own Notes box (from the old log, or Edit details) is in Details.

function Notes({ r }: { r: RefundDetail }) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [saving, startSaving] = useTransition()
  const notes = r.events.filter(e => e.kind === "note")

  function add() {
    if (!text.trim() || saving) return
    startSaving(async () => {
      try {
        const res = await addRefundNote(r.id, text.trim())
        if (!res.ok) { setMsg({ tone: "error", text: res.error }); return }
        setText("")
        setMsg({ tone: "ok", text: "Note added." })
        router.refresh()
      } catch {
        setMsg({ tone: "error", text: NO_ANSWER })
      }
    })
  }

  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="notes-title">
      <h2 id="notes-title" className={`${cardTitle} mb-3`}>Notes</h2>
      <form onSubmit={e => { e.preventDefault(); add() }}>
        <textarea value={text} onChange={e => setText(e.target.value)} maxLength={REFUND_LIMITS.eventText} rows={2} placeholder="What was said or done — e.g. Rang the customer, return label sent" aria-label="A new note" className={input} />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button type="submit" disabled={saving || !text.trim()} className={btnGo}>{saving ? "Adding…" : "Add note"}</button>
          <span className={`text-xs ${muted}`}>Never type bank or card details here.</span>
        </div>
      </form>
      <Flash msg={msg} />
      {notes.length > 0 && (
        <ol className="mt-4 space-y-3">
          {notes.map(e => (
            <li key={e.id} className="border-b border-gray-100 dark:border-gray-800 pb-3">
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">{e.text}</p>
              <p className={`text-xs ${muted} mt-1`}>{formatDateTime(e.at)}{e.byName ? ` · ${e.byName}` : ""}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ─── Timeline ────────────────────────────────────────────────────────────────────────────────

/** Each kind of timeline line — an icon AND its words (design rule 3). A kind this page doesn't know
 *  (written by the form or the import) still shows, with its own name. */
const EVENT_WORDS: Record<string, { icon: string; label: string }> = {
  created: { icon: "＋", label: "Added" },
  received: { icon: "📨", label: "Came in through the refund form" },
  form: { icon: "📨", label: "Came in through the refund form" },
  imported: { icon: "📥", label: "Imported from the old refund log" },
  import: { icon: "📥", label: "Imported from the old refund log" },
  edit: { icon: "✏️", label: "Details changed" },
  status: { icon: "🔁", label: "Status changed" },
  picked_up: { icon: "🙋", label: "Picked up" },
  dealt_with: { icon: "👤", label: "Who's dealing with it" },
  amounts: { icon: "💷", label: "Amounts updated" },
  processed: { icon: "📅", label: "Date processed" },
  accounts: { icon: "✅", label: "Complete for accounts" },
  photos: { icon: "📷", label: "Photos" },
}
const eventWords = (kind: string) =>
  EVENT_WORDS[kind] ?? { icon: "•", label: kind ? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, " ") : "Event" }

function Timeline({ events }: { events: RefundEventRow[] }) {
  const shown = events.filter(e => e.kind !== "note")
  const notes = events.length - shown.length
  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="timeline-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 id="timeline-title" className={cardTitle}>Timeline</h2>
        <span className={`text-xs ${muted}`}>London time{notes ? ` · ${plural(notes, "note")} under Notes` : ""}</span>
      </div>
      {shown.length === 0 ? (
        <p className={`text-sm ${muted}`}>Nothing on the timeline yet.</p>
      ) : (
        <ol className="space-y-3">
          {shown.map(e => {
            const m = eventWords(e.kind)
            return (
              <li key={e.id} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-base" aria-hidden>{m.icon}</span>
                <div className="min-w-0 flex-1 border-b border-gray-100 dark:border-gray-800 pb-3">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{m.label}</p>
                  {e.text && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words mt-0.5">{e.text}</p>}
                  <p className={`text-xs ${muted} mt-1`}>{formatDateTime(e.at)}{e.byName ? ` · ${e.byName}` : ""}</p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

// ─── Delete ──────────────────────────────────────────────────────────────────────────────────

function DeleteCard({ r, backHref }: { r: RefundDetail; backHref: string }) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [deleting, startDeleting] = useTransition()

  function remove() {
    startDeleting(async () => {
      try {
        const res = await deleteRefund(r.id)
        if (!res.ok) { setMsg({ tone: "error", text: res.error }); setAsking(false); return }
        // Back to the list, with what happened said there (this page's request has gone). Said, not
        // hidden: a photo that couldn't be removed is still in storage.
        const ref = refundRefWords(res.data.ref)
        leaveListNote(res.data.photosLeft
          ? { tone: "info", text: `${ref} was deleted, but ${plural(res.data.photosLeft, "photo")} couldn't be removed from storage — tell whoever looks after the Hub (${res.data.photosLeft === 1 ? "it's" : "they're"} under refund-photos/ in R2).` }
          : { tone: "ok", text: `${ref} was deleted.` })
        router.push(backHref)
        router.refresh()
      } catch {
        setMsg({ tone: "error", text: "The Hub didn't answer — check the connection and try again. Nothing was deleted." })
      }
    })
  }

  return (
    <section className="mt-6 rounded-2xl border border-red-200 dark:border-red-900/60 p-4 sm:p-5" aria-labelledby="delete-title">
      <h2 id="delete-title" className="text-sm font-bold text-red-700 dark:text-red-300 uppercase tracking-wider">Delete this request</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
        For one added by mistake, or spam. If it was refunded, declined or withdrawn, change its status instead — that keeps the record.
      </p>
      {!asking ? (
        <button type="button" onClick={() => { setAsking(true); setMsg(null) }} disabled={deleting} className={`${btnDanger} mt-3`}>Delete this request…</button>
      ) : (
        <div className="mt-3 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">
            Delete {refundRefWords(r.ref)} — its lots, photos and whole timeline? This can&apos;t be undone.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={remove} disabled={deleting} className="inline-flex items-center justify-center min-h-11 px-4 py-2 text-sm font-semibold rounded-xl bg-red-600 hover:bg-red-500 text-white disabled:opacity-50">
              {deleting ? "Deleting…" : "Yes, delete it"}
            </button>
            <button type="button" onClick={() => setAsking(false)} disabled={deleting} className={btn}>No, keep it</button>
          </div>
        </div>
      )}
      <Flash msg={msg} />
      <p className={`text-xs ${muted} mt-3`}>Last changed {formatDay(r.updatedAt)}.</p>
    </section>
  )
}
