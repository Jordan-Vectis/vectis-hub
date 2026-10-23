"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState, useSyncExternalStore, useTransition } from "react"
import { listCases } from "@/lib/actions/uncollected"
import {
  AGE_BANDS, CLOSED_STATUSES, OPEN_STATUSES, SORT_LABELS, STATUS_META, UNCOLLECTED_AFTER_DAYS, UNCOLLECTED_LIMITS, UNCOLLECTED_SORTS,
  UNCOLLECTED_STATUSES, ageBandFor, formatMoney, isUncollectedSort, uncollectedFilterQuery,
  STORAGE_SETTINGS_READ_FAILED, STORAGE_TEXT, formatPence,
  type AgeBandKey, type StorageTotals, type UncollectedFilter, type UncollectedList, type UncollectedStatus,
} from "@/lib/uncollected"
import AddBuyer from "./add-buyer"
import { ChaseDate, ColourKey, DaysWaiting, LastContact, PaidWhen, SourceBadge, StatusChip, StorageOwed } from "./bits"
import { casesCsv, downloadCsv } from "./export"
import { PANEL_PATH, btn, btnGo, card, cardTitle, inlineLink, input, plural, td, th } from "./ui"

// The Paid, not collected list: tiles, filters, the cases as a table on a wide screen and as cards
// on a phone or an iPad in portrait, Add a buyer, and Export CSV of exactly what's shown.
//
// ⚠ Status, age band and order live in the address bar (the server page reads them). The SEARCH
// never does: it is usually a customer's name or email, and an address ends up in the browser's
// history and the server's request logs. The panel sends it to listCases itself (a POST — nothing
// in a URL) and keeps it in this tab's sessionStorage, so Back from a case returns to the same search.

const SEARCH_KEY = "uncollected-search-v1"
/** How long after the last key the search runs. */
const SEARCH_WAIT_MS = 350

/** The search as the server reads it: trimmed, cut to the limit. */
const tidyQ = (s: string) => s.trim().slice(0, UNCOLLECTED_LIMITS.search)

function readSearch(): string {
  try { return (sessionStorage.getItem(SEARCH_KEY) ?? "").slice(0, UNCOLLECTED_LIMITS.search) } catch { return "" }
}
function writeSearch(q: string) {
  try {
    if (tidyQ(q)) sessionStorage.setItem(SEARCH_KEY, q)
    else sessionStorage.removeItem(SEARCH_KEY)
  } catch { /* a private window or blocked storage: the search just isn't remembered */ }
}
const noSubscribe = () => () => {}

const sameSet = (a: readonly UncollectedStatus[], b: readonly UncollectedStatus[]) =>
  a.length === b.length && a.every(s => b.includes(s))

/** The status chips, in order. Each one's count is what picking it shows (the server counts with
 *  the search and age band applied, but not the status choice). */
const STATUS_CHOICES: { key: string; label: string; statuses: UncollectedStatus[]; help: string; dot?: string }[] = [
  { key: "open", label: "All open", statuses: [...OPEN_STATUSES], help: "Every case that hasn't been collected or closed" },
  ...OPEN_STATUSES.map(s => ({ key: s, label: STATUS_META[s].short, statuses: [s], help: STATUS_META[s].label, dot: STATUS_META[s].dot })),
  ...CLOSED_STATUSES.map(s => ({ key: s, label: STATUS_META[s].short, statuses: [s], help: STATUS_META[s].label, dot: STATUS_META[s].dot })),
  { key: "all", label: "Everything", statuses: [...UNCOLLECTED_STATUSES], help: "Open and closed cases together" },
]

const chipBase = "inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-full border text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-60"
const chipOff = "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-[#1C1C1E] hover:border-emerald-500/60"
const chipOn = "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-500/40"

/** An answer to a search, and which filter, words and server list it was for. */
type Answer<T> = { key: string; src: UncollectedList; value: T }

