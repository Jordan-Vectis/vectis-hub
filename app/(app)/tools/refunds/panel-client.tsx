"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from "react"
import { listRefunds, type RefundPanelItem, type RefundPanelList } from "@/lib/actions/refunds"
import {
  CLOSED_REFUND_STATUSES, OPEN_REFUND_STATUSES, REFUND_LIMITS, REFUND_PARTIES, REFUND_PARTY_LABELS, REFUND_REASONS,
  REFUND_REASON_LABELS, REFUND_SOLUTIONS, REFUND_SOLUTION_LABELS, REFUND_SORTS, REFUND_SORT_LABELS, REFUND_STATUSES,
  REFUND_STATUS_META, REFUNDS_PATH, formatPence, isRefundSort, refundFilterQuery, refundRefWords,
  type RefundFilter, type RefundStatus,
} from "@/lib/refunds"
import { formatDay } from "@/lib/uncollected"
import AddRequest from "./add-request"
import { AccountsMark, ColourKey, PartyBadge, SourceBadge, StatusChip, SuspectBadge } from "./bits"
import { downloadCsv, refundsCsv } from "./export"
import {
  Flash, Spinner, btn, btnGo, card, cardTitle, clearListNote, inlineLink, input, muted, parseListNote, plural, readListNote, td, th,
  type FlashMessage,
} from "./ui"

// The Refunds list: tiles, filters, the requests as a table on a wide screen (lg — an iPad in
// landscape too, no sideways scrolling) and as cards on a phone or an iPad in portrait, ＋ Add a
// request, and Export CSV of exactly what's shown.
//
// ⚠ Status, reason, buyer/vendor, solution, accounts, who's dealing with it and the order live in the
// address bar (the server page reads them — parseRefundFilter). The SEARCH never does: it is usually
// a customer's name or email, and an address ends up in the browser's history and the server's logs.
// The panel sends it to listRefunds itself (a POST — nothing in a URL) and keeps it in this tab's
// sessionStorage, so Back from a request returns to the same search (the Paid, not collected way).

const SEARCH_KEY = "refunds-search-v1"
/** How long after the last key the search runs. */
const SEARCH_WAIT_MS = 350

/** The search as the server reads it: trimmed, cut to the limit. */
const tidyQ = (s: string) => s.trim().slice(0, REFUND_LIMITS.search)

function readSearch(): string {
  try { return (sessionStorage.getItem(SEARCH_KEY) ?? "").slice(0, REFUND_LIMITS.search) } catch { return "" }
}
function writeSearch(q: string) {
  try {
    if (tidyQ(q)) sessionStorage.setItem(SEARCH_KEY, q)
    else sessionStorage.removeItem(SEARCH_KEY)
  } catch { /* a private window or blocked storage: the search just isn't remembered */ }
}
const noSubscribe = () => () => {}

const sameSet = (a: readonly RefundStatus[], b: readonly RefundStatus[]) => a.length === b.length && a.every(s => b.includes(s))

/** The status chips, in order. Each one's count is what picking it shows (the server counts with every
 *  other filter and the search applied, but not the status choice). */
const STATUS_CHOICES: { key: string; label: string; statuses: RefundStatus[]; help: string; dot?: string }[] = [
  { key: "all-open", label: "All open", statuses: [...OPEN_REFUND_STATUSES], help: "Everything not yet paid, declined or closed" },
  ...OPEN_REFUND_STATUSES.map(s => ({ key: s, label: REFUND_STATUS_META[s].short, statuses: [s], help: REFUND_STATUS_META[s].label, dot: REFUND_STATUS_META[s].dot })),
  ...CLOSED_REFUND_STATUSES.map(s => ({ key: s, label: REFUND_STATUS_META[s].short, statuses: [s], help: REFUND_STATUS_META[s].label, dot: REFUND_STATUS_META[s].dot })),
  { key: "all-closed", label: "All closed", statuses: [...CLOSED_REFUND_STATUSES], help: "Paid, declined and closed together" },
  { key: "all", label: "Everything", statuses: [...REFUND_STATUSES], help: "Open and closed together" },
]

const chipBase = "inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-full border text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-60"
const chipOff = "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-[#1C1C1E] hover:border-emerald-500/60"
const chipOn = "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-500/40"
const count = (n: number) => <span className="tabular-nums text-xs font-bold opacity-70">{n.toLocaleString("en-GB")}</span>

