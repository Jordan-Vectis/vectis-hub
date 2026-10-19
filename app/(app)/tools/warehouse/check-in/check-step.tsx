"use client"

import type { ReactNode } from "react"
import type { CustomerRow } from "@/lib/actions/goods-in"
import type { CustomerAgreement } from "@/lib/actions/goods-in-agreement"
import type { ReceiptTerms } from "@/lib/goods-in/model"
import { KindBadge, box, btn, mono, td, th } from "../_components/ui"
import CustomerCard from "./customer-card"
import { Declaration, NotesField, TermsEditor } from "./terms-step"
import {
  LABEL_WORDS, NOTE, TERM_FIELDS, countKinds, customerTerm, isBlankRow, isPrinted, kindsPhrase, labelState, linkBtn, listNumbers, parseTerms, rowNumber,
  sameTerms, termsLine, usualTerms,
  type GoodsRow, type TermsDraft,
} from "./shared"

// Step 3 — one look at everything before it is booked in: the customer, the terms, the notes and
// the customer's declaration, and every tote and pallet with its number. The customer and the
// goods have a Change button back to their step.
//
// The terms are NOT a question (Jack, 2026-10-16): they are the customer's usual terms — their fees
// and reserve as set on their customer page → Fees & agreement, the standard terms where they have
// none — shown as one plain line, with a small "Change for this receipt" that opens the fields here.
// A special arrangement on their Fees & agreement shows under that line as a small highlighted note
// (it is copied onto the receipt when it's booked in), and terms not signed yet get one quiet line —
// never a nag and never a block. If their Fees & agreement couldn't be read, one amber line says so
// (with Try again) and the label says "The fees on their record" — a failure never looks like
// their usual terms. An unusual value is never questioned; only an entry that can't be
// used is marked, and only once the fields are open. Problems that don't stop a booking (a blank
// row) are said plainly so they're a choice, not a surprise. The Book in button itself sits in the
// bar at the bottom of the page; the receipt number and "Saved" in the strip above the step.

const partTitle = "text-sm font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300"

function Part({ title, step, goTo, children, className = "" }: { title: ReactNode; step?: number; goTo: (i: number) => void; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
        <h3 className={partTitle}>{title}</h3>
        {step != null && (
          <button type="button" className={`${btn} !px-3`} onClick={() => goTo(step)} aria-label={step === 0 ? "Change the customer" : "Change what they've brought"}>Change</button>
        )}
      </div>
      {children}
    </div>
  )
}

