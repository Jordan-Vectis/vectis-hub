"use client"

import type { CustomerRow } from "@/lib/actions/goods-in"
import type { ReceiptTerms } from "@/lib/goods-in/model"
import { box, btn, input, label } from "../_components/ui"
import { TERM_FIELDS, customerTerm, fullName, parseTerms, sameTerms, termText, usualTerms, type TermsDraft } from "./shared"

// Step 3 — the terms printed on the receipt. Filled in from the customer's usual terms where they
// have them and the standard terms where they don't; anything changed here is for THIS receipt
// only (their usual terms live on their record — Edit details on the Customer step). Then the
// notes, and the customer's declaration, which prints on the receipt they sign.

export const OWNER_TEXT = "I confirm I am the legal owner of the property"
export const AGENT_TEXT = "I confirm I am authorised to act as agent on behalf of the legal owner of the property"

export default function TermsStep({ customer, terms, setTerm, onReset, notes, setNotes, owner, setOwner, agent, setAgent }: {
  customer: CustomerRow | null
  terms: TermsDraft
  setTerm: (k: keyof ReceiptTerms, v: string) => void
  onReset: () => void
  notes: string
  setNotes: (v: string) => void
  owner: boolean
  setOwner: (v: boolean) => void
  agent: boolean
  setAgent: (v: boolean) => void
}) {
  const usual = usualTerms(customer)
  const { errors, terms: parsed } = parseTerms(terms)
  const changed = !sameTerms(terms, usual)
  const hasOwn = TERM_FIELDS.some(f => customerTerm(customer, f.key) != null)
  const name = customer ? fullName(customer) : "the customer"

  return (
    <section aria-labelledby="gi-step-2-heading" className="space-y-6">
      <div>
        <h2 id="gi-step-2-heading" tabIndex={-1} className="text-lg font-bold text-gray-900 dark:text-white outline-none">Terms for this receipt</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-3xl">
          {hasOwn
            ? <>Filled in from {name}&apos;s usual terms (the standard terms where they have none).</>
            : <>Filled in with the standard terms — {name} has no usual terms of their own.</>}
          {" "}A change here is for this receipt only. VAT applies to all charges.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 @2xl:grid-cols-3 @5xl:grid-cols-5">
        {TERM_FIELDS.map(f => {
          const id = `gi-term-${f.key}`
          const own = customerTerm(customer, f.key)
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
                  className={`${input} ${f.unit === "£" ? "pl-7" : "pr-8"} ${err ? "!border-red-500 !ring-red-500" : ""}`}
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
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
          <span>Some terms differ from {hasOwn ? `${name}'s usual terms` : "the standard terms"}.</span>
          <button type="button" className={btn} onClick={onReset}>Put back {hasOwn ? "their usual terms" : "the standard terms"}</button>
        </div>
      )}

      <div className="max-w-4xl">
        <label htmlFor="gi-notes" className={label}>Notes (for Vectis staff — not printed on the receipt)</label>
        <textarea
          id="gi-notes"
          rows={3}
          className={input}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          maxLength={2000}
          placeholder="e.g. Customer will collect anything unsold. The pallet has two fragile boxes."
        />
      </div>

      <fieldset className={`${box} p-4 sm:p-5 max-w-4xl`}>
        <legend className="px-1 text-sm font-semibold text-gray-800 dark:text-gray-200">The customer&apos;s declaration</legend>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">Tick what the customer confirms. It prints on the receipt above their signature — a box left blank prints empty for them to tick by hand.</p>
        <div className="space-y-2">
          {([[owner, setOwner, OWNER_TEXT, "gi-owner"], [agent, setAgent, AGENT_TEXT, "gi-agent"]] as const).map(([on, set, text, id]) => (
            <label key={id} htmlFor={id} className={`flex items-start gap-3 rounded-lg border px-3 py-3 min-h-11 cursor-pointer transition-colors ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60"}`}>
              <input id={id} type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-indigo-600" checked={on} onChange={e => set(e.target.checked)} />
              <span className="text-sm sm:text-base text-gray-900 dark:text-gray-100">{text}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  )
}