export default function UncollectedPanel({ list }: { list: UncollectedList }) {
  const router = useRouter()
  const [navigating, startTransition] = useTransition()
  const { filter, totals } = list
  /** Storage owed on every open case (the tile), whatever the filters. */
  const owed = totals.storage
  /** Status, age band and order as the address has them — never the search. */
  const filterKey = uncollectedFilterQuery(filter)
  const [q, setQ] = useState("")
  const [adding, setAdding] = useState(false)

  // The last search in this tab, put back once the page is in the browser — never in the server's
  // render (it can't see sessionStorage), so the first paint matches it.
  const stored = useSyncExternalStore(noSubscribe, readSearch, () => null)
  const [restored, setRestored] = useState(false)
  if (stored !== null && !restored) {
    setRestored(true)
    if (stored) setQ(stored)
  }

  const tq = tidyQ(q)
  const want = `${filterKey}|${tq}`
  const [found, setFound] = useState<Answer<UncollectedList> | null>(null)
  const [searchError, setSearchError] = useState<Answer<string> | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Searching: a moment after the last key — and again after a change of filter, or the list
  // refreshing after an add — ask the server for this filter AND these words. Only the newest
  // answer counts: an older one arriving late is dropped (`live`), and one for other words or
  // another filter is never shown as this one's (`key`, `src`).
  useEffect(() => {
    if (!tq) return
    let live = true
    const t = setTimeout(async () => {
      try {
        const res = await listCases({ ...filter, q: tq })
        if (!live) return
        if (res.ok) { setFound({ key: want, src: list, value: res.data }); setSearchError(null) }
        else setSearchError({ key: want, src: list, value: res.error })
      } catch {
        if (live) setSearchError({ key: want, src: list, value: "The Hub didn't answer — check the connection and try again." })
      }
    }, SEARCH_WAIT_MS)
    return () => { live = false; clearTimeout(t) }
  }, [tq, want, filter, list, attempt])

  const current = (a: Answer<unknown> | null) => !!a && a.key === want && a.src === list
  const searching = !!tq
  const failed = searching && searchError && current(searchError) ? searchError.value : null
  // While a search is on its way the last answer stays up, dimmed (or the unsearched list, the
  // first time) — never an empty flash.
  const shown: UncollectedList = searching ? (found?.value ?? list) : list
  const busy = navigating || (searching && !current(found) && !failed)
  /** What's on screen isn't the answer to what's asked (yet) — dimmed, and not exported. */
  const stale = busy || !!failed
  const cases = shown.cases

  /** Goes to the list with some of status / age band / order changed. The search stays as it is. */
  function go(change: Partial<UncollectedFilter>) {
    startTransition(() => router.replace(`${PANEL_PATH}${uncollectedFilterQuery({ ...filter, ...change })}`, { scroll: false }))
  }
  function setSearch(v: string) {
    const next = v.slice(0, UNCOLLECTED_LIMITS.search)
    setQ(next)
    writeSearch(next)
  }
  function clearAll() {
    setSearch("")
    startTransition(() => router.replace(PANEL_PATH, { scroll: false }))
  }

  const isDefault = sameSet(filter.statuses, OPEN_STATUSES) && !filter.age && !tq && filter.sort === "waiting"
  const statusTotal = (sts: UncollectedStatus[]) => sts.reduce((n, s) => n + (shown.statusCounts[s] ?? 0), 0)
  const anyAge = Object.values(shown.ageCounts).reduce((n, v) => n + v, 0)
  // Each case's address carries the filter (never the search), so its Back link returns to this list.
  const caseHref = (id: string) => `${PANEL_PATH}/${id}${filterKey}`

  function exportCsv() {
    if (!cases.length || stale) return
    downloadCsv(casesCsv(cases), `paid-not-collected-${list.today}.csv`)
  }

  return (
    <div>
      {/* ── Tiles: every OPEN case, whatever the filters ─────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile label="Open cases" value={totals.open.toLocaleString("en-GB")} sub={totals.open === 0 ? "Nobody waiting" : "Paid, not collected yet"} />
        <Tile
          label="Lots waiting"
          value={totals.lots.toLocaleString("en-GB")}
          sub={totals.lotsUnknown ? `at least — ${plural(totals.lotsUnknown, "case")} with no lot count` : "on open cases"}
        />
        <Tile
          label="Money waiting"
          value={formatMoney(totals.money)}
          sub={totals.moneyUnknown ? `at least — ${plural(totals.moneyUnknown, "case")} with no amount` : "paid for lots still here"}
        />
        <Tile
          label="Oldest wait"
          value={totals.oldestDays == null ? "—" : plural(totals.oldestDays, "day")}
          valueClass={ageBandFor(totals.oldestDays)?.text}
          sub={totals.oldestDays == null ? "No paid dates yet" : "since they paid"}
        />
        <Tile
          label="Chases due"
          value={totals.chasesDue.toLocaleString("en-GB")}
          valueClass={totals.chasesDue ? "text-red-600 dark:text-red-400" : undefined}
          sub={totals.chasesDue ? `${totals.chasesOverdue} overdue · ${totals.chasesToday} today` : "Nothing due today"}
        />
        <Tile
          label="Storage owed"
          value={storageTileValue(owed)}
          valueClass={owed.totalPence > 0 ? STORAGE_TEXT : undefined}
          sub={storageTileWords(owed)}
        />
      </div>
      {list.storageSettings.readFailed && (
        <p role="alert" className="mt-2 rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-4 py-2.5 text-sm">
          {STORAGE_SETTINGS_READ_FAILED}
        </p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">The tiles count every open case, whatever the filters below.</p>
      {totals.unknownStatus > 0 && (
        <p role="status" className="mt-2 rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-4 py-2.5 text-sm">
          {plural(totals.unknownStatus, "case")} {totals.unknownStatus === 1 ? "has" : "have"} a status this panel doesn&apos;t know, so{" "}
          {totals.unknownStatus === 1 ? "it's" : "they're"} shown and counted as <b>Waiting</b>. Open {totals.unknownStatus === 1 ? "it" : "each one"} and pick the right status.
        </p>
      )}

      {/* ── Add a buyer / Export ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mt-5">
        <button type="button" onClick={() => setAdding(a => !a)} aria-expanded={adding} className={btnGo}>
          {adding ? "✕ Close the form" : "＋ Add a buyer"}
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!cases.length || stale}
          className={btn}
          title={shown.truncated ? `Only the first ${UNCOLLECTED_LIMITS.list} shown are exported — narrow the filters for the rest` : "The list exactly as shown, as a spreadsheet"}
        >
          ⬇ Export CSV{cases.length ? ` (${cases.length.toLocaleString("en-GB")})` : ""}
        </button>
      </div>
      {adding && <AddBuyer today={list.today} onClose={() => setAdding(false)} caseHrefFor={caseHref} />}

      {/* ── Filters ──────────────────────────────────────────────────────────────────── */}
      <div className={`${card} p-4 mt-5 space-y-4`}>
        <div>
          <p className={`${cardTitle} mb-2`}>Status</p>
          <div className="flex flex-wrap gap-2">
            {STATUS_CHOICES.map(ch => {
              const on = sameSet(filter.statuses, ch.statuses)
              return (
                <button
                  key={ch.key}
                  type="button"
                  title={ch.help}
                  aria-pressed={on}
                  onClick={() => go({ statuses: ch.statuses })}
                  className={`${chipBase} ${on ? chipOn : chipOff}`}
                >
                  {ch.dot && <span className={`h-2 w-2 rounded-full ${ch.dot}`} aria-hidden />}
                  {ch.label}
                  <span className="tabular-nums text-xs font-bold opacity-70">{statusTotal(ch.statuses).toLocaleString("en-GB")}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <p className={`${cardTitle} mb-2`}>Waiting for</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={!filter.age}
              onClick={() => go({ age: null })}
              className={`${chipBase} ${!filter.age ? chipOn : chipOff}`}
            >
              Any time <span className="tabular-nums text-xs font-bold opacity-70">{anyAge.toLocaleString("en-GB")}</span>
            </button>
            {AGE_BANDS.map(b => {
              const on = filter.age === b.key
              return (
                <button
                  key={b.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => go({ age: b.key as AgeBandKey })}
                  className={`${chipBase} ${on ? `${b.chip} ring-2 ring-emerald-500/60` : chipOff}`}
                >
                  {b.label} <span className="tabular-nums text-xs font-bold opacity-70">{shown.ageCounts[b.key].toLocaleString("en-GB")}</span>
                </button>
              )
            })}
          </div>
          {shown.ageCounts.none > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              {plural(shown.ageCounts.none, "case")} {shown.ageCounts.none === 1 ? "has" : "have"} no paid date, so {shown.ageCounts.none === 1 ? "it shows" : "they show"} under Any time only.
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <label className="flex-1 min-w-0">
            <span className={`${cardTitle} block mb-2`}>Search</span>
            <input
              type="search"
              value={q}
              onChange={e => setSearch(e.target.value)}
              placeholder="Name, buyer number, email, sale or invoice"
              className={input}
              autoComplete="off"
            />
          </label>
          <label className="sm:w-64">
            <span className={`${cardTitle} block mb-2`}>Order</span>
            <select
              value={filter.sort}
              onChange={e => { if (isUncollectedSort(e.target.value)) go({ sort: e.target.value }) }}
              className={input}
            >
              {UNCOLLECTED_SORTS.map(s => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
            </select>
          </label>
          {!isDefault && (
            <button type="button" onClick={clearAll} className={btn}>
              Clear filters
            </button>
          )}
        </div>

        <ColourKey />
      </div>

      {/* ── The list ─────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-5 mb-2 min-h-11">
        <p className="text-sm text-gray-600 dark:text-gray-300" aria-live="polite">
          {busy ? (
            <span className="inline-flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <span className="block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
              {searching && !navigating ? "Searching…" : "Updating the list…"}
            </span>
          ) : failed ? (
            <span className="text-red-700 dark:text-red-300">
              The search couldn&apos;t be run — {failed}{" "}
              <button type="button" onClick={() => { setSearchError(null); setAttempt(n => n + 1) }} className={`${inlineLink} text-red-700 dark:text-red-300`}>Try again</button>
            </span>
          ) : shown.truncated ? (
            <>Showing the first <b>{cases.length.toLocaleString("en-GB")}</b> of <b>{shown.matched.toLocaleString("en-GB")}</b> — narrow the filters or search to see the rest.</>
          ) : (
            <>{plural(shown.matched, "case")}</>
          )}
        </p>
      </div>

      {cases.length === 0 ? (
        <div className={`${card} px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400 ${stale ? "opacity-60" : ""}`}>
          {totals.open === 0 && isDefault ? (
            statusTotal(CLOSED_STATUSES) > 0 ? (
              <>Nobody is waiting right now — {plural(statusTotal(CLOSED_STATUSES), "case")} collected or closed (see <b>Everything</b>). The BC check adds anyone who qualifies; for anyone else, press <b>＋ Add a buyer</b>.</>
            ) : (
              <>Nobody is on the list yet. The BC check adds buyers whose paid lots are still here after {UNCOLLECTED_AFTER_DAYS} days — press <b>Check BC now</b> above, or <b>＋ Add a buyer</b> by hand.</>
            )
          ) : (
            <>Nothing matches these filters.{" "}
              <button type="button" onClick={clearAll} className={`${inlineLink} text-emerald-600 dark:text-emerald-400 hover:text-emerald-500`}>
                Clear them
              </button>
            </>
          )}
        </div>
      ) : (
        <div className={stale ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {/* Wide screens (lg and up — an iPad in landscape too): a table. Eight columns, so it fits
              without scrolling sideways: "paid on" sits under the amount, storage inc VAT under
              storage before VAT, the last contact under the next chase. */}
          <div className={`${card} hidden lg:block overflow-x-auto`}>
            <table className="w-full">
              <thead className="border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th className={`${th} text-left`}>Buyer</th>
                  <th className={`${th} text-left`}>Sale / invoice</th>
                  <th className={`${th} text-right`}>Lots</th>
                  <th className={`${th} text-right`}>Paid</th>
                  <th className={`${th} text-right`}>Storage owed</th>
                  <th className={`${th} text-left`}>Waiting</th>
                  <th className={`${th} text-left`}>Status</th>
                  <th className={`${th} text-left`}>Next chase · last contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {cases.map(c => (
                  <tr
                    key={c.id}
                    onClick={e => {
                      // Let a link inside the row (or a ctrl/cmd-click) do its own thing.
                      if ((e.target as HTMLElement).closest("a") || e.metaKey || e.ctrlKey) return
                      router.push(caseHref(c.id))
                    }}
                    className="cursor-pointer hover:bg-emerald-50/60 dark:hover:bg-emerald-500/5 transition-colors"
                  >
                    <td className={td}>
                      <Link href={caseHref(c.id)} prefetch={false} className="font-semibold text-gray-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 break-words">
                        {c.buyerName}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {c.buyerNo ? <span className="font-mono">{c.buyerNo}</span> : <span>No buyer number</span>}
                        <SourceBadge source={c.source} />
                      </div>
                    </td>
                    <td className={td}>
                      <div className="font-mono">{c.saleCode ?? "—"}</div>
                      {c.invoiceNo && <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{c.invoiceNo}</div>}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{c.lots ?? "—"}</td>
                    <td className={`${td} text-right tabular-nums whitespace-nowrap`}>
                      <div>{formatMoney(c.amountPaid)}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400"><PaidWhen source={c.source} paidAt={c.paidAt} exact={c.paidExact} /></div>
                    </td>
                    <td className={`${td} text-right`}><StorageOwed s={c.storage} /></td>
                    <td className={`${td} whitespace-nowrap`}><DaysWaiting days={c.daysWaiting} closed={!!c.closedAt} /></td>
                    <td className={td}><StatusChip status={c.status} /></td>
                    <td className={td}>
                      <div><ChaseDate at={c.nextChaseAt} chase={c.chase} /></div>
                      <div className="text-xs mt-0.5 text-gray-600 dark:text-gray-300">Last: <LastContact last={c.lastContact} compact /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones and iPads in portrait: a card per buyer, two to a row from sm. */}
          <ul className="lg:hidden grid gap-2 sm:grid-cols-2">
            {cases.map(c => (
              <li key={c.id} className="min-w-0">
                <Link href={caseHref(c.id)} prefetch={false} className={`${card} block h-full p-4 hover:border-emerald-500/60 transition-colors`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-white truncate">{c.buyerName}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-words">
                        {c.buyerNo ? <span className="font-mono">{c.buyerNo}</span> : "No buyer number"}
                        {(c.saleCode || c.invoiceNo) && <> · <span className="font-mono">{[c.saleCode, c.invoiceNo].filter(Boolean).join(" / ")}</span></>}
                      </p>
                    </div>
                    <StatusChip status={c.status} />
                  </div>
                  <dl className="grid grid-cols-3 gap-2 mt-3 text-sm">
                    <div><dt className="text-xs text-gray-500 dark:text-gray-400">Waiting</dt><dd><DaysWaiting days={c.daysWaiting} closed={!!c.closedAt} /></dd></div>
                    <div><dt className="text-xs text-gray-500 dark:text-gray-400">Paid</dt><dd className="tabular-nums text-gray-800 dark:text-gray-200">{formatMoney(c.amountPaid)}</dd></div>
                    <div><dt className="text-xs text-gray-500 dark:text-gray-400">Lots</dt><dd className="tabular-nums text-gray-800 dark:text-gray-200">{c.lots ?? "—"}</dd></div>
                  </dl>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-600 dark:text-gray-300">
                    <SourceBadge source={c.source} />
                    <PaidWhen source={c.source} paidAt={c.paidAt} exact={c.paidExact} />
                  </div>
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Storage owed: <StorageOwed s={c.storage} inline /></p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-600 dark:text-gray-300">
                    <span>Next chase: <ChaseDate at={c.nextChaseAt} chase={c.chase} /></span>
                    <span>Last contact: <LastContact last={c.lastContact} compact /></span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** The Storage owed tile's figure. "—" when cases ARE being charged but none of them can be added up
 *  (every one has no lot count) — never a calm £0.00 that means "couldn't tell" (design rule 7). */
function storageTileValue(t: StorageTotals): string {
  return !t.charging && t.lotsUnknown ? "—" : formatPence(t.totalPence)
}

/** Under the Storage owed tile: "inc VAT — £180.00 + VAT on 3 cases · 1 waived · at least — 2 with no
 *  lot count". Cases with no lot count or no paid date can't be added in, so the figure is a minimum.
 *  "No open case is being charged yet" only when nothing is being charged, waived or left uncounted. */
function storageTileWords(t: StorageTotals): string {
  const n = (k: number) => k.toLocaleString("en-GB")
  const waived = t.waived ? `${n(t.waived)} waived` : null
  const noStart = t.noStart ? `${n(t.noStart)} with no paid date to count from` : null
  if (!t.charging) {
    if (t.lotsUnknown) {
      return [`${plural(t.lotsUnknown, "case")} being charged — no lot count, so no total yet`, waived, noStart].filter(Boolean).join(" · ")
    }
    if (t.waived) return [`Nothing owed — ${plural(t.waived, "case")} waived`, noStart].filter(Boolean).join(" · ")
    return [noStart ? "Nothing owed on the cases it can count" : "No open case is being charged yet", noStart].filter(Boolean).join(" · ")
  }
  const missing = t.lotsUnknown + t.noStart
  const parts = [
    t.vatPence > 0
      ? `inc VAT — ${formatPence(t.exVatPence)} + VAT on ${plural(t.charging, "case")}`
      : `on ${plural(t.charging, "case")} (no VAT)`,
    waived,
    missing
      ? `at least — ${[
          t.lotsUnknown ? `${n(t.lotsUnknown)} with no lot count` : null,
          t.noStart ? `${n(t.noStart)} with no paid date` : null,
        ].filter(Boolean).join(", ")}`
      : null,
  ]
  return parts.filter(Boolean).join(" · ")
}

function Tile({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className={`${card} p-4 min-w-0`}>
      <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
      {/* text-xl on a phone: two tiles to a row leaves ~130px, and "£123,456.78" must fit. */}
      <p className={`text-xl sm:text-2xl font-bold tabular-nums mt-1 break-words ${valueClass ?? "text-gray-900 dark:text-white"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}