export default function CheckStep({
  customer, agreement, agreementUnread, onRetryAgreement, rows, terms, setTerm, onResetTerms, termsOpen, setTermsOpen, notes, setNotes, owner, setOwner, agent, setAgent,
  vendorSeries, numbering, goTo, onRemoveBlank, error, printedAs,
}: {
  customer: CustomerRow
  /** Their Fees & agreement — null while it's being read, or when it can't be (before Run Migrations). */
  agreement: CustomerAgreement | null
  /** Reading their Fees & agreement failed — the terms shown are the fees on their record and the standard reserve. */
  agreementUnread: boolean
  onRetryAgreement: () => void
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
  numbering: boolean
  goTo: (i: number) => void
  onRemoveBlank: () => void
  /** The reason the last Book in failed, shown at the top of the step. */
  error: ReactNode
  /** What each row's label said when it was printed, by row key. */
  printedAs: Readonly<Record<string, string>>
}) {
  const { totes, pallets } = countKinds(rows)
  const usual = usualTerms(customer, agreement)
  const parsed = parseTerms(terms).terms
  const changed = !sameTerms(terms, usual)
  const hasOwn = TERM_FIELDS.some(f => customerTerm(customer, f.key, agreement) != null)
  // A term that can't be used keeps the fields open — it is only ever marked there.
  const showEditor = termsOpen || !parsed
  const arrangement = agreement?.specialArrangement?.trim() || null
  // Only said once their agreement has been read (and can be): "not signed" must never be a guess.
  const unsigned = !!agreement?.ready && !agreement.termsSignedAt

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
      ? <span className={`${mono} whitespace-nowrap font-bold tabular-nums text-gray-900 dark:text-white`}>{n}</span>
      : (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
          {numbering && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400 motion-safe:animate-pulse" />}
          {numbering ? "Numbering…" : "No number yet"}
        </span>
      )
  }
  const labelCell = (r: GoodsRow) => {
    const s = labelState(r, printedAs)
    const tone = s === "printed" ? "font-semibold text-emerald-700 dark:text-emerald-300" : s === "changed" ? "font-semibold text-amber-700 dark:text-amber-300" : "text-gray-500 dark:text-gray-400"
    return <span className={`whitespace-nowrap text-xs ${tone}`}>{LABEL_WORDS[s]}</span>
  }

  return (
    <section aria-labelledby="gi-step-2-heading" className="space-y-6">
      <div className="min-w-0">
        <h2 id="gi-step-2-heading" tabIndex={-1} className="text-lg font-bold text-gray-900 dark:text-white outline-none">Check, then book in</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-3xl">
          Have a last look. Booking in makes it count — the totes and pallets keep the numbers they have, and the receipt can be printed or emailed straight after.
        </p>
      </div>

      {error}

      {blank.length > 0 && (
        <div className={`${NOTE.warn} flex flex-wrap items-center gap-x-3 gap-y-2`}>
          <span className="flex-1 basis-72 min-w-0">
            {say(blankNames)} {one ? "has" : "have"} nothing written against {one ? "it" : "them"}. Say what&apos;s inside so the cataloguers know — or remove {one ? "it" : "them"} if {one ? "it isn't a real tote" : "they aren't real totes"}
            {blankNumbered && <> ({one ? "its number" : "their numbers"} won&apos;t be used again{blankPrinted.length ? ` — throw away the ${listNumbers(blankPrinted)} ${blankPrinted.length === 1 ? "label" : "labels"}` : ""})</>}.
            {" "}You can still book in and fill {one ? "it" : "them"} in later on the receipt.
          </span>
          <span className="flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => goTo(1)}>Fill {one ? "it" : "them"} in</button>
            <button type="button" className={btn} onClick={onRemoveBlank}>Remove {one ? "it" : `all ${blank.length}`}</button>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Part title="Customer" step={0} goTo={goTo}>
          <CustomerCard c={customer} vendorSeries={vendorSeries} />
        </Part>

        <Part title="Terms and declaration" goTo={goTo}>
          <div className="space-y-4">
            <div className={`${box} p-4 sm:p-5`}>
              <p className={`text-xs font-semibold ${changed && parsed ? "text-amber-700 dark:text-amber-300" : "text-gray-500 dark:text-gray-400"}`}>
                {!parsed ? "The terms need a look" : changed ? "Changed for this receipt" : agreementUnread ? "The fees on their record" : hasOwn ? "Their usual terms" : "The standard terms"}
              </p>
              <p className="mt-1 text-base font-semibold leading-snug text-gray-900 dark:text-white">
                {parsed ? termsLine(parsed) : "One of the terms can't be used — see the fields below."}
              </p>

              {agreementUnread && (
                <div role="status" className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-amber-700 dark:text-amber-300">
                  <span>Their Fees &amp; agreement couldn&apos;t be read — the reserve shown is the standard one.</span>
                  <button type="button" className={`${linkBtn} text-xs`} onClick={onRetryAgreement}>Try again</button>
                </div>
              )}

              {arrangement && (
                <div className="mt-3 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-2 text-sm text-indigo-900 dark:text-indigo-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Special arrangement</p>
                  <p className="mt-0.5 whitespace-pre-line break-words">{arrangement}</p>
                </div>
              )}

              {unsigned && (
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Vendor terms not signed yet — they&apos;ll sign the receipt.</p>
              )}

              {parsed && (
                <button
                  type="button"
                  className={`${linkBtn} mt-1 text-sm`}
                  aria-expanded={showEditor}
                  aria-controls="gi-terms-editor"
                  onClick={() => setTermsOpen(!termsOpen)}
                >
                  {termsOpen ? "Done" : "Change for this receipt"}
                </button>
              )}

              {showEditor && (
                <div id="gi-terms-editor" className="mt-3 border-t border-gray-200 dark:border-gray-800 pt-4">
                  <TermsEditor customer={customer} agreement={agreement} terms={terms} setTerm={setTerm} onReset={onResetTerms} />
                </div>
              )}
            </div>
            <Declaration owner={owner} setOwner={setOwner} agent={agent} setAgent={setAgent} />
            <NotesField notes={notes} setNotes={setNotes} />
          </div>
        </Part>
      </div>

      <Part
        title={<>What they&apos;ve brought <span className="font-semibold normal-case tracking-normal text-gray-500 dark:text-gray-400">· {kindsPhrase(totes, pallets)}</span></>}
        step={1}
        goTo={goTo}
      >
        {rows.length === 0 ? (
          <p className={`${box} px-4 py-6 text-center text-sm text-red-700 dark:text-red-300`}>No totes or pallets — add at least one before booking in.</p>
        ) : (
          <>
            {/* Wide screens: a table */}
            <div className={`${box} hidden @3xl:block overflow-x-auto`}>
              <table className="w-full">
                <thead className="border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className={`${th} w-32`}>Number</th>
                    <th className={`${th} w-24`}>Type</th>
                    <th className={th}>Category</th>
                    <th className={th}>What&apos;s in it</th>
                    <th className={`${th} w-32`}>Label</th>
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
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {numberCell(r)}
                    <KindBadge kind={r.kind} />
                    <span className="ml-auto">{labelCell(r)}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white break-words">
                    {r.category.trim() || <span className="font-normal text-gray-500 dark:text-gray-400">No category</span>}
                  </p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 break-words">{r.description.trim() || <span className="text-gray-500 dark:text-gray-400">Nothing written</span>}</p>
                </li>
              ))}
            </ol>
          </>
        )}
      </Part>
    </section>
  )
}
