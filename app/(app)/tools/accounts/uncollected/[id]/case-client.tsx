"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { deleteCase, updateCase } from "@/lib/actions/uncollected"
import {
  EVENT_META, STATUS_META, dateInputValue, daysBetween, formatDateTime, formatDay,
  type UncollectedCaseDetail,
} from "@/lib/uncollected"
import { DaysWaiting, LastContact, SourceBadge, StatusChip } from "../bits"
import { BackLink, Flash, NO_ANSWER, PANEL_PATH, btn, btnDanger, btnGo, card, cardTitle, field, label, plural, type CaseHref, type FlashMessage } from "../ui"
import ContactCard from "./contact-card"
import DetailsCard from "./details-card"
import StatusCard from "./status-card"

// One Paid, not collected case. Every card writes through lib/actions/uncollected.ts (admins only,
// re-checked there) and then refreshes the page from the server, so what's shown is what's saved.
//
// Layout: on a wide screen (lg) Details + Storage on the left, Status + Log contact + Timeline on
// the right. Narrower — a phone, an iPad in portrait — one column with what's done most FIRST:
// Status, Log contact, Details, Storage, Timeline. The two column wrappers are `display: contents`
// below lg, so each card takes its own `order` in the one column. The right-hand column comes first
// in the page, so on the iPads the order you tab through matches what's shown (only the Timeline,
// with nothing to tap, sits elsewhere in the page); on a wide screen the keyboard reaches Status and
// Log contact before Details.

export default function CaseView({ c, today, backHref }: { c: UncollectedCaseDetail; today: string; backHref: string }) {
  const query = backHref.startsWith(PANEL_PATH) ? backHref.slice(PANEL_PATH.length) : ""
  const caseHref: CaseHref = id => `${PANEL_PATH}/${id}${query}`
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <BackLink href={backHref}>Paid, not collected</BackLink>

      <div className="mt-1 mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white break-words">{c.buyerName}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2 text-sm text-gray-600 dark:text-gray-300">
            <StatusChip status={c.status} long />
            {c.buyerNo && <span className="font-mono">{c.buyerNo}</span>}
            <SourceBadge source={c.source} />
            <span>
              <DaysWaiting days={c.daysWaiting} closed={!!c.closedAt} />{" "}
              {c.daysWaiting == null ? "— paid date not known" : c.closedAt ? `waited · closed ${formatDay(c.closedAt)}` : "waiting since they paid"}
            </span>
          </div>
        </div>
        {c.customerId && (
          <Link href={`/tools/customers/${c.customerId}`} prefetch={false} className={btn}>
            👥 Open in Customers →
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
        <div className="contents lg:block lg:order-2 lg:min-w-0 lg:space-y-4">
          <div className="order-1 min-w-0"><StatusCard c={c} caseHref={caseHref} /></div>
          <div className="order-2 min-w-0"><ContactCard c={c} today={today} /></div>
          <div className="order-5 min-w-0"><Timeline c={c} /></div>
        </div>
        <div className="contents lg:block lg:order-1 lg:min-w-0 lg:space-y-4">
          <div className="order-3 min-w-0"><DetailsCard c={c} today={today} caseHref={caseHref} /></div>
          <div className="order-4 min-w-0"><StorageCard c={c} today={today} /></div>
        </div>
      </div>

      <DeleteCard c={c} backHref={backHref} />
    </div>
  )
}

// ─── Storage charges ─────────────────────────────────────────────────────────────────────────

function StorageCard({ c, today }: { c: UncollectedCaseDetail; today: string }) {
  const router = useRouter()
  const current = dateInputValue(c.storageFrom)
  const [day, setDay] = useState(current)
  // The date box follows the saved date when something else changes it (choosing "Storage charges
  // apply" starts the charges today on the server).
  const [seen, setSeen] = useState(current)
  if (seen !== current) { setSeen(current); setDay(current) }
  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [saving, startSaving] = useTransition()
  const daysSoFar = current ? daysBetween(current, today) : null

  function save(next: string) {
    if (next === current) { setMsg({ tone: "info", text: "That's the date it already has — nothing changed." }); return }
    startSaving(async () => {
      try {
        const res = await updateCase(c.id, { storageFrom: next || null })
        if (!res.ok) { setMsg({ tone: "error", text: res.error }); return }
        setMsg(res.data.changed.length
          ? { tone: "ok", text: next ? `Storage charges now start from ${formatDay(`${next}T12:00:00Z`)}.` : "Storage start date cleared." }
          : { tone: "info", text: "That's the date it already has — nothing changed." })
        setDay(next)
        router.refresh()
      } catch {
        setMsg({ tone: "error", text: NO_ANSWER })
      }
    })
  }

  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="storage-title">
      <h2 id="storage-title" className={`${cardTitle} mb-2`}>Storage charges</h2>
      <p className="text-sm text-gray-800 dark:text-gray-200">
        {current ? (
          <>From <b>{formatDay(c.storageFrom)}</b>
            {daysSoFar != null && (daysSoFar >= 0 ? <> — {plural(daysSoFar, "day")} so far</> : <> — starts in {plural(-daysSoFar, "day")}</>)}
          </>
        ) : "Not started — no storage charges on this case yet."}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{STATUS_META.storage.help}</p>
      <form onSubmit={e => { e.preventDefault(); save(day) }} className="mt-3">
        <label htmlFor={`storage-${c.id}`} className={label}>Charges start from</label>
        <div className="flex flex-wrap items-center gap-2">
          <input id={`storage-${c.id}`} type="date" value={day} onChange={e => setDay(e.target.value)} className={field} />
          <button type="submit" disabled={saving || !day || day === current} className={btnGo}>{saving ? "Saving…" : "Save date"}</button>
          {current && <button type="button" disabled={saving} onClick={() => save("")} className={btn}>Clear it</button>}
        </div>
      </form>
      <Flash msg={msg} />
    </section>
  )
}

