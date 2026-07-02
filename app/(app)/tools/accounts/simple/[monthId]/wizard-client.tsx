"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  VAT_CODES, NOMINAL_COLUMNS, columnLabel, vatFromGross,
} from "@/lib/accounting"
import {
  saveAccountingDocuments, deleteAccountingDocument,
  autoMatchStatement, setTransactionMatch, setTransactionReceiptMissing,
} from "@/lib/actions/accounting"
import ImageViewer from "../../[monthId]/accounts-viewer"

// ── Types (mirror the server page) ───────────────────────────────────────────
type Row = {
  id: string; cardholder: string; source: string; images: string[]
  supplier: string; item: string; website: string; docDate: string
  vatCode: number; gross: number; vat: number; net: number
  column: string; reviewed: boolean; aiRun: boolean; aiNotes: string | null; splitGroupId: string | null
  currency: string; originalAmount: number | null
}
type Txn = {
  id: string; postDate: string; tranDate: string; description: string; reference: string
  amount: number; currency: string; originalAmount: number | null; feeAmount: number | null
  direction: string; matchedDocIds: string[]; ignored: boolean; receiptMissing: boolean
}
type Statement = { id: string; label: string; cardholder: string; source: string; images: string[]; transactions: Txn[] }
type Unit = { key: string; docIds: string[]; amount: number; label: string }
type Entry = { id: string; cardholder: string; supplier: string; item: string; gross: number; splitGroupId: string | null }

