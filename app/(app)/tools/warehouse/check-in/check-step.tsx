"use client"

import type { ReactNode } from "react"
import type { CustomerRow } from "@/lib/actions/goods-in"
import type { ReceiptTerms } from "@/lib/goods-in/model"
import { KindBadge, box, btn, mono, td, th } from "../_components/ui"
import CustomerCard from "./customer-card"
import { Declaration, NotesField, TermsEditor } from "./terms-step"
import {
  TERM_FIELDS, countKinds, customerTerm, isBlankRow, isPrinted, kindsPhrase, labelState, listNumbers, parseTerms, rowNumber, sameTerms, termsLine,
  usualTerms,
  type GoodsRow, type TermsDraft,
} from "./shared"

// Step 3 — one look at everything before it is booked in: the customer, every tote and pallet with
// its number, the terms, the notes and the customer's declaration. The customer and the goods have
// a Change button back to their step.
//
// The terms are NOT a question (Jack, 2026-10-16): they are the customer's usual terms (the
// standard terms where they have none), shown as one plain line, with a small "Change for this
// receipt" that opens the fields here. An unusual value is never questioned; only an entry that
// can't be used is marked, and only once the fields are open. Problems that don't stop a booking
// (a blank row) are said plainly so they're a choice, not a surprise. The Book in button itself
// sits in the bar at the bottom of the page.

function Part({ title, step, goTo, children, className = "" }: { title: string; step?: number; goTo: (i: number) => void; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">{title}</h3>
        {step != null && (
          <button type="button" className={`${btn} !px-3`} onClick={() => goTo(step)} aria-label={`Change ${title.split(" — ")[0].toLowerCase()}`}>Change</button>
        )}
      </div>
      {children}
    </div>
  )
}

const Amber = ({ children }: { children: ReactNode }) => (
  <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">{children}</div>
)

