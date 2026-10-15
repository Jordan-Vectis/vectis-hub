"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { lookupCode, updateContainer } from "@/lib/actions/goods-in"
import { CONTAINER_STATUS, LOCATION_KINDS, STATUS_FOR_KIND, normaliseCode, type ContainerStatus, type LocationKind } from "@/lib/goods-in/model"
import ScanInput from "../../_components/scan-input"
import { ErrorBox, KindBadge, StatusBadge, btn, input, mono, th, td, ukDateTime } from "../../_components/ui"
import LotList from "./lot-list"
import { useRefreshOnReturn } from "./refresh-on-return"
import { CATEGORY_LIST_ID, type ContainerView } from "./types"

// The totes and pallets on a receipt. One table, which becomes a stack of cards below iPad-landscape
// width (each tote is its own <tbody>, so a card and a table row are the same markup — no second
// copy of the edit boxes). Category and description are edited in place (updateContainer); the
// lots made from each tote open underneath it. A scanner can be used in the box at the top to find
// a tote on this receipt (or say which receipt it IS on).

const kindLabel = (k: string | null) => LOCATION_KINDS.find(l => l.value === k)?.label ?? null

/** The status a tote goes back to when "catalogued"/"returned" is undone: what its location says. */
const statusFromLocation = (c: { locationCode: string | null; locationKind: string | null }): ContainerStatus =>
  c.locationCode ? STATUS_FOR_KIND[(c.locationKind as LocationKind) in STATUS_FOR_KIND ? (c.locationKind as LocationKind) : "storage"] : "booked"

type ScanNote = { tone: "ok" | "info" | "warn"; text: React.ReactNode }

