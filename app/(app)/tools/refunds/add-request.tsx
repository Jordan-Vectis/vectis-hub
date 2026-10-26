"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react"
import { createRefund, type RefundInput } from "@/lib/actions/refunds"
import { REFUND_LIMITS, REFUND_PARTIES, REFUND_PARTY_LABELS, REFUND_REASONS, REFUND_REASON_LABELS, refundRefWords } from "@/lib/refunds"
import { btn, btnGo, card, cardTitle, inlineLink, input, label } from "./ui"

// ＋ Add a request — the in-page form on the panel, for one that didn't come through the public form
// (an email, a phone call, a vendor owed a payout). Only the name is needed; everything else can be
// filled in on the request. The server checks every field again (lib/actions/refunds.ts). Built for
// adding several in a row: the name box has the cursor when the form opens and after each one.

type Form = Record<"name" | "email" | "customerNo" | "party" | "saleCode" | "auctionDate" | "lotsText" | "reason" | "details", string>

const EMPTY: Form = { name: "", email: "", customerNo: "", party: "buyer", saleCode: "", auctionDate: "", lotsText: "", reason: "", details: "" }

export default function AddRequest({ onClose, hrefFor }: { onClose: () => void; hrefFor: (id: string) => string }) {
  const router = useRouter()
  const [form, setForm] = useState<Form>(EMPTY)
  const [takeIt, setTakeIt] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<{ id: string; ref: number; name: string } | null>(null)
  const [saving, startSaving] = useTransition()
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  const set = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const v = e.target.value
    setForm(f => ({ ...f, [k]: v }))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || saving) return
    setError(null)
    setAdded(null)
    const payload: RefundInput = { ...form, takeIt }
    startSaving(async () => {
      try {
        const res = await createRefund(payload)
        if (!res.ok) { setError(res.error); return }
        setAdded({ id: res.data.id, ref: res.data.ref, name: form.name.trim() })
        setForm(EMPTY)
        nameRef.current?.focus()
        router.refresh()
      } catch {
        setError("The Hub didn't answer — check the connection and try again. Nothing was added.")
      }
    })
  }

  return (
    <form onSubmit={submit} className={`${card} p-4 sm:p-5 mt-3`} aria-label="Add a request">
      <div className="mb-3">
        <h2 className={cardTitle}>Add a request</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          One that didn&apos;t come through the refund form — an email, a phone call, or a vendor owed a payout. Only the name is needed.
        </p>
      </div>

      {added && (
        <div role="status" className="mb-4 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>✓ Added <b>{refundRefWords(added.ref)}</b> for <b>{added.name}</b>. The form is clear for the next one.</span>
          <Link href={hrefFor(added.id)} prefetch={false} className={`${inlineLink} hover:text-emerald-600 dark:hover:text-emerald-300`}>Open it →</Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className={label}>Name <span className="text-red-600 dark:text-red-400">*</span></span>
          <input ref={nameRef} value={form.name} onChange={set("name")} maxLength={REFUND_LIMITS.name} required autoComplete="off" className={input} />
        </label>
        <label className="block">
          <span className={label}>Email</span>
          <input type="email" value={form.email} onChange={set("email")} maxLength={REFUND_LIMITS.email} autoComplete="off" className={input} />
        </label>
        <label className="block">
          <span className={label}>C-number</span>
          <input value={form.customerNo} onChange={set("customerNo")} maxLength={REFUND_LIMITS.customerNo} placeholder="e.g. C201384" autoComplete="off" className={`${input} font-mono`} />
        </label>
        <label className="block">
          <span className={label}>Buyer or vendor</span>
          <select value={form.party} onChange={set("party")} className={input}>
            {REFUND_PARTIES.map(p => <option key={p} value={p}>{REFUND_PARTY_LABELS[p]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={label}>Sale</span>
          <input value={form.saleCode} onChange={set("saleCode")} maxLength={REFUND_LIMITS.saleCode} placeholder="e.g. F118" autoComplete="off" className={`${input} font-mono`} />
        </label>
        <label className="block">
          <span className={label}>Auction date</span>
          <input type="date" value={form.auctionDate} onChange={set("auctionDate")} className={input} />
        </label>
        <label className="block">
          <span className={label}>Lot number(s)</span>
          <input value={form.lotsText} onChange={set("lotsText")} maxLength={REFUND_LIMITS.lotsText} placeholder="e.g. 808 & 809" autoComplete="off" className={input} />
        </label>
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className={label}>Reason</span>
          <select value={form.reason} onChange={set("reason")} className={input}>
            <option value="">Pick one (or Something else)</option>
            {REFUND_REASONS.map(r => <option key={r} value={r}>{REFUND_REASON_LABELS[r]}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2 lg:col-span-3">
          <span className={label}>What happened</span>
          <textarea value={form.details} onChange={set("details")} maxLength={REFUND_LIMITS.details} rows={2} className={input} />
          <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">Never type bank or card details here.</span>
        </label>
      </div>

      <label className="mt-3 inline-flex items-center gap-3 min-h-11 cursor-pointer text-sm text-gray-800 dark:text-gray-200">
        <input type="checkbox" checked={takeIt} onChange={e => setTakeIt(e.target.checked)} className="h-5 w-5 accent-emerald-600" />
        I&apos;m dealing with it <span className="text-gray-500 dark:text-gray-400">— it starts at Being looked at, with your name on it</span>
      </label>

      {error && (
        <div role="alert" className="mt-3 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        <button type="submit" disabled={saving || !form.name.trim()} className={btnGo}>{saving ? "Adding…" : "Add request"}</button>
        <button type="button" onClick={onClose} className={btn}>{added ? "Done" : "Cancel"}</button>
      </div>
    </form>
  )
}