// ── Small helpers ────────────────────────────────────────────────────────────
const round = (n: number) => Math.round((n || 0) * 100) / 100
const gbp = (n: number) => "£" + (n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const CCY: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" }
const fmtCcy = (c: string, n: number) => (CCY[c] ?? c + " ") + (n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const vatLabel = (code: number) => (code === 1 ? "20% VAT" : code === 7 ? "Personal" : "No VAT")
const ukDate = (s: string) => (s ? s.split("-").reverse().join("/") : "")

function descSim(a: string, b: string): number {
  const w = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((x) => x.length > 2))
  const wA = w(a), wB = w(b)
  const common = [...wA].filter((x) => wB.has(x)).length
  const union = new Set([...wA, ...wB]).size
  return union > 0 ? common / union : 0
}

function buildUnits(entries: Entry[]): Unit[] {
  const out: Unit[] = []
  const groups = new Map<string, Entry[]>()
  for (const e of entries) {
    if (e.splitGroupId) { const a = groups.get(e.splitGroupId) ?? []; a.push(e); groups.set(e.splitGroupId, a) }
    else out.push({ key: e.id, docIds: [e.id], amount: round(e.gross), label: `${e.supplier || "(no description)"}${e.item ? " — " + e.item : ""}` })
  }
  for (const [gid, arr] of groups) {
    if (arr.length === 1) { const e = arr[0]; out.push({ key: e.id, docIds: [e.id], amount: round(e.gross), label: `${e.supplier || "(no description)"}${e.item ? " — " + e.item : ""}` }) }
    else out.push({ key: gid, docIds: arr.map((e) => e.id), amount: round(arr.reduce((a, e) => a + e.gross, 0)), label: `${arr[0].supplier || "(no description)"} (split, ${arr.length} parts)` })
  }
  return out
}

// Subset-sum: find a set of free receipts that add up to a payment (same idea as
// the full reconcile page's Smart match, kept bounded so it stays instant).
function findCombo(target: number, cands: Unit[], txnText: string): Unit[] | null {
  const goal = Math.round(target * 100)
  if (goal <= 0) return null
  const items = cands
    .map((u) => ({ u, p: Math.round(u.amount * 100), sim: descSim(txnText, u.label) }))
    .filter((x) => x.p > 0 && x.p <= goal)
    .sort((a, b) => b.sim - a.sim || b.p - a.p)
    .slice(0, 22)
  let best: { idx: number[]; sim: number } | null = null
  let iter = 0
  const cur: number[] = []
  function dfs(i: number, sum: number, simSum: number) {
    if (iter++ > 400000 || (best && best.idx.length === 1)) return
    if (sum === goal && cur.length) {
      if (!best || cur.length < best.idx.length || (cur.length === best.idx.length && simSum > best.sim)) best = { idx: [...cur], sim: simSum }
      return
    }
    if (sum >= goal || i >= items.length || cur.length >= 10) return
    cur.push(i); dfs(i + 1, sum + items[i].p, simSum + items[i].sim); cur.pop()
    dfs(i + 1, sum, simSum)
  }
  dfs(0, 0, 0)
  const result = best as { idx: number[]; sim: number } | null
  return result ? result.idx.map((i: number) => items[i].u) : null
}

// Everything the matching step needs for one statement.
function statementState(stmt: Statement, allEntries: Entry[]) {
  const entries = stmt.cardholder ? allEntries.filter((e) => e.cardholder === stmt.cardholder) : allEntries
  const units = buildUnits(entries)
  const matchedByUnit = new Map<string, number>()
  const unitsForTxn = (t: Txn) => {
    const seen = new Set<string>(); const out: Unit[] = []
    for (const u of units) if (!seen.has(u.key) && u.docIds.some((id) => t.matchedDocIds.includes(id))) { seen.add(u.key); out.push(u) }
    return out
  }
  for (const t of stmt.transactions) {
    if (t.ignored || t.direction === "CREDIT" || !t.matchedDocIds.length) continue
    const us = unitsForTxn(t)
    if (us.length === 1) matchedByUnit.set(us[0].key, round((matchedByUnit.get(us[0].key) ?? 0) + t.amount))
    else for (const u of us) matchedByUnit.set(u.key, round((matchedByUnit.get(u.key) ?? 0) + u.amount))
  }
  const unitRemaining = (u: Unit) => round(u.amount - (matchedByUnit.get(u.key) ?? 0))
  const freeUnits = units.filter((u) => unitRemaining(u) > 0.005)
  const liveDebits = stmt.transactions.filter((t) => !t.ignored && t.direction !== "CREDIT")
  const matched = liveDebits.filter((t) => t.matchedDocIds.length)
  const missing = liveDebits.filter((t) => !t.matchedDocIds.length && t.receiptMissing)
  const pending = liveDebits.filter((t) => !t.matchedDocIds.length && !t.receiptMissing)
  return { units, unitRemaining, freeUnits, liveDebits, matched, missing, pending }
}

// ── UI atoms ─────────────────────────────────────────────────────────────────
const CARD = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"
const BIG_PRIMARY = "w-full rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-lg px-6 py-4 shadow-sm disabled:opacity-50"
const BIG_SECONDARY = "w-full rounded-2xl border-2 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-lg px-6 py-4 hover:border-emerald-400 disabled:opacity-50"

type Stage = "home" | "capture" | "read" | "review" | "statement" | "match" | "done"

export default function SimpleWizard({
  monthId, monthLabel, documents, statements, cardholders,
}: {
  monthId: string; monthLabel: string; documents: Row[]; statements: Statement[]; cardholders: string[]
}) {
  const router = useRouter()
  const [busy, startBusy] = useTransition()
  const run = (fn: () => Promise<unknown>) => startBusy(async () => { await fn(); router.refresh() })

  const [rows, setRows] = useState<Row[]>(documents)
  const [stmts, setStmts] = useState<Statement[]>(statements)
  useEffect(() => { setRows(documents) }, [documents])
  useEffect(() => { setStmts(statements) }, [statements])

  const [stage, setStage] = useState<Stage>("home")
  const [viewer, setViewer] = useState<{ images: string[]; label: string } | null>(null)

  // Capture / read
  const [cardholder, setCardholder] = useState<string>(cardholders[0] ?? "Vectis")
  useEffect(() => {
    try { const s = localStorage.getItem("accounts_cardholder"); if (s && cardholders.includes(s)) setCardholder(s) } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  function pickCardholder(v: string) { setCardholder(v); try { localStorage.setItem("accounts_cardholder", v) } catch {} }
  const cameraInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [reading, setReading] = useState<{ done: number; total: number; errors: number } | null>(null)
  const [readResult, setReadResult] = useState<{ total: number; errors: number } | null>(null)

  // Review
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<Row>>({})

  // Statement / match
  const stmtCamera = useRef<HTMLInputElement>(null)
  const stmtFile = useRef<HTMLInputElement>(null)
  const [stmtCard, setStmtCard] = useState<string>(cardholders[0] ?? "Vectis")
  const [buildingStmtId, setBuildingStmtId] = useState<string | null>(null)
  const [stmtUploading, setStmtUploading] = useState(false)
  const [stmtReading, setStmtReading] = useState(false)
  const [activeStatementId, setActiveStatementId] = useState<string | null>(null)
  const [showOthers, setShowOthers] = useState(false)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())

  // Derived counts
  const toRead = rows.filter((r) => r.source === "SCAN" && !r.aiRun)
  const toReview = rows.filter((r) => r.aiRun && !r.reviewed)
  const entries: Entry[] = rows.map((d) => ({ id: d.id, cardholder: d.cardholder, supplier: d.supplier, item: d.item, gross: d.gross, splitGroupId: d.splitGroupId }))
  const allLive = stmts.flatMap((s) => s.transactions.filter((t) => !t.ignored && t.direction !== "CREDIT"))
  const stmtMatched = allLive.filter((t) => t.matchedDocIds.length).length
  const stmtMissing = allLive.filter((t) => !t.matchedDocIds.length && t.receiptMissing).length
  const stmtToMatch = allLive.length - stmtMatched - stmtMissing

  const blankRow = (id: string, images: string[], ch: string): Row => ({
    id, cardholder: ch, source: "SCAN", images, supplier: "", item: "", website: "", docDate: "",
    vatCode: 2, gross: 0, vat: 0, net: 0, column: "vectis", reviewed: false, aiRun: false, aiNotes: null,
    splitGroupId: null, currency: "GBP", originalAmount: null,
  })

  // ── Capture ────────────────────────────────────────────────────────────────
  async function uploadScans(list: FileList | null) {
    const files = list ? Array.from(list) : []
    if (!files.length) return
    setUploading({ done: 0, total: files.length })
    for (const f of files) {
      try {
        const fd = new FormData(); fd.append("monthId", monthId); fd.append("cardholder", cardholder); fd.append("file", f)
        const res = await fetch("/api/accounts/upload", { method: "POST", body: fd })
        if (res.ok) { const j = await res.json(); setRows((rs) => [...rs, blankRow(j.id, j.images ?? [], cardholder)]) }
      } catch {}
      setUploading((u) => ({ done: (u?.done ?? 0) + 1, total: files.length }))
    }
    setUploading(null); router.refresh()
  }

  // ── Read with AI ─────────────────────────────────────────────────────────────
  async function readAll() {
    const todo = rows.filter((r) => r.source === "SCAN" && !r.aiRun)
    if (!todo.length) { setStage("review"); return }
    setReading({ done: 0, total: todo.length, errors: 0 })
    let errors = 0
    for (const d of todo) {
      try {
        const ex = await fetch("/api/accounts/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId: d.id }) })
        const ej = await ex.json().catch(() => ({}))
        if (!ex.ok) throw new Error(ej.error || "read failed")
        const ap = await fetch("/api/accounts/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId: d.id, receipts: ej.receipts ?? [] }) })
        if (!ap.ok) throw new Error("save failed")
      } catch { errors++ }
      setReading((s) => (s ? { ...s, done: s.done + 1, errors } : s))
    }
    setReading(null)
    setReadResult({ total: todo.length, errors })
    router.refresh()
  }

  // ── Review ───────────────────────────────────────────────────────────────────
  async function commitReview(row: Row, patch: Partial<Row>) {
    const merged = { ...row, ...patch }
    const gross = round(Number(merged.gross) || 0)
    const vatCode = Number(merged.vatCode)
    let vat = merged.vat
    if ("gross" in patch || "vatCode" in patch) vat = vatCode === 1 ? vatFromGross(gross, 1) : 0
    else if (vatCode !== 1) vat = 0
    setEditing(false); setDraft({})
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...merged, gross, vat, net: round(gross - vat), reviewed: true } : r)))
    startBusy(async () => {
      await saveAccountingDocuments(monthId, [{
        id: row.id, cardholder: merged.cardholder, supplier: merged.supplier ?? "", item: merged.item ?? "",
        website: merged.website ?? "", docDate: merged.docDate || null, vatCode, gross, vat, column: merged.column, reviewed: true,
      }])
      router.refresh()
    })
  }
  async function removeRow(row: Row) {
    setEditing(false); setDraft({})
    setRows((rs) => rs.filter((r) => r.id !== row.id))
    startBusy(async () => { await deleteAccountingDocument(row.id); router.refresh() })
  }

  // ── Statement upload / read ──────────────────────────────────────────────────
  async function uploadStatement(list: FileList | null) {
    const files = list ? Array.from(list) : []
    if (!files.length) return
    setStmtUploading(true)
    let sid = buildingStmtId
    try {
      for (const f of files) {
        const fd = new FormData(); fd.append("monthId", monthId)
        if (sid) fd.append("statementId", sid); else fd.append("cardholder", stmtCard)
        fd.append("file", f)
        const res = await fetch("/api/accounts/statement/upload", { method: "POST", body: fd })
        if (res.ok) { const j = await res.json(); sid = j.id }
      }
      setBuildingStmtId(sid)
    } finally { setStmtUploading(false); router.refresh() }
  }
  async function readStatement(sid: string) {
    setStmtReading(true)
    try {
      const res = await fetch("/api/accounts/statement/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statementId: sid }) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || "Couldn't read the statement — try a clearer, straighter photo."); return }
      await autoMatchStatement(sid)
      setBuildingStmtId(null); setActiveStatementId(sid); setSkipped(new Set()); setShowOthers(false); setStage("match")
    } finally { setStmtReading(false); router.refresh() }
  }

  // ── Missing-invoices email text ──────────────────────────────────────────────
  const missingByCard = stmts
    .map((s) => ({ card: s.cardholder || s.label || "Statement", txns: s.transactions.filter((t) => !t.ignored && t.direction !== "CREDIT" && t.receiptMissing) }))
    .filter((g) => g.txns.length)
  const missingText = (() => {
    if (!missingByCard.length) return ""
    const multi = missingByCard.length > 1
    const lines: string[] = ["I am missing the following invoices:", ""]
    for (const g of missingByCard) {
      if (multi) lines.push(`${g.card}:`)
      for (const t of g.txns) lines.push(`- ${ukDate(t.tranDate || t.postDate)} — ${t.description || "(no description)"} — ${gbp(t.amount)}`)
      if (multi) lines.push("")
    }
    return lines.join("\n").trim()
  })()

  // ── Header ───────────────────────────────────────────────────────────────────
  function Header({ back }: { back: () => void }) {
    return (
      <div className="flex items-center justify-between gap-3 mb-6">
        <button onClick={back} className="text-base font-semibold text-gray-500 dark:text-gray-400 hover:text-emerald-600">‹ Back</button>
        <span className="text-sm font-bold text-gray-400 uppercase tracking-wide">{monthLabel}</span>
      </div>
    )
  }

  const shell = "min-h-screen bg-gray-50 dark:bg-[#111318] px-5 py-6"
  const inner = "max-w-xl mx-auto"

  // ══════════════════════════════════════════════════════════════════════════
  // HOME / overview
  // ══════════════════════════════════════════════════════════════════════════
  if (stage === "home") {
    const steps = [
      { key: "capture" as Stage, icon: "📷", title: "Add your receipts", sub: toRead.length ? `${toRead.length} waiting to be read` : "Take photos of each invoice & receipt", done: rows.length > 0 && toRead.length === 0 },
      { key: "review" as Stage, icon: "✅", title: "Check what was read", sub: toReview.length ? `${toReview.length} still to check` : rows.length ? "All checked" : "Nothing to check yet", done: rows.length > 0 && toReview.length === 0, disabled: rows.length === 0 },
      { key: "statement" as Stage, icon: "🏦", title: "Match your card statement", sub: allLive.length ? `${stmtToMatch} payment${stmtToMatch === 1 ? "" : "s"} left to sort` : "Upload the statement to tick off payments", done: allLive.length > 0 && stmtToMatch === 0 },
      { key: "done" as Stage, icon: "📊", title: "Finish & download", sub: "See the summary and get the spreadsheet", done: false },
    ]
    return (
      <div className={shell}>
        <div className={inner}>
          <div className="flex items-center justify-between gap-3 mb-1">
            <Link href="/tools/accounts/simple" prefetch={false} className="text-base font-semibold text-gray-500 dark:text-gray-400 hover:text-emerald-600">‹ Months</Link>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{monthLabel}</h1>
          <p className="text-lg text-gray-500 dark:text-gray-400 mb-7">What would you like to do? Just tap a step.</p>

          <div className="space-y-4">
            {steps.map((s, i) => (
              <button
                key={s.key}
                onClick={() => { setEditing(false); setStage(s.key) }}
                disabled={s.disabled}
                className={`${CARD} w-full text-left p-5 flex items-center gap-4 transition-colors ${s.disabled ? "opacity-50" : "hover:border-emerald-400"}`}
              >
                <span className="text-4xl shrink-0">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-400 mb-0.5">Step {i + 1}</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{s.title}</p>
                  <p className="text-base text-gray-500 dark:text-gray-400">{s.sub}</p>
                </div>
                {s.done ? <span className="text-emerald-500 text-2xl shrink-0">✓</span> : <span className="text-gray-300 dark:text-gray-600 text-2xl shrink-0">›</span>}
              </button>
            ))}
          </div>
        </div>
        {viewer && <ImageViewer images={viewer.images} startIndex={0} label={viewer.label} onClose={() => setViewer(null)} />}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CAPTURE
  // ══════════════════════════════════════════════════════════════════════════
  if (stage === "capture") {
    const mine = rows.filter((r) => r.source === "SCAN" && !r.aiRun)
    return (
      <div className={shell}>
        <div className={inner}>
          <Header back={() => setStage("home")} />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">📷 Add your receipts</h1>
          <p className="text-base text-gray-500 dark:text-gray-400 mb-5">Take a photo of each invoice or receipt — one at a time is best.</p>

          <div className={`${CARD} p-4 mb-5`}>
            <p className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">Whose card are these on?</p>
            <div className="flex flex-wrap gap-2">
              {cardholders.map((c) => (
                <button key={c} onClick={() => pickCardholder(c)}
                  className={`px-4 py-2 rounded-xl font-semibold text-base border-2 ${cardholder === c ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <button onClick={() => cameraInput.current?.click()} disabled={!!uploading} className={BIG_PRIMARY}>
              {uploading ? `Adding ${uploading.done} of ${uploading.total}…` : "📷 Take a photo"}
            </button>
            <button onClick={() => fileInput.current?.click()} disabled={!!uploading} className={BIG_SECONDARY}>🖼 Choose from files</button>
          </div>

          {mine.length > 0 && (
            <div className="mt-6">
              <p className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">Added so far: {mine.length}</p>
              <div className="grid grid-cols-3 gap-2">
                {mine.map((r) => (
                  <div key={r.id} className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
                    {r.images[0]
                      ? <img src={r.images[0]} alt="" className="w-full h-full object-cover" onClick={() => setViewer({ images: r.images, label: "Receipt" })} />
                      : <span className="w-full h-full flex items-center justify-center text-3xl">🧾</span>}
                    <button onClick={() => removeRow(r)} disabled={busy} className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 text-white text-sm leading-none">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-7">
            <button onClick={() => { setStage("read"); readAll() }} disabled={mine.length === 0 && toRead.length === 0} className={BIG_PRIMARY}>
              Read them with the computer →
            </button>
            {mine.length === 0 && toRead.length === 0 && <p className="text-center text-sm text-gray-400 mt-2">Add at least one photo first.</p>}
          </div>

          <input ref={cameraInput} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { uploadScans(e.target.files); e.currentTarget.value = "" }} />
          <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { uploadScans(e.target.files); e.currentTarget.value = "" }} />
        </div>
        {viewer && <ImageViewer images={viewer.images} startIndex={0} label={viewer.label} onClose={() => setViewer(null)} />}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // READ
  // ══════════════════════════════════════════════════════════════════════════
  if (stage === "read") {
    return (
      <div className={shell}>
        <div className={inner}>
          <Header back={() => setStage("capture")} />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">🤖 Reading your receipts</h1>
          <p className="text-base text-gray-500 dark:text-gray-400 mb-6">The computer reads each one and works out the supplier, amount and category. This can take a moment each.</p>

          {reading ? (
            <div className={`${CARD} p-6 text-center`}>
              <p className="text-5xl mb-3">⏳</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">Reading {reading.done} of {reading.total}…</p>
              <div className="mt-4 h-3 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((reading.done / Math.max(1, reading.total)) * 100)}%` }} />
              </div>
              <p className="text-sm text-gray-400 mt-3">Please keep this screen open.</p>
            </div>
          ) : readResult ? (
            <div className={`${CARD} p-6 text-center`}>
              <p className="text-5xl mb-3">✅</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">All done — read {readResult.total}.</p>
              {readResult.errors > 0 && <p className="text-base text-amber-600 dark:text-amber-400 mt-1">{readResult.errors} couldn&apos;t be read — you can fix those by hand in the next step.</p>}
              <button onClick={() => { setReadResult(null); setStage("review") }} className={`${BIG_PRIMARY} mt-5`}>Check them →</button>
            </div>
          ) : (
            <div className={`${CARD} p-6 text-center`}>
              <p className="text-5xl mb-3">🧾</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{toRead.length} receipt{toRead.length === 1 ? "" : "s"} ready to read.</p>
              <button onClick={readAll} disabled={toRead.length === 0} className={`${BIG_PRIMARY} mt-5`}>Start reading</button>
              {toRead.length === 0 && (
                <button onClick={() => setStage("review")} className={`${BIG_SECONDARY} mt-3`}>Nothing to read — check them →</button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REVIEW — one receipt at a time
  // ══════════════════════════════════════════════════════════════════════════
  if (stage === "review") {
    const current = toReview[0]
    const doneCount = rows.filter((r) => r.aiRun).length - toReview.length
    const totalCount = rows.filter((r) => r.aiRun).length
    if (!current) {
      return (
        <div className={shell}>
          <div className={inner}>
            <Header back={() => setStage("home")} />
            <div className={`${CARD} p-8 text-center`}>
              <p className="text-5xl mb-3">🎉</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">All receipts checked!</p>
              <p className="text-base text-gray-500 dark:text-gray-400 mt-1">{totalCount} receipt{totalCount === 1 ? "" : "s"} done.</p>
              <button onClick={() => setStage("statement")} className={`${BIG_PRIMARY} mt-6`}>Next: match the statement →</button>
              <button onClick={() => setStage("home")} className={`${BIG_SECONDARY} mt-3`}>Back to steps</button>
            </div>
          </div>
        </div>
      )
    }
    const d = { ...current, ...draft } as Row
    return (
      <div className={shell}>
        <div className={inner}>
          <Header back={() => { setEditing(false); setDraft({}); setStage("home") }} />
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">✅ Check receipt</h1>
            <span className="text-base font-bold text-gray-400">{doneCount + 1} of {totalCount}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden mb-4">
            <div className="h-full bg-emerald-500" style={{ width: `${Math.round(((doneCount) / Math.max(1, totalCount)) * 100)}%` }} />
          </div>

          <div className={`${CARD} overflow-hidden`}>
            {current.images[0] && (
              <button onClick={() => setViewer({ images: current.images, label: current.supplier || "Receipt" })} className="block w-full bg-gray-100 dark:bg-black">
                <img src={current.images[0]} alt="" className="w-full max-h-72 object-contain" />
                <span className="block text-center text-xs text-gray-400 py-1">Tap the photo to zoom</span>
              </button>
            )}

            {current.aiNotes && (
              <div className="mx-4 mt-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300/60 dark:border-amber-600/40 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                ⚠ {current.aiNotes}
              </div>
            )}

            {!editing ? (
              <div className="p-4 space-y-2.5">
                <Field label="Who from" value={current.supplier || "—"} big />
                <Field label="Amount" value={current.currency !== "GBP" && current.originalAmount ? `${gbp(current.gross)}  (${fmtCcy(current.currency, current.originalAmount)})` : gbp(current.gross)} big />
                <Field label="What for" value={columnLabel(current.column)} />
                <Field label="VAT" value={vatLabel(current.vatCode)} />
                <Field label="Card" value={current.cardholder} />
                {current.docDate && <Field label="Date" value={ukDate(current.docDate)} />}
              </div>
            ) : (
              <div className="p-4 space-y-4">
                <EditField label="Who from">
                  <input value={d.supplier} onChange={(e) => setDraft((p) => ({ ...p, supplier: e.target.value }))} className={INPUT} placeholder="e.g. Shell, Amazon…" />
                </EditField>
                <EditField label="Amount (£, total paid)">
                  <input type="number" inputMode="decimal" step="0.01" value={d.gross || ""} onChange={(e) => setDraft((p) => ({ ...p, gross: Number(e.target.value) }))} className={INPUT} placeholder="0.00" />
                </EditField>
                <EditField label="What was it for?">
                  <select value={d.column} onChange={(e) => setDraft((p) => ({ ...p, column: e.target.value }))} className={INPUT}>
                    {NOMINAL_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </EditField>
                <EditField label="VAT">
                  <div className="flex gap-2">
                    {VAT_CODES.map((v) => (
                      <button key={v.code} onClick={() => setDraft((p) => ({ ...p, vatCode: v.code }))}
                        className={`flex-1 py-2.5 rounded-xl font-semibold border-2 ${d.vatCode === v.code ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>
                        {vatLabel(v.code)}
                      </button>
                    ))}
                  </div>
                </EditField>
                <EditField label="Whose card">
                  <select value={d.cardholder} onChange={(e) => setDraft((p) => ({ ...p, cardholder: e.target.value }))} className={INPUT}>
                    {Array.from(new Set([...cardholders, current.cardholder])).filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </EditField>
                <EditField label="Date (optional)">
                  <input type="date" value={d.docDate || ""} onChange={(e) => setDraft((p) => ({ ...p, docDate: e.target.value }))} className={INPUT} />
                </EditField>
              </div>
            )}
          </div>

          {!editing ? (
            <div className="mt-4 space-y-3">
              <button onClick={() => commitReview(current, {})} disabled={busy} className={BIG_PRIMARY}>✓ Looks right</button>
              <button onClick={() => { setDraft({}); setEditing(true) }} disabled={busy} className={BIG_SECONDARY}>✏ Change something</button>
              <button onClick={() => { if (confirm("Remove this — it isn't a real receipt?")) removeRow(current) }} disabled={busy} className="w-full text-center text-base font-semibold text-red-500 hover:text-red-600 py-2">🗑 Remove this one</button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <button onClick={() => commitReview(current, draft)} disabled={busy} className={BIG_PRIMARY}>Save & next →</button>
              <button onClick={() => { setEditing(false); setDraft({}) }} disabled={busy} className={BIG_SECONDARY}>Cancel</button>
            </div>
          )}
        </div>
        {viewer && <ImageViewer images={viewer.images} startIndex={0} label={viewer.label} onClose={() => setViewer(null)} />}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STATEMENT — upload / pick which statement to match
  // ══════════════════════════════════════════════════════════════════════════
  if (stage === "statement") {
    const building = buildingStmtId ? stmts.find((s) => s.id === buildingStmtId) : null
    return (
      <div className={shell}>
        <div className={inner}>
          <Header back={() => setStage("home")} />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">🏦 Your card statement</h1>
          <p className="text-base text-gray-500 dark:text-gray-400 mb-5">Upload the statement so we can tick off each payment against your receipts.</p>

          {stmts.length > 0 && (
            <div className="space-y-3 mb-6">
              {stmts.map((s) => {
                const st = statementState(s, entries)
                const total = st.liveDebits.length
                const left = st.pending.length
                const noTxns = s.transactions.length === 0
                return (
                  <div key={s.id} className={`${CARD} p-4`}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">{s.cardholder || "Statement"}</p>
                        <p className="text-sm text-gray-500">{noTxns ? "Not read yet" : `${st.matched.length} of ${total} matched · ${left} left`}</p>
                      </div>
                      {noTxns
                        ? <button onClick={() => readStatement(s.id)} disabled={stmtReading} className="rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2.5">{stmtReading ? "Reading…" : "🤖 Read it"}</button>
                        : left === 0
                          ? <span className="text-emerald-500 font-bold">All done ✓</span>
                          : <button onClick={() => { setActiveStatementId(s.id); setSkipped(new Set()); setShowOthers(false); setStage("match") }} className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2.5">Match →</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className={`${CARD} p-4`}>
            <p className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">{stmts.length ? "Add another statement" : "Upload a statement"}</p>
            <p className="text-xs text-gray-400 mb-2">Whose card / account is it?</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {cardholders.map((c) => (
                <button key={c} onClick={() => setStmtCard(c)}
                  className={`px-3.5 py-2 rounded-xl font-semibold text-sm border-2 ${stmtCard === c ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="space-y-2.5">
              <button onClick={() => stmtCamera.current?.click()} disabled={stmtUploading} className={BIG_PRIMARY}>{stmtUploading ? "Uploading…" : "📷 Photograph the statement"}</button>
              <button onClick={() => stmtFile.current?.click()} disabled={stmtUploading} className={BIG_SECONDARY}>🖼 Choose file (photo or PDF)</button>
            </div>
            {building && (
              <div className="mt-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-3">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{building.images.length} page{building.images.length === 1 ? "" : "s"} added for {building.cardholder}.</p>
                <button onClick={() => readStatement(building.id)} disabled={stmtReading} className={`${BIG_PRIMARY} mt-2`}>{stmtReading ? "Reading…" : "🤖 Read this statement →"}</button>
              </div>
            )}
          </div>

          <input ref={stmtCamera} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { uploadStatement(e.target.files); e.currentTarget.value = "" }} />
          <input ref={stmtFile} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { uploadStatement(e.target.files); e.currentTarget.value = "" }} />
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MATCH — one payment at a time
  // ══════════════════════════════════════════════════════════════════════════
  if (stage === "match") {
    const stmt = stmts.find((s) => s.id === activeStatementId)
    if (!stmt) {
      return (
        <div className={shell}>
          <div className={inner}>
            <Header back={() => setStage("statement")} />
            <div className={`${CARD} p-8 text-center`}>
              <p className="text-lg font-bold text-gray-900 dark:text-white">That statement isn&apos;t open any more.</p>
              <button onClick={() => setStage("statement")} className={`${BIG_PRIMARY} mt-5`}>Back to statements</button>
            </div>
          </div>
        </div>
      )
    }
    const st = statementState(stmt, entries)
    const ordered = [...st.pending.filter((t) => !skipped.has(t.id)), ...st.pending.filter((t) => skipped.has(t.id))]
    const current = ordered[0]
    const sortedSoFar = st.matched.length + st.missing.length
    const totalToSort = st.liveDebits.length

    if (!current) {
      // Just after "Read", the parsed transactions may not have loaded yet — show a
      // neutral loading state (not a false "all sorted") until they arrive.
      if (stmt.transactions.length === 0) {
        return (
          <div className={shell}>
            <div className={inner}>
              <Header back={() => setStage("statement")} />
              <div className={`${CARD} p-8 text-center`}>
                <p className="text-5xl mb-3">⏳</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">Getting the statement ready…</p>
                <button onClick={() => setStage("statement")} className={`${BIG_SECONDARY} mt-5`}>Back</button>
              </div>
            </div>
          </div>
        )
      }
      return (
        <div className={shell}>
          <div className={inner}>
            <Header back={() => setStage("statement")} />
            <div className={`${CARD} p-8 text-center`}>
              <p className="text-5xl mb-3">🎉</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stmt.cardholder || "Statement"} — all sorted!</p>
              <p className="text-base text-gray-500 dark:text-gray-400 mt-1">{st.matched.length} matched · {st.missing.length} with no receipt.</p>
              <button onClick={() => setStage("statement")} className={`${BIG_PRIMARY} mt-6`}>Do another statement</button>
              <button onClick={() => setStage("done")} className={`${BIG_SECONDARY} mt-3`}>Finish →</button>
            </div>
          </div>
        </div>
      )
    }

    const txnText = `${current.description} ${current.reference || ""}`
    const exact = st.freeUnits.filter((u) => Math.abs(st.unitRemaining(u) - current.amount) < 0.005).sort((a, b) => descSim(txnText, b.label) - descSim(txnText, a.label))
    const near = st.freeUnits.filter((u) => Math.abs(st.unitRemaining(u) - current.amount) >= 0.005).sort((a, b) => Math.abs(st.unitRemaining(a) - current.amount) - Math.abs(st.unitRemaining(b) - current.amount)).slice(0, 6)
    const fullyFree = st.freeUnits.filter((u) => Math.abs(st.unitRemaining(u) - u.amount) < 0.005)
    const canSmart = fullyFree.length >= 2

    const match = (u: Unit) => run(() => setTransactionMatch(current.id, [...current.matchedDocIds, ...u.docIds]))
    const smart = () => {
      const combo = findCombo(current.amount, fullyFree, txnText)
      if (!combo) { alert("Couldn't find receipts that add up to this payment. Pick them one at a time, or mark it as no receipt."); return }
      run(() => setTransactionMatch(current.id, combo.flatMap((u) => u.docIds)))
    }
    const skip = () => setSkipped((prev) => new Set(prev).add(current.id))

    return (
      <div className={shell}>
        <div className={inner}>
          <Header back={() => setStage("statement")} />
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🏦 Which receipt?</h1>
            <span className="text-base font-bold text-gray-400">{st.pending.length} left</span>
          </div>
          <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden mb-4">
            <div className="h-full bg-emerald-500" style={{ width: `${Math.round((sortedSoFar / Math.max(1, totalToSort)) * 100)}%` }} />
          </div>

          <div className={`${CARD} p-5 mb-4`}>
            <p className="text-sm text-gray-500 dark:text-gray-400">{ukDate(current.tranDate || current.postDate)} · {stmt.cardholder}</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{gbp(current.amount)}</p>
            <p className="text-lg text-gray-700 dark:text-gray-200">{current.description || "(no description)"}</p>
            {current.currency !== "GBP" && current.originalAmount != null && <p className="text-sm text-sky-600 dark:text-sky-400">{fmtCcy(current.currency, current.originalAmount)}</p>}
          </div>

          <p className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-2">Which receipt is this payment for?</p>
          <div className="space-y-2.5">
            {exact.map((u) => (
              <button key={u.key} onClick={() => match(u)} disabled={busy} className="w-full text-left rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3.5 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 disabled:opacity-50">
                <span className="font-bold text-emerald-700 dark:text-emerald-300">✓ {u.label}</span>
                <span className="block text-sm text-emerald-600 dark:text-emerald-400">{gbp(u.amount)}</span>
              </button>
            ))}
            {exact.length === 0 && <p className="text-base text-gray-400 py-1">No receipt matches this amount exactly.</p>}

            {canSmart && (
              <button onClick={smart} disabled={busy} className="w-full rounded-2xl border-2 border-indigo-400 dark:border-indigo-500 text-indigo-600 dark:text-indigo-300 font-semibold px-4 py-3 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:opacity-50">
                ✨ Find receipts that add up to {gbp(current.amount)}
              </button>
            )}

            {near.length > 0 && (
              !showOthers ? (
                <button onClick={() => setShowOthers(true)} className="w-full text-center text-base font-semibold text-gray-500 dark:text-gray-400 py-2">Show other receipts…</button>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-sm text-gray-400">Other receipts (amount doesn&apos;t match exactly):</p>
                  {near.map((u) => (
                    <button key={u.key} onClick={() => match(u)} disabled={busy} className="w-full text-left rounded-2xl border-2 border-gray-200 dark:border-gray-700 px-4 py-3 hover:border-emerald-400 disabled:opacity-50">
                      <span className="font-semibold text-gray-700 dark:text-gray-200">{u.label}</span>
                      <span className="block text-sm text-gray-500">{gbp(st.unitRemaining(u))}</span>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>

          <div className="mt-5 space-y-2.5">
            <button onClick={() => run(() => setTransactionReceiptMissing(current.id, true))} disabled={busy} className="w-full rounded-2xl border-2 border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 font-semibold px-4 py-3 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50">
              ❌ No receipt for this payment
            </button>
            {st.pending.length > 1 && (
              <button onClick={skip} disabled={busy} className="w-full text-center text-base font-semibold text-gray-500 dark:text-gray-400 py-2">⏭ Skip for now</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DONE
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className={shell}>
      <div className={inner}>
        <Header back={() => setStage("home")} />
        <div className={`${CARD} p-6`}>
          <p className="text-5xl text-center mb-3">📊</p>
          <h1 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-1">{monthLabel} — summary</h1>
          <div className="grid grid-cols-3 gap-2 my-5 text-center">
            <Stat label="Receipts" value={String(rows.filter((r) => r.aiRun).length)} />
            <Stat label="Matched" value={String(stmtMatched)} tone="emerald" />
            <Stat label="No receipt" value={String(stmtMissing)} tone="red" />
          </div>
          {stmtToMatch > 0 && <p className="text-center text-base text-amber-600 dark:text-amber-400 mb-4">{stmtToMatch} payment{stmtToMatch === 1 ? "" : "s"} still to match — you can come back to the statement step any time.</p>}
          {toReview.length > 0 && <p className="text-center text-base text-amber-600 dark:text-amber-400 mb-4">{toReview.length} receipt{toReview.length === 1 ? "" : "s"} still to check.</p>}

          <div className="space-y-3">
            {missingText && (
              <a href={`mailto:?subject=${encodeURIComponent(`Missing invoices — ${monthLabel}`)}&body=${encodeURIComponent(missingText)}`} className={`${BIG_SECONDARY} block text-center`}>
                ✉ Email the list of missing receipts ({stmtMissing})
              </a>
            )}
            <a href={`/api/accounts/export?monthId=${monthId}&reconciled=true`} className={`${BIG_PRIMARY} block text-center`}>📥 Download the spreadsheet</a>
            <Link href="/tools/accounts/simple" prefetch={false} className={`${BIG_SECONDARY} block text-center`}>🏁 All done — back to months</Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Presentational helpers ─────────────────────────────────────────────────────
const INPUT = "w-full rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-lg px-4 py-3 focus:outline-none focus:border-emerald-500"

function Field({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-gray-100 dark:border-gray-800 pb-2 last:border-0">
      <span className="text-sm font-semibold text-gray-400 shrink-0">{label}</span>
      <span className={`text-right ${big ? "text-xl font-bold text-gray-900 dark:text-white" : "text-base text-gray-700 dark:text-gray-200"}`}>{value}</span>
    </div>
  )
}
function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{label}</span>
      {children}
    </label>
  )
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "red" }) {
  const c = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : tone === "red" ? "text-red-500" : "text-gray-900 dark:text-white"
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-800/40 py-3">
      <p className={`text-3xl font-bold ${c}`}>{value}</p>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
    </div>
  )
}
