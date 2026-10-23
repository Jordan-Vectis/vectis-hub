"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { bcLotsForCase, closeCollectedFromBc } from "@/lib/actions/uncollected"
import {
  GONE_LOCATIONS, QUERY_LOCATIONS, bcConnectHref, formatDateTime, formatDay, formatMoney, isGoneState, locationListWords, queryLotWords,
  type UncollectedBcLot, type UncollectedBcLots, type UncollectedCaseDetail,
} from "@/lib/uncollected"
import { NO_ANSWER, PANEL_PATH, btn, btnGo, card, cardTitle, inlineLink, muted, plural, td, th } from "../ui"

// The case's lots, read LIVE from BC when the case is opened — the simplest honest option: no copy
// kept in the Hub to go stale, and the notes stay the staff's. A read of BC's auction lines with
// the admin's own BC sign-in (bcLotsForCase): every lot BC shows as sold to this buyer in this sale
// (each of its sales, when one invoice covered several — each lot then says its sale),
// collected and not — lots to check first, then not collected. A case from BC reads them as it
// opens; a case added by hand (with a buyer number and sale) on a press, so opening it never asks
// BC unasked. Read only.
//
// Each lot's LOCATION is read live too (Jack, 2026-10-23: "can you also add the location in here
// please"), and the Collected? chip follows the same rule as the BC check (lotState in
// lib/uncollected.ts): "Collected" when BC ticked it OR its location is a GONE one ("by location"
// when only the location says so — the docket was never posted), "⚠ Check this lot" at a QUERY
// location, "Not collected" otherwise. The headline count follows the same rule.
//
// When every lot reads as collected and the case is still open, a green box offers "Close as
// collected" (Jack, 2026-10-23: "things are scanned as collected and still showing"). It doesn't
// trust this read: closeCollectedFromBc reads BC again on the server and closes the case only if
// every lot has still gone, the same way the BC check closes one (closed on the last check's day).

type Shown =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; text: string; connect: boolean }
  | { kind: "done"; data: UncollectedBcLots }

export default function BcLots({ c }: { c: UncollectedCaseDetail }) {
  const canAsk = !!c.buyerNo && !!c.saleCode
  const auto = canAsk && c.source === "bc"
  const [shown, setShown] = useState<Shown>(auto ? { kind: "loading" } : { kind: "idle" })

  async function read(): Promise<Shown> {
    try {
      const res = await bcLotsForCase(c.id)
      return res.ok ? { kind: "done", data: res.data } : { kind: "error", text: res.error, connect: !!res.needsBc }
    } catch {
      return { kind: "error", text: "The Hub didn't answer — check the connection and try again.", connect: false }
    }
  }

  // A case from BC: its lots as it opens.
  useEffect(() => {
    if (!auto) return
    let live = true
    read().then(s => { if (live) setShown(s) })
    return () => { live = false }
    // Once per case: `read` only uses the case id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, c.id])

  function again() {
    if (shown.kind === "loading") return
    setShown({ kind: "loading" })
    read().then(setShown)
  }

  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="bc-lots-title">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 id="bc-lots-title" className={cardTitle}>Lots in BC</h2>
        {canAsk && shown.kind !== "idle" && (
          <button type="button" onClick={again} disabled={shown.kind === "loading"} className={btn}>
            {shown.kind === "loading" ? "Reading BC…" : "Read again"}
          </button>
        )}
      </div>

      {!canAsk ? (
        <p className={`text-sm ${muted}`}>
          Add the buyer number and the sale to this case to look up their lots in BC.
        </p>
      ) : shown.kind === "idle" ? (
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            See every lot BC shows as bought by <span className="font-mono">{c.buyerNo}</span> in <span className="font-mono">{c.saleCode}</span>, and which are still here.
          </p>
          <button type="button" onClick={again} className={`${btn} mt-3`}>Look up their lots in BC</button>
        </div>
      ) : shown.kind === "loading" ? (
        <p className="text-sm text-gray-600 dark:text-gray-300 inline-flex items-center gap-2" role="status">
          <span className="block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
          Reading their lots from BC…
        </p>
      ) : shown.kind === "error" ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {shown.text}
          {shown.connect && <> <a href={bcConnectHref(`${PANEL_PATH}/${c.id}`)} className={inlineLink}>Sign in to BC →</a></>}
        </p>
      ) : (
        <LotList data={shown.data} close={!c.closedAt && <CloseCollected caseId={c.id} />} />
      )}
    </section>
  )
}

