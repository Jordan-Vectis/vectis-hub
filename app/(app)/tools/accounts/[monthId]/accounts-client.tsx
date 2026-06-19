"use client"

import { Fragment, useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { VAT_CODES, NOMINAL_COLUMNS } from "@/lib/accounting"
import { addManualDocument, deleteAccountingDocument, deleteAccountingMonth, removeDocumentPage, saveAccountingDocuments } from "@/lib/actions/accounting"

type Row = {
  id: string; cardholder: string; source: string; images: string[]
  supplier: string; item: string; website: string; docDate: string
  vatCode: number; gross: number; vat: number; net: number
  column: string; reviewed: boolean; aiRun: boolean; aiNotes: string | null
}

const round = (n: number) => Math.round((n || 0) * 100) / 100
const gbp = (n: number) => "£" + (n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function AccountsMonthClient({
  monthId, monthLabel, documents, cardholders,
}: { monthId: string; monthLabel: string; documents: Row[]; cardholders: string[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(documents)
  useEffect(() => { setRows(documents) }, [documents])

  // Per-row card dropdown options: the managed list + any historical value still on a doc.
  const cardOptions = Array.from(new Set([...cardholders, ...rows.map((d) => d.cardholder)].filter(Boolean)))

  const [cardholder, setCardholder] = useState<string>(cardholders[0] ?? "Vectis")
  const [uploadProg, setUploadProg] = useState<{ done: number; total: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [aiProg, setAiProg] = useState<{ done: number; total: number; errors: number }>({ done: 0, total: 0, errors: 0 })
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const modalCamera = useRef<HTMLInputElement>(null)
  const modalFiles = useRef<HTMLInputElement>(null)
  const [viewId, setViewId] = useState<string | null>(null)
  const [addingPage, setAddingPage] = useState(false)
  const [viewer, setViewer] = useState<{ images: string[]; index: number } | null>(null)

  // Each photo/file becomes a BLANK line straight away (image only); the AI is run
  // afterwards over all the un-read lines.
  async function uploadFiles(list: FileList | null) {
    const fileArr = list ? Array.from(list) : []
    if (!fileArr.length) return
    setUploadProg({ done: 0, total: fileArr.length })
    for (let i = 0; i < fileArr.length; i++) {
      try {
        const fd = new FormData()
        fd.append("monthId", monthId)
        fd.append("cardholder", cardholder)
        fd.append("file", fileArr[i])
        const res = await fetch("/api/accounts/upload", { method: "POST", body: fd })
        if (res.ok) {
          const { id, images } = await res.json()
          setRows((rs) => [...rs, {
            id, cardholder, source: "SCAN", images, supplier: "", item: "", website: "", docDate: "",
            vatCode: 2, gross: 0, vat: 0, net: 0, column: "vectis", reviewed: false, aiRun: false, aiNotes: null,
          }])
        }
      } catch { /* skip a failed upload */ }
      setUploadProg({ done: i + 1, total: fileArr.length })
    }
    setUploadProg(null)
  }

  const pending = rows.filter((r) => r.images.length > 0 && !r.aiRun)

  // Add more pages to an existing line (multi-page invoices).
  async function addPages(docId: string, list: FileList | null) {
    const arr = list ? Array.from(list) : []
    if (!arr.length) return
    setAddingPage(true)
    let latest: string[] | null = null
    for (const f of arr) {
      try {
        const fd = new FormData(); fd.append("docId", docId); fd.append("file", f)
        const res = await fetch("/api/accounts/add-page", { method: "POST", body: fd })
        if (res.ok) latest = (await res.json()).images
      } catch { /* skip */ }
    }
    if (latest) setRows((rs) => rs.map((r) => r.id === docId ? { ...r, images: latest!, aiRun: false } : r))
    setAddingPage(false)
  }
  function removePage(docId: string, index: number) {
    setRows((rs) => rs.map((r) => r.id === docId ? { ...r, images: r.images.filter((_, i) => i !== index) } : r))
    startBusy(async () => { await removeDocumentPage(docId, index) })
  }

  async function runAi() {
    if (running || pending.length === 0) return
    setRunning(true)
    setAiProg({ done: 0, total: pending.length, errors: 0 })
    let errors = 0
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i]
      try {
        const res = await fetch("/api/accounts/extract", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId: r.id }),
        })
        if (res.ok) {
          const d = await res.json()
          setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, ...d, aiRun: true } : x))
        } else { errors++ }
      } catch { errors++ }
      setAiProg({ done: i + 1, total: pending.length, errors })
    }
    setRunning(false)
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
        id: r.id, cardholder: r.cardholder, supplier: r.supplier, item: r.item, website: r.website, docDate: r.docDate || null,
        vatCode: r.vatCode, gross: r.gross, vat: r.vat, column: r.column, reviewed: r.reviewed,
      })))
      router.refresh()
    })
  }

  const [busy, startBusy] = useTransition()
  function addManual() {
    startBusy(async () => {
      const { id } = await addManualDocument(monthId, cardholder)
      setRows((rs) => [...rs, {
        id, cardholder, source: "MANUAL", images: [], supplier: "", item: "", website: "", docDate: "",
        vatCode: 2, gross: 0, vat: 0, net: 0, column: "vectis", reviewed: false, aiRun: true, aiNotes: null,
      }])
    })
  }
  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id))
    startBusy(async () => { await deleteAccountingDocument(id) })
  }
  function deleteMonth() {
    if (!confirm(`Delete the whole "${monthLabel}" month and all its lines? This cannot be undone.`)) return
    startBusy(async () => { await deleteAccountingMonth(monthId); router.push("/tools/accounts") })
  }

  // ── Totals + grouping ─────────────────────────────────────────────────────────
  const grandGross = round(rows.reduce((a, r) => a + r.gross, 0))
  const vatReclaim  = round(rows.filter((r) => r.vatCode === 1).reduce((a, r) => a + r.vat, 0))
  const unreviewed  = rows.filter((r) => !r.reviewed).length

  const groupOrder = Array.from(new Set([...cardholders, ...rows.map((r) => r.cardholder)].filter(Boolean)))
  const groups = groupOrder.map((name) => ({ name, items: rows.filter((r) => r.cardholder === name) })).filter((g) => g.items.length)
  const colSum = (items: Row[], key: string) => round(items.filter((r) => r.column === key).reduce((a, r) => a + r.net, 0))
  const TOTAL_COLS = NOMINAL_COLUMNS.length + 9

  const input = "px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
  const cell = `${input} w-full text-xs`
  const viewRow = rows.find((r) => r.id === viewId) ?? null

  return (
    <div className="p-6">
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
          <a href={`/api/accounts/export?monthId=${monthId}`} className="px-3.5 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white">
            ⬇ Export to Excel
          </a>
          <button onClick={deleteMonth} disabled={busy} className="px-3 py-2 rounded-xl text-sm font-semibold text-red-500 hover:bg-red-500/10">
            Delete month
          </button>
        </div>
      </div>

      {/* Scan */}
      <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 p-5 mb-6">
        <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Scan documents</h2>
        <p className="text-xs text-gray-400 mb-3">Pick whose card it is, then take a photo or choose files. Each one is added as a line straight away — take them all, then press <span className="font-semibold">Run AI</span> to read them.</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-600 dark:text-gray-300">Whose card / account:</label>
          <select value={cardholder} onChange={(e) => setCardholder(e.target.value)} className={`${input} text-sm`}>
            {cardholders.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { uploadFiles(e.target.files); e.currentTarget.value = "" }} />
          <button onClick={() => cameraInput.current?.click()} disabled={!!uploadProg}
            className="text-sm font-semibold px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-emerald-500 disabled:opacity-50">
            📷 Take photo
          </button>

          <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple className="hidden"
            onChange={(e) => { uploadFiles(e.target.files); e.currentTarget.value = "" }} />
          <button onClick={() => fileInput.current?.click()} disabled={!!uploadProg}
            className="text-sm font-semibold px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-emerald-500 disabled:opacity-50">
            Choose files
          </button>

          <button onClick={runAi} disabled={running || pending.length === 0}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">
            {running ? `Reading ${aiProg.done}/${aiProg.total}…` : `Run AI${pending.length ? ` (${pending.length})` : ""}`}
          </button>
          <button onClick={addManual} disabled={busy} className="text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-emerald-500 px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700">
            + Add line manually
          </button>
        </div>
        {uploadProg && <p className="text-xs text-gray-400 mt-2">Adding {uploadProg.done}/{uploadProg.total}…</p>}
        {running && <p className="text-xs text-gray-400 mt-2">Reading each document with AI — leave this page open until it finishes.</p>}
        {!running && aiProg.total > 0 && <p className="text-xs text-gray-400 mt-2">Read {aiProg.total - aiProg.errors} of {aiProg.total}{aiProg.errors ? `, ${aiProg.errors} failed` : ""}.</p>}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <Stat label="Total value" value={gbp(grandGross)} />
        <Stat label="VAT reclaimable" value={gbp(vatReclaim)} />
        <Stat label="Lines to review" value={String(unreviewed)} amber={unreviewed > 0} />
      </div>

      {/* Review grid — laid out like the spreadsheet, grouped per card, fits the screen */}
      {rows.length === 0 ? (
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 p-8 text-center text-sm text-gray-400">
          No lines yet — scan some documents above, or add one manually.
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-2">Tip: click a column cell to file a line under that nominal code. Open a line (its image) to change its card/date or add more pages for a multi-page invoice.</p>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 p-1">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: "2.5%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "3%" }} />
                <col style={{ width: "5.5%" }} />
                <col style={{ width: "5.5%" }} />
                {NOMINAL_COLUMNS.map((c) => <col key={c.key} />)}
                <col style={{ width: "3%" }} />
                <col style={{ width: "2.5%" }} />
              </colgroup>
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-800 align-bottom">
                  <th className="p-1.5"></th>
                  <th className="p-1.5 text-left">Supplier</th>
                  <th className="p-1.5 text-left">Item / service</th>
                  <th className="p-1.5 text-left">Website</th>
                  <th className="p-1.5 text-center">Vat</th>
                  <th className="p-1.5 text-right">Value</th>
                  <th className="p-1.5 text-right">VAT</th>
                  {NOMINAL_COLUMNS.map((c) => <th key={c.key} className="p-1.5 text-right leading-tight break-words">{c.label}<br /><span className="text-gray-500 font-normal">{c.code}</span></th>)}
                  <th className="p-1.5 text-center">OK</th>
                  <th className="p-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.name}>
                    <tr className="bg-gray-50 dark:bg-gray-800/40">
                      <td colSpan={TOTAL_COLS} className="px-3 py-1.5 font-bold text-gray-700 dark:text-gray-200 text-sm">{g.name}</td>
                    </tr>
                    {g.items.map((r) => (
                      <tr key={r.id} className={`border-b border-gray-100 dark:border-gray-800/60 align-top ${r.reviewed ? "" : "bg-amber-50/40 dark:bg-amber-500/5"}`}>
                        <td className="p-1.5">
                          <button onClick={() => setViewId(r.id)} title="Open invoice" className="relative block">
                            {r.images[0] ? (
                              <img src={r.images[0]} alt="scan" className="w-9 h-9 object-cover rounded border border-gray-200 dark:border-gray-700 hover:ring-2 hover:ring-emerald-500" />
                            ) : (
                              <span className="w-9 h-9 rounded bg-gray-100 dark:bg-gray-800 text-gray-400 text-xs flex items-center justify-center hover:ring-2 hover:ring-emerald-500">✎</span>
                            )}
                            {r.images.length > 1 && <span className="absolute -top-1 -right-1 bg-emerald-600 text-white text-[9px] font-bold rounded-full px-1 leading-tight">{r.images.length}</span>}
                          </button>
                        </td>
                        <td className="p-1.5">
                          <input value={r.supplier} onChange={(e) => patch(r.id, { supplier: e.target.value })} className={cell} placeholder="Supplier" />
                          {r.aiNotes && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 break-words">{r.aiNotes}</p>}
                        </td>
                        <td className="p-1.5">
                          <input value={r.item} onChange={(e) => patch(r.id, { item: e.target.value })} className={cell} placeholder="—" />
                        </td>
                        <td className="p-1.5">
                          <input value={r.website} onChange={(e) => patch(r.id, { website: e.target.value })} className={cell} placeholder="—" />
                        </td>
                        <td className="p-1.5">
                          <select value={r.vatCode} onChange={(e) => patch(r.id, { vatCode: Number(e.target.value) })} className={cell}>
                            {VAT_CODES.map((v) => <option key={v.code} value={v.code}>{v.code}</option>)}
                          </select>
                        </td>
                        <td className="p-1.5">
                          <input type="number" step="0.01" value={r.gross} onChange={(e) => patch(r.id, { gross: Number(e.target.value) })} className={`${cell} text-right`} />
                        </td>
                        <td className="p-1.5">
                          <input type="number" step="0.01" value={r.vat} onChange={(e) => patch(r.id, { vat: Number(e.target.value), net: round(r.gross - Number(e.target.value)) })} className={`${cell} text-right`} />
                        </td>
                        {NOMINAL_COLUMNS.map((c) => {
                          const active = r.column === c.key
                          return (
                            <td key={c.key} className="p-1 text-right">
                              <button onClick={() => patch(r.id, { column: c.key })} title={`File under ${c.label}`}
                                className={`w-full px-1 py-1 rounded text-xs tabular-nums ${active ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold" : "text-gray-300 dark:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
                                {active ? gbp(r.net) : "·"}
                              </button>
                            </td>
                          )
                        })}
                        <td className="p-1.5 text-center">
                          <input type="checkbox" checked={r.reviewed} onChange={(e) => patch(r.id, { reviewed: e.target.checked })} className="w-4 h-4 accent-emerald-600" />
                        </td>
                        <td className="p-1.5 text-right">
                          <button onClick={() => removeRow(r.id)} className="text-gray-400 hover:text-red-500" title="Delete line">✕</button>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b-2 border-gray-200 dark:border-gray-700 font-semibold text-gray-600 dark:text-gray-300 text-xs">
                      <td></td>
                      <td className="p-1.5">Total</td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td className="p-1.5 text-right tabular-nums">{gbp(round(g.items.reduce((a, r) => a + r.gross, 0)))}</td>
                      <td className="p-1.5 text-right tabular-nums">{gbp(round(g.items.reduce((a, r) => a + r.vat, 0)))}</td>
                      {NOMINAL_COLUMNS.map((c) => {
                        const s = colSum(g.items, c.key)
                        return <td key={c.key} className="p-1 text-right tabular-nums">{s ? gbp(s) : ""}</td>
                      })}
                      <td colSpan={2}></td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Save bar */}
      {rows.length > 0 && (
        <div className="sticky bottom-4 mt-4 flex justify-end">
          <button onClick={saveAll} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-6 py-3 rounded-xl shadow-lg disabled:opacity-50">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}

      {/* Invoice detail — image alongside the saved details */}
      {viewRow && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 sm:p-8 overflow-y-auto" onClick={() => setViewId(null)}>
          <div className="bg-white dark:bg-[#1C1C1E] w-full max-w-4xl rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Invoice details</h2>
              <button onClick={() => setViewId(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="bg-gray-50 dark:bg-black/30 p-3 min-h-[280px] max-h-[80vh] overflow-y-auto space-y-2">
                {viewRow.images.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No image (manual line)</p>}
                {viewRow.images.map((url, i) => (
                  <div key={i} className="relative">
                    <button onClick={() => setViewer({ images: viewRow.images, index: i })} title={`Page ${i + 1} — view & zoom`} className="block w-full cursor-zoom-in">
                      <img src={url} alt={`Page ${i + 1}`} className="w-full rounded-lg border border-gray-200 dark:border-gray-700" />
                    </button>
                    {viewRow.images.length > 1 && <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">Page {i + 1}</span>}
                    <button onClick={() => removePage(viewRow.id, i)} disabled={busy} className="absolute top-1 right-1 bg-black/60 hover:bg-red-600 text-white text-sm rounded-full w-6 h-6 leading-none disabled:opacity-50" title="Remove this page">×</button>
                  </div>
                ))}
                <input ref={modalCamera} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => { addPages(viewRow.id, e.target.files); e.currentTarget.value = "" }} />
                <input ref={modalFiles} type="file" accept="image/*,application/pdf" multiple className="hidden"
                  onChange={(e) => { addPages(viewRow.id, e.target.files); e.currentTarget.value = "" }} />
                <div className="flex gap-2 pt-1">
                  <button onClick={() => modalCamera.current?.click()} disabled={addingPage}
                    className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-emerald-500 disabled:opacity-50">📷 Add page</button>
                  <button onClick={() => modalFiles.current?.click()} disabled={addingPage}
                    className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-emerald-500 disabled:opacity-50">Add files</button>
                </div>
                {addingPage && <p className="text-xs text-gray-400">Adding page…</p>}
              </div>
              <div className="p-5 space-y-3 text-sm">
                <Field label="Supplier"><input value={viewRow.supplier} onChange={(e) => patch(viewRow.id, { supplier: e.target.value })} className={`${input} w-full`} placeholder="Supplier" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Item / service"><input value={viewRow.item} onChange={(e) => patch(viewRow.id, { item: e.target.value })} className={`${input} w-full`} /></Field>
                  <Field label="Website"><input value={viewRow.website} onChange={(e) => patch(viewRow.id, { website: e.target.value })} className={`${input} w-full`} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Card / account">
                    <select value={viewRow.cardholder} onChange={(e) => patch(viewRow.id, { cardholder: e.target.value })} className={`${input} w-full`}>
                      {cardOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Date"><input type="date" value={viewRow.docDate} onChange={(e) => patch(viewRow.id, { docDate: e.target.value })} className={`${input} w-full`} /></Field>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="VAT code">
                    <select value={viewRow.vatCode} onChange={(e) => patch(viewRow.id, { vatCode: Number(e.target.value) })} className={`${input} w-full`}>
                      {VAT_CODES.map((v) => <option key={v.code} value={v.code}>{v.code}</option>)}
                    </select>
                  </Field>
                  <Field label="Value"><input type="number" step="0.01" value={viewRow.gross} onChange={(e) => patch(viewRow.id, { gross: Number(e.target.value) })} className={`${input} w-full text-right`} /></Field>
                  <Field label="VAT £"><input type="number" step="0.01" value={viewRow.vat} onChange={(e) => patch(viewRow.id, { vat: Number(e.target.value), net: round(viewRow.gross - Number(e.target.value)) })} className={`${input} w-full text-right`} /></Field>
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

      {/* Full-screen zoomable image viewer */}
      {viewer && <ImageViewer images={viewer.images} startIndex={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function ImageViewer({ images, startIndex, onClose }: { images: string[]; startIndex: number; onClose: () => void }) {
  const [i, setI] = useState(startIndex)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const panLast = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => { setZoom(1); setPos({ x: 0, y: 0 }) }, [i])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowRight") setI((p) => Math.min(p + 1, images.length - 1))
      else if (e.key === "ArrowLeft") setI((p) => Math.max(p - 1, 0))
      else if (e.key === "+" || e.key === "=") setZoom((z) => clamp(z + 0.25, 1, 6))
      else if (e.key === "-" || e.key === "_") setZoom((z) => clamp(z - 0.25, 1, 6))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [images.length, onClose])

  function spread() {
    const pts = [...pointers.current.values()]
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
  }
  function onPointerDown(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) pinch.current = { dist: spread(), zoom }
    else if (pointers.current.size === 1 && zoom > 1) panLast.current = { x: e.clientX, y: e.clientY }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinch.current) {
      setZoom(clamp(pinch.current.zoom * (spread() / pinch.current.dist), 1, 6))
    } else if (pointers.current.size === 1 && zoom > 1 && panLast.current) {
      setPos((p) => ({ x: p.x + (e.clientX - panLast.current!.x), y: p.y + (e.clientY - panLast.current!.y) }))
      panLast.current = { x: e.clientX, y: e.clientY }
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) { panLast.current = null; if (zoom <= 1) setPos({ x: 0, y: 0 }) }
  }

  const btn = "bg-white/15 hover:bg-white/30 text-white rounded-lg w-9 h-9 flex items-center justify-center text-lg leading-none"
  return (
    <div className="fixed inset-0 z-[70] bg-black/90 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex items-center justify-between p-3 text-white">
        <span className="text-sm">{images.length > 1 ? `Page ${i + 1} of ${images.length}` : "Invoice"} · {Math.round(zoom * 100)}%</span>
        <div className="flex items-center gap-2">
          <button className={btn} onClick={() => setZoom((z) => clamp(z - 0.5, 1, 6))} title="Zoom out">−</button>
          <button className={btn} onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }) }} title="Fit">⤢</button>
          <button className={btn} onClick={() => setZoom((z) => clamp(z + 0.5, 1, 6))} title="Zoom in">+</button>
          <a className={btn} href={images[i]} target="_blank" rel="noreferrer" title="Open in new tab">↗</a>
          <button className={btn} onClick={onClose} title="Close">×</button>
        </div>
      </div>
      <div
        className="flex-1 overflow-hidden flex items-center justify-center select-none"
        style={{ touchAction: "none", cursor: zoom > 1 ? "grab" : "zoom-in" }}
        onWheel={(e) => setZoom((z) => clamp(z - e.deltaY * 0.0015, 1, 6))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2.5))}
      >
        <img
          src={images[i]}
          alt={`Page ${i + 1}`}
          draggable={false}
          className="max-h-full max-w-full object-contain"
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`, transition: pinch.current || panLast.current ? "none" : "transform 0.08s" }}
        />
      </div>
      {images.length > 1 && (
        <>
          <button onClick={() => setI((p) => Math.max(p - 1, 0))} disabled={i === 0}
            className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/15 hover:bg-white/30 disabled:opacity-30 text-white rounded-full w-11 h-11 text-2xl leading-none">‹</button>
          <button onClick={() => setI((p) => Math.min(p + 1, images.length - 1))} disabled={i === images.length - 1}
            className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/15 hover:bg-white/30 disabled:opacity-30 text-white rounded-full w-11 h-11 text-2xl leading-none">›</button>
        </>
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
