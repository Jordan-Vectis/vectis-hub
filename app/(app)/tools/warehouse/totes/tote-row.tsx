"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { updateContainer } from "@/lib/actions/goods-in"
import { CONTAINER_STATUS, type ContainerStatus } from "@/lib/goods-in/model"
import { ErrorBox, KindBadge, StatusBadge, btn, input, mono, td, ukDate, ukDateTime } from "../_components/ui"
import { FromBcBadge, ReceiptStatusBadge } from "../receipts/_parts"

// One tote or pallet on the Totes & pallets list — a table row on wide screens, a card below xl
// (the same markup, laid out by CSS, like the receipt page's table). What's in it is edited in
// place and its status marked, both through updateContainer; `canEdit` is false for a BC row until
// the Hub owns the warehouse records, and for one on a voided receipt or an unfinished check-in.

export type ToteRowData = {
  id: string
  kind: string
  category: string | null
  description: string | null
  status: string | null
  locationCode: string | null
  locationKind: string | null
  locationName: string | null
  movedAt: string | null
  labelPrintedAt: string | null
  createdAt: string
  updatedAt: string
  source: string | null
  receiptId: string
  receiptStatus: string | null
  vendorNo: string | null
  customerId: string | null
  customerName: string
  canEdit: boolean
  /** Why it can't be edited, in plain words (shown under the row's buttons). */
  lockedWhy: string | null
}

const cell = `${td} max-xl:p-0`
const head = "xl:hidden text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5"

