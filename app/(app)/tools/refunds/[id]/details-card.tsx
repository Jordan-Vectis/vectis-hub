"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition, type ReactNode } from "react"
import { updateRefund, type RefundPatch } from "@/lib/actions/refunds"
import {
  REFUND_LIMITS, REFUND_PARTIES, REFUND_PARTY_LABELS, REFUND_REASONS, REFUND_REASON_LABELS, REFUND_SOLUTIONS, REFUND_SOLUTION_LABELS,
  REFUND_SOURCE_LABELS, type RefundDetail,
} from "@/lib/refunds"
import { mailtoHref } from "@/lib/refunds-public"
import { formatDay } from "@/lib/uncollected"
import { Flash, NO_ANSWER, btn, btnGo, card, cardTitle, input, label, muted, type FlashMessage } from "../ui"

// The request's details — shown, then edited in place (Edit details → Save). Only the boxes the person
// actually changed are sent — compared with what the form OPENED with, not with the request as it is
// now, so something changed elsewhere meanwhile is never written back with its old value. The server
// answers which really changed, and "nothing changed" is said as such (design rule 7). Postage and the
// ref code are on the Lots & money card, beside the money they belong to.

type EditField = "name" | "email" | "customerNo" | "party" | "saleCode" | "auctionDate" | "lotsText" | "reason" | "details" | "solution" | "percentText" | "notes"
type Form = Record<EditField, string>

const FIELDS: EditField[] = ["name", "email", "customerNo", "party", "saleCode", "auctionDate", "lotsText", "reason", "details", "solution", "percentText", "notes"]

function formOf(r: RefundDetail): Form {
  return {
    name: r.name,
    email: r.email ?? "",
    customerNo: r.customerNo ?? "",
    party: r.party,
    saleCode: r.saleCode ?? "",
    auctionDate: r.auctionDate ?? "",
    lotsText: r.lotsText ?? "",
    reason: r.reason,
    details: r.details ?? "",
    solution: r.solution ?? "",
    percentText: r.percentText ?? "",
    notes: r.notes ?? "",
  }
}

