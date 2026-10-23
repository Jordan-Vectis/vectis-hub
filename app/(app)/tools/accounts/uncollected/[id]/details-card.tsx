"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition, type ReactNode } from "react"
import { updateCase } from "@/lib/actions/uncollected"
import {
  BC_OWNED_FIELDS, FIELD_LABELS, UNCOLLECTED_LIMITS, dateInputValue, formatDay, formatMoney, paidHelp, paidTerm,
  type UncollectedCaseDetail, type UncollectedField, type UncollectedPatch,
} from "@/lib/uncollected"
import { ChaseDate, Shipping } from "../bits"
import { Flash, NO_ANSWER, btn, btnGo, card, cardTitle, input, label, muted, type CaseHref, type FlashMessage } from "../ui"

// The buyer's details — shown, then edited in place (Edit details → Save). Only the boxes the person
// actually changed are sent — compared with what the form OPENED with, not with the case as it is
// now, so something changed elsewhere meanwhile (Log contact's "In a week" sets the next chase and
// refreshes the page) is never written back with its old value. The server answers which really
// changed, and "nothing changed" is said as such (design rule 7). On a case from BC the fields BC
// owns are shown but can't be edited.

type EditField = Exclude<UncollectedField, "storageFrom">
type Form = Record<EditField, string>

const FIELDS: EditField[] = ["buyerName", "buyerNo", "email", "phone", "saleCode", "invoiceNo", "lots", "amountPaid", "paidAt", "nextChaseAt", "notes"]

function formOf(c: UncollectedCaseDetail): Form {
  return {
    buyerName: c.buyerName,
    buyerNo: c.buyerNo ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    saleCode: c.saleCode ?? "",
    invoiceNo: c.invoiceNo ?? "",
    lots: c.lots == null ? "" : String(c.lots),
    amountPaid: c.amountPaid == null ? "" : c.amountPaid.toFixed(2),
    paidAt: dateInputValue(c.paidAt),
    nextChaseAt: dateInputValue(c.nextChaseAt),
    notes: c.notes ?? "",
  }
}

