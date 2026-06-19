"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CARDHOLDERS, VAT_CODES, NOMINAL_COLUMNS, columnLabel,
} from "@/lib/accounting"
import { addManualDocument, deleteAccountingDocument, deleteAccountingMonth, saveAccountingDocuments } from "@/lib/actions/accounting"

type Row = {
  id: string; cardholder: string; source: string; imageUrl: string | null
  supplier: string; docDate: string; vatCode: number; gross: number; vat: number; net: number
  column: string; reviewed: boolean; aiNotes: string | null
}

const round = (n: number) => Math.round((n || 0) * 100) / 100
const gbp = (n: number) => "£" + (n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function AccountsMonthClient({
  monthId, monthLabel, documents,
}: { monthId: string; monthLabel: string; documents: Row[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(documents)
  useEffect(() => { setRows(documents) }, [documents])

  // ── Upload / AI batch ──────────────────────────────────────────────────────
  const [cardholder, setCardholder] = useState<string>("B Goodall")
  const [files, setFiles] = useState<File[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; errors: number }>({ done: 0, total: 0, errors: 0 })
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const [viewId, setViewId] = useState<string | null>(null)

  // Both "Take photo" and "Choose files" add to the same pending batch, so you
  // can snap several invoices (one at a time) and/or pick PDFs, then Run AI.
  function addFiles(list: FileList | null) {
    if (list && list.length) setFiles((f) => [...f, ...Array.from(list)])
  }

  async function runBatch() {
    if (files.length === 0 || running) return
    setRunning(true)
    setProgress({ done: 0, total: files.length, errors: 0 })
    let errors = 0
    for (let i = 0; i < files.length; i++) {
      try {
        const fd = new FormData()
        fd.append("monthId", monthId)
        fd.append("cardholder", cardholder)
        fd.append("file", files[i])
        const res = await fetch("/api/accounts/extract", { method: "POST", body: fd })
        if (!res.ok) errors++
      } catch { errors++ }
      setProgress({ done: i + 1, total: files.length, errors })
    }
    setRunning(false)
    setFiles([])
    if (fileInput.current) fileInput.current.value = ""
    router.refresh()
  }

  // ── Row editing ─────────────────────────────────────────────────────────────
  function patch(id: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => {
      if (r.id !== id) return r
      const next = { ...r, ...p }
      if ("vatCode" in p) next.vat = next.vatCode === 1 ? round(next.gross / 6) : 0
      if ("gross" in p && next.vatCode === 1) next.vat = round(next.gross / 6)
      next.net = round(next.gross - next.vat)
      return next
    }))
  }

  const [saving, startSave] = useTransition()
  function saveAll() {
    startSave(async () => {
      await saveAccountingDocuments(monthId, rows.map((r) => ({
        id: r.id, cardholder: r.cardholder, supplier: r.supplier, docDate: r.docDate || null,
        vatCode: r.vatCode, gross: r.gross, vat: r.vat, column: r.column, reviewed: r.reviewed,
      })))
      router.refresh()
    })
  }

  const [busy, startBusy] = useTransition()
  function addManual() {
    // Append locally (don't refresh) so any unsaved edits on other rows survive.
    startBusy(async () => {
      const { id } = await addManualDocument(monthId, cardholder)
      setRows((rs) => [...rs, {
        id, cardholder, source: "MANUAL", imageUrl: null, supplier: "", docDate: "",
        vatCode: 2, gross: 0, vat: 0, net: 0, column: "vectis", reviewed: false, aiNotes: null,
      }])
    })
  }
  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id))   // optimistic; no refresh
    startBusy(async () => { await deleteAccountingDocument(id) })
  }
  function deleteMonth() {
    if (!confirm(`Delete the whole "${monthLabel}" month and all its lines? This cannot be undone.`)) return
    startBusy(async () => { await deleteAccountingMonth(monthId); router.push("/tools/accounts") })
  }

  // ── Totals ──────────────────────────────────────────────────────────────────
  const grandGross = round(rows.reduce((a, r) => a + r.gross, 0))
  const vatReclaim  = round(rows.filter((r) => r.vatCode === 1).reduce((a, r) => a + r.vat, 0))
  const unreviewed  = rows.filter((r) => !r.reviewed).length

  const input = "px-2 py-1 rounded-lg text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
  const viewRow = rows.find((r) => r.id === viewId) ?? null

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <Link href="/tools/accounts" className="text-sm text-gray-400 hover:text-emerald-500">← All months</Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{monthLabel}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {rows.length} {rows.length === 1 ? "line" : "lines"}
            {unreviewed > 0 && <span className="text-amber-500 font-semibold"> · {unreviewed} to review</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`/api/accounts/export?monthId=${monthId}`}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            ⬇ Export to Excel
          </a>
          <button onClick={deleteMonth} disabled={busy} className="px-3 py-2 rounded-xl text-sm font-semibold text-red-500 hover:bg-red-500/10">
            Delete month
          </button>
        </div>
      </div>

      {/* Upload / scan */}
      <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 p-5 mb-6">
        <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Scan a batch</h2>
        <p className="text-xs text-gray-400 mb-3">Pick whose card it is, snap a photo or choose files (photos/PDFs), and AI reads each one. Tip: hit <span className="font-semibold">Save changes</span> before scanning another batch.</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-600 dark:text-gray-300">Whose card / account:</label>
          <select value={cardholder} onChange={(e) => setCardholder(e.target.value)} className={input}>
            {CARDHOLDERS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Camera — opens the device camera on phone/iPad; on desktop it's a file picker */}
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = "" }} />
          <button onClick={() => cameraInput.current?.click()} disabled={running}
            className="text-sm font-semibold px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-emerald-500 disabled:opacity-50">
            📷 Take photo
          </button>

          {/* Files — photos from gallery or PDFs, multiple */}
          <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = "" }} />
          <button onClick={() => fileInput.current?.click()} disabled={running}
            className="text-sm font-semibold px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-emerald-500 disabled:opacity-50">
            Choose files
          </button>

          {files.length > 0 && (
            <span className="text-sm text-gray-500">
              {files.length} ready
              <button onClick={() => setFiles([])} className="ml-2 text-gray-400 hover:text-red-500 underline">clear</button>
            </span>
          )}

          <button
            onClick={runBatch}
            disabled={running || files.length === 0}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50"
          >
            {running ? `Reading ${progress.done}/${progress.total}…` : `Run AI${files.length ? ` on ${files.length}` : ""}`}
          </button>
          <button onClick={addManual} disabled={busy} className="text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-emerald-500 px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700">
            + Add line manually
          </button>
        </div>
        {running && (
          <p className="text-xs text-gray-400 mt-2">Reading each document with AI and adding it as “{cardholder}” — leave this page open until it finishes.</p>
        )}
        {!running && progress.total > 0 && (
          <p className="text-xs text-gray-400 mt-2">Done — added {progress.total - progress.errors} of {progress.total}{progress.errors ? `, ${progress.errors} failed` : ""}.</p>
        )}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <Stat label="Total value" value={gbp(grandGross)} />
        <Stat label="VAT reclaimable" value={gbp(vatReclaim)} />
        <Stat label="Lines to review" value={String(unreviewed)} amber={unreviewed > 0} />
      </div>

      {/* Review table */}
      {rows.length === 0 ? (
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 p-8 text-center text-sm text-gray-400">
          No lines yet — scan a batch above, or add one manually.
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-200 dark:border-gray-800">
                <th className="p-3 font-semibold">Scan</th>
                <th className="p-3 font-semibold">Card</th>
                <th className="p-3 font-semibold">Supplier / description</th>
                <th className="p-3 font-semibold">Date</th>
                <th className="p-3 font-semibold">VAT</th>
                <th className="p-3 font-semibold text-right">Value</th>
                <th className="p-3 font-semibold text-right">VAT £</th>
                <th className="p-3 font-semibold text-right">Net</th>
                <th className="p-3 font-semibold">Column</th>
                <th className="p-3 font-semibold text-center">OK</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b border-gray-100 dark:border-gray-800/60 ${r.reviewed ? "" : "bg-amber-50/40 dark:bg-amber-500/5"}`}>
                  <td className="p-2">
                    <button onClick={() => setViewId(r.id)} className="block" title="Open invoice">
                      {r.imageUrl ? (
                        <img src={r.imageUrl} alt="scan" className="w-12 h-12 object-cover rounded-md border border-gray-200 dark:border-gray-700 hover:ring-2 hover:ring-emerald-500" />
                      ) : (
                        <span className="w-12 h-12 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-400 text-xs flex items-center justify-center hover:ring-2 hover:ring-emerald-500">✎</span>
                      )}
                    </button>
                  </td>
                  <td className="p-2">
                    <select value={r.cardholder} onChange={(e) => patch(r.id, { cardholder: e.target.value })} className={input}>
                      {CARDHOLDERS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="p-2">
                    <input value={r.supplier} onChange={(e) => patch(r.id, { supplier: e.target.value })} className={`${input} w-48`} placeholder="Supplier" />
                    {r.aiNotes && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 max-w-48">{r.aiNotes}</p>}
                  </td>
                  <td className="p-2">
                    <input type="date" value={r.docDate} onChange={(e) => patch(r.id, { docDate: e.target.value })} className={input} />
                  </td>
                  <td className="p-2">
                    <select value={r.vatCode} onChange={(e) => patch(r.id, { vatCode: Number(e.target.value) })} className={input}>
                      {VAT_CODES.map((v) => <option key={v.code} value={v.code}>{v.code}</option>)}
                    </select>
                  </td>
                  <td className="p-2">
                    <input type="number" step="0.01" value={r.gross} onChange={(e) => patch(r.id, { gross: Number(e.target.value) })} className={`${input} w-24 text-right`} />
                  </td>
                  <td className="p-2">
                    <input type="number" step="0.01" value={r.vat} onChange={(e) => patch(r.id, { vat: Number(e.target.value), net: round(r.gross - Number(e.target.value)) })} className={`${input} w-24 text-right`} />
                  </td>
                  <td className="p-2 text-right tabular-nums text-gray-500">{gbp(r.net)}</td>
                  <td className="p-2">
                    <select value={r.column} onChange={(e) => patch(r.id, { column: e.target.value })} className={input} title={columnLabel(r.column)}>
                      {NOMINAL_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </td>
                  <td className="p-2 text-center">
                    <input type="checkbox" checked={r.reviewed} onChange={(e) => patch(r.id, { reviewed: e.target.checked })} className="w-4 h-4 accent-emerald-600" />
                  </td>
                  <td className="p-2 text-right">
                    <button onClick={() => removeRow(r.id)} className="text-gray-400 hover:text-red-500" title="Delete line">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Save bar */}
      {rows.length > 0 && (
        <div className="sticky bottom-4 mt-4 flex justify-end">
          <button
            onClick={saveAll}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-6 py-3 rounded-xl shadow-lg disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}

      {/* Invoice detail — image alongside the saved details (auction-manager style) */}
      {viewRow && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 sm:p-8 overflow-y-auto" onClick={() => setViewId(null)}>
          <div className="bg-white dark:bg-[#1C1C1E] w-full max-w-4xl rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Invoice details</h2>
              <button onClick={() => setViewId(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="bg-gray-50 dark:bg-black/30 flex items-center justify-center p-3 min-h-[280px]">
                {viewRow.imageUrl ? (
                  <a href={viewRow.imageUrl} target="_blank" rel="noreferrer" title="Open full size">
                    <img src={viewRow.imageUrl} alt="invoice" className="max-h-[70vh] w-auto rounded-lg" />
                  </a>
                ) : (
                  <p className="text-sm text-gray-400">No image (manual line)</p>
                )}
              </div>
              <div className="p-5 space-y-3">
                <Field label="Supplier / description">
                  <input value={viewRow.supplier} onChange={(e) => patch(viewRow.id, { supplier: e.target.value })} className={`${input} w-full`} placeholder="Supplier" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Card / account">
                    <select value={viewRow.cardholder} onChange={(e) => patch(viewRow.id, { cardholder: e.target.value })} className={`${input} w-full`}>
                      {CARDHOLDERS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Date">
                    <input type="date" value={viewRow.docDate} onChange={(e) => patch(viewRow.id, { docDate: e.target.value })} className={`${input} w-full`} />
                  </Field>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="VAT code">
                    <select value={viewRow.vatCode} onChange={(e) => patch(viewRow.id, { vatCode: Number(e.target.value) })} className={`${input} w-full`}>
                      {VAT_CODES.map((v) => <option key={v.code} value={v.code}>{v.code}</option>)}
                    </select>
                  </Field>
                  <Field label="Value">
                    <input type="number" step="0.01" value={viewRow.gross} onChange={(e) => patch(viewRow.id, { gross: Number(e.target.value) })} className={`${input} w-full text-right`} />
                  </Field>
                  <Field label="VAT £">
                    <input type="number" step="0.01" value={viewRow.vat} onChange={(e) => patch(viewRow.id, { vat: Number(e.target.value), net: round(viewRow.gross - Number(e.target.value)) })} className={`${input} w-full text-right`} />
                  </Field>
                </div>
                <Field label="Nominal column">
                  <select value={viewRow.column} onChange={(e) => patch(viewRow.id, { column: e.target.value })} className={`${input} w-full`}>
                    {NOMINAL_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}{c.code ? ` (${c.code})` : ""}</option>)}
                  </select>
                </Field>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Net: <span className="font-semibold text-gray-900 dark:text-white">{gbp(viewRow.net)}</span></span>
                  <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input type="checkbox" checked={viewRow.reviewed} onChange={(e) => patch(viewRow.id, { reviewed: e.target.checked })} className="w-4 h-4 accent-emerald-600" />
                    Reviewed
                  </label>
                </div>
                {viewRow.aiNotes && <p className="text-xs text-amber-600 dark:text-amber-400">{viewRow.aiNotes}</p>}
                <div className="flex gap-2 pt-2">
                  <button onClick={() => { saveAll(); setViewId(null) }} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">Save changes</button>
                  <button onClick={() => setViewId(null)} className="text-sm font-semibold text-gray-600 dark:text-gray-300 px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700">Close</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Stat({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${amber ? "text-amber-500" : "text-gray-900 dark:text-white"}`}>{value}</p>
    </div>
  )
}
