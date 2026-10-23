"use client"

import { useEffect, useState } from "react"
import { bcLotsForCase } from "@/lib/actions/uncollected"
import { bcConnectHref, formatDateTime, formatDay, formatMoney, type UncollectedBcLots, type UncollectedCaseDetail } from "@/lib/uncollected"
import { PANEL_PATH, btn, card, cardTitle, inlineLink, muted, plural, td, th } from "../ui"

// The case's lots, read LIVE from BC when the case is opened — the simplest honest option: no copy
// kept in the Hub to go stale, and the notes stay the staff's. A read of BC's auction lines with
// the admin's own BC sign-in (bcLotsForCase): every lot BC shows as sold to this buyer in this sale
// (each of its sales, when one invoice covered several — each lot then says its sale),
// collected and not, not-collected first. A case from BC reads them as it opens; a case added by
// hand (with a buyer number and sale) on a press, so opening it never asks BC unasked. Read only.

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
        <LotList data={shown.data} />
      )}
    </section>
  )
}

function CollectedChip({ collected }: { collected: boolean }) {
  return collected ? (
    <span className="inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30">Collected</span>
  ) : (
    <span className="inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30">Not collected</span>
  )
}

function LotList({ data }: { data: UncollectedBcLots }) {
  const { lots } = data
  const waiting = lots.filter(l => !l.collected)
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

  return (
    <div>
      <p className="text-sm text-gray-700 dark:text-gray-200">
        <b>{plural(lots.length, "lot")}</b> bought by <span className="font-mono">{data.buyerNo}</span> in {sale}
        {" — "}
        {waiting.length
          ? <b className="text-amber-700 dark:text-amber-300">{waiting.length} not collected</b>
          : <b className="text-emerald-700 dark:text-emerald-300">all collected</b>}
        {waiting.length > 0 && waiting.length < lots.length && <>, {lots.length - waiting.length} collected</>}.
      </p>
      <p className={`text-xs ${muted} mt-0.5`}>
        Read live from BC {formatDateTime(data.readAt)}{data.more ? ` — only the first ${lots.length} are listed` : ""}.
      </p>
      {leftOut}

      {/* A phone (below sm): one stacked row per lot — the table would need sideways scrolling. */}
      <ul className="sm:hidden mt-3 divide-y divide-gray-100 dark:divide-gray-800">
        {lots.map((l, i) => (
          <li key={l.uniqueId ?? `${l.saleCode}-${l.lotNo}-${i}`} className={`py-3 ${l.collected ? "opacity-70" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono font-semibold">{multi && l.saleCode ? `${l.saleCode} · ` : ""}Lot {l.lotNo}</span>
                {l.uniqueId && <span className={`ml-2 text-xs font-mono ${muted}`}>{l.uniqueId}</span>}
              </div>
              <CollectedChip collected={l.collected} />
            </div>
            <div className="mt-1 flex items-start justify-between gap-3 text-sm">
              <p className="min-w-0 break-words text-gray-800 dark:text-gray-200">{l.description ?? <span className={muted}>No description in BC</span>}</p>
              <p className="shrink-0 tabular-nums text-gray-700 dark:text-gray-300"><span className={`text-xs ${muted}`}>Hammer</span> {formatMoney(l.hammer)}</p>
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
              <th className={`${th} text-left`}>Collected?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {lots.map((l, i) => (
              <tr key={l.uniqueId ?? `${l.saleCode}-${l.lotNo}-${i}`} className={l.collected ? "opacity-70" : undefined}>
                {multi && <td className={`${td} whitespace-nowrap font-mono`}>{l.saleCode ?? "—"}</td>}
                <td className={`${td} whitespace-nowrap`}>
                  <div className="font-mono font-semibold">{l.lotNo}</div>
                  {l.uniqueId && <div className={`text-xs font-mono ${muted}`}>{l.uniqueId}</div>}
                </td>
                <td className={`${td} break-words min-w-[10rem]`}>{l.description ?? <span className={muted}>No description in BC</span>}</td>
                <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{formatMoney(l.hammer)}</td>
                <td className={`${td} whitespace-nowrap`}><CollectedChip collected={l.collected} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`text-xs ${muted} mt-2`}>
        Every lot BC shows as sold to them in {multi ? "these sales" : "this sale"} (hammer over £0, not withdrawn). If they bought on more
        than one invoice in {multi ? "them" : "the sale"}, those lots are listed here too.
      </p>
    </div>
  )
}