export default function DetailsCard({ c, today, caseHref }: { c: UncollectedCaseDetail; today: string; caseHref: CaseHref }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form>(() => formOf(c))
  /** The form as it opened — what "changed" is measured against. */
  const [opened, setOpened] = useState<Form>(() => formOf(c))
  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [saving, startSaving] = useTransition()
  const fromBc = c.source === "bc"
  const locked = (f: EditField) => fromBc && BC_OWNED_FIELDS.includes(f)

  function startEditing() {
    const now = formOf(c)
    setForm(now)
    setOpened(now)
    setMsg(null)
    setEditing(true)
  }

  function save() {
    const was = opened
    const patch: UncollectedPatch = {}
    for (const f of FIELDS) {
      if (locked(f)) continue
      if (form[f].trim() !== was[f].trim()) (patch as Record<string, string>)[f] = form[f]
    }
    if (!Object.keys(patch).length) {
      setMsg({ tone: "info", text: "Nothing was changed, so nothing was saved." })
      setEditing(false)
      return
    }
    if (patch.buyerName !== undefined && !patch.buyerName.trim()) {
      setMsg({ tone: "error", text: "The buyer's name can't be blank." })
      return
    }
    setMsg(null)
    startSaving(async () => {
      try {
        const res = await updateCase(c.id, patch)
        if (!res.ok) {
          setMsg({ tone: "error", text: res.error, link: res.existingId ? { href: caseHref(res.existingId), text: "Open that case →" } : undefined })
          return
        }
        const changed = res.data.changed
        setMsg(changed.length
          ? { tone: "ok", text: `Saved — ${changed.map(f => FIELD_LABELS[f]).join(", ")}.` }
          : { tone: "info", text: "It already said that — nothing needed saving." })
        setEditing(false)
        router.refresh()
      } catch {
        setMsg({ tone: "error", text: NO_ANSWER })
      }
    })
  }

  const set = (f: EditField) => (e: { target: { value: string } }) => {
    const v = e.target.value
    setForm(s => ({ ...s, [f]: v }))
  }

  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="details-title">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id="details-title" className={cardTitle}>Details</h2>
        {!editing && <button type="button" onClick={startEditing} className={btn}>✏️ Edit details</button>}
      </div>

      {!editing ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Item term="Buyer's name">{c.buyerName}</Item>
          <Item term="Buyer number">{c.buyerNo ? <span className="font-mono">{c.buyerNo}</span> : <Blank />}</Item>
          <Item term="Email">{c.email ? <a href={`mailto:${c.email}`} className="text-emerald-600 dark:text-emerald-400 hover:underline break-all">{c.email}</a> : <Blank />}</Item>
          <Item term="Phone">{c.phone ? <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="text-emerald-600 dark:text-emerald-400 hover:underline">{c.phone}</a> : <Blank />}</Item>
          <Item term="Sale">{c.saleCode ? <span className="font-mono">{c.saleCode}</span> : <Blank />}</Item>
          <Item term="Invoice number">{c.invoiceNo ? <span className="font-mono">{c.invoiceNo}</span> : <Blank />}</Item>
          <Item term="Number of lots">{c.lots ?? <Blank />}</Item>
          <Item term="Amount paid">{c.amountPaid == null ? <Blank /> : formatMoney(c.amountPaid)}</Item>
          <Item term={paidTerm(c.source, c.paidExact)}>
            {c.paidAt ? formatDay(c.paidAt) : <Blank />}
            {fromBc && c.paidAt && <span className={`block text-xs ${muted}`}>{paidHelp(c.source, c.paidExact)}</span>}
          </Item>
          <Item term="Next chase"><ChaseDate at={c.nextChaseAt} chase={c.chase} /></Item>
          <Item term="Collection docket · shipment">
            <Shipping s={c.shipping} />
            {c.shipping && <span className={`block text-xs ${muted} mt-0.5`}>From BC — read by the check {formatDay(c.shipping.checkedAt)}</span>}
          </Item>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400">Notes</dt>
            <dd className="text-sm text-gray-800 dark:text-gray-200 mt-0.5 whitespace-pre-wrap break-words">{c.notes || <Blank />}</dd>
          </div>
        </dl>
      ) : (
        <form onSubmit={e => { e.preventDefault(); save() }}>
          {fromBc && (
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              This case came from BC, so the name, buyer number, sale, invoice, lots, amount and paid date are BC&apos;s — the BC
              check keeps them up to date, so change them in BC. Email, phone, next chase and notes are yours.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Box label="Buyer's name"><input value={form.buyerName} onChange={set("buyerName")} disabled={locked("buyerName")} maxLength={UNCOLLECTED_LIMITS.buyerName} required className={input} /></Box>
            <Box label="Buyer number"><input value={form.buyerNo} onChange={set("buyerNo")} disabled={locked("buyerNo")} maxLength={UNCOLLECTED_LIMITS.buyerNo} className={`${input} font-mono`} /></Box>
            <Box label="Email"><input type="email" value={form.email} onChange={set("email")} maxLength={UNCOLLECTED_LIMITS.email} autoComplete="off" className={input} /></Box>
            <Box label="Phone"><input type="tel" value={form.phone} onChange={set("phone")} maxLength={UNCOLLECTED_LIMITS.phone} autoComplete="off" className={input} /></Box>
            <Box label="Sale"><input value={form.saleCode} onChange={set("saleCode")} disabled={locked("saleCode")} maxLength={UNCOLLECTED_LIMITS.saleCode} className={`${input} font-mono`} /></Box>
            <Box label="Invoice number"><input value={form.invoiceNo} onChange={set("invoiceNo")} disabled={locked("invoiceNo")} maxLength={UNCOLLECTED_LIMITS.invoiceNo} className={`${input} font-mono`} /></Box>
            <Box label="Number of lots"><input value={form.lots} onChange={set("lots")} disabled={locked("lots")} inputMode="numeric" className={input} /></Box>
            <Box label="Amount paid (£)"><input value={form.amountPaid} onChange={set("amountPaid")} disabled={locked("amountPaid")} inputMode="decimal" className={input} /></Box>
            <Box label={paidTerm(c.source, c.paidExact)}><input type="date" value={form.paidAt} onChange={set("paidAt")} disabled={locked("paidAt")} max={today} className={input} /></Box>
            <Box label="Next chase"><input type="date" value={form.nextChaseAt} onChange={set("nextChaseAt")} className={input} /></Box>
            <label className="block sm:col-span-2">
              <span className={label}>Notes</span>
              <textarea value={form.notes} onChange={set("notes")} maxLength={UNCOLLECTED_LIMITS.notes} rows={3} className={input} />
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">Never type bank or card details here.</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <button type="submit" disabled={saving || !form.buyerName.trim()} className={btnGo}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" disabled={saving} onClick={() => { setEditing(false); setMsg(null) }} className={btn}>Cancel</button>
          </div>
        </form>
      )}

      <Flash msg={msg} />

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
        {c.source === "bc"
          ? `From BC — invoice ${c.bcKey ?? c.invoiceNo ?? "not known"}, on the list since`
          : `Added by hand${c.createdByName ? ` by ${c.createdByName}` : ""} on`} {formatDay(c.createdAt)} · last changed {formatDay(c.updatedAt)}
      </p>
    </section>
  )
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400">{term}</dt>
      <dd className="text-sm text-gray-800 dark:text-gray-200 mt-0.5 break-words">{children}</dd>
    </div>
  )
}

const Blank = () => <span className={muted}>Not known</span>

function Box({ label: text, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={label}>{text}</span>
      {children}
    </label>
  )
}