export default function ContainersTable({ receiptId, containers, highlight, isVoid = false }: {
  receiptId: string
  containers: ContainerView[]
  /** The receipt is void: its totes keep their numbers, but no label is printed for them. */
  isVoid?: boolean
  /** A tote/pallet to pick out (arrived from a scan on the receipts list). */
  highlight: string | null
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => (highlight ? { [highlight]: true } : {}))
  const [flash, setFlash] = useState<string | null>(highlight)
  const [note, setNote] = useState<ScanNote | null>(null)

  const scrollTo = (id: string) => {
    requestAnimationFrame(() => document.getElementById(`c-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }))
  }

  useEffect(() => { if (highlight) scrollTo(highlight) }, [highlight])

  const onScan = async (raw: string) => {
    const code = normaliseCode(raw)
    const here = containers.find(c => c.id === code)
    if (here) {
      setFlash(here.id)
      setExpanded(e => ({ ...e, [here.id]: true }))
      setNote({ tone: "ok", text: <><span className={`${mono} font-semibold`}>{here.id}</span> is on this receipt — {CONTAINER_STATUS[(here.status as ContainerStatus) in CONTAINER_STATUS ? (here.status as ContainerStatus) : "booked"].label.toLowerCase()}{here.locationCode ? <> at <span className={`${mono} font-semibold`}>{here.locationCode}</span></> : null}.</> })
      scrollTo(here.id)
      return
    }
    const res = await lookupCode(code)
    if (!res.ok) { setNote({ tone: "warn", text: res.error }); return }
    const hit = res.data
    if (!hit) { setNote({ tone: "warn", text: <>Nothing found for <span className={`${mono} font-semibold`}>{code}</span>. Check the label and scan again.</> }); return }
    if (hit.type === "container") {
      setNote({ tone: "info", text: <><span className={`${mono} font-semibold`}>{hit.id}</span> isn&apos;t on this receipt — it&apos;s on <Link className="underline font-semibold" href={`/tools/warehouse/receipts/${encodeURIComponent(hit.receiptId)}?tote=${encodeURIComponent(hit.id)}`}>{hit.receiptId}</Link> ({hit.customer}).</> })
    } else if (hit.type === "receipt") {
      setNote({ tone: "info", text: hit.id === receiptId ? <>That&apos;s this receipt&apos;s own number.</> : <>That&apos;s receipt <Link className="underline font-semibold" href={`/tools/warehouse/receipts/${encodeURIComponent(hit.id)}`}>{hit.id}</Link> ({hit.customer}).</> })
    } else if (hit.type === "lot") {
      setNote({ tone: "info", text: <>That&apos;s lot <Link className="underline font-semibold" href={`/tools/warehouse/find?q=${encodeURIComponent(hit.barcode)}`}>{hit.barcode}</Link>{hit.tote ? <> from tote <span className={mono}>{hit.tote}</span></> : null}{hit.locationCode ? <>, on shelf <span className={mono}>{hit.locationCode}</span></> : null}.</> })
    } else if (hit.type === "location") {
      setNote({ tone: "info", text: <>That&apos;s location <span className={`${mono} font-semibold`}>{hit.code}</span>. To put a tote there, use <Link className="underline font-semibold" href="/tools/warehouse/move">Move</Link>.</> })
    } else {
      setNote({ tone: "info", text: <>That&apos;s the vendor number for <Link className="underline font-semibold" href={`/tools/warehouse/customers/${encodeURIComponent(hit.id)}`}>{hit.name}</Link>.</> })
    }
  }

  return (
    <div className="space-y-3">
      {containers.length > 1 && (
        <div className="max-w-xl">
          <ScanInput id="receipt-scan" label="Find a tote or pallet on this receipt" placeholder="Scan or type T… / P…" onScan={onScan} />
          {note && (
            <p role="status" className={`mt-2 text-sm rounded-lg px-3 py-2 border ${note.tone === "ok"
              ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200"
              : note.tone === "warn"
                ? "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200"
                : "border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200"}`}>{note.text}</p>
          )}
        </div>
      )}

      <div className="xl:rounded-xl xl:border xl:border-gray-200 xl:dark:border-gray-800 xl:bg-white xl:dark:bg-gray-900 xl:overflow-x-auto">
        <table className="w-full max-xl:block">
          <thead className="max-xl:hidden border-b border-gray-200 dark:border-gray-800">
            <tr>
              <th className={th}>Number</th>
              <th className={th}>What&apos;s in it</th>
              <th className={th}>Status</th>
              <th className={th}>Where it is</th>
              <th className={th}>Label</th>
              <th className={th}>Lots made</th>
              <th className={th}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          {containers.map(c => (
            <ContainerRow
              key={c.id}
              c={c}
              open={!!expanded[c.id]}
              onToggle={() => setExpanded(e => ({ ...e, [c.id]: !e[c.id] }))}
              flashed={flash === c.id}
              isVoid={isVoid}
            />
          ))}
        </table>
      </div>
    </div>
  )
}

function ContainerRow({ c, open, onToggle, flashed, isVoid }: { c: ContainerView; open: boolean; onToggle: () => void; flashed: boolean; isVoid: boolean }) {
  const router = useRouter()
  const refreshOnReturn = useRefreshOnReturn()
  const [editing, setEditing] = useState(false)
  const [cat, setCat] = useState(c.category ?? "")
  const [desc, setDesc] = useState(c.description ?? "")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ContainerStatus | null>(null)
  // What was just saved, shown until the page's fresh copy (a newer updatedAt) arrives.
  const [local, setLocal] = useState<{ at: string; category?: string | null; description?: string | null; status?: ContainerStatus } | null>(null)
  const catRef = useRef<HTMLInputElement>(null)

  const fresh = local && local.at === c.updatedAt ? local : null
  const category = fresh && "category" in fresh ? fresh.category ?? null : c.category
  const description = fresh && "description" in fresh ? fresh.description ?? null : c.description
  const status = (fresh?.status ?? c.status ?? "booked") as string
  const done = status === "catalogued" || status === "returned"
  const back = statusFromLocation(c)

  const startEdit = () => {
    setCat(category ?? "")
    setDesc(description ?? "")
    setError(null)
    setEditing(true)
    requestAnimationFrame(() => catRef.current?.focus())
  }

  const save = async () => {
    const patch: { category?: string | null; description?: string | null } = {}
    if (cat.trim() !== (category ?? "")) patch.category = cat.trim() || null
    if (desc.trim() !== (description ?? "")) patch.description = desc.trim() || null
    if (Object.keys(patch).length === 0) { setEditing(false); return }
    setBusy("save")
    setError(null)
    const res = await updateContainer(c.id, patch)
    setBusy(null)
    if (!res.ok) { setError(res.error); return }
    setLocal({ at: c.updatedAt, ...patch })
    setEditing(false)
    router.refresh()
  }

  const setStatus = async (next: ContainerStatus) => {
    setBusy(next)
    setError(null)
    const res = await updateContainer(c.id, { status: next })
    setBusy(null)
    setConfirm(null)
    if (!res.ok) { setError(res.error); return }
    setLocal(l => ({ ...(l && l.at === c.updatedAt ? l : {}), at: c.updatedAt, status: next }))
    router.refresh()
  }

  const kindName = kindLabel(c.locationKind)
  const lotsN = c.lots.length

  return (
    <tbody
      id={`c-${c.id}`}
      className={`max-xl:block max-xl:mb-3 max-xl:rounded-xl max-xl:border max-xl:bg-white max-xl:dark:bg-gray-900 xl:border-t xl:border-gray-100 xl:dark:border-gray-800 scroll-mt-24 transition-colors ${flashed
        ? "max-xl:border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 xl:outline xl:outline-2 xl:outline-indigo-500 xl:-outline-offset-2"
        : "max-xl:border-gray-200 max-xl:dark:border-gray-800"}`}
    >
      <tr className="max-xl:grid max-md:grid-cols-2 md:max-xl:grid-cols-4 max-xl:gap-x-4 max-xl:gap-y-3 max-xl:p-4">
        {/* Number + kind */}
        <td className={`${td} max-xl:p-0 max-xl:order-1 whitespace-nowrap`}>
          <span className={`${mono} text-base font-bold text-gray-900 dark:text-white`}>{c.id}</span>
          <div className="mt-1"><KindBadge kind={c.kind} /></div>
        </td>

        {/* What's in it — edited in place */}
        <td className={`${td} max-xl:p-0 max-md:order-3 md:max-xl:order-2 max-xl:col-span-2 xl:min-w-[13rem] xl:w-[30%]`}>
          <div className="xl:hidden text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">What&apos;s in it</div>
          {editing ? (
            <div
              className="space-y-2"
              onKeyDown={e => {
                if (e.key === "Escape") { e.preventDefault(); setEditing(false); setError(null) }
                if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName !== "BUTTON") { e.preventDefault(); void save() }
              }}
            >
              <div>
                <label htmlFor={`cat-${c.id}`} className="sr-only">Category</label>
                <input ref={catRef} id={`cat-${c.id}`} list={CATEGORY_LIST_ID} className={input} value={cat} maxLength={80} onChange={e => setCat(e.target.value)} placeholder="Category, e.g. Comics" autoComplete="off" />
              </div>
              <div>
                <label htmlFor={`desc-${c.id}`} className="sr-only">Description</label>
                <textarea id={`desc-${c.id}`} className={`${input} min-h-16`} rows={2} value={desc} maxLength={500} onChange={e => setDesc(e.target.value)} placeholder="What's in it, e.g. 5 boxes of 1980s comics" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="inline-flex items-center justify-center min-h-11 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-40" disabled={busy === "save"} onClick={() => void save()}>
                  {busy === "save" ? "Saving…" : "Save"}
                </button>
                <button type="button" className={btn} disabled={busy === "save"} onClick={() => { setEditing(false); setError(null) }}>Cancel</button>
              </div>
              <p className="hidden desk:block text-xs text-gray-500 dark:text-gray-400">Enter saves · Esc cancels · Shift+Enter starts a new line</p>
            </div>
          ) : (
            <button type="button" onClick={startEdit} className="group w-full text-left rounded-lg -mx-2 px-2 py-1.5 min-h-11 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title={`Change the category or description of ${c.id}`}>
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className={`block text-sm font-semibold ${category ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400 font-normal italic"}`}>{category || "No category"}</span>
                  <span className={`block text-sm whitespace-pre-line ${description ? "text-gray-700 dark:text-gray-300" : "text-gray-500 dark:text-gray-400 italic"}`}>{description || "No description"}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-indigo-700 dark:text-indigo-300 group-hover:underline">Edit</span>
              </span>
            </button>
          )}
        </td>

        {/* Status */}
        <td className={`${td} max-xl:p-0 max-md:order-2 md:max-xl:order-3 max-xl:text-right`}>
          <StatusBadge status={status} />
        </td>

        {/* Where it is: location (+ its kind) and when it last moved */}
        <td className={`${td} max-xl:p-0 max-xl:order-4`}>
          <div className="xl:hidden text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Where it is</div>
          {c.locationCode ? (
            <>
              <span className={`${mono} font-semibold text-gray-900 dark:text-white`}>{c.locationCode}</span>
              {kindName && <span className="text-xs text-gray-500 dark:text-gray-400"> · {kindName}</span>}
              {c.locationName && <div className="text-xs text-gray-500 dark:text-gray-400">{c.locationName}</div>}
              <div className="text-xs text-gray-500 dark:text-gray-400">Moved {ukDateTime(c.movedAt)}</div>
            </>
          ) : (
            <span className="text-sm text-gray-500 dark:text-gray-400">Not put away yet</span>
          )}
        </td>

        {/* Label printed */}
        <td className={`${td} max-xl:p-0 max-xl:order-5`}>
          <div className="xl:hidden text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Label</div>
          {c.labelPrintedAt
            ? <span className="text-sm text-gray-700 dark:text-gray-200">Printed <span className="block text-xs text-gray-500 dark:text-gray-400">{ukDateTime(c.labelPrintedAt)}</span></span>
            : <span className="text-sm font-medium text-amber-700 dark:text-amber-300">Not printed</span>}
        </td>

        {/* Lots made from it */}
        <td className={`${td} max-xl:p-0 max-xl:order-6`}>
          <div className="xl:hidden text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Lots made</div>
          {lotsN === 0 ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">None yet</span>
          ) : (
            <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`lots-${c.id}`} className="inline-flex items-center gap-1.5 min-h-11 px-3 -mx-1 rounded-lg text-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 whitespace-nowrap">
              {lotsN} lot{lotsN === 1 ? "" : "s"} <span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
            </button>
          )}
        </td>

        {/* Actions */}
        <td className={`${td} max-xl:p-0 max-xl:order-7 max-md:col-span-2 md:max-xl:col-span-4 xl:min-w-[15rem] xl:w-[16rem]`}>
          <div className="flex flex-wrap gap-2 xl:justify-end">
            {isVoid
              ? <button type="button" className={btn} disabled title="A void receipt’s labels can’t be printed.">Print label</button>
              : <a href={`/api/goods-in/labels?containers=${encodeURIComponent(c.id)}`} target="_blank" rel="noopener" className={btn} onClick={refreshOnReturn}>Print label</a>}
            <Link href={`/tools/warehouse/move?item=${encodeURIComponent(c.id)}`} className={btn}>Move</Link>
            {!done && confirm === null && (
              <>
                <button type="button" className={btn} disabled={!!busy} onClick={() => (lotsN === 0 ? setConfirm("catalogued") : void setStatus("catalogued"))}>
                  {busy === "catalogued" ? "Saving…" : "Mark catalogued"}
                </button>
                <button type="button" className={btn} disabled={!!busy} onClick={() => setConfirm("returned")}>Mark returned</button>
              </>
            )}
            {done && (
              <button type="button" className={btn} disabled={!!busy} onClick={() => void setStatus(back)}>
                {busy === back ? "Saving…" : `Undo — back to ${CONTAINER_STATUS[back].label.toLowerCase()}`}
              </button>
            )}
          </div>
          {confirm && (
            <div role="alertdialog" className="mt-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-900 dark:text-amber-200 space-y-2">
              <p>
                {confirm === "returned"
                  ? <>Mark <span className={`${mono} font-semibold`}>{c.id}</span> as given back to the customer?</>
                  : <>No lots have been made from <span className={`${mono} font-semibold`}>{c.id}</span> yet. Mark it catalogued anyway?</>}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="inline-flex items-center justify-center min-h-11 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-40" disabled={!!busy} onClick={() => void setStatus(confirm)}>
                  {busy ? "Saving…" : confirm === "returned" ? "Yes, it's been returned" : "Yes, mark catalogued"}
                </button>
                <button type="button" className={btn} disabled={!!busy} onClick={() => setConfirm(null)}>No</button>
              </div>
            </div>
          )}
          {error && <div className="mt-2"><ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox></div>}
        </td>
      </tr>

      {open && lotsN > 0 && (
        <tr id={`lots-${c.id}`} className="max-xl:block">
          <td colSpan={7} className="px-3 pb-4 max-xl:block max-xl:px-4">
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Lots made from {c.id}</p>
            <LotList lots={c.lots} />
          </td>
        </tr>
      )}
    </tbody>
  )
}
