"use client"

import Link from "next/link"
import type { CustomerRow } from "@/lib/actions/goods-in"
import type { CustomerAgreement } from "@/lib/actions/goods-in-agreement"
import type { ReceiptTerms } from "@/lib/goods-in/model"
import { box, btn, input, label } from "../_components/ui"
import { TERM_FIELDS, customerTerm, linkBtn, parseTerms, sameTerms, termText, usualTerms, type TermsDraft } from "./shared"

// The receipt's terms, notes and the customer's declaration — the pieces Check & book in shows.
//
// There is no Terms step any more (Jack, 2026-10-16: "it's more the checking in asking for fees
// part you have done is annoying"). Every receipt simply uses the customer's usual terms — their
// fees and reserve from their customer page → Fees & agreement, the standard terms where they have
// none; Check & book in shows them as one line, and these fields open only when the clerk presses
// "Change for this receipt". A change here is for THIS receipt only — their usual fees are changed
// on their Fees & agreement tab, not at the counter. An unusual value is never questioned; only an
// entry that can't be used (a negative fee, a letter) is marked, and only here, once the clerk has
// opened the fields.

export const OWNER_TEXT = "I confirm I am the legal owner of the property"
export const AGENT_TEXT = "I confirm I am authorised to act as agent on behalf of the legal owner of the property"

/** The customer's Fees & agreement tab. */
export const feesHref = (contactId: string) => `/tools/warehouse/customers/${encodeURIComponent(contactId)}?tab=fees`

/** The terms fields for this receipt, opened from the one-line summary. Lays itself out to its own width. */
export function TermsEditor({ customer, agreement, terms, setTerm, onReset }: {
  customer: CustomerRow | null
  /** Their Fees & agreement (null while it's being read, or before Run Migrations). */
  agreement: CustomerAgreement | null
  terms: TermsDraft
  setTerm: (k: keyof ReceiptTerms, v: string) => void
  onReset: () => void
}) {
  const usual = usualTerms(customer, agreement)
  const { errors, terms: parsed } = parseTerms(terms)
  const changed = !sameTerms(terms, usual)
  const hasOwn = TERM_FIELDS.some(f => customerTerm(customer, f.key, agreement) != null)
  const theirs = hasOwn ? "their usual terms" : "the standard terms"

  return (
    <div className="@container space-y-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 @2xl:grid-cols-3 @5xl:grid-cols-5">
        {TERM_FIELDS.map(f => {
          const id = `gi-term-${f.key}`
          const own = customerTerm(customer, f.key, agreement)
          const was = usual[f.key]
          const now = parsed?.[f.key]
          const differs = now != null && now !== was
          const err = errors[f.key]
          return (
            <div key={f.key} className="min-w-0">
              <label htmlFor={id} className={label}>{f.label} {f.unit === "%" ? "(%)" : "(£)"}</label>
              <div className="relative">
                {f.unit === "£" && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-500 dark:text-gray-400">£</span>}
                <input
                  id={id}
                  type="text"
                  inputMode={f.whole ? "numeric" : "decimal"}
                  autoComplete="off"
                  className={`${input} tabular-nums ${f.unit === "£" ? "pl-7" : "pr-8"} ${err ? "!border-red-500 !ring-red-500" : ""}`}
                  value={terms[f.key]}
                  onChange={e => setTerm(f.key, e.target.value)}
                  aria-invalid={!!err}
                  aria-describedby={`${id}-help`}
                />
                {f.unit === "%" && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-500 dark:text-gray-400">%</span>}
              </div>
              <p id={`${id}-help`} className="mt-1 text-xs leading-snug">
                {err
                  ? <span className="text-red-700 dark:text-red-300">{err}</span>
                  : <span className="text-gray-500 dark:text-gray-400">
                      {f.help}{" "}
                      {differs
                        ? <span className="font-semibold text-amber-700 dark:text-amber-300">Changed — {own != null ? "usually" : "standard is"} {termText(f.key, was)}.</span>
                        : own != null ? "Their usual." : "Standard."}
                    </span>}
              </p>
            </div>
          )
        })}
      </div>

      {changed && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gray-600 dark:text-gray-400">
          <span>Some terms differ from {theirs}.</span>
          <button type="button" className={btn} onClick={onReset}>Put back {theirs}</button>
        </div>
      )}

      <div>
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          A change here is for this receipt only, and VAT applies to all charges.{customer ? "" : " Their usual fees are on their customer page."}
        </p>
        {customer && (
          // Its own line and a full-size tap target — the one way from here to their usual fees.
          <p className="flex flex-wrap items-center gap-x-2">
            <Link href={feesHref(customer.id)} target="_blank" className={`${linkBtn} text-sm`}>
              To change their usual fees, open their Fees &amp; agreement tab ↗
            </Link>
            <span className="text-xs text-gray-500 dark:text-gray-400">A new tab, so nothing here is lost.</span>
          </p>
        )}
      </div>
    </div>
  )
}

/** Notes for Vectis staff — not printed on the receipt. */
export function NotesField({ notes, setNotes }: { notes: string; setNotes: (v: string) => void }) {
  return (
    <div className={`${box} p-4 sm:p-5`}>
      <label htmlFor="gi-notes" className="block text-sm font-semibold text-gray-900 dark:text-white">Notes</label>
      <p id="gi-notes-help" className="mt-0.5 mb-3 text-sm text-gray-600 dark:text-gray-400">For Vectis staff — not printed on the receipt.</p>
      <textarea
        id="gi-notes"
        rows={3}
        className={input}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        maxLength={2000}
        aria-describedby="gi-notes-help"
        placeholder="e.g. Customer will collect anything unsold. The pallet has two fragile boxes."
      />
    </div>
  )
}

/** The customer's declaration, which prints on the receipt above their signature. */
export function Declaration({ owner, setOwner, agent, setAgent }: {
  owner: boolean
  setOwner: (v: boolean) => void
  agent: boolean
  setAgent: (v: boolean) => void
}) {
  return (
    <fieldset className={`${box} min-w-0 p-4 sm:p-5`}>
      {/* Floated, so the legend sits inside the card like every other card's heading, not on its border. */}
      <legend className="float-left w-full text-sm font-semibold text-gray-900 dark:text-white">The customer&apos;s declaration</legend>
      <p className="clear-left mt-0.5 mb-3 pt-0.5 text-sm text-gray-600 dark:text-gray-400">
        Tick what the customer confirms. It prints on the receipt above their signature — a box left blank prints empty for them to tick by hand.
      </p>
      <div className="space-y-2">
        {([[owner, setOwner, OWNER_TEXT, "gi-owner"], [agent, setAgent, AGENT_TEXT, "gi-agent"]] as const).map(([on, set, text, id]) => (
          <label key={id} htmlFor={id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60"}`}>
            <input id={id} type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-indigo-600" checked={on} onChange={e => set(e.target.checked)} />
            <span className="text-sm sm:text-base text-gray-900 dark:text-gray-100">{text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
