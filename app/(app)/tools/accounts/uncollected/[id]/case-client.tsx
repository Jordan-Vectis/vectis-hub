"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition, type ReactNode } from "react"
import { deleteCase, resumeStorage, updateCase, waiveStorage } from "@/lib/actions/uncollected"
import {
  EVENT_META, STATUS_META, STORAGE_LIMITS, STORAGE_SETTINGS_READ_FAILED, dateInputValue, formatDateTime, formatDay, formatPence,
  STORAGE_TEXT, storageSettingsWords,
  type UncollectedCaseDetail,
} from "@/lib/uncollected"
import { DaysWaiting, LastContact, PaidWhen, SourceBadge, StatusChip, StorageOwed } from "../bits"
import { BackLink, Flash, NO_ANSWER, PANEL_PATH, btn, btnDanger, btnGo, card, cardTitle, field, input, label, plural, type CaseHref, type FlashMessage } from "../ui"
import BcLots from "./bc-lots"
import ContactCard from "./contact-card"
import DetailsCard from "./details-card"
import StatusCard from "./status-card"

// One Paid, not collected case. Every card writes through lib/actions/uncollected.ts (admins only,
// re-checked there) and then refreshes the page from the server, so what's shown is what's saved.
//
// Layout: on a wide screen (lg) Details + Lots in BC + Storage on the left, Status + Log contact +
// Timeline on the right. Narrower — a phone, an iPad in portrait — one column with what's done most
// FIRST: Status, Log contact, Details, Lots in BC, Storage, Timeline. The two column wrappers are `display: contents`
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
              {c.daysWaiting == null
                ? "— paid date not known"
                : c.closedAt
                  ? `waited · closed ${formatDay(c.closedAt)}`
                  : c.source === "bc" && !c.paidExact ? "since BC settled the invoice — they've waited at least this long" : "waiting since they paid"}
            </span>
            <PaidWhen source={c.source} paidAt={c.paidAt} exact={c.paidExact} />
            <span>Storage owed: <StorageOwed s={c.storage} inline /></span>
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
          <div className="order-6 min-w-0"><Timeline c={c} /></div>
        </div>
        <div className="contents lg:block lg:order-1 lg:min-w-0 lg:space-y-4">
          <div className="order-3 min-w-0"><DetailsCard c={c} today={today} caseHref={caseHref} /></div>
          <div className="order-4 min-w-0"><BcLots c={c} /></div>
          <div className="order-5 min-w-0"><StorageCard c={c} /></div>
        </div>
      </div>

      <DeleteCard c={c} backHref={backHref} />
    </div>
  )
}

// ─── Storage charges ─────────────────────────────────────────────────────────────────────────
// The running total, worked out live on the server by the rules in lib/uncollected.ts (storageCharge
// — never stored as money: it changes every day), in words and as the figures to raise the charge;
// the day the charges start, which can be changed; and Waive / Charge again (admins — the server
// re-checks), each confirmed in the page, waiving with a reason. The Hub never charges anything in
// BC — these figures are for staff to raise the charge.