export default function CheckStep({
  customer, rows, terms, setTerm, onResetTerms, termsOpen, setTermsOpen, notes, setNotes, owner, setOwner, agent, setAgent,
  vendorSeries, receiptId, numbering, status, goTo, onRemoveBlank, error, printedAs,
}: {
  customer: CustomerRow
  rows: GoodsRow[]
  terms: TermsDraft
  setTerm: (k: keyof ReceiptTerms, v: string) => void
  onResetTerms: () => void
  /** The terms fields are open ("Change for this receipt"). */
  termsOpen: boolean
  setTermsOpen: (v: boolean) => void
  notes: string
  setNotes: (v: string) => void
  owner: boolean
  setOwner: (v: boolean) => void
  agent: boolean
  setAgent: (v: boolean) => void
  vendorSeries: boolean | null
  receiptId: string | null
  numbering: boolean
  /** "Saved" / "Saving…" / "Not saved — …" with Retry. */
  status: ReactNode
  goTo: (i: number) => void
  onRemoveBlank: () => void
  /** The reason the last Book in failed, shown at the top of the step. */
  error: ReactNode
  /** What each row's label said when it was printed, by row key. */
  printedAs: Readonly<Record<string, string>>
}) {
  const { totes, pallets } = countKinds(rows)
  const usual = usualTerms(customer)
  const parsed = parseTerms(terms).terms
  const changed = !sameTerms(terms, usual)
  const hasOwn = TERM_FIELDS.some(f => customerTerm(customer, f.key) != null)
  // A term that can't be used keeps the fields open — it is only ever marked there.
  const showEditor = termsOpen || !parsed

  const blank = rows.map((r, i) => ({ r, i })).filter(({ r }) => isBlankRow(r))
  const blankNames = blank.map(({ r, i }) => rowNumber(r) ?? `row ${i + 1}`)
  const blankPrinted = blank.filter(({ r }) => isPrinted(r)).map(({ r }) => rowNumber(r)!)
  const blankNumbered = blank.some(({ r }) => rowNumber(r))
  const one = blank.length === 1
  const say = (names: string[]) => {
    const t = listNumbers(names)
    return t.charAt(0).toUpperCase() + t.slice(1)
  }

  const numberCell = (r: GoodsRow) => {
    const n = rowNumber(r)
    return n
      ? <span className={`${mono} font-bold text-gray-900 dark:text-white`}>{n}</span>
      : <span className="text-xs text-gray-500 dark:text-gray-400">{numbering ? "Numbering…" : "No number yet"}</span>
  }
  const labelCell = (r: GoodsRow) => {
    const s = labelState(r, printedAs)
    return s === "printed"
      ? <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">✓ Printed</span>
      : s === "changed"
        ? <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Printed — changed since</span>
        : <span className="text-xs text-gray-500 dark:text-gray-400">Not printed</span>
  }

  return (
    <section aria-labelledby="gi-step-2-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="gi-step-2-heading" tabIndex={-1} className="text-lg font-bold text-gray-900 dark:text-white outline-none">Check, then book in</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-3xl">
            {receiptId ? <>Receipt <span className={`${mono} font-semibold`}>{receiptId}</span> isn&apos;t booked in yet. </> : null}
            Booking in makes it count: the totes and pallets keep the numbers they have, and you can print the receipt and the labels, and email it, straight after.
          </p>
        </div>
        {status && <div className="text-xs text-right">{status}</div>}
      </div>

      {error}

      {blank.length > 0 && (
        <Amber>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-[14rem]">
              {say(blankNames)} {one ? "has" : "have"} nothing written against {one ? "it" : "them"}. Say what&apos;s inside so the cataloguers know — or remove {one ? "it" : "them"} if {one ? "it isn't a real tote" : "they aren't real totes"}
              {blankNumbered && <> ({one ? "its number" : "their numbers"} won&apos;t be used again{blankPrinted.length ? ` — throw away the ${listNumbers(blankPrinted)} ${blankPrinted.length === 1 ? "label" : "labels"}` : ""})</>}.
              {" "}You can still book in and fill them in later on the receipt.
            </span>
            <button type="button" className={btn} onClick={() => goTo(1)}>Fill them in</button>
            <button type="button" className={btn} onClick={onRemoveBlank}>Remove {one ? "it" : `all ${blank.length}`}</button>
          </div>
        </Amber>
      )}

      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Part title="Customer" step={0} goTo={goTo}>
          <CustomerCard c={customer} vendorSeries={vendorSeries} />
        </Part>

        <Part title="Terms and declaration" goTo={goTo}>
          <div className="space-y-4">
            <div className={`${box} p-4 sm:p-5 space-y-3`}>
              <div>
                <p className="text-base font-semibold text-gray-900 dark:text-white">
                  {parsed ? termsLine(parsed) : "The terms need a look — see the fields below."}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-500 dark:text-gray-400">
                  <span className={changed && parsed ? "font-semibold text-amber-700 dark:text-amber-300" : ""}>
                    {changed ? "Changed for this receipt" : hasOwn ? "Their usual terms" : "The standard terms"}
                  </span>
                  {parsed && (
                    <>
                      <span aria-hidden>·</span>
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center font-semibold text-indigo-700 dark:text-indigo-300 underline"
                        aria-expanded={showEditor}
                        aria-controls="gi-terms-editor"
                        onClick={() => setTermsOpen(!termsOpen)}
                      >
                        {termsOpen ? "Done" : "Change for this receipt"}
                      </button>
                    </>
                  )}
                </p>
              </div>
              {showEditor && (
                <div id="gi-terms-editor" className="border-t border-gray-200 dark:border-gray-800 pt-3">
                  <TermsEditor customer={customer} terms={terms} setTerm={setTerm} onReset={onResetTerms} />
                </div>
              )}
            </div>
            <Declaration owner={owner} setOwner={setOwner} agent={agent} setAgent={setAgent} />
            <NotesField notes={notes} setNotes={setNotes} />
          </div>
        </Part>
      </div>

      <Part title={`What they've brought — ${kindsPhrase(totes, pallets)}`} step={1} goTo={goTo}>
        {rows.length === 0 ? (
          <p className={`${box} px-4 py-6 text-center text-sm text-red-700 dark:text-red-300`}>No totes or pallets — add at least one before booking in.</p>
        ) : (
          <>
            {/* Wide screens: a table */}
            <div className={`${box} hidden @3xl:block overflow-x-auto`}>
              <table className="w-full">
                <thead className="border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className={`${th} w-32`}>Number</th><th className={`${th} w-24`}>Type</th><th className={th}>Category</th><th className={th}>What&apos;s in it</th><th className={`${th} w-28`}>Label</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {rows.map(r => (
                    <tr key={r.key} className={isBlankRow(r) ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}>
                      <td className={td}>{numberCell(r)}</td>
                      <td className={td}><KindBadge kind={r.kind} /></td>
                      <td className={`${td} break-words`}>{r.category.trim() || <span className="text-gray-500 dark:text-gray-400">—</span>}</td>
                      <td className={`${td} break-words`}>{r.description.trim() || <span className="text-gray-500 dark:text-gray-400">—</span>}</td>
                      <td className={td}>{labelCell(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Tablets and phones: cards */}
            <ol className="space-y-2 @3xl:hidden">
              {rows.map(r => (
                <li key={r.key} className={`${box} px-4 py-3 ${isBlankRow(r) ? "!border-amber-300 dark:!border-amber-800" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    {numberCell(r)}
                    <KindBadge kind={r.kind} />
                    <span className="font-semibold text-gray-900 dark:text-white break-words min-w-0">{r.category.trim() || <span className="font-normal text-gray-500 dark:text-gray-400">No category</span>}</span>
                    <span className="ml-auto">{labelCell(r)}</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 break-words">{r.description.trim() || <span className="text-gray-500 dark:text-gray-400">Nothing written</span>}</p>
                </li>
              ))}
            </ol>
          </>
        )}
      </Part>
    </section>
  )
}