/** "Close as collected" — shown only when the list reads all collected and the case is open. */
function CloseCollected({ caseId }: { caseId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; connect: boolean } | null>(null)

  async function close() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await closeCollectedFromBc(caseId)
      if (!res.ok) { setError({ text: res.error, connect: !!res.needsBc }); setBusy(false); return }
      router.refresh()   // the page shows it closed; keep the button down until it does
    } catch {
      setError({ text: NO_ANSWER, connect: false })
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3">
      <p className="text-sm text-emerald-900 dark:text-emerald-200">
        <b>BC shows every lot on this case collected</b>, so it shouldn&apos;t be on the list. The BC check closes cases like
        this by itself, or you can close it now.
      </p>
      <button type="button" onClick={close} disabled={busy} className={`${btnGo} mt-2`}>
        {busy ? "Checking BC and closing…" : "✓ Close as collected"}
      </button>
      <p className={`text-xs ${muted} mt-1.5`}>
        BC is read again first, and the case closes only if every lot has still gone. It closes on the day of the last BC
        check, so storage stops then, the same as when the check closes it.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300 mt-2">
          {error.text}
          {error.connect && <> <a href={bcConnectHref(`${PANEL_PATH}/${caseId}`)} className={inlineLink}>Sign in to BC →</a></>}
        </p>
      )}
    </div>
  )
}

const chip = "inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
const GREEN = "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30"
const AMBER = "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30"
/** "Check this lot": amber like a warning, but OUTLINED with ⚠ so it never reads as "Not collected". */
const CHECK = "bg-white text-amber-800 border-amber-500 ring-1 ring-amber-500 dark:bg-transparent dark:text-amber-300 dark:border-amber-400 dark:ring-amber-400"

/** The Collected? chip — the BC check's own rule (lotState): green "Collected" when BC ticked it or
 *  it's at a GONE location ("by location" under it when only the location says so), amber outlined
 *  "⚠ Check this lot" at a QUERY location, amber "Not collected" otherwise. The key is under the list. */
function CollectedChip({ lot }: { lot: UncollectedBcLot }) {
  if (isGoneState(lot.state)) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className={`${chip} ${GREEN}`}>Collected</span>
        {lot.state === "gone" && (
          <span className={`text-xs ${muted}`} title={`BC hasn't ticked it collected, but has it at ${lot.location} — its collection docket wasn't posted.`}>
            by location
          </span>
        )}
      </span>
    )
  }
  if (lot.state === "query") {
    return <span className={`${chip} ${CHECK}`} title={`BC has it at ${lot.location} — check it before chasing. It isn't charged or counted in this case's lots.`}>⚠ Check this lot</span>
  }
  return <span className={`${chip} ${AMBER}`}>Not collected</span>
}

/** Where BC has the lot now: its location code (and bin), "—" for none, "Not read" when its receipt
 *  line couldn't be read (the Collected tick alone decides then). */
function LocationCell({ lot }: { lot: UncollectedBcLot }) {
  if (!lot.locationRead) {
    return <span className={`text-xs ${muted}`} title="Its receipt line couldn't be read in BC, so BC's Collected tick alone decides">Not read</span>
  }
  if (!lot.location) return <span className={muted} title="BC has no location for it">—</span>
  return (
    <div>
      <div className="font-mono font-semibold">{lot.location}</div>
      {lot.bin && <div className={`text-xs font-mono ${muted}`}>Bin {lot.bin}</div>}
    </div>
  )
}