/** An answer to a search, and which filter, words and server list it was for. */
type Answer<T> = { key: string; src: RefundPanelList; value: T }

export default function RefundsPanel({ list }: { list: RefundPanelList }) {
  const router = useRouter()
  const [navigating, startTransition] = useTransition()
  const { filter, totals, more } = list
  /** The filter as the address has it — never the search. */
  const filterKey = refundFilterQuery(filter)
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

  // What a request's page left to be said here (a delete — ui.tsx leaveListNote), shown once.
  const storedNote = useSyncExternalStore(noSubscribe, readListNote, () => null)
  const [note, setNote] = useState<FlashMessage | null>(null)
  const [noteTaken, setNoteTaken] = useState(false)
  if (storedNote && !noteTaken) {
    setNoteTaken(true)
    setNote(parseListNote(storedNote))
  }
  useEffect(() => { if (noteTaken) clearListNote() }, [noteTaken])

  const tq = tidyQ(q)
  const want = `${filterKey}|${tq}`
  const [found, setFound] = useState<Answer<RefundPanelList> | null>(null)
  const [searchError, setSearchError] = useState<Answer<string> | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Searching: a moment after the last key — and again after a change of filter, or the list
  // refreshing after an add — ask the server for this filter AND these words. Only the newest answer
  // counts: an older one arriving late is dropped (`live`), and one for other words or another filter
  // is never shown as this one's (`key`, `src`).
  useEffect(() => {
    if (!tq) return
    let live = true
    const t = setTimeout(async () => {
      try {
        const res = await listRefunds({ ...filter, q: tq })
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
  // While a search is on its way the last answer stays up, dimmed (or the unsearched list, the first
  // time) — never an empty flash.
  const shown: RefundPanelList = searching ? (found?.value ?? list) : list
  const busy = navigating || (searching && !current(found) && !failed)
  /** What's on screen isn't the answer to what's asked (yet) — dimmed, and not exported. */
  const stale = busy || !!failed
  const items = shown.items

  /** Goes to the list with some of the filter changed. The search stays as it is. */
  function go(change: Partial<RefundFilter>) {
    startTransition(() => router.replace(`${REFUNDS_PATH}${refundFilterQuery({ ...filter, ...change })}`, { scroll: false }))
  }
  function setSearch(v: string) {
    const next = v.slice(0, REFUND_LIMITS.search)
    setQ(next)
    writeSearch(next)
  }
  function clearAll() {
    setSearch("")
    startTransition(() => router.replace(REFUNDS_PATH, { scroll: false }))
  }
  /** A tile: the requests it counts — every request, whatever the filters — so the list it opens
   *  matches its number. The other filters and the search are cleared; the order stays. */
  function showTile(change: Partial<RefundFilter>) {
    setSearch("")
    go({ reason: null, party: null, solution: null, accounts: null, dealt: null, ...change })
  }
  /** Accounts to do / done only means anything for paid requests — so picking one on a list that
   *  doesn't include Paid shows everything, rather than an empty list. */
  function pickAccounts(a: "todo" | "done" | null) {
    go(a && !filter.statuses.includes("paid") ? { accounts: a, statuses: [...REFUND_STATUSES] } : { accounts: a })
  }

  const isDefault = sameSet(filter.statuses, OPEN_REFUND_STATUSES) && !filter.reason && !filter.party && !filter.solution
    && !filter.accounts && !filter.dealt && !tq && filter.sort === "newest"
  const statusTotal = (sts: RefundStatus[]) => sts.reduce((n, s) => n + (shown.statusCounts[s] ?? 0), 0)
  const anyReason = Object.values(shown.reasonCounts).reduce((n, v) => n + v, 0)
  const dealers = filter.dealt && !shown.dealers.some(d => d.toLowerCase() === filter.dealt!.toLowerCase()) ? [filter.dealt, ...shown.dealers] : shown.dealers
  // Each request's address carries the filter (never the search), so its Back link returns to this list.
  const hrefFor = (id: string) => `${REFUNDS_PATH}/${id}${filterKey}`
  const month = new Date(`${list.today}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "Europe/London" })

  function exportCsv() {
    if (!items.length || stale) return
    downloadCsv(refundsCsv(items), `refunds-${list.today}.csv`)
  }

  return (
    <div>
      {note && <div className="-mt-3 mb-4"><Flash msg={note} /></div>}

      {/* ── Tiles: every request, whatever the filters ───────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 desk:grid-cols-7 gap-3">
        <Tile label="Open" value={totals.open} sub={totals.open ? "not paid, declined or closed" : "Nothing open"} onClick={() => showTile({ statuses: [...OPEN_REFUND_STATUSES] })} />
        <Tile label="New" value={totals.new} sub="nobody has picked them up" valueClass={totals.new ? "text-sky-700 dark:text-sky-300" : undefined} onClick={() => showTile({ statuses: ["new"] })} />
        <Tile label="Awaiting return" value={totals.awaitingReturn} sub="waiting for the item back" onClick={() => showTile({ statuses: ["awaiting_return"] })} />
        <Tile label="To pay" value={totals.toPay} sub="agreed — to be paid" valueClass={totals.toPay ? "text-orange-700 dark:text-orange-300" : undefined} onClick={() => showTile({ statuses: ["agreed"] })} />
        <Tile label="Paid, not complete for accounts" value={totals.accountsToDo} sub="not ticked complete for accounts" valueClass={totals.accountsToDo ? "text-amber-700 dark:text-amber-300" : undefined} onClick={() => showTile({ statuses: ["paid"], accounts: "todo" })} />
        <Tile
          label="Paid this month"
          text={more.paidThisMonth ? formatPence(totals.paidThisMonthPence) : "£0.00"}
          sub={more.paidThisMonth
            ? `${plural(more.paidThisMonth, "request")} processed in ${month}${more.paidThisMonthNoTotal ? ` · at least — ${more.paidThisMonthNoTotal} with no total yet` : ""}`
            : `Nothing processed in ${month} yet`}
        />
        <Tile
          label="Median days to pay"
          text={totals.medianDaysToPay == null ? "—" : `${totals.medianDaysToPay.toLocaleString("en-GB")} ${totals.medianDaysToPay === 1 ? "day" : "days"}`}
          sub={totals.medianDaysToPay == null ? "Nothing paid in the last 90 days" : `from coming in to paid — ${plural(more.medianOver, "request")} paid in the last 90 days`}
        />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
        The tiles count every request, whatever the filters below — tap one to list just those (it clears the other filters and the search).
        A total that can&apos;t be worked out yet — a lot with no hammer or % — counts as having none.
      </p>
      {more.suspectOpen > 0 && (
        <p role="status" className="mt-2 rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-4 py-2.5 text-sm">
          {plural(more.suspectOpen, "open request")} from the form {more.suspectOpen === 1 ? "looks" : "look"} like spam (marked <b>⚠ Check it&apos;s real</b>) — make
          sure {more.suspectOpen === 1 ? "it's" : "they're"} from a real customer before acting on {more.suspectOpen === 1 ? "it" : "them"}.
        </p>
      )}

      {/* ── Add / Export ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mt-5">
        <button type="button" onClick={() => setAdding(a => !a)} aria-expanded={adding} className={btnGo}>
          {adding ? "✕ Close the form" : "＋ Add a request"}
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!items.length || stale}
          className={btn}
          title={shown.truncated ? `Only the first ${REFUND_LIMITS.list} shown are exported — narrow the filters for the rest` : "The list exactly as shown, as a spreadsheet"}
        >
          ⬇ Export CSV{items.length ? ` (${items.length.toLocaleString("en-GB")})` : ""}
        </button>
      </div>
      {adding && <AddRequest onClose={() => setAdding(false)} hrefFor={hrefFor} />}

      {/* ── Filters ──────────────────────────────────────────────────────────────────── */}
      <div className={`${card} p-4 mt-5 space-y-4`}>
        <div>
          <p className={`${cardTitle} mb-2`}>Status</p>
          <div className="flex flex-wrap gap-2">
            {STATUS_CHOICES.map(ch => {
              const on = sameSet(filter.statuses, ch.statuses)
              return (
                <button key={ch.key} type="button" title={ch.help} aria-pressed={on} onClick={() => go({ statuses: ch.statuses })} className={`${chipBase} ${on ? chipOn : chipOff}`}>
                  {ch.dot && <span className={`h-2 w-2 rounded-full ${ch.dot}`} aria-hidden />}
                  {ch.label} {count(statusTotal(ch.statuses))}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <p className={`${cardTitle} mb-2`}>Reason</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!filter.reason} onClick={() => go({ reason: null })} className={`${chipBase} ${!filter.reason ? chipOn : chipOff}`}>
              Any reason {count(anyReason)}
            </button>
            {REFUND_REASONS.map(r => {
              const on = filter.reason === r
              return (
                <button key={r} type="button" aria-pressed={on} onClick={() => go({ reason: r })} className={`${chipBase} ${on ? chipOn : chipOff}`}>
                  {REFUND_REASON_LABELS[r]} {count(shown.reasonCounts[r] ?? 0)}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <ChipGroup title="Buyer or vendor">
            <Chip on={!filter.party} onClick={() => go({ party: null })}>Either</Chip>
            {REFUND_PARTIES.map(p => <Chip key={p} on={filter.party === p} onClick={() => go({ party: p })}>{REFUND_PARTY_LABELS[p]}</Chip>)}
          </ChipGroup>
          <ChipGroup title="Solution">
            <Chip on={!filter.solution} onClick={() => go({ solution: null })}>Any</Chip>
            {REFUND_SOLUTIONS.map(s => <Chip key={s} on={filter.solution === s} onClick={() => go({ solution: s })}>{REFUND_SOLUTION_LABELS[s]}</Chip>)}
          </ChipGroup>
          <ChipGroup title="Complete for accounts">
            <Chip on={!filter.accounts} onClick={() => pickAccounts(null)}>Any</Chip>
            <Chip on={filter.accounts === "todo"} onClick={() => pickAccounts("todo")} help="Paid, not ticked complete for accounts yet">To do</Chip>
            <Chip on={filter.accounts === "done"} onClick={() => pickAccounts("done")} help="Ticked complete for accounts">Done</Chip>
          </ChipGroup>
        </div>

        <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
          <label className="flex-1 min-w-0">
            <span className={`${cardTitle} block mb-2`}>Search</span>
            <input
              type="search"
              value={q}
              onChange={e => setSearch(e.target.value)}
              placeholder="Name, email, C-number, sale, lots, ref code or RF0042"
              className={input}
              autoComplete="off"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:contents">
            <label className="lg:w-56">
              <span className={`${cardTitle} block mb-2`}>Dealt with</span>
              <select value={filter.dealt ?? ""} onChange={e => go({ dealt: e.target.value || null })} className={input}>
                <option value="">Anyone</option>
                {dealers.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="lg:w-56">
              <span className={`${cardTitle} block mb-2`}>Order</span>
              <select value={filter.sort} onChange={e => { if (isRefundSort(e.target.value)) go({ sort: e.target.value }) }} className={input}>
                {REFUND_SORTS.map(s => <option key={s} value={s}>{REFUND_SORT_LABELS[s]}</option>)}
              </select>
            </label>
          </div>
          {!isDefault && <button type="button" onClick={clearAll} className={btn}>Clear filters</button>}
        </div>

        <ColourKey />
      </div>

      {/* ── The list ─────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-5 mb-2 min-h-11">
        <p className="text-sm text-gray-600 dark:text-gray-300" aria-live="polite">
          {busy ? (
            <span className="inline-flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <Spinner /> {searching && !navigating ? "Searching…" : "Updating the list…"}
            </span>
          ) : failed ? (
            <span className="text-red-700 dark:text-red-300">
              The search couldn&apos;t be run — {failed}{" "}
              <button type="button" onClick={() => { setSearchError(null); setAttempt(n => n + 1) }} className={`${inlineLink} text-red-700 dark:text-red-300`}>Try again</button>
            </span>
          ) : shown.truncated ? (
            <>Showing the first <b>{items.length.toLocaleString("en-GB")}</b> of <b>{shown.matched.toLocaleString("en-GB")}</b> — narrow the filters or search to see the rest.</>
          ) : (
            <>{plural(shown.matched, "request")}</>
          )}
        </p>
      </div>

      {items.length === 0 ? (
        <div className={`${card} px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400 ${stale ? "opacity-60" : ""}`}>
          {totals.open === 0 && isDefault ? (
            statusTotal(CLOSED_REFUND_STATUSES) > 0 ? (
              <>Nothing is open right now — {plural(statusTotal(CLOSED_REFUND_STATUSES), "request")} paid, declined or closed (see <b>Everything</b>).</>
            ) : (
              <>No refund requests yet. They arrive here from the public refund form (its address is above); press <b>＋ Add a request</b> for one sent another way, or import the old refund log below.</>
            )
          ) : (
            <>Nothing matches these filters.{" "}
              <button type="button" onClick={clearAll} className={`${inlineLink} text-emerald-600 dark:text-emerald-400 hover:text-emerald-500`}>Clear them</button>
            </>
          )}
        </div>
      ) : (
        <div className={stale ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {/* Wide screens (lg and up — an iPad in landscape too): eight columns that wrap rather than
              scroll sideways — the date sits under the reference, the C-number under the name, the
              total under the solution. */}
          <div className={`${card} hidden lg:block overflow-x-auto`}>
            <table className="w-full">
              <thead className="border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th className={`${th} text-left`}>Ref</th>
                  <th className={`${th} text-left`}>Customer</th>
                  <th className={`${th} text-left`}>Sale · lots</th>
                  <th className={`${th} text-left`}>Reason</th>
                  <th className={`${th} text-right`}>Solution · total</th>
                  <th className={`${th} text-left`}>Status</th>
                  <th className={`${th} text-left`}>Dealt with</th>
                  <th className={`${th} text-left`}>Accounts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {items.map(r => (
                  <tr
                    key={r.id}
                    onClick={e => {
                      // Let a link inside the row (or a ctrl/cmd-click) do its own thing.
                      if ((e.target as HTMLElement).closest("a") || e.metaKey || e.ctrlKey) return
                      router.push(hrefFor(r.id))
                    }}
                    className="cursor-pointer hover:bg-emerald-50/60 dark:hover:bg-emerald-500/5 transition-colors"
                  >
                    <td className={`${td} whitespace-nowrap`}>
                      <Link href={hrefFor(r.id)} prefetch={false} className="font-mono font-bold text-gray-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400">
                        {refundRefWords(r.ref)}
                      </Link>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{formatDay(r.receivedAt)}</div>
                      <DaysOpen r={r} />
                    </td>
                    <td className={`${td} min-w-0`}>
                      <div className="font-semibold text-gray-900 dark:text-white break-words">{r.name}</div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {r.customerNo ? <span className="font-mono">{r.customerNo}</span> : <span>No C-number</span>}
                        <PartyBadge party={r.party} />
                        {r.suspect && <SuspectBadge />}
                      </div>
                    </td>
                    <td className={td}>
                      <SaleLots r={r} />
                    </td>
                    <td className={td}>
                      <span className="break-words">{REFUND_REASON_LABELS[r.reason]}</span>
                      {r.photoCount > 0 && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5" title={plural(r.photoCount, "photo")}><span aria-hidden>📷</span> {r.photoCount}</div>}
                    </td>
                    <td className={`${td} text-right`}>
                      <div>{r.solution ? REFUND_SOLUTION_LABELS[r.solution] : <span className={muted}>—</span>}</div>
                      <Total pence={r.totalPence} />
                    </td>
                    <td className={td}><StatusChip status={r.status} /></td>
                    <td className={`${td} break-words`}>{r.dealtWithName ?? <span className={muted}>Nobody yet</span>}</td>
                    <td className={td}><AccountsMark status={r.status} doneAt={r.accountsDoneAt} doneBy={r.accountsDoneBy} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones and iPads in portrait: a card per request, two to a row from sm. */}
          <ul className="lg:hidden grid gap-2 sm:grid-cols-2">
            {items.map(r => (
              <li key={r.id} className="min-w-0">
                <Link href={hrefFor(r.id)} prefetch={false} className={`${card} block h-full p-4 hover:border-emerald-500/60 transition-colors`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 dark:text-gray-400"><span className="font-mono font-bold text-gray-900 dark:text-white">{refundRefWords(r.ref)}</span> · {formatDay(r.receivedAt)}</p>
                      <p className="font-semibold text-gray-900 dark:text-white truncate mt-0.5">{r.name}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {r.customerNo && <span className="font-mono">{r.customerNo}</span>}
                        <PartyBadge party={r.party} />
                        <SourceBadge source={r.source} />
                        {r.suspect && <SuspectBadge />}
                      </div>
                    </div>
                    <StatusChip status={r.status} />
                  </div>
                  <div className="mt-3 text-sm text-gray-800 dark:text-gray-200"><SaleLots r={r} /></div>
                  <dl className="grid grid-cols-2 gap-2 mt-3 text-sm">
                    <div className="min-w-0">
                      <dt className="text-xs text-gray-500 dark:text-gray-400">Reason</dt>
                      <dd className="text-gray-800 dark:text-gray-200 break-words">{REFUND_REASON_LABELS[r.reason]}{r.photoCount > 0 && <span className="text-xs text-gray-500 dark:text-gray-400"> · <span aria-hidden>📷</span> {r.photoCount}</span>}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-gray-500 dark:text-gray-400">{r.solution ? REFUND_SOLUTION_LABELS[r.solution] : "Solution not set"}</dt>
                      <dd><Total pence={r.totalPence} left /></dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-600 dark:text-gray-300">
                    <span>Dealt with: {r.dealtWithName ?? <span className={muted}>nobody yet</span>}</span>
                    <span className="inline-flex items-center gap-1.5">Accounts: <AccountsMark status={r.status} doneAt={r.accountsDoneAt} doneBy={r.accountsDoneBy} /></span>
                    <DaysOpen r={r} inline />
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

function SaleLots({ r }: { r: RefundPanelItem }) {
  return (
    <div className="min-w-0">
      {r.saleCode || r.auctionDate ? (
        <div>
          {r.saleCode && <span className="font-mono">{r.saleCode}</span>}
          {r.saleCode && r.auctionDate && " · "}
          {r.auctionDate && <span className="text-xs text-gray-500 dark:text-gray-400">{formatDay(`${r.auctionDate}T12:00:00Z`)}</span>}
        </div>
      ) : (
        <div className={muted}>No sale given</div>
      )}
      {r.lotsText && <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 line-clamp-2 break-words" title={r.lotsText}>Lots {r.lotsText}</div>}
    </div>
  )
}

/** The total to refund — "Not worked out" when there isn't a whole one yet: no amounts, or a lot that
 *  can't be worked out (refundTotalToSave never saves a short total). Never a calm £0.00. */
function Total({ pence, left = false }: { pence: number | null; left?: boolean }) {
  if (pence == null) return <span className={`text-xs ${muted} ${left ? "" : "block"}`}>Not worked out</span>
  return <span className={`font-semibold tabular-nums text-gray-900 dark:text-white ${left ? "" : "block"}`}>{formatPence(pence)}</span>
}

/** "12 days open" for an open request — how long it has waited; nothing once it's closed. */
function DaysOpen({ r, inline = false }: { r: RefundPanelItem; inline?: boolean }) {
  if (!OPEN_REFUND_STATUSES.includes(r.status)) return null
  const old = r.daysOpen > 14
  return (
    <span className={`${inline ? "" : "block mt-0.5"} text-xs ${old ? "font-semibold text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`} title={old ? "Open for more than two weeks" : undefined}>
      {plural(r.daysOpen, "day")} open
    </span>
  )
}

function Tile({ label, value, text, sub, valueClass, onClick }: {
  label: string; value?: number; text?: string; sub?: string; valueClass?: string; onClick?: () => void
}) {
  const body = (
    <>
      <span className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</span>
      {/* text-xl on a phone: two tiles to a row leaves ~130px, and "£12,345.67" must fit. */}
      <span className={`block text-xl sm:text-2xl font-bold tabular-nums mt-1 break-words ${valueClass ?? "text-gray-900 dark:text-white"}`}>
        {text ?? (value ?? 0).toLocaleString("en-GB")}
      </span>
      {sub && <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{sub}</span>}
    </>
  )
  if (!onClick) return <div className={`${card} p-4 min-w-0`}>{body}</div>
  return (
    <button type="button" onClick={onClick} className={`${card} p-4 min-w-0 text-left hover:border-emerald-500/60 transition-colors`}>
      {body}
    </button>
  )
}

function ChipGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className={`${cardTitle} mb-2`}>{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function Chip({ on, onClick, help, children }: { on: boolean; onClick: () => void; help?: string; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} title={help} onClick={onClick} className={`${chipBase} ${on ? chipOn : chipOff}`}>
      {children}
    </button>
  )
}