function StorageCard({ c }: { c: UncollectedCaseDetail }) {
  const router = useRouter()
  const s = c.storage
  const settings = c.storageSettings
  const waiver = s.waived ? s.waiver : null
  const current = dateInputValue(c.storageFrom)
  const [day, setDay] = useState(current)
  // The date box follows the saved date when something else changes it (choosing "Storage charges
  // apply", the BC check filling it from the paid date, or the free days being changed).
  const [seen, setSeen] = useState(current)
  if (seen !== current) { setSeen(current); setDay(current) }
  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [saving, startSaving] = useTransition()
  /** The waive / charge-again confirm that's open, and what's typed in it. */
  const [asking, setAsking] = useState<"waive" | "resume" | null>(null)
  const [note, setNote] = useState("")
  /** The start the storage rule gives from the paid date (the day after the free days). */
  const standard = s.standardFrom
  /** Who set the start on the case (from its timeline, not by comparing dates): the rule, a person, or
   *  nobody (no start on the case — the rule works it out live). */
  const by = c.storageStartBy
  const differs = !!current && current !== standard
  const free = plural(settings.graceDays, "free day")
  const figures = s.started && s.fullTotalPence != null
  const day0 = (d: string) => formatDay(`${d}T12:00:00Z`)
  /** "Use the standard date" — or, for a person's start on a case from BC that already matches it,
   *  hand it back to the rule (the BC check then keeps it in step again). */
  const showReset = !!current && (differs || (by === "person" && c.source === "bc"))
  const resetLabel = differs ? (standard ? "Use the standard date" : "Clear it") : "Hand it back to the storage rule"
  const whereFrom = !current
    ? standard
      ? `No start date is set on the case, so it starts the day after the ${free} from when they paid.`
      : "There's no paid date — add it, or set the day the charges start."
    : by === "rule"
      ? !differs
        ? `Set by the storage rule — the day after the ${free} from when they paid.`
        : c.closedAt
          ? `Set by the storage rule while the case was open${standard ? ` — by today's free days it would be ${day0(standard)}` : ""}.`
          : `Set by the storage rule${standard ? ` — by today's free days it would be ${day0(standard)}; the BC check brings it into line when it next looks at the case` : ""}.`
      : differs
        ? `Set on this case by a person${standard ? ` — the standard start would be ${day0(standard)}` : ""}.`
        : "Set on this case by a person — the same day as the standard start."

  function saveDay(next: string) {
    if (next === current) { setMsg({ tone: "info", text: "That's the date it already has — nothing changed." }); return }
    startSaving(async () => {
      try {
        const res = await updateCase(c.id, { storageFrom: next || null })
        if (!res.ok) { setMsg({ tone: "error", text: res.error }); return }
        setMsg(res.data.changed.length
          ? { tone: "ok", text: next
              ? `Storage charges now start from ${formatDay(`${next}T12:00:00Z`)}.`
              : standard ? `The start date is cleared — the standard one is used: ${formatDay(`${standard}T12:00:00Z`)}.` : "The start date is cleared." }
          : { tone: "info", text: "That's the date it already has — nothing changed." })
        setDay(next)
        router.refresh()
      } catch {
        setMsg({ tone: "error", text: NO_ANSWER })
      }
    })
  }

  function switchIt() {
    const which = asking
    if (!which || saving) return
    if (which === "waive" && !note.trim()) return
    startSaving(async () => {
      try {
        const res = which === "waive" ? await waiveStorage(c.id, note.trim()) : await resumeStorage(c.id, note.trim() || null)
        if (!res.ok) { setMsg({ tone: "error", text: res.error }); return }
        const fig = res.data.figurePence
        setMsg(!res.data.changed
          ? { tone: "info", text: which === "waive" ? "Storage was already waived on this case — nothing changed." : "Storage wasn't waived on this case — nothing changed." }
          : which === "waive"
            ? { tone: "ok", text: `Storage waived on this case${fig ? ` — the ${formatPence(fig)} so far won't be charged` : ""}. It's on the timeline.` }
            : { tone: "ok", text: `Storage is charged on this case again${fig ? ` — ${formatPence(fig)} so far, inc VAT` : ""}. It's on the timeline.` })
        setAsking(null)
        setNote("")
        router.refresh()
      } catch {
        setMsg({ tone: "error", text: NO_ANSWER })
      }
    })
  }

  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="storage-title">
      <h2 id="storage-title" className={`${cardTitle} mb-2`}>Storage charges</h2>

      {settings.readFailed && (
        <p role="alert" className="mb-3 rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-3 py-2 text-sm">
          {STORAGE_SETTINGS_READ_FAILED}
        </p>
      )}

      {waiver && (
        <div className="mb-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-4 py-3 text-sm text-gray-800 dark:text-gray-200">
          <p className="font-semibold">Waived — no storage is charged on this case.</p>
          {waiver.reason && <p className="mt-0.5 whitespace-pre-wrap break-words">{waiver.reason}</p>}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{waiver.byName ? `By ${waiver.byName}, ` : ""}{formatDateTime(waiver.at)}</p>
        </div>
      )}

      <p className={`text-sm ${s.waived ? "text-gray-600 dark:text-gray-300" : s.started && s.totalPence != null ? `font-semibold ${STORAGE_TEXT}` : "text-gray-800 dark:text-gray-200"}`}>
        {s.words}
      </p>

      {figures && (
        // Two to a row while the card is half the page (lg — an iPad in landscape), four when there's room.
        <dl className={`grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-2 mt-3 text-sm ${s.waived ? "opacity-70" : ""}`}>
          <Figure term="Charged for">{s.period === "week" ? `${plural(s.units, "week")} (${plural(s.days, "day")})` : plural(s.days, "day")}</Figure>
          <Figure term="Lots still here">{s.lots ?? "—"}</Figure>
          <Figure term={s.vatPercent > 0 ? `VAT (${s.vatPercent}%)` : "VAT"}>{formatPence(s.fullVatPence)}</Figure>
          <Figure term={s.waived ? "Would be, inc VAT" : "Owed, inc VAT"}>
            {formatPence(s.fullTotalPence)}
            <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">{formatPence(s.fullExVatPence)} before VAT</span>
          </Figure>
        </dl>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
        {storageSettingsWords(settings)}. {whereFrom}{" "}
        It&apos;s charged on the lots still here today, for every day since the start — a lot collected part-way through isn&apos;t
        charged for the days it was here. The Hub never charges anything in BC — these figures are for raising the charge.
      </p>

      <form onSubmit={e => { e.preventDefault(); saveDay(day) }} className="mt-3">
        <label htmlFor={`storage-${c.id}`} className={label}>Charges start from</label>
        <div className="flex flex-wrap items-center gap-2">
          <input id={`storage-${c.id}`} type="date" value={day} onChange={e => setDay(e.target.value)} className={field} />
          <button type="submit" disabled={saving || !day || day === current} className={btnGo}>{saving ? "Saving…" : "Save date"}</button>
          {showReset && (
            <button type="button" disabled={saving} onClick={() => saveDay("")} className={btn}>{resetLabel}</button>
          )}
        </div>
        {c.source === "bc" && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {c.closedAt
              ? "The case is closed, so the BC check no longer changes it."
              : by === "person"
                ? `A person set this start, so the BC check leaves it alone — press ${resetLabel} ${differs ? "to hand it back to the storage rule" : "to let the check keep it in step with the paid date again"}.`
                : "The BC check keeps the start in step with the paid date. Change it only if the charges really started another day — the check then leaves it alone."}
          </p>
        )}
      </form>

      {/* Waive / charge again — confirmed underneath, so a stray tap on an iPad changes nothing. */}
      <div className="mt-4">
        {!asking ? (
          waiver ? (
            <button type="button" onClick={() => { setAsking("resume"); setNote(""); setMsg(null) }} disabled={saving} className={btn}>
              <span aria-hidden>💷</span> Charge storage again…
            </button>
          ) : (
            <button type="button" onClick={() => { setAsking("waive"); setNote(""); setMsg(null) }} disabled={saving} className={btn}>
              <span aria-hidden>🚫</span> Waive storage…
            </button>
          )
        ) : (
          <div className="rounded-xl border border-emerald-500/50 bg-emerald-50/60 dark:bg-emerald-500/5 p-4">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {asking === "waive" ? "Waive the storage charges on this case?" : "Charge storage on this case again?"}
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
              {asking === "waive"
                ? "Nothing is charged on it while it's waived, and it leaves the Storage owed tile. It can be charged again later — the figure carries on from the same start date."
                : "Its storage is worked out from its start date again, as if it had never been waived."}
            </p>
            <label className="block mt-3">
              <span className={label}>
                {asking === "waive" ? <>Why is it being waived? <span className="text-red-600 dark:text-red-400">*</span></> : "A note for the timeline (optional)"}
              </span>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                maxLength={STORAGE_LIMITS.reason}
                rows={2}
                placeholder={asking === "waive" ? "e.g. Agreed with Jordan — our delay, not theirs" : ""}
                className={input}
              />
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">Never type bank or card details here.</span>
            </label>
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" onClick={switchIt} disabled={saving || (asking === "waive" && !note.trim())} className={btnGo}>
                {saving ? "Saving…" : asking === "waive" ? "Waive storage" : "Charge storage again"}
              </button>
              <button type="button" onClick={() => setAsking(null)} disabled={saving} className={btn}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <Flash msg={msg} />
    </section>
  )
}

function Figure({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
      <dt className="text-xs text-gray-500 dark:text-gray-400">{term}</dt>
      <dd className="font-semibold tabular-nums text-gray-900 dark:text-white">{children}</dd>
    </div>
  )
}

// ─── Timeline ────────────────────────────────────────────────────────────────────────────────

function Timeline({ c }: { c: UncollectedCaseDetail }) {
  // The BC check's "Added" line (its long list of the lots) isn't shown on a case from BC (Jack,
  // 2026-10-23: "can you remove these bits") — Lots in BC shows the lots live, and the details say
  // where it came from and since when. Display only: the event stays in the table, where the check's
  // own rules read their lines.
  const events = c.source === "bc" ? c.events.filter(e => e.kind !== "created") : c.events
  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="timeline-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 id="timeline-title" className={cardTitle}>Timeline</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">Last contact: <LastContact last={c.lastContact} /></span>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Nothing on the timeline yet.</p>
      ) : (
        <ol className="space-y-3">
          {events.map(e => {
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