function LotList({ data, close }: { data: UncollectedBcLots; close: ReactNode }) {
  const { lots } = data
  const waiting = lots.filter(l => l.state === "here")
  const toCheck = lots.filter(l => l.state === "query")
  const gone = lots.filter(l => isGoneState(l.state)).length
  const byLocation = lots.filter(l => l.state === "gone").length
  // One invoice can cover lots from more than one sale ("F067, F068"): then each lot says its sale.
  const multi = data.sales.length > 1 || new Set(lots.map(l => l.saleCode ?? "")).size > 1
  const first = lots[0]
  const sale = multi
    ? `sales ${data.saleCode}`
    : first ? [first.saleCode ?? data.saleCode, first.saleName, first.saleDate ? formatDay(`${first.saleDate}T12:00:00Z`) : null].filter(Boolean).join(" · ") : data.saleCode
  const leftOut = data.salesLeftOut > 0 && (
    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
      This case covers {plural(data.salesLeftOut, "more sale")} that {data.salesLeftOut === 1 ? "wasn't" : "weren't"} read here — look {data.salesLeftOut === 1 ? "it" : "them"} up
      in BC before closing it.
    </p>
  )
  const unread = data.locationsUnread > 0 && (
    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
      Where {plural(data.locationsUnread, "lot")} {data.locationsUnread === 1 ? "is" : "are"} couldn&apos;t be read{data.locationError ? ` (${data.locationError})` : ""} —
      {data.locationsUnread === 1 ? " its" : " their"} Collected? is BC&apos;s Collected tick alone.
    </p>
  )

  if (!lots.length) {
    return (
      <div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          BC shows no lots sold to <span className="font-mono">{data.buyerNo}</span> in <span className="font-mono">{data.saleCode}</span> — check the
          buyer number and sale on this case. <span className={muted}>Read from BC {formatDateTime(data.readAt)}.</span>
        </p>
        {leftOut}
      </div>
    )
  }

  // "— 2 not collected, 1 to check, 3 collected." / "— all collected." (the same rule as the BC check)
  const parts: { key: string; node: ReactNode }[] = []
  if (waiting.length) parts.push({ key: "here", node: <b className="text-amber-700 dark:text-amber-300">{waiting.length} not collected</b> })
  if (toCheck.length) parts.push({ key: "query", node: <b className="text-amber-700 dark:text-amber-300">{toCheck.length} to check</b> })
  if (!waiting.length && !toCheck.length) parts.push({ key: "all", node: <b className="text-emerald-700 dark:text-emerald-300">all collected</b> })
  else if (gone) parts.push({ key: "gone", node: <>{gone} collected</> })

  return (
    <div>
      <p className="text-sm text-gray-700 dark:text-gray-200">
        <b>{plural(lots.length, "lot")}</b> bought by <span className="font-mono">{data.buyerNo}</span> in {sale}
        {" — "}
        {parts.map((p, i) => <span key={p.key}>{i > 0 && ", "}{p.node}</span>)}.
      </p>
      <p className={`text-xs ${muted} mt-0.5`}>
        Read live from BC {formatDateTime(data.readAt)}{data.more ? ` — only the first ${lots.length} are listed` : ""}.
        {byLocation > 0 && <> {plural(byLocation, "lot")} {byLocation === 1 ? "counts" : "count"} as collected by {byLocation === 1 ? "its" : "their"} location only — BC hasn&apos;t ticked {byLocation === 1 ? "it" : "them"}, as the collection docket wasn&apos;t posted.</>}
      </p>
      {leftOut}
      {unread}
      {/* Every lot gone, the whole list read, every sale of the case read: offer to close it. */}
      {!waiting.length && !toCheck.length && !data.more && data.salesLeftOut === 0 && close}

      {toCheck.length > 0 && (
        <div role="status" className="mt-3 rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-4 py-2.5 text-sm">
          <ul className="space-y-0.5">
            {toCheck.map((l, i) => (
              <li key={l.uniqueId ?? `${l.saleCode}-${l.lotNo}-${i}`}>
                ⚠ {queryLotWords({ lotNo: l.lotNo, saleCode: l.saleCode, location: l.location ?? "" }, multi)}.
              </li>
            ))}
          </ul>
          <p className="text-xs mt-1">
            {toCheck.length === 1 ? "It isn't" : "They aren't"} charged, and {toCheck.length === 1 ? "isn't" : "aren't"} counted in this case&apos;s lots,
            while {toCheck.length === 1 ? "it's" : "they're"} there.
          </p>
        </div>
      )}

      {/* A phone (below sm): one stacked row per lot — the table would need sideways scrolling. */}
      <ul className="sm:hidden mt-3 divide-y divide-gray-100 dark:divide-gray-800">
        {lots.map((l, i) => (
          <li key={l.uniqueId ?? `${l.saleCode}-${l.lotNo}-${i}`} className={`py-3 ${isGoneState(l.state) ? "opacity-70" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono font-semibold">{multi && l.saleCode ? `${l.saleCode} · ` : ""}Lot {l.lotNo}</span>
                {l.uniqueId && <span className={`ml-2 text-xs font-mono ${muted}`}>{l.uniqueId}</span>}
              </div>
              <CollectedChip lot={l} />
            </div>
            <div className="mt-1 flex items-start justify-between gap-3 text-sm">
              <p className="min-w-0 break-words text-gray-800 dark:text-gray-200">{l.description ?? <span className={muted}>No description in BC</span>}</p>
              <p className="shrink-0 tabular-nums text-gray-700 dark:text-gray-300"><span className={`text-xs ${muted}`}>Hammer</span> {formatMoney(l.hammer)}</p>
            </div>
            <div className="mt-1 flex items-baseline gap-2 text-sm">
              <span className={`text-xs ${muted}`}>Location</span>
              {!l.locationRead
                ? <span className={`text-xs ${muted}`}>Not read</span>
                : l.location
                  ? <span className="font-mono font-semibold">{l.location}{l.bin && <span className={`ml-2 text-xs font-normal ${muted}`}>Bin {l.bin}</span>}</span>
                  : <span className={muted}>—</span>}
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden sm:block mt-3 overflow-x-auto -mx-1">
        <table className="w-full">
          <thead className="border-b border-gray-200 dark:border-gray-800">
            <tr>
              {multi && <th className={`${th} text-left`}>Sale</th>}
              <th className={`${th} text-left`}>Lot</th>
              <th className={`${th} text-left`}>Description</th>
              <th className={`${th} text-right`}>Hammer</th>
              <th className={`${th} text-left`}>Location</th>
              <th className={`${th} text-left`}>Collected?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {lots.map((l, i) => (
              <tr key={l.uniqueId ?? `${l.saleCode}-${l.lotNo}-${i}`} className={isGoneState(l.state) ? "opacity-70" : undefined}>
                {multi && <td className={`${td} whitespace-nowrap font-mono`}>{l.saleCode ?? "—"}</td>}
                <td className={`${td} whitespace-nowrap`}>
                  <div className="font-mono font-semibold">{l.lotNo}</div>
                  {l.uniqueId && <div className={`text-xs font-mono ${muted}`}>{l.uniqueId}</div>}
                </td>
                <td className={`${td} break-words min-w-[10rem]`}>{l.description ?? <span className={muted}>No description in BC</span>}</td>
                <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{formatMoney(l.hammer)}</td>
                <td className={`${td} whitespace-nowrap`}><LocationCell lot={l} /></td>
                <td className={`${td} whitespace-nowrap`}><CollectedChip lot={l} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* The key (design rule 3): what each chip means. */}
      <p className={`text-xs ${muted} mt-2`}>
        <b>Collected</b> — BC ticked it collected, or has it at {locationListWords(GONE_LOCATIONS)} (<i>by location</i> when only the location
        says so: the collection docket wasn&apos;t posted). <b>⚠ Check this lot</b> — at {locationListWords(QUERY_LOCATIONS)}: not charged, or
        counted in the case&apos;s lots. <b>Not collected</b> — still here. Location is where BC has the lot now (its receipt line).
      </p>
      <p className={`text-xs ${muted} mt-1`}>
        Every lot BC shows as sold to them in {multi ? "these sales" : "this sale"} (hammer over £0, not withdrawn). If they bought on more
        than one invoice in {multi ? "them" : "the sale"}, those lots are listed here too.
      </p>
    </div>
  )
}