export default function ToteRow({ r }: { r: ToteRowData }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [cat, setCat] = useState(r.category ?? "")
  const [desc, setDesc] = useState(r.description ?? "")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [local, setLocal] = useState<{ at: string; category?: string | null; description?: string | null; status?: ContainerStatus } | null>(null)

  const fresh = local && local.at === r.updatedAt ? local : null
  const category = fresh && "category" in fresh ? fresh.category ?? null : r.category
  const description = fresh && "description" in fresh ? fresh.description ?? null : r.description
  const status = (fresh?.status ?? r.status ?? "booked") as string
  const done = status === "catalogued" || status === "returned"

  const save = async () => {
    const patch: { category?: string | null; description?: string | null } = {}
    if (cat.trim() !== (category ?? "")) patch.category = cat.trim() || null
    if (desc.trim() !== (description ?? "")) patch.description = desc.trim() || null
    if (Object.keys(patch).length === 0) { setEditing(false); return }
    setBusy("save"); setError(null)
    const res = await updateContainer(r.id, patch)
    setBusy(null)
    if (!res.ok) { setError(res.error); return }
    setLocal({ at: r.updatedAt, ...patch })
    setEditing(false)
    router.refresh()
  }
  const setStatus = async (next: ContainerStatus) => {
    setBusy(next); setError(null)
    const res = await updateContainer(r.id, { status: next })
    setBusy(null)
    if (!res.ok) { setError(res.error); return }
    setLocal(l => ({ ...(l && l.at === r.updatedAt ? l : {}), at: r.updatedAt, status: next }))
    router.refresh()
  }

  return (
    <tbody className="max-xl:block max-xl:mb-3 max-xl:rounded-xl max-xl:border max-xl:border-gray-200 max-xl:dark:border-gray-800 max-xl:bg-white max-xl:dark:bg-gray-900 xl:border-t xl:border-gray-100 xl:dark:border-gray-800">
      <tr className="max-xl:grid max-md:grid-cols-2 md:max-xl:grid-cols-4 max-xl:gap-x-4 max-xl:gap-y-3 max-xl:p-4">
        <td className={`${cell} whitespace-nowrap`}>
          <span className={`${mono} text-base font-bold text-gray-900 dark:text-white`}>{r.id}</span>
          <div className="mt-1 flex flex-wrap gap-1"><KindBadge kind={r.kind} />{r.source === "bc" && <FromBcBadge />}</div>
        </td>
        <td className={`${cell} max-xl:col-span-2 xl:min-w-[14rem] xl:w-[26%]`}>
          <div className={head}>What&apos;s in it</div>
          {editing ? (
            <div className="space-y-2" onKeyDown={e => { if (e.key === "Escape") { setEditing(false); setError(null) } if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName !== "BUTTON" && (e.target as HTMLElement).tagName !== "TEXTAREA") { e.preventDefault(); void save() } }}>
              <input className={input} value={cat} maxLength={80} onChange={e => setCat(e.target.value)} placeholder="Category" aria-label={`Category of ${r.id}`} autoFocus />
              <textarea className={`${input} min-h-16`} rows={2} value={desc} maxLength={500} onChange={e => setDesc(e.target.value)} placeholder="What's in it" aria-label={`Description of ${r.id}`} />
              <div className="flex gap-2">
                <button type="button" className="inline-flex items-center justify-center min-h-11 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-40" disabled={busy === "save"} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save"}</button>
                <button type="button" className={btn} onClick={() => { setEditing(false); setError(null) }}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <span className={`block text-sm font-semibold ${category ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400 font-normal italic"}`}>{category || "No category"}</span>
              <span className={`block text-sm whitespace-pre-line ${description ? "text-gray-700 dark:text-gray-300" : "text-gray-500 dark:text-gray-400 italic"}`}>{description || "No description"}</span>
            </>
          )}
        </td>
        <td className={`${cell} max-md:text-right`}>
          <div className={head}>Status</div>
          <StatusBadge status={status} />
        </td>
        <td className={cell}>
          <div className={head}>Where it is</div>
          {r.locationCode ? (
            <>
              <Link href={`/tools/warehouse/locations/${encodeURIComponent(r.locationCode)}`} className={`${mono} font-semibold text-indigo-700 dark:text-indigo-300 hover:underline`}>{r.locationCode}</Link>
              {r.locationName && <div className="text-xs text-gray-500 dark:text-gray-400">{r.locationName}</div>}
              <div className="text-xs text-gray-500 dark:text-gray-400">{r.movedAt ? `Moved ${ukDateTime(r.movedAt)}` : r.source === "bc" ? "As at the last BC copy" : ""}</div>
            </>
          ) : <span className="text-sm text-gray-500 dark:text-gray-400">Not put away yet</span>}
        </td>
        <td className={cell}>
          <div className={head}>Receipt · customer</div>
          <Link href={`/tools/warehouse/receipts/${encodeURIComponent(r.receiptId)}?tote=${encodeURIComponent(r.id)}`} className={`${mono} font-semibold text-indigo-700 dark:text-indigo-300 hover:underline`}>{r.receiptId}</Link>
          {r.receiptStatus && r.receiptStatus !== "open" && <span className="ml-2 align-middle"><ReceiptStatusBadge status={r.receiptStatus} /></span>}
          <div className="text-sm text-gray-800 dark:text-gray-200 truncate max-w-[16rem]">
            {r.customerId ? <Link href={`/tools/warehouse/customers/${encodeURIComponent(r.customerId)}`} className="hover:underline">{r.customerName}</Link> : r.customerName}
            {r.vendorNo && <span className={`${mono} text-xs text-gray-500 dark:text-gray-400`}> {r.vendorNo}</span>}
          </div>
        </td>
        <td className={`${cell} whitespace-nowrap`}>
          <div className={head}>Booked</div>
          <span className="text-sm">{ukDate(r.createdAt)}</span>
          <div className="text-xs text-gray-500 dark:text-gray-400">{r.labelPrintedAt ? `Label ${ukDate(r.labelPrintedAt)}` : <span className="text-amber-700 dark:text-amber-300">Label not printed</span>}</div>
        </td>
        <td className={`${cell} max-md:col-span-2 md:max-xl:col-span-4 xl:w-[17rem]`}>
          <div className="flex flex-wrap gap-2 xl:justify-end">
            <a href={`/api/goods-in/labels?containers=${encodeURIComponent(r.id)}`} target="_blank" rel="noopener" className={btn}>Label</a>
            {r.canEdit && !editing && <button type="button" className={btn} onClick={() => { setCat(category ?? ""); setDesc(description ?? ""); setError(null); setEditing(true) }}>Edit</button>}
            {r.canEdit && <Link href={`/tools/warehouse/move?item=${encodeURIComponent(r.id)}`} className={btn}>Move</Link>}
            {r.canEdit && !done && (
              <>
                <button type="button" className={btn} disabled={!!busy} onClick={() => void setStatus("catalogued")}>{busy === "catalogued" ? "Saving…" : "Catalogued"}</button>
                <button type="button" className={btn} disabled={!!busy} onClick={() => void setStatus("returned")}>{busy === "returned" ? "Saving…" : "Returned"}</button>
              </>
            )}
            {r.canEdit && done && (
              <button type="button" className={btn} disabled={!!busy} onClick={() => void setStatus(r.locationCode ? "stored" : "booked")}>{busy ? "Saving…" : `Undo ${CONTAINER_STATUS[status as ContainerStatus]?.label.toLowerCase() ?? status}`}</button>
            )}
          </div>
          {!r.canEdit && r.lockedWhy && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 xl:text-right">{r.lockedWhy}</p>}
          {error && <div className="mt-2"><ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox></div>}
        </td>
      </tr>
    </tbody>
  )
}
