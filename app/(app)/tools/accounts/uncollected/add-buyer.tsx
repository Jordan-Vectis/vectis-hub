"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react"
import { createCase } from "@/lib/actions/uncollected"
import { UNCOLLECTED_LIMITS, type UncollectedInput } from "@/lib/uncollected"
import { btn, btnGo, card, cardTitle, inlineLink, input, label } from "./ui"

// Add a buyer — the in-page form on the panel. Only the name is needed; everything else can be
// filled in later on the case. The server checks every field again (lib/actions/uncollected.ts).
// Built for adding several in a row: the name box has the cursor when the form opens and again
// after each buyer is added.

type Form = Record<"buyerName" | "buyerNo" | "email" | "phone" | "saleCode" | "invoiceNo" | "lots" | "amountPaid" | "paidAt" | "nextChaseAt" | "notes", string>

const EMPTY: Form = {
  buyerName: "", buyerNo: "", email: "", phone: "", saleCode: "", invoiceNo: "",
  lots: "", amountPaid: "", paidAt: "", nextChaseAt: "", notes: "",
}

export default function AddBuyer({ today, onClose, caseHrefFor }: { today: string; onClose: () => void; caseHrefFor: (id: string) => string }) {
  const router = useRouter()
  const [form, setForm] = useState<Form>(EMPTY)
  const [error, setError] = useState<{ text: string; existingId?: string } | null>(null)
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null)
  const [saving, startSaving] = useTransition()
  const nameRef = useRef<HTMLInputElement>(null)

  // The cursor in the name box when the form opens.
  useEffect(() => { nameRef.current?.focus() }, [])

  const set = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value
    setForm(f => ({ ...f, [k]: v }))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.buyerName.trim() || saving) return
    setError(null)
    setAdded(null)
    const payload: UncollectedInput = { ...form }
    startSaving(async () => {
      try {
        const res = await createCase(payload)
        if (!res.ok) {
          setError({ text: res.error, existingId: res.existingId })
          return
        }
        setAdded({ id: res.data.id, name: form.buyerName.trim() })
        setForm(EMPTY)
        // Ready for the next one (the Add button was disabled while saving, so focus had gone).
        nameRef.current?.focus()
        router.refresh()
      } catch {
        setError({ text: "The Hub didn't answer — check the connection and try again. Nothing was added." })
      }
    })
  }

  return (
    <form onSubmit={submit} className={`${card} p-4 sm:p-5 mt-3`} aria-label="Add a buyer">
      <div className="mb-3">
        <h2 className={cardTitle}>Add a buyer</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Someone who has paid but not collected. Only the name is needed — fill in the rest now or later.</p>
      </div>

      {added && (
        <div role="status" className="mb-4 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>✓ Added <b>{added.name}</b>. The form is clear for the next one.</span>
          <Link href={caseHrefFor(added.id)} prefetch={false} className={`${inlineLink} hover:text-emerald-600 dark:hover:text-emerald-300`}>Open their case →</Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className={label}>Buyer&apos;s name <span className="text-red-600 dark:text-red-400">*</span></span>
          <input ref={nameRef} value={form.buyerName} onChange={set("buyerName")} maxLength={UNCOLLECTED_LIMITS.buyerName} required autoComplete="off" className={input} />
        </label>
        <label className="block">
          <span className={label}>Buyer number</span>
          <input value={form.buyerNo} onChange={set("buyerNo")} maxLength={UNCOLLECTED_LIMITS.buyerNo} autoComplete="off" className={`${input} font-mono`} />
        </label>
        <label className="block">
          <span className={label}>Sale</span>
          <input value={form.saleCode} onChange={set("saleCode")} maxLength={UNCOLLECTED_LIMITS.saleCode} placeholder="e.g. F118" autoComplete="off" className={`${input} font-mono`} />
        </label>
        <label className="block">
          <span className={label}>Invoice number</span>
          <input value={form.invoiceNo} onChange={set("invoiceNo")} maxLength={UNCOLLECTED_LIMITS.invoiceNo} autoComplete="off" className={`${input} font-mono`} />
        </label>
        <label className="block">
          <span className={label}>Number of lots</span>
          <input value={form.lots} onChange={set("lots")} inputMode="numeric" placeholder="e.g. 3" autoComplete="off" className={input} />
        </label>
        <label className="block">
          <span className={label}>Amount paid (£)</span>
          <input value={form.amountPaid} onChange={set("amountPaid")} inputMode="decimal" placeholder="e.g. 125.50" autoComplete="off" className={input} />
        </label>
        <label className="block">
          <span className={label}>Paid on</span>
          <input type="date" value={form.paidAt} onChange={set("paidAt")} max={today} className={input} />
        </label>
        <label className="block">
          <span className={label}>Next chase</span>
          <input type="date" value={form.nextChaseAt} onChange={set("nextChaseAt")} className={input} />
        </label>
        <label className="block">
          <span className={label}>Email</span>
          <input type="email" value={form.email} onChange={set("email")} maxLength={UNCOLLECTED_LIMITS.email} autoComplete="off" className={input} />
        </label>
        <label className="block">
          <span className={label}>Phone</span>
          <input type="tel" value={form.phone} onChange={set("phone")} maxLength={UNCOLLECTED_LIMITS.phone} autoComplete="off" className={input} />
        </label>
        <label className="block sm:col-span-2 lg:col-span-2">
          <span className={label}>Notes</span>
          <textarea value={form.notes} onChange={set("notes")} maxLength={UNCOLLECTED_LIMITS.notes} rows={2} className={input} />
          <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">Never type bank or card details here.</span>
        </label>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {error.text}
          {error.existingId && (
            <> <Link href={caseHrefFor(error.existingId)} prefetch={false} className={inlineLink}>Open that case →</Link></>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        <button type="submit" disabled={saving || !form.buyerName.trim()} className={btnGo}>
          {saving ? "Adding…" : "Add buyer"}
        </button>
        <button type="button" onClick={onClose} className={btn}>{added ? "Done" : "Cancel"}</button>
      </div>
    </form>
  )
}
