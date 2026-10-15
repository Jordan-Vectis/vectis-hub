"use client"

import type { ReactNode } from "react"
import type { CustomerRow } from "@/lib/actions/goods-in"
import type { ReceiptTerms } from "@/lib/goods-in/model"
import { KindBadge, box, btn, label, td, th } from "../_components/ui"
import CustomerCard from "./customer-card"
import { AGENT_TEXT, OWNER_TEXT } from "./terms-step"
import { TERM_FIELDS, countKinds, customerTerm, isBlankRow, kindsPhrase, termText, usualTerms, type GoodsRow } from "./shared"

// Step 4 — one look at everything before it becomes a receipt: the customer, every tote and pallet,
// the terms and the declaration. Each part has a Change button back to its step. Problems that
// don't stop a booking (a blank row, no declaration ticked) are said plainly here so they're a
// choice, not a surprise. The Book in button itself sits in the bar at the bottom of the page.

function Part({ title, step, goTo, children, className = "" }: { title: string; step: number; goTo: (i: number) => void; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">{title}</h3>
        <button type="button" className={`${btn} !px-3`} onClick={() => goTo(step)} aria-label={`Change ${title.split(" — ")[0].toLowerCase()}`}>Change</button>
      </div>
      {children}
    </div>
  )
}

const Amber = ({ children }: { children: ReactNode }) => (
  <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">{children}</div>
)

export default function CheckStep({ customer, rows, terms, notes, owner, agent, vendorSeries, goTo, onRemoveBlank, error }: {
  customer: CustomerRow
  rows: GoodsRow[]
  terms: ReceiptTerms | null
  notes: string
  owner: boolean
  agent: boolean
  vendorSeries: boolean | null
  goTo: (i: number) => void
  onRemoveBlank: () => void
  /** The reason the last Book in failed, shown at the top of the step. */
  error: ReactNode
}) {
  const { totes, pallets } = countKinds(rows)
  const blanks = rows.map((r, i) => (isBlankRow(r) ? i + 1 : 0)).filter(Boolean)
  const usual = usualTerms(customer)
  const rowNos = (ns: number[]) => (ns.length === 1 ? `Row ${ns[0]} has` : `Rows ${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]} have`)

  return (
    <section aria-labelledby="gi-step-3-heading" className="space-y-6">
      <div>
        <h2 id="gi-step-3-heading" tabIndex={-1} className="text-lg font-bold text-gray-900 dark:text-white outline-none">Check, then book in</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-3xl">
          Booking in makes the receipt and gives it and each tote and pallet its number, all at once. You can print the receipt and the labels, and email it, straight after.
        </p>
      </div>

      {error}

      {(blanks.length > 0 || (!owner && !agent)) && (
        <div className="space-y-2">
          {blanks.length > 0 && (
            <Amber>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex-1 min-w-[14rem]">
                  {rowNos(blanks)} nothing written against {blanks.length === 1 ? "it" : "them"}. Say what&apos;s inside so the cataloguers know — or remove {blanks.length === 1 ? "it" : "them"} if {blanks.length === 1 ? "it isn't a real tote" : "they aren't real totes"}. You can still book in and fill them in later on the receipt.
                </span>
                <button type="button" className={btn} onClick={() => goTo(1)}>Fill them in</button>
                <button type="button" className={btn} onClick={onRemoveBlank}>Remove {blanks.length === 1 ? "it" : `all ${blanks.length}`}</button>
              </div>
            </Amber>
          )}
          {!owner && !agent && (
            <Amber>
              Neither declaration is ticked. The receipt will print with both boxes empty for the customer to tick by hand.{" "}
              <button type="button" className="inline-flex items-center min-h-11 underline font-semibold" onClick={() => goTo(2)}>Tick one now</button>
            </Amber>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Part title="Customer" step={0} goTo={goTo}>
          <CustomerCard c={customer} vendorSeries={vendorSeries} />
        </Part>

        <Part title="Terms" step={2} goTo={goTo}>
          <div className={`${box} p-4 sm:p-5 space-y-4`}>
            {terms ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @xl:grid-cols-3 @4xl:grid-cols-2">
                {TERM_FIELDS.map(f => {
                  const differs = terms[f.key] !== usual[f.key]
                  return (
                    <div key={f.key}>
                      <dt className={label}>{f.label}</dt>
                      <dd className="text-lg font-semibold text-gray-900 dark:text-white">
                        {termText(f.key, terms[f.key])}
                        {f.key === "reservePercent" && <span className="text-xs font-normal text-gray-500 dark:text-gray-400"> of bottom estimate</span>}
                      </dd>
                      <dd className={`text-xs ${differs ? "font-semibold text-amber-700 dark:text-amber-300" : "text-gray-500 dark:text-gray-400"}`}>
                        {differs ? `Changed for this receipt (${customerTerm(customer, f.key) != null ? "usually" : "standard is"} ${termText(f.key, usual[f.key])})` : customerTerm(customer, f.key) != null ? "Their usual" : "Standard"}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            ) : (
              <p className="text-sm text-red-700 dark:text-red-300">The terms need fixing before booking in.</p>
            )}
            <div className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-1.5 text-sm">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">Declaration</p>
              {([[owner, OWNER_TEXT], [agent, AGENT_TEXT]] as const).map(([on, text]) => (
                <p key={text}className={`flex items-start gap-2 ${on ? "text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"}`}>
                  <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-bold ${on ? "border-indigo-500 bg-indigo-600 text-white" : "border-gray-400 dark:border-gray-600"}`}>{on ? "✓" : ""}</span>
                  <span><span className="sr-only">{on ? "Ticked: " : "Not ticked: "}</span>{text}</span>
                </p>
              ))}
            </div>
            {notes.trim() && (
              <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">Notes (not printed)</p>
                <p className="mt-1 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line break-words">{notes.trim()}</p>
              </div>
            )}
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
                  <tr><th className={`${th} w-12 text-right`}>Row</th><th className={`${th} w-24`}>Type</th><th className={th}>Category</th><th className={th}>What&apos;s in it</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {rows.map((r, i) => (
                    <tr key={r.key} className={isBlankRow(r) ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}>
                      <td className={`${td} text-right font-mono text-gray-500 dark:text-gray-400`}>{i + 1}</td>
                      <td className={td}><KindBadge kind={r.kind} /></td>
                      <td className={`${td} break-words`}>{r.category.trim() || <span className="text-gray-500 dark:text-gray-400">—</span>}</td>
                      <td className={`${td} break-words`}>{r.description.trim() || <span className="text-gray-500 dark:text-gray-400">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Tablets and phones: cards */}
            <ol className="space-y-2 @3xl:hidden">
              {rows.map((r, i) => (
                <li key={r.key} className={`${box} px-4 py-3 ${isBlankRow(r) ? "!border-amber-300 dark:!border-amber-800" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-gray-500 dark:text-gray-400">{i + 1}</span>
                    <KindBadge kind={r.kind} />
                    <span className="font-semibold text-gray-900 dark:text-white break-words min-w-0">{r.category.trim() || <span className="font-normal text-gray-500 dark:text-gray-400">No category</span>}</span>
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
