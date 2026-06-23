"use client"

import { Fragment, useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { VAT_CODES, NOMINAL_COLUMNS, columnLabel } from "@/lib/accounting"
import { addManualDocument, deleteAccountingDocument, deleteAccountingMonth, removeDocumentPage, saveAccountingDocuments, splitAccountingDocument, bulkDeleteAccountingDocuments } from "@/lib/actions/accounting"

type Row = {
  id: string; cardholder: string; source: string; images: string[]
  supplier: string; item: string; website: string; docDate: string
  vatCode: number; gross: number; vat: number; net: number
  column: string; reviewed: boolean; aiRun: boolean; aiNotes: string | null; splitGroupId: string | null
  currency: string; originalAmount: number | null
}

const CCY_SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" }
function ccy(code: string, amount: number): string {
  const s = CCY_SYMBOL[code] ?? (code + " ")
  return s + amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Diff a re-run's proposed receipt against the current line — used in the Approve modal.
function receiptChanges(row: { supplier: string; vatCode: number; column: string; gross: number }, r: any): string[] {
  const out: string[] = []
  const oldGross = Math.round((row.gross || 0) * 100) / 100
  const newGross = Math.round((Number(r.gross) || 0) * 100) / 100
  if (Math.abs(oldGross - newGross) > 0.005) out.push(`£${oldGross.toFixed(2)} → £${newGross.toFixed(2)}`)
  const oldSup = (row.supplier || "").trim(), newSup = (r.supplier || "").trim()
  if (oldSup !== newSup) out.push(`${oldSup || "—"} → ${newSup || "—"}`)
  if (Number(row.vatCode) !== Number(r.vatCode)) out.push(`VAT ${row.vatCode} → ${r.vatCode}`)
  if ((row.column || "") !== (r.column || "")) out.push(`${columnLabel(row.column)} → ${columnLabel(r.column)}`)
  return out
}

// Drop £0 "phantom" split lines the AI sometimes invents when over-splitting a big
// scan: keep every line with an amount; only if ALL are £0 keep the first so the doc
// still shows.
function dropZeroSplits(receipts: any[]): any[] {
  if (!Array.isArray(receipts) || receipts.length <= 1) return receipts
  // Keep lines with an amount AND lines flagged "price missing" (real, just unreadable);
  // only the rest (£0 phantoms) get dropped.
  const keep = receipts.filter((r) => Number(r?.gross) > 0 || r?.priceMissing === true)
  return keep.length ? keep : [receipts[0]]
}

// Keep split-group members contiguous (in first-appearance order); singles stay put.
function orderGrouped(items: Row[]): Row[] {
  const out: Row[] = []
  const placed = new Set<string>()
  for (const r of items) {
    if (placed.has(r.id)) continue
    if (r.splitGroupId) {
      const members = items.filter((x) => x.splitGroupId === r.splitGroupId)
      if (members.length > 1) { for (const m of members) { out.push(m); placed.add(m.id) }; continue }
    }
    out.push(r); placed.add(r.id)
  }
  return out
}

const round = (n: number) => Math.round((n || 0) * 100) / 100
const gbp = (n: number) => "£" + (n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const isPdf = (u: string) => u.split("?")[0].toLowerCase().endsWith(".pdf")

export default function AccountsMonthClient({
  monthId, monthLabel, documents, cardholders,
}: { monthId: string; monthLabel: string; documents: Row[]; cardholders: string[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(documents)
  useEffect(() => { setRows(documents) }, [documents])

  // Per-row card dropdown options: the managed list + any historical value still on a doc.
  const cardOptions = Array.from(new Set([...cardholders, ...rows.map((d) => d.cardholder)].filter(Boolean)))

  const [cardholder, setCardholder] = useState<string>(cardholders[0] ?? "Vectis")
  // Pin: remember the last-picked card/account across page loads (saved the moment it's changed).
  useEffect(() => {
    try { const saved = localStorage.getItem("accounts_cardholder"); if (saved && cardholders.includes(saved)) setCardholder(saved) } catch {}
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  function pickCardholder(v: string) {
    setCardholder(v)
    try { localStorage.setItem("accounts_cardholder", v) } catch {}
  }
  const [multiPage, setMultiPage] = useState(false)
  const [currentDocId, setCurrentDocId] = useState<string | null>(null)   // the invoice new photos attach to in multi-page mode
  const [uploadProg, setUploadProg] = useState<{ done: number; total: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [aiProg, setAiProg] = useState<{ done: number; total: number; errors: number }>({ done: 0, total: 0, errors: 0 })
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const modalCamera = useRef<HTMLInputElement>(null)
  const modalFiles = useRef<HTMLInputElement>(null)
  const [viewId, setViewId] = useState<string | null>(null)
  const [addingPage, setAddingPage] = useState(false)
  const [modalBusy, setModalBusy] = useState(false)
  const [viewer, setViewer] = useState<{ images: string[]; index: number } | null>(null)
  const [aiPreview, setAiPreview] = useState<{ docId: string; receipts: any[]; capped?: boolean; cardholder?: string }[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())   // main-table rows ticked for re-run
  const [filterCard, setFilterCard] = useState("")
  const [colFilters, setColFilters] = useState({ supplier: "", item: "", website: "", date: "", vat: "", value: "", vatAmt: "", column: "", reviewed: "" })
  const [stitching, setStitching] = useState(false)
  const [applying, setApplying] = useState(false)
  const [deselected, setDeselected] = useState<Set<string>>(new Set())   // To-read scans the user has un-ticked

  // Each photo/file becomes a BLANK line straight away (image only); the AI is run
  // afterwards over all the un-read lines.
  async function uploadFiles(list: FileList | null) {
    const fileArr = list ? Array.from(list) : []
    if (!fileArr.length) return
    setUploadProg({ done: 0, total: fileArr.length })
    // In multi-page mode, the first photo starts a new invoice and the rest attach
    // to it (until "New invoice" is pressed). Otherwise every photo is its own line.
    let curId = multiPage ? currentDocId : null
    for (let i = 0; i < fileArr.length; i++) {
      try {
        if (curId) {
          const fd = new FormData(); fd.append("docId", curId); fd.append("file", fileArr[i])
          const res = await fetch("/api/accounts/add-page", { method: "POST", body: fd })
          if (res.ok) {
            const { id, images } = await res.json()
            setRows((rs) => rs.map((r) => r.id === id ? { ...r, images, aiRun: false } : r))
          }
        } else {
          const fd = new FormData(); fd.append("monthId", monthId); fd.append("cardholder", cardholder); fd.append("file", fileArr[i])
          const res = await fetch("/api/accounts/upload", { method: "POST", body: fd })
          if (res.ok) {
            const { id, images } = await res.json()
            setRows((rs) => [...rs, {
              id, cardholder, source: "SCAN", images, supplier: "", item: "", website: "", docDate: "",
              vatCode: 2, gross: 0, vat: 0, net: 0, column: "vectis", reviewed: false, aiRun: false, aiNotes: null, splitGroupId: null, currency: "GBP", originalAmount: null,
            }])
            if (multiPage) { curId = id; setCurrentDocId(id) }
          }
        }
      } catch { /* skip a failed upload */ }
      setUploadProg({ done: i + 1, total: fileArr.length })
    }
    setUploadProg(null)
  }

  // Un-read scans sit in their own "To read" area; everything else (AI-read lines
  // + manual lines) is the main table. Run AI only reads the scans the user has
  // ticked in "To read" — it never silently re-does already-read lines (re-read a
  // single read line from its detail view instead).
  const toRead = rows.filter((r) => r.images.length > 0 && !r.aiRun)
  const mainRows = rows.filter((r) => !(r.images.length > 0 && !r.aiRun))
  const selectedToRead = toRead.filter((r) => !deselected.has(r.id))
  const aiTarget = selectedToRead
  const aiLabel = `Run AI${selectedToRead.length ? ` (${selectedToRead.length})` : ""}`
  function toggleSel(id: string) {
    setDeselected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // Preview: ask the AI what it proposes for a document — returns receipts but
  // writes nothing. The user approves before anything is committed.
  async function previewOne(docId: string, pages?: number[]): Promise<{ docId: string; receipts: any[]; capped?: boolean } | null> {
    try {
      const res = await fetch("/api/accounts/extract", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId, pages }),
      })
      if (res.ok) return await res.json()
    } catch { /* skip */ }
    return null
  }
  // Apply an approved proposal — receipt[0] updates the line; the rest split into new lines.
  async function applyOne(docId: string, receipts: any[], cardholder?: string): Promise<boolean> {
    try {
      const res = await fetch("/api/accounts/apply", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId, receipts, cardholder }),
      })
      if (res.ok) {
        const { extra, ...fields } = await res.json()
        setRows((rs) => {
          const patched = rs.map((x) => x.id === docId ? { ...x, ...fields, aiRun: true } : x)
          return extra && extra.length ? [...patched, ...extra] : patched
        })
        return true
      }
    } catch { /* skip */ }
    return false
  }

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

  // Run AI = read everything (no writes) then show the proposals for approval.
  // PDFs go through a two-stage pass: split into page groups, then read each
  // invoice on its own pages. Photos are read in one pass (may be multi-receipt).
  async function runAi() {
    const target = aiTarget
    if (running || target.length === 0) return
    setRunning(true)
    setAiProg({ done: 0, total: target.length, errors: 0 })
    const previews: { docId: string; receipts: any[]; capped?: boolean; cardholder?: string }[] = []
    let errors = 0
    for (let i = 0; i < target.length; i++) {
      const r = target[i]
      try {
        const canSplit = r.images.length === 1 && isPdf(r.images[0]) && !r.aiRun
        if (canSplit) {
          const s = await fetch("/api/accounts/split", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId: r.id }) }).then((x) => x.ok ? x.json() : null)
          const groups: number[][] = s?.groups ?? []
          if (groups.length > 1) {
            const receipts: any[] = []
            for (const g of groups) {
              const d = await previewOne(r.id, g)
              for (const rr of (d?.receipts ?? [])) receipts.push({ ...rr, pages: g })
            }
            if (receipts.length) previews.push({ docId: r.id, receipts, capped: !!s?.capped, cardholder: r.cardholder })
            else errors++
          } else {
            const d = await previewOne(r.id)
            if (d?.receipts?.length) previews.push({ docId: r.id, receipts: d.receipts.map((x: any) => ({ ...x, pages: groups[0] ?? [] })), capped: !!d.capped, cardholder: r.cardholder })
            else errors++
          }
        } else {
          const d = await previewOne(r.id)
          if (d?.receipts) previews.push({ docId: r.id, receipts: d.receipts, capped: !!d.capped, cardholder: r.cardholder })
          else errors++
        }
      } catch { errors++ }
      setAiProg({ done: i + 1, total: target.length, errors })
    }
    setRunning(false)
    if (previews.length) setAiPreview(previews.map((p) => ({ ...p, receipts: dropZeroSplits(p.receipts) })))
  }

  // Re-run the AI on already-processed lines (e.g. to pick up improved extraction).
  // Re-reads each selected line from its scan and shows the Approve modal.
  function toggleSelect(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  async function rerunSelected() {
    const targets = mainRows.filter((r) => selected.has(r.id) && r.images.length > 0)
    if (running || targets.length === 0) return
    setRunning(true)
    setAiProg({ done: 0, total: targets.length, errors: 0 })
    const previews: { docId: string; receipts: any[]; capped?: boolean; cardholder?: string }[] = []
    let errors = 0
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i]
      try {
        // Multi-page PDFs: split into individual invoices first, then read each on its
        // own — reading a whole stack at once over-splits and misreads amounts (lots of £0).
        const canSplit = r.images.length === 1 && isPdf(r.images[0])
        if (canSplit) {
          const s = await fetch("/api/accounts/split", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId: r.id }) }).then((x) => x.ok ? x.json() : null)
          const groups: number[][] = s?.groups ?? []
          if (groups.length > 1) {
            const receipts: any[] = []
            for (const g of groups) {
              const d = await previewOne(r.id, g)
              for (const rr of (d?.receipts ?? [])) receipts.push({ ...rr, pages: g })
            }
            if (receipts.length) previews.push({ docId: r.id, receipts, capped: !!s?.capped, cardholder: r.cardholder })
            else errors++
          } else {
            const d = await previewOne(r.id)
            if (d?.receipts?.length) previews.push({ docId: r.id, receipts: d.receipts.map((x: any) => ({ ...x, pages: groups[0] ?? [] })), capped: !!d.capped, cardholder: r.cardholder })
            else errors++
          }
        } else {
          const d = await previewOne(r.id)
          if (d?.receipts?.length) previews.push({ docId: r.id, receipts: d.receipts, capped: !!d.capped, cardholder: r.cardholder })
          else errors++
        }
      } catch { errors++ }
      setAiProg({ done: i + 1, total: targets.length, errors })
    }
    setRunning(false)
    setSelected(new Set())
    if (previews.length) setAiPreview(previews.map((p) => ({ ...p, receipts: dropZeroSplits(p.receipts) })))
  }

  // Stitch multi-photo invoices: AI groups which ticked photos are the same invoice,
  // then merges their pages into one document (review the page counts before Run AI).
  async function stitchToRead() {
    const ids = selectedToRead.filter((r) => r.images.length > 0 && !isPdf(r.images[0])).map((r) => r.id)
    if (ids.length < 2) { alert("This joins photos that are pages of the SAME invoice into one document.\n\nFirst TICK at least 2 photos in the “To read” list (the ones that belong to one invoice), then click this again. It only works on photos not yet read."); return }
    if (!confirm(`Look across ${Math.min(ids.length, 20)} ticked photo(s) for ones that are pages of the SAME invoice and stitch them together?\n\nNothing is read or deleted — pages just join one document, which you then Run AI on.`)) return
    setStitching(true)
    try {
      const res = await fetch("/api/accounts/stitch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docIds: ids }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) alert(j.error || "Couldn't stitch the photos.")
      else if (!j.merged) alert("No multi-photo invoices found — each photo looks like its own receipt.")
    } finally { setStitching(false); router.refresh() }
  }

  // Approve the previewed proposals → commit them.
  async function applyPreview() {
    if (!aiPreview) return
    setApplying(true)
    for (const p of aiPreview) await applyOne(p.docId, p.receipts, p.cardholder)
    setApplying(false)
    setAiPreview(null)
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

  // Edit a proposed amount on the Approve screen before applying. Recomputes VAT
  // for 20%-coded lines (net is recomputed server-side on apply).
  function setPreviewGross(docId: string, i: number, gross: number) {
    const g = round(gross)
    setAiPreview((prev) => prev && prev.map((p) => p.docId !== docId ? p : {
      ...p,
      receipts: p.receipts.map((r: any, j: number) => j !== i ? r : { ...r, gross: g, vat: Number(r.vatCode) === 1 ? round(g / 6) : 0 }),
    }))
  }
  // Change which card/account a previewed document applies to, before approving.
  function setPreviewCardholder(docId: string, cardholder: string) {
    setAiPreview((prev) => prev && prev.map((p) => p.docId !== docId ? p : { ...p, cardholder }))
  }
  // Set the card on EVERY previewed document at once.
  function setAllPreviewCardholder(cardholder: string) {
    setAiPreview((prev) => prev && prev.map((p) => ({ ...p, cardholder })))
  }
  // Skip one document in the Approve modal — it won't be applied (deny just this line).
  function removePreview(docId: string) {
    setAiPreview((prev) => { const next = (prev ?? []).filter((p) => p.docId !== docId); return next.length ? next : null })
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
  // After a manual line is added, flash + scroll to it and focus its first field
  // so it's obvious it appeared (it lands at the bottom of the table).
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashRef = useRef<HTMLTableRowElement | null>(null)
  useEffect(() => {
    if (!flashId) return
    flashRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    flashRef.current?.querySelector("input")?.focus()
    const t = setTimeout(() => setFlashId(null), 2500)
    return () => clearTimeout(t)
  }, [flashId])
  function addManual() {
    startBusy(async () => {
      const { id } = await addManualDocument(monthId, cardholder)
      setRows((rs) => [...rs, {
        id, cardholder, source: "MANUAL", images: [], supplier: "", item: "", website: "", docDate: "",
        vatCode: 2, gross: 0, vat: 0, net: 0, column: "vectis", reviewed: false, aiRun: true, aiNotes: null, splitGroupId: null, currency: "GBP", originalAmount: null,
      }])
      setFlashId(id)
    })
  }
  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id))
    startBusy(async () => { await deleteAccountingDocument(id) })
  }
  // Split a line into two (e.g. accommodation vs food, which differ on VAT/nominal).
  // Creates a sibling carrying its own copy of the invoice image, starting at £0;
  // the user reallocates the amount across the two lines.
  function splitRow(id: string) {
    startBusy(async () => {
      const d = await splitAccountingDocument(id)
      setRows((rs) => {
        const withGroup = rs.map((r) => r.id === id ? { ...r, splitGroupId: d.splitGroupId } : r)
        const idx = withGroup.findIndex((r) => r.id === id)
        const newRow = { ...d, reviewed: false, aiRun: true } as Row
        return idx === -1 ? [...withGroup, newRow] : [...withGroup.slice(0, idx + 1), newRow, ...withGroup.slice(idx + 1)]
      })
      setFlashId(d.id)
    })
  }
  function deleteMonth() {
    if (!confirm(`Delete the whole "${monthLabel}" month and all its lines? This cannot be undone.`)) return
    startBusy(async () => { await deleteAccountingMonth(monthId); router.push("/tools/accounts") })
  }

  // ── Totals + grouping (main table only; un-read scans excluded) ────────────────
  const grandGross = round(mainRows.reduce((a, r) => a + r.gross, 0))
  const vatReclaim  = round(mainRows.filter((r) => r.vatCode === 1).reduce((a, r) => a + r.vat, 0))
  const unreviewed  = mainRows.filter((r) => !r.reviewed).length

  // Possible-duplicate flag (display only — does nothing): a line that shares the
  // same date AND the same amount with at least one other line in the month.
  const dupeKey = (r: Row) => `${r.docDate}|${r.gross.toFixed(2)}`
  const dupeCounts = new Map<string, number>()
  for (const r of mainRows) if (r.docDate && r.gross > 0) dupeCounts.set(dupeKey(r), (dupeCounts.get(dupeKey(r)) ?? 0) + 1)
  const isPossibleDupe = (r: Row) => !!r.docDate && r.gross > 0 && (dupeCounts.get(dupeKey(r)) ?? 0) > 1

  // Per-column filter (display only — the totals/stats above stay full-month).
  const cf = colFilters
  const inc = (val: string, q: string) => !q.trim() || (val ?? "").toLowerCase().includes(q.trim().toLowerCase())
  const displayRows = mainRows.filter((r) => {
    if (filterCard && r.cardholder !== filterCard) return false
    if (!inc(r.supplier, cf.supplier)) return false
    if (!inc(r.item, cf.item)) return false
    if (!inc(r.website, cf.website)) return false
    if (cf.date.trim() && !(r.docDate || "").includes(cf.date.trim())) return false
    if (cf.vat && String(r.vatCode) !== cf.vat) return false
    if (cf.value.trim() && !String(r.gross).includes(cf.value.trim())) return false
    if (cf.vatAmt.trim() && !String(r.vat).includes(cf.vatAmt.trim())) return false
    if (cf.column && r.column !== cf.column) return false
    if (cf.reviewed === "yes" && !r.reviewed) return false
    if (cf.reviewed === "no" && r.reviewed) return false
    return true
  })
  const filtering = !!filterCard || Object.values(colFilters).some(Boolean)
  const clearFilters = () => { setFilterCard(""); setColFilters({ supplier: "", item: "", website: "", date: "", vat: "", value: "", vatAmt: "", column: "", reviewed: "" }) }
  const miniFilter = "w-full px-1 py-0.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500"
  const groupOrder = Array.from(new Set([...cardholders, ...displayRows.map((r) => r.cardholder)].filter(Boolean)))
  const groups = groupOrder.map((name) => ({ name, items: displayRows.filter((r) => r.cardholder === name) })).filter((g) => g.items.length)
  const colSum = (items: Row[], key: string) => round(items.filter((r) => r.column === key).reduce((a, r) => a + r.net, 0))
  const TOTAL_COLS = NOMINAL_COLUMNS.length + 10

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
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Add documents</h2>
            <p className="text-xs text-gray-400 mt-1">Tag whose card it is, add your invoices/receipts using any method below, then press <span className="font-semibold">Run AI</span> to read them — you approve the results before anything saves.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <span title="Remembered for next time">📌 Card / account:</span>
            <select value={cardholder} onChange={(e) => pickCardholder(e.target.value)} className={`${input} text-sm`}>
              {cardholders.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        {/* hidden file inputs */}
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { uploadFiles(e.target.files); e.currentTarget.value = "" }} />
        <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple className="hidden"
          onChange={(e) => { uploadFiles(e.target.files); e.currentTarget.value = "" }} />

        {/* Upload methods, each explained */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button onClick={() => cameraInput.current?.click()} disabled={!!uploadProg}
            className="text-left p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-500/5 disabled:opacity-50 transition-colors">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">📷 Take photo</div>
            <p className="text-xs text-gray-400 mt-1">Snap ONE receipt with your phone/iPad camera. Each shot becomes a new line.</p>
          </button>

          <button onClick={() => { setMultiPage(false); setCurrentDocId(null); cameraInput.current?.click() }} disabled={!!uploadProg}
            className="text-left p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-500/5 disabled:opacity-50 transition-colors">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">🧾 Several receipts in one photo</div>
            <p className="text-xs text-gray-400 mt-1">Lay several small receipts out together and take ONE photo — Run AI splits each receipt onto its own line.</p>
          </button>

          <button onClick={() => fileInput.current?.click()} disabled={!!uploadProg}
            className="text-left p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-500/5 disabled:opacity-50 transition-colors">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">🖼 Choose files / PDF</div>
            <p className="text-xs text-gray-400 mt-1">Pick photos or PDFs from this device — including a multi-page PDF, or one scan holding several different invoices (Run AI splits them).</p>
          </button>

          <button onClick={() => { setMultiPage(!multiPage); setCurrentDocId(null) }}
            className={`text-left p-3 rounded-xl border transition-colors ${multiPage ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10" : "border-gray-200 dark:border-gray-700 hover:border-emerald-500"}`}>
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{multiPage ? "☑" : "☐"} Multi-page invoice</div>
            <p className="text-xs text-gray-400 mt-1">Turn on when ONE invoice spans several separate photos — each photo then joins the same invoice. Leave off for normal receipts and PDFs.</p>
          </button>
        </div>

        {multiPage && currentDocId && (
          <p className="mt-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            Adding pages to this invoice ({rows.find((r) => r.id === currentDocId)?.images.length ?? 0})
            <button onClick={() => setCurrentDocId(null)} className="ml-2 underline text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">New invoice / done</button>
          </p>
        )}

        <div className="flex items-center gap-3 flex-wrap mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={runAi} disabled={running || aiTarget.length === 0}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">
            {running ? `Reading ${aiProg.done}/${aiProg.total}…` : aiLabel}
          </button>
          <button onClick={addManual} disabled={busy} className="text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-emerald-500 px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700">
            + Add line manually
          </button>
          <p className="text-xs text-gray-400 flex-1 min-w-[14rem]">Run AI reads each new document. A photo with several receipts, or a PDF scanned from a stack of invoices, is split into separate lines — you check and approve everything before it saves.</p>
        </div>
        {uploadProg && <p className="text-xs text-gray-400 mt-2">Adding {uploadProg.done}/{uploadProg.total}…</p>}
        {running && <p className="text-xs text-gray-400 mt-2">Reading each document with AI — leave this page open until it finishes.</p>}
        {!running && aiProg.total > 0 && <p className="text-xs text-gray-400 mt-2">Read {aiProg.total - aiProg.errors} of {aiProg.total}{aiProg.errors ? `, ${aiProg.errors} failed` : ""}.</p>}
      </div>

      {/* To read — scans not yet processed by AI (tick which ones Run AI should read) */}
      {toRead.length > 0 && (
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-amber-300/60 dark:border-amber-500/30 p-4 mb-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <h2 className="text-sm font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">To read · {selectedToRead.length}/{toRead.length} selected</h2>
            <div className="flex items-center gap-3 text-xs font-semibold">
              <button onClick={() => setDeselected(new Set())} className="text-emerald-600 hover:text-emerald-500">Select all</button>
              <button onClick={() => setDeselected(new Set(toRead.map((r) => r.id)))} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Select none</button>
              <button onClick={stitchToRead} disabled={stitching} className="text-blue-600 hover:text-blue-500 disabled:opacity-40" title="Tick the photos that are pages of the SAME invoice, then click to join them into one before reading">{stitching ? "Stitching…" : "🧵 Combine same-invoice photos"}</button>
              <button onClick={() => { if (confirm(`Delete all ${toRead.length} un-read scan${toRead.length === 1 ? "" : "s"}? They won't be read or saved.`)) { const ids = toRead.map((r) => r.id); setRows((rs) => rs.filter((r) => !ids.includes(r.id))); startBusy(async () => { await bulkDeleteAccountingDocuments(ids) }) } }} disabled={busy} className="text-red-500 hover:text-red-700 disabled:opacity-50">Delete all</button>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-3">Tick the scans you want to read, then press <span className="font-semibold">Run AI</span> above — only the selected ones are read. Click a scan to view it, or use the ✕ to remove it. If some photos are pages of <span className="font-semibold">one invoice</span>, tick just those and press <span className="font-semibold">🧵 Combine same-invoice photos</span> to join them first.</p>
          <div className="flex flex-wrap gap-2">
            {toRead.map((r) => {
              const sel = !deselected.has(r.id)
              return (
                <div key={r.id} className="relative">
                  <button onClick={() => setViewId(r.id)} title="View / remove" className="block">
                    {isPdf(r.images[0])
                      ? <span className={`w-14 h-14 rounded-lg border bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-300 text-[10px] font-bold flex items-center justify-center ${sel ? "ring-2 ring-emerald-500 border-transparent" : "border-gray-200 dark:border-gray-700 opacity-60"}`}>PDF</span>
                      : <img src={r.images[0]} alt="scan" className={`w-14 h-14 object-cover rounded-lg border border-gray-200 dark:border-gray-700 ${sel ? "ring-2 ring-emerald-500" : "opacity-60"}`} />}
                  </button>
                  <label className="absolute top-1 left-1 bg-white/90 dark:bg-black/70 rounded p-0.5 cursor-pointer flex" title={sel ? "Selected — untick to skip" : "Tick to read"}>
                    <input type="checkbox" checked={sel} onChange={() => toggleSel(r.id)} className="w-4 h-4 accent-emerald-600 block" />
                  </label>
                  <button onClick={() => { if (confirm("Remove this scan? It won't be read or saved.")) removeRow(r.id) }} disabled={busy} title="Remove this scan"
                    className="absolute -bottom-1.5 -right-1.5 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center leading-none shadow disabled:opacity-50">✕</button>
                  {r.images.length > 1 && <span className="absolute -top-1 -right-1 bg-emerald-600 text-white text-[9px] font-bold rounded-full px-1 leading-tight">{r.images.length}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <Stat label="Total value" value={gbp(grandGross)} />
        <Stat label="VAT reclaimable" value={gbp(vatReclaim)} />
        <Stat label="Lines to review" value={String(unreviewed)} amber={unreviewed > 0} />
      </div>

      {/* Review grid — laid out like the spreadsheet, grouped per card, fits the screen */}
      {mainRows.length === 0 ? (
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 p-8 text-center text-sm text-gray-400">
          {toRead.length > 0 ? "Press Run AI above and approve to read the scans waiting in “To read”." : "No lines yet — add some documents above, or add a line manually."}
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-2">
            <span className="font-semibold text-gray-500 dark:text-gray-300">VAT codes:</span> 1 = 20% VAT · 2 = no VAT · 7 = personal.
            {" "}Click a column cell to file a line under that nominal code. Open a line (its image) to change its card or add pages.
          </p>
          {/* Filter — per-column boxes are in the header row below */}
          <div className="flex items-center gap-2 flex-wrap mb-2 text-xs">
            <span className="text-gray-400">Card / account:</span>
            <select value={filterCard} onChange={(e) => setFilterCard(e.target.value)} className={`${input} text-sm`}>
              <option value="">All cards</option>
              {cardholders.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="text-gray-400">— or filter any column in the row below ↓</span>
            {filtering && <button onClick={clearFilters} className="font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Clear all filters</button>}
            {filtering && <span className="text-gray-400">Showing {displayRows.length} of {mainRows.length}</span>}
          </div>
          {/* Re-run AI on already-processed lines */}
          <div className="flex items-center gap-3 flex-wrap mb-2 text-xs">
            <button onClick={() => setSelected(new Set(displayRows.filter((r) => r.images.length > 0).map((r) => r.id)))} className="font-semibold text-emerald-600 hover:text-emerald-500">Select all with a scan</button>
            {selected.size > 0 && <button onClick={() => setSelected(new Set())} className="font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Clear</button>}
            <span className="text-gray-400">{selected.size} selected</span>
            <button onClick={rerunSelected} disabled={running || selected.size === 0} className="font-semibold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40">{running ? `Re-reading ${aiProg.done}/${aiProg.total}…` : "🤖 Re-run AI on selected"}</button>
            <span className="text-gray-400">Re-reads each ticked line from its scan to pick up the latest extraction — you approve before anything changes.</span>
          </div>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 p-1">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: "3.5%" }} />
                <col style={{ width: "9.5%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "8.5%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "3%" }} />
                <col style={{ width: "5.5%" }} />
                <col style={{ width: "5.5%" }} />
                {NOMINAL_COLUMNS.map((c) => <col key={c.key} />)}
                <col style={{ width: "3%" }} />
                <col style={{ width: "4%" }} />
              </colgroup>
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-800 align-bottom">
                  <th className="p-1.5"></th>
                  <th className="p-1.5 text-left">Supplier</th>
                  <th className="p-1.5 text-left">Item / service</th>
                  <th className="p-1.5 text-left">Website</th>
                  <th className="p-1.5 text-left">Date</th>
                  <th className="p-1.5 text-center" title="VAT code — 1 = 20% VAT (reclaimable), 2 = no/zero VAT, 7 = personal">Vat</th>
                  <th className="p-1.5 text-right">Value</th>
                  <th className="p-1.5 text-right">VAT</th>
                  {NOMINAL_COLUMNS.map((c) => <th key={c.key} className="p-1.5 text-right leading-tight break-words">{c.label}<br /><span className="text-gray-500 font-normal">{c.code}</span></th>)}
                  <th className="p-1.5 text-center">OK</th>
                  <th className="p-1.5"></th>
                </tr>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/30">
                  <th className="p-1"></th>
                  <th className="p-1"><input value={cf.supplier} onChange={(e) => setColFilters((s) => ({ ...s, supplier: e.target.value }))} placeholder="filter…" className={miniFilter} /></th>
                  <th className="p-1"><input value={cf.item} onChange={(e) => setColFilters((s) => ({ ...s, item: e.target.value }))} placeholder="filter…" className={miniFilter} /></th>
                  <th className="p-1"><input value={cf.website} onChange={(e) => setColFilters((s) => ({ ...s, website: e.target.value }))} placeholder="filter…" className={miniFilter} /></th>
                  <th className="p-1"><input value={cf.date} onChange={(e) => setColFilters((s) => ({ ...s, date: e.target.value }))} placeholder="yyyy-mm" className={miniFilter} /></th>
                  <th className="p-1"><select value={cf.vat} onChange={(e) => setColFilters((s) => ({ ...s, vat: e.target.value }))} className={miniFilter}><option value="">all</option><option value="1">1</option><option value="2">2</option><option value="7">7</option></select></th>
                  <th className="p-1"><input value={cf.value} onChange={(e) => setColFilters((s) => ({ ...s, value: e.target.value }))} placeholder="filter…" className={miniFilter} /></th>
                  <th className="p-1"><input value={cf.vatAmt} onChange={(e) => setColFilters((s) => ({ ...s, vatAmt: e.target.value }))} placeholder="filter…" className={miniFilter} /></th>
                  <th className="p-1" colSpan={NOMINAL_COLUMNS.length}>
                    <select value={cf.column} onChange={(e) => setColFilters((s) => ({ ...s, column: e.target.value }))} className={miniFilter}>
                      <option value="">any nominal column</option>
                      {NOMINAL_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </th>
                  <th className="p-1"><select value={cf.reviewed} onChange={(e) => setColFilters((s) => ({ ...s, reviewed: e.target.value }))} className={miniFilter}><option value="">all</option><option value="yes">✓</option><option value="no">✗</option></select></th>
                  <th className="p-1"></th>
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 && (
                  <tr><td colSpan={TOTAL_COLS} className="p-6 text-center text-sm text-gray-400">No lines match your filter.</td></tr>
                )}
                {groups.map((g) => (
                  <Fragment key={g.name}>
                    <tr className="bg-gray-50 dark:bg-gray-800/40">
                      <td colSpan={TOTAL_COLS} className="px-3 py-1.5 font-bold text-gray-700 dark:text-gray-200 text-sm">{g.name}</td>
                    </tr>
                    {(() => {
                      const ordered = orderGrouped(g.items)
                      const headerDone = new Set<string>()
                      return ordered.map((r) => {
                      const gid = r.splitGroupId
                      const members = gid ? ordered.filter((x) => x.splitGroupId === gid) : []
                      const inGroup = members.length > 1
                      const showHeader = inGroup && !!gid && !headerDone.has(gid)
                      if (gid) headerDone.add(gid)
                      const groupTotal = inGroup ? round(members.reduce((a, m) => a + m.gross, 0)) : 0
                      return (
                      <Fragment key={r.id}>
                        {showHeader && (
                          <tr className="bg-indigo-50/60 dark:bg-indigo-500/10">
                            <td colSpan={TOTAL_COLS} className="px-3 py-1 border-l-4 border-l-indigo-400 dark:border-l-indigo-500">
                              <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">🧾 {r.supplier || "Invoice"} — one invoice, {members.length} parts — total {gbp(groupTotal)}</span>
                            </td>
                          </tr>
                        )}
                      <tr ref={r.id === flashId ? flashRef : undefined} className={`border-b border-gray-100 dark:border-gray-800/60 align-top transition-colors ${inGroup ? "border-l-4 border-l-indigo-400 dark:border-l-indigo-500" : ""} ${r.id === flashId ? "bg-emerald-100 dark:bg-emerald-500/20" : inGroup ? "bg-indigo-50/30 dark:bg-indigo-500/[0.06]" : r.reviewed ? "" : "bg-amber-50/40 dark:bg-amber-500/5"}`}>
                        <td className="p-1.5">
                          <div className="flex flex-col items-center gap-1">
                            {r.images.length > 0 && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} className="w-4 h-4 accent-blue-600" title="Select to re-run AI" />}
                            <button onClick={() => setViewId(r.id)} title="Open invoice" className="relative block">
                              {!r.images[0] ? (
                                <span className="w-9 h-9 rounded bg-gray-100 dark:bg-gray-800 text-gray-400 text-xs flex items-center justify-center hover:ring-2 hover:ring-emerald-500">✎</span>
                              ) : isPdf(r.images[0]) ? (
                                <span className="w-9 h-9 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300 text-[9px] font-bold flex items-center justify-center hover:ring-2 hover:ring-emerald-500">PDF</span>
                              ) : (
                                <img src={r.images[0]} alt="scan" className="w-9 h-9 object-cover rounded border border-gray-200 dark:border-gray-700 hover:ring-2 hover:ring-emerald-500" />
                              )}
                              {r.images.length > 1 && <span className="absolute -top-1 -right-1 bg-emerald-600 text-white text-[9px] font-bold rounded-full px-1 leading-tight">{r.images.length}</span>}
                            </button>
                          </div>
                        </td>
                        <td className="p-1.5">
                          <input value={r.supplier} onChange={(e) => patch(r.id, { supplier: e.target.value })} className={cell} placeholder="Supplier" />
                          {r.aiNotes && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 break-words">{r.aiNotes}</p>}
                          {isPossibleDupe(r) && <p className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 mt-0.5">⚠ Possible duplicate — same date &amp; amount</p>}
                        </td>
                        <td className="p-1.5">
                          <input value={r.item} onChange={(e) => patch(r.id, { item: e.target.value })} className={cell} placeholder="—" />
                        </td>
                        <td className="p-1.5">
                          <input value={r.website} onChange={(e) => patch(r.id, { website: e.target.value })} className={cell} placeholder="—" />
                        </td>
                        <td className="p-1.5">
                          <input type="date" value={r.docDate} onChange={(e) => patch(r.id, { docDate: e.target.value })} className={cell} />
                        </td>
                        <td className="p-1.5">
                          <select value={r.vatCode} onChange={(e) => patch(r.id, { vatCode: Number(e.target.value) })} className={cell}>
                            {VAT_CODES.map((v) => <option key={v.code} value={v.code}>{v.code}</option>)}
                          </select>
                        </td>
                        <td className="p-1.5">
                          <input type="number" step="0.01" value={r.gross} onChange={(e) => patch(r.id, { gross: Number(e.target.value) })} className={`${cell} text-right`} />
                          {r.currency !== "GBP" && r.originalAmount != null && (
                            <p className="text-[10px] text-sky-600 dark:text-sky-400 mt-0.5 text-right" title="Original invoice amount — GBP charged may differ on the bank statement">{ccy(r.currency, r.originalAmount)}</p>
                          )}
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
                        <td className="p-1.5 text-right whitespace-nowrap">
                          <button onClick={() => splitRow(r.id)} disabled={busy} className="text-gray-400 hover:text-emerald-600 mr-2 disabled:opacity-40" title="Split this line into parts (e.g. food vs accommodation)">✂</button>
                          <button onClick={() => removeRow(r.id)} className="text-gray-400 hover:text-red-500" title="Delete line">✕</button>
                        </td>
                      </tr>
                      </Fragment>
                      )
                      })
                      })()}
                    <tr className="border-b-2 border-gray-200 dark:border-gray-700 font-semibold text-gray-600 dark:text-gray-300 text-xs">
                      <td></td>
                      <td className="p-1.5">Total</td>
                      <td></td>
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
                      {isPdf(url) ? (
                        <span className="flex items-center justify-center gap-2 w-full py-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm font-semibold text-gray-600 dark:text-gray-300">📄 View PDF</span>
                      ) : (
                        <img src={url} alt={`Page ${i + 1}`} className="w-full rounded-lg border border-gray-200 dark:border-gray-700" />
                      )}
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
                      {VAT_CODES.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
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
                <div className="flex gap-2 pt-2 flex-wrap">
                  <button onClick={() => { saveAll(); setViewId(null) }} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">Save changes</button>
                  {viewRow.images.length > 0 && (
                    <button
                      onClick={async () => {
                        setModalBusy(true)
                        const p = await previewOne(viewRow.id)
                        const r = p?.receipts?.[0]
                        if (r) await applyOne(viewRow.id, [r])
                        setModalBusy(false)
                      }}
                      disabled={modalBusy}
                      className="text-sm font-semibold text-gray-600 dark:text-gray-300 px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 disabled:opacity-50"
                    >{modalBusy ? "Reading…" : "↻ Re-read with AI"}</button>
                  )}
                  <button onClick={() => setViewId(null)} className="text-sm font-semibold text-gray-600 dark:text-gray-300 px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700">Close</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen zoomable image viewer */}
      {viewer && <ImageViewer images={viewer.images} startIndex={viewer.index} onClose={() => setViewer(null)} />}

      {/* AI proposal — approve before anything is written */}
      {aiPreview && (
        <div className="fixed inset-0 z-[65] bg-black/70 flex items-start justify-center p-4 sm:p-8 overflow-y-auto" onClick={() => { if (!applying) setAiPreview(null) }}>
          <div className="bg-white dark:bg-[#1C1C1E] w-full max-w-2xl rounded-2xl border border-gray-200 dark:border-gray-800" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Approve AI results</h2>
              <button onClick={() => { if (!applying) setAiPreview(null) }} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
              <p className="text-xs text-gray-400">The AI read {aiPreview.length} {aiPreview.length === 1 ? "document" : "documents"}. Here&apos;s what it will fill in — tweak any amount if it&apos;s wrong, then approve to apply, or cancel to discard. Re-run lines show ↻ what changed; use ✕ to skip one. Nothing is saved until you approve.</p>
              {aiPreview.length > 1 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500 dark:text-gray-400 font-semibold">Apply ALL to card:</span>
                  <select value="" onChange={(e) => { if (e.target.value) setAllPreviewCardholder(e.target.value) }} className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                    <option value="">— choose to set them all —</option>
                    {cardholders.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
              {aiPreview.some((p) => p.capped) && (
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">⚠ A file held more than 200 invoices — only the first 200 were read. Split very large scans into smaller files and run them separately.</p>
              )}
              {aiPreview.map((p) => {
                const row = rows.find((r) => r.id === p.docId)
                return (
                  <div key={p.docId} className="flex gap-3 items-start border border-gray-200 dark:border-gray-800 rounded-xl p-3">
                    {row?.images[0] && (isPdf(row.images[0])
                      ? <span className="w-12 h-12 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-300 text-[9px] font-bold flex items-center justify-center flex-shrink-0">PDF</span>
                      : <img src={row.images[0]} alt="" className="w-12 h-12 object-cover rounded border border-gray-200 dark:border-gray-700 flex-shrink-0" />)}
                    <div className="text-sm flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[11px] text-gray-400">Apply to card:</span>
                        <select value={p.cardholder ?? row?.cardholder ?? cardholders[0]} onChange={(e) => setPreviewCardholder(p.docId, e.target.value)}
                          className="text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                          {cardholders.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      {p.receipts.length > 1 && <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1">Splits into {p.receipts.length} separate receipts:</p>}
                      {p.receipts.map((r: any, i: number) => {
                        const isPrimary = i === 0
                        const hadData = !!row && (row.gross > 0 || !!row.supplier)
                        const changes = isPrimary && hadData ? receiptChanges(row!, r) : null
                        return (
                        <div key={i}>
                          <div className="flex justify-between items-center gap-2">
                            <span className="truncate text-gray-800 dark:text-gray-200">{r.supplier || "(no supplier read)"} <span className="text-gray-400">· VAT {r.vatCode} · {columnLabel(r.column)}</span></span>
                            <span className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-gray-400 text-xs">£</span>
                              <input
                                type="number" step="0.01" value={r.gross}
                                onChange={(e) => setPreviewGross(p.docId, i, Number(e.target.value))}
                                className="w-20 text-right tabular-nums rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                              />
                            </span>
                          </div>
                          {isPrimary && hadData && (
                            changes && changes.length
                              ? <p className="text-[10px] text-amber-600 dark:text-amber-400">↻ Changed: {changes.join("  ·  ")}</p>
                              : <p className="text-[10px] text-gray-400">↻ No change</p>
                          )}
                          {!isPrimary && <p className="text-[10px] text-emerald-600 dark:text-emerald-400">+ new split line</p>}
                          {r.priceMissing && <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">⚠ Price not on the document — type it in</p>}
                        </div>
                        )
                      })}
                      {p.receipts[0]?.aiNotes && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">{p.receipts[0].aiNotes}</p>}
                    </div>
                    <button onClick={() => removePreview(p.docId)} className="text-gray-400 hover:text-red-500 text-base leading-none flex-shrink-0" title="Skip this one — don't apply">&times;</button>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-2 justify-end p-4 border-t border-gray-200 dark:border-gray-800">
              <button onClick={() => setAiPreview(null)} disabled={applying} className="text-sm font-semibold text-gray-600 dark:text-gray-300 px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 disabled:opacity-50">Cancel</button>
              <button onClick={applyPreview} disabled={applying} className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-5 py-2 rounded-xl disabled:opacity-50">{applying ? "Applying…" : "✓ Approve & apply"}</button>
            </div>
          </div>
        </div>
      )}
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
  const pdf = isPdf(images[i])
  return (
    <div className="fixed inset-0 z-[70] bg-black/90 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex items-center justify-between p-3 text-white">
        <span className="text-sm">{images.length > 1 ? `Page ${i + 1} of ${images.length}` : "Invoice"}{pdf ? " · PDF" : ` · ${Math.round(zoom * 100)}%`}</span>
        <div className="flex items-center gap-2">
          {!pdf && <button className={btn} onClick={() => setZoom((z) => clamp(z - 0.5, 1, 6))} title="Zoom out">−</button>}
          {!pdf && <button className={btn} onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }) }} title="Fit">⤢</button>}
          {!pdf && <button className={btn} onClick={() => setZoom((z) => clamp(z + 0.5, 1, 6))} title="Zoom in">+</button>}
          <a className={btn} href={images[i]} target="_blank" rel="noreferrer" title="Open in new tab">↗</a>
          <button className={btn} onClick={onClose} title="Close">×</button>
        </div>
      </div>
      {pdf ? (
        <div className="flex-1 bg-white" onClick={(e) => e.stopPropagation()}>
          <iframe src={images[i]} title={`Page ${i + 1}`} className="w-full h-full border-0" />
        </div>
      ) : (
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
      )}
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