// ─── Timeline ────────────────────────────────────────────────────────────────────────────────

function Timeline({ c }: { c: UncollectedCaseDetail }) {
  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="timeline-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 id="timeline-title" className={cardTitle}>Timeline</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">Last contact: <LastContact last={c.lastContact} /></span>
      </div>
      {c.events.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Nothing on the timeline yet.</p>
      ) : (
        <ol className="space-y-3">
          {c.events.map(e => {
            const m = EVENT_META[e.kind]
            return (
              <li key={e.id} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-base" aria-hidden>{m.icon}</span>
                <div className="min-w-0 flex-1 border-b border-gray-100 dark:border-gray-800 pb-3">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{m.label}</p>
                  {e.text && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words mt-0.5">{e.text}</p>}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatDateTime(e.at)}{e.byName ? ` · ${e.byName}` : ""}</p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

// ─── Delete (a case entered by hand only) ────────────────────────────────────────────────────

function DeleteCard({ c, backHref }: { c: UncollectedCaseDetail; backHref: string }) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [deleting, startDeleting] = useTransition()

  if (c.source !== "manual") {
    return (
      <p className="mt-6 text-xs text-gray-500 dark:text-gray-400">
        This case came from BC, so it can&apos;t be deleted here — if it shouldn&apos;t be on the list, change its status to &ldquo;{STATUS_META.closed.label}&rdquo; and say why.
      </p>
    )
  }

  function remove() {
    startDeleting(async () => {
      try {
        const res = await deleteCase(c.id)
        if (!res.ok) { setMsg({ tone: "error", text: res.error }); setAsking(false); return }
        router.push(backHref)
        router.refresh()
      } catch {
        setMsg({ tone: "error", text: "The Hub didn't answer — check the connection and try again. Nothing was deleted." })
      }
    })
  }

  return (
    <section className="mt-6 rounded-2xl border border-red-200 dark:border-red-900/60 p-4 sm:p-5" aria-labelledby="delete-title">
      <h2 id="delete-title" className="text-sm font-bold text-red-700 dark:text-red-300 uppercase tracking-wider">Delete this case</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
        For a case added by mistake. If they&apos;ve collected, or it was refunded, change the status instead — that keeps the record.
      </p>
      {!asking ? (
        <button type="button" onClick={() => { setAsking(true); setMsg(null) }} className={`${btnDanger} mt-3`}>Delete this case…</button>
      ) : (
        <div className="mt-3 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">
            Delete {c.buyerName}&apos;s case and its whole timeline? This can&apos;t be undone.
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
    </section>
  )
}