export default function DetailsCard({ r }: { r: RefundDetail }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form>(() => formOf(r))
  /** The form as it opened — what "changed" is measured against. */
  const [opened, setOpened] = useState<Form>(() => formOf(r))
  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [saving, startSaving] = useTransition()

  function startEditing() {
    const now = formOf(r)
    setForm(now)
    setOpened(now)
    setMsg(null)
    setEditing(true)
  }

  function save() {
    const patch: Record<string, string> = {}
    for (const f of FIELDS) if (form[f].trim() !== opened[f].trim()) patch[f] = form[f]
    if (!Object.keys(patch).length) {
      setMsg({ tone: "info", text: "Nothing was changed, so nothing was saved." })
      setEditing(false)
      return
    }
    if (patch.name !== undefined && !patch.name.trim()) {
      setMsg({ tone: "error", text: "The name can't be blank." })
      return
    }
    setMsg(null)
    startSaving(async () => {
      try {
        const res = await updateRefund(r.id, patch as RefundPatch)
        if (!res.ok) { setMsg({ tone: "error", text: res.error }); return }
        const changed = res.data.changed
        setMsg(changed.length
          ? { tone: "ok", text: `Saved — ${changed.join(", ")}.` }
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
          <Item term="Name">{r.name}</Item>
          <Item term="Email">{r.email ? <a href={mailtoHref(r.email)} className="text-emerald-600 dark:text-emerald-400 hover:underline break-all">{r.email}</a> : <Blank />}</Item>
          <Item term="C-number">{r.customerNo ? <span className="font-mono">{r.customerNo}</span> : <Blank />}{r.customerNo && !r.customerId && <span className={`block text-xs ${muted}`}>Not matched to anyone in Customers</span>}</Item>
          <Item term="Buyer or vendor">{REFUND_PARTY_LABELS[r.party]}</Item>
          <Item term="Sale">{r.saleCode ? <span className="font-mono">{r.saleCode}</span> : <Blank />}</Item>
          <Item term="Auction date">{r.auctionDate ? formatDay(`${r.auctionDate}T12:00:00Z`) : <Blank />}</Item>
          <Item term="Lot number(s)">{r.lotsText || <Blank />}</Item>
          <Item term="Reason">{REFUND_REASON_LABELS[r.reason]}</Item>
          <Item term="Solution">{r.solution ? REFUND_SOLUTION_LABELS[r.solution] : <span className={muted}>Not decided yet</span>}</Item>
          <Item term="% agreed">{r.percentText || <span className={muted}>Not set</span>}</Item>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400">What happened</dt>
            <dd className="text-sm text-gray-800 dark:text-gray-200 mt-0.5 whitespace-pre-wrap break-words">{r.details || <Blank />}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400">Notes</dt>
            <dd className="text-sm text-gray-800 dark:text-gray-200 mt-0.5 whitespace-pre-wrap break-words">{r.notes || <span className={muted}>None</span>}</dd>
          </div>
        </dl>
      ) : (
        <form onSubmit={e => { e.preventDefault(); save() }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Box label="Name"><input value={form.name} onChange={set("name")} maxLength={REFUND_LIMITS.name} required className={input} /></Box>
            <Box label="Email"><input type="email" value={form.email} onChange={set("email")} maxLength={REFUND_LIMITS.email} autoComplete="off" className={input} /></Box>
            <Box label="C-number"><input value={form.customerNo} onChange={set("customerNo")} maxLength={REFUND_LIMITS.customerNo} placeholder="e.g. C201384" autoComplete="off" className={`${input} font-mono`} /></Box>
            <Box label="Buyer or vendor">
              <select value={form.party} onChange={set("party")} className={input}>
                {REFUND_PARTIES.map(p => <option key={p} value={p}>{REFUND_PARTY_LABELS[p]}</option>)}
              </select>
            </Box>
            <Box label="Sale"><input value={form.saleCode} onChange={set("saleCode")} maxLength={REFUND_LIMITS.saleCode} placeholder="e.g. F118" autoComplete="off" className={`${input} font-mono`} /></Box>
            <Box label="Auction date"><input type="date" value={form.auctionDate} onChange={set("auctionDate")} className={input} /></Box>
            <Box label="Lot number(s)"><input value={form.lotsText} onChange={set("lotsText")} maxLength={REFUND_LIMITS.lotsText} placeholder="e.g. 808 & 809" autoComplete="off" className={input} /></Box>
            <Box label="Reason">
              <select value={form.reason} onChange={set("reason")} className={input}>
                {REFUND_REASONS.map(x => <option key={x} value={x}>{REFUND_REASON_LABELS[x]}</option>)}
              </select>
            </Box>
            <Box label="Solution">
              <select value={form.solution} onChange={set("solution")} className={input}>
                <option value="">Not decided yet</option>
                {REFUND_SOLUTIONS.map(x => <option key={x} value={x}>{REFUND_SOLUTION_LABELS[x]}</option>)}
              </select>
            </Box>
            <Box label="% agreed (in words)"><input value={form.percentText} onChange={set("percentText")} maxLength={REFUND_LIMITS.percentText} placeholder="e.g. 20%, or Set amount" autoComplete="off" className={input} /></Box>
            <label className="block sm:col-span-2">
              <span className={label}>What happened</span>
              <textarea value={form.details} onChange={set("details")} maxLength={REFUND_LIMITS.details} rows={4} className={input} />
            </label>
            <label className="block sm:col-span-2">
              <span className={label}>Notes</span>
              <textarea value={form.notes} onChange={set("notes")} maxLength={REFUND_LIMITS.notes} rows={3} className={input} />
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">Never type bank or card details here.</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <button type="submit" disabled={saving || !form.name.trim()} className={btnGo}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" disabled={saving} onClick={() => { setEditing(false); setMsg(null) }} className={btn}>Cancel</button>
          </div>
        </form>
      )}

      <Flash msg={msg} />

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
        {REFUND_SOURCE_LABELS[r.source]} · came in {formatDay(r.receivedAt)} · last changed {formatDay(r.updatedAt)}
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
