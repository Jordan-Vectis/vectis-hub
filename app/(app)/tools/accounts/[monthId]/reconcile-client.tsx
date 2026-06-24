"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  deleteBankStatement, autoMatchStatement, setTransactionMatch,
  setTransactionIgnored, snapDocAmount, createBankStatementFromRows,
  setStatementCardholder, renameAccountingMonth, clearStatementMatches,
  setTransactionReceiptMissing, setDocumentsReserved, pullDocumentsFromReserve,
} from "@/lib/actions/accounting"
import ImageViewer from "./accounts-viewer"
import LinkSpinner from "../link-spinner"

type Entry = {
  id: string; cardholder: string; supplier: string; item: string; gross: number
  currency: string; originalAmount: number | null; splitGroupId: string | null
  docDate: string; column: string
}
type Txn = {
  id: string; postDate: string; tranDate: string; description: string; reference: string
  amount: number; currency: string; originalAmount: number | null; feeAmount: number | null
  direction: string; matchedDocIds: string[]; ignored: boolean; receiptMissing: boolean
}
type Statement = { id: string; label: string; cardholder: string; source: string; images: string[]; transactions: Txn[] }
type Unit = { key: string; docIds: string[]; amount: number; label: string }
type ReserveItem = { id: string; cardholder: string; supplier: string; item: string; gross: number; splitGroupId: string | null; monthId: string; monthLabel: string; docDate: string }

const round = (n: number) => Math.round((n || 0) * 100) / 100
const gbp = (n: number) => "£" + (n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const CCY: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" }
const fmtCcy = (c: string, n: number) => (CCY[c] ?? c + " ") + (n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function descSim(a: string, b: string): number {
  const w = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(x => x.length > 2))
  const wA = w(a), wB = w(b)
  const common = [...wA].filter(x => wB.has(x)).length
  const union = new Set([...wA, ...wB]).size
  return union > 0 ? common / union : 0
}

// Smart match: find a SUBSET of free invoices whose amounts add up exactly to a
// target payment (subset-sum, penny-exact). Bounded so it stays instant in the
// browser: ranks candidates by description similarity to the txn (so same-supplier
// chunks are tried first), caps the pool + depth + iterations, and prefers the
// combination with the fewest lines, then the best supplier match.
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

export default function AccountsReconcile({
  monthId, entries, statements, cardholders, standalone, monthLabel, reserve = [],
}: {
  monthId: string; entries: Entry[]; statements: Statement[]; cardholders: string[]
  standalone?: boolean; monthLabel?: string; reserve?: ReserveItem[]
}) {
  const router = useRouter()
  const [busy, startBusy] = useTransition()
  const [readingId, setReadingId] = useState<string | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [newCardholder, setNewCardholder] = useState<string>(cardholders[0] ?? "Vectis")
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState(monthLabel ?? "")
  const [displayLabel, setDisplayLabel] = useState(monthLabel ?? "")
  const [open, setOpen] = useState(false)
  const [missingOpen, setMissingOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [unmatchedOnly, setUnmatchedOnly] = useState(false)   // hide already-matched transactions
  const [viewer, setViewer] = useState<{ images: string[]; label: string } | null>(null)   // fullscreen statement viewer
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())   // minimised statement sections
  const [reserveFilter, setReserveFilter] = useState("")               // filter the reserve chips
  const [reserveSel, setReserveSel] = useState<Set<string>>(new Set()) // multi-selected reserve units

  useEffect(() => {
    try { const s = localStorage.getItem(`reconcile_collapsed_${monthId}`); if (s) setCollapsed(new Set(JSON.parse(s))) } catch {}
  }, [monthId])
  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id)
      try { localStorage.setItem(`reconcile_collapsed_${monthId}`, JSON.stringify([...n])) } catch {}
      return n
    })
  }
  function setAllCollapsed(ids: string[], on: boolean) {
    const n = on ? new Set(ids) : new Set<string>()
    setCollapsed(n)
    try { localStorage.setItem(`reconcile_collapsed_${monthId}`, JSON.stringify([...n])) } catch {}
  }
  const fileInput = useRef<HTMLInputElement>(null)
  const addPageInput = useRef<HTMLInputElement>(null)
  const csvInput = useRef<HTMLInputElement>(null)
  const addPageForIdRef = useRef<string | null>(null)

  const entryById = new Map(entries.map((e) => [e.id, e]))
  const run = (fn: () => Promise<any>) => startBusy(async () => { await fn(); router.refresh() })

  const allLiveTxns = statements.flatMap((s) => s.transactions.filter((t) => !t.ignored && t.direction !== "CREDIT"))
  const totalMatched = allLiveTxns.filter((t) => t.matchedDocIds.length).length
  const totalMissing = allLiveTxns.filter((t) => !t.matchedDocIds.length && t.receiptMissing).length
  const totalUnmatched = allLiveTxns.length - totalMatched - totalMissing

  // "Missing invoices" email lists the transactions you've explicitly marked as
  // "receipt missing" (a real payment with no paperwork). Grouped by card.
  const txnDate = (t: Txn) => (t.tranDate || t.postDate || "").split("-").reverse().join("/")
  const missingByCard = statements
    .map((s) => ({ card: s.cardholder || s.label || "Statement", txns: s.transactions.filter((t) => !t.ignored && t.direction !== "CREDIT" && t.receiptMissing) }))
    .filter((g) => g.txns.length)
  const missingCount = missingByCard.reduce((a, g) => a + g.txns.length, 0)
  const missingText = (() => {
    if (!missingCount) return ""
    const multi = missingByCard.length > 1
    const lines: string[] = ["I am missing the following invoices:", ""]
    for (const g of missingByCard) {
      if (multi) lines.push(`${g.card}:`)
      for (const t of g.txns) lines.push(`- ${txnDate(t)} — ${t.description || "(no description)"} — ${gbp(t.amount)}`)
      if (multi) lines.push("")
    }
    return lines.join("\n").trim()
  })()
  async function copyMissing() { try { await navigator.clipboard.writeText(missingText); setCopied(true) } catch { setCopied(false) } }

  // Shared reserve pool as match-units (split invoice = one unit), keeping its origin month.
  const reserveUnits: (Unit & { monthId: string; monthLabel: string })[] = (() => {
    const out: (Unit & { monthId: string; monthLabel: string })[] = []
    const groups = new Map<string, ReserveItem[]>()
    for (const r of reserve) {
      if (r.splitGroupId) { const a = groups.get(r.splitGroupId) ?? []; a.push(r); groups.set(r.splitGroupId, a) }
      else out.push({ key: r.id, docIds: [r.id], amount: round(r.gross), label: `${r.supplier || "(no description)"}${r.item ? " — " + r.item : ""}`, monthId: r.monthId, monthLabel: r.monthLabel })
    }
    for (const [gid, arr] of groups) {
      if (arr.length === 1) { const r = arr[0]; out.push({ key: r.id, docIds: [r.id], amount: round(r.gross), label: `${r.supplier || "(no description)"}${r.item ? " — " + r.item : ""}`, monthId: r.monthId, monthLabel: r.monthLabel }) }
      else out.push({ key: gid, docIds: arr.map((r) => r.id), amount: round(arr.reduce((a, r) => a + r.gross, 0)), label: `${arr[0].supplier || "(no description)"} (split, ${arr.length} parts)`, monthId: arr[0].monthId, monthLabel: arr[0].monthLabel })
    }
    return out
  })()
  const reserveTotal = round(reserveUnits.reduce((a, u) => a + u.amount, 0))
  const reserveShown = reserveUnits.filter((u) => { const q = reserveFilter.trim().toLowerCase(); return !q || `${u.label} ${u.monthLabel}`.toLowerCase().includes(q) })
  const reserveSelUnits = reserveShown.filter((u) => reserveSel.has(u.key))
  const reserveSelTotal = round(reserveSelUnits.reduce((a, u) => a + u.amount, 0))
  const toggleReserveSel = (key: string) => setReserveSel((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  const reserveAllShownSelected = reserveShown.length > 0 && reserveShown.every((u) => reserveSel.has(u.key))

  async function uploadFiles(files: FileList | null, statementId: string | null, cardholder?: string) {
    const arr = files ? Array.from(files) : []
    if (!arr.length) return
    setUploadingId(statementId ?? "__new__")
    let sid = statementId
    try {
      for (const f of arr) {
        const fd = new FormData(); fd.append("monthId", monthId)
        if (sid) fd.append("statementId", sid); else if (cardholder) fd.append("cardholder", cardholder)
        fd.append("file", f)
        const res = await fetch("/api/accounts/statement/upload", { method: "POST", body: fd })
        if (res.ok) { const j = await res.json(); sid = j.id }
      }
    } finally { setUploadingId(null); router.refresh() }
  }

  async function readStatement(id: string) {
    setReadingId(id)
    try {
      const res = await fetch("/api/accounts/statement/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statementId: id }) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || "Couldn't read the statement — try clearer photos.") }
    } finally { setReadingId(null); router.refresh() }
  }

  async function importCsv(file: File | null) {
    if (!file) return
    const text = await file.text()
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) { alert("CSV looks empty."); return }
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""))
    const idx = (names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)))
    const di = idx(["date"]), de = idx(["description", "detail", "narrative", "merchant", "transaction"]), ai = idx(["amount", "value", "debit", "gbp"]), ci = idx(["currency"]), oi = idx(["original", "foreign"])
    if (ai === -1) { alert("Couldn't find an Amount column in the CSV."); return }
    const rows = lines.slice(1).map((l) => {
      const c = l.split(",").map((x) => x.trim().replace(/^"|"$/g, ""))
      return {
        date: di >= 0 ? (c[di] || null) : null,
        description: de >= 0 ? c[de] : "",
        amount: Number((c[ai] || "0").replace(/[£,]/g, "")) || 0,
        currency: ci >= 0 ? c[ci] : "GBP",
        originalAmount: oi >= 0 ? Number((c[oi] || "").replace(/[^0-9.]/g, "")) || null : null,
      }
    }).filter((r) => r.amount)
    if (!rows.length) { alert("No usable rows found in the CSV."); return }
    run(async () => { await createBankStatementFromRows(monthId, file.name.replace(/\.csv$/i, ""), newCardholder, rows) })
  }

  function doRename() {
    const trimmed = renameVal.trim()
    setRenaming(false)
    if (!trimmed || trimmed === displayLabel) return
    setDisplayLabel(trimmed)
    run(() => renameAccountingMonth(monthId, trimmed))
  }

  const input = "px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
  const btn = (color: string) => `text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 ${color}`

  const statementsContent = (
    <div className="space-y-4">
      {/* Add new statement row */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-gray-500 dark:text-gray-400">New statement for:
          <select value={newCardholder} onChange={(e) => setNewCardholder(e.target.value)} className={`${input} ml-1.5 text-xs py-1`}>
            {cardholders.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button onClick={() => fileInput.current?.click()} disabled={uploadingId === "__new__"} className={btn("bg-emerald-600 hover:bg-emerald-500 text-white")}>
          {uploadingId === "__new__" ? "Uploading…" : "+ New statement (photo/PDF)"}
        </button>
        <button onClick={() => csvInput.current?.click()} disabled={uploadingId === "__new__"} className={btn("border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300")}>
          Import CSV
        </button>
      </div>

      {statements.length === 0 && (
        <p className="text-sm text-gray-400 py-4">No statements yet — upload one above.</p>
      )}

      {statements.map((stmt) => {
        const scopedEntries = stmt.cardholder ? entries.filter((e) => e.cardholder === stmt.cardholder) : entries
        const stmtUnits = buildUnits(scopedEntries)
        // Two directions of many-to-one matching, both supported:
        //  A) ONE invoice paid by SEVERAL transactions (Google Ads £500 caps) — a txn
        //     hits ONE unit and contributes its amount toward that unit's balance.
        //  B) ONE transaction covering SEVERAL invoices (World Options chunked into one
        //     PayPal payment) — a txn hits MANY units, each fully claimed by it.
        const matchedByUnit = new Map<string, number>()        // unit.key → £ claimed so far
        const txnCountByUnit = new Map<string, number>()       // unit.key → how many txns reference it
        const unitsForTxn = (t: Txn) => {
          const seen = new Set<string>(); const out: Unit[] = []
          for (const u of stmtUnits) if (!seen.has(u.key) && u.docIds.some((id) => t.matchedDocIds.includes(id))) { seen.add(u.key); out.push(u) }
          return out
        }
        for (const t of stmt.transactions) {
          if (t.ignored || t.direction === "CREDIT" || !t.matchedDocIds.length) continue
          const us = unitsForTxn(t)
          if (us.length === 1) { const u = us[0]; matchedByUnit.set(u.key, round((matchedByUnit.get(u.key) ?? 0) + t.amount)); txnCountByUnit.set(u.key, (txnCountByUnit.get(u.key) ?? 0) + 1) }
          else for (const u of us) { matchedByUnit.set(u.key, round((matchedByUnit.get(u.key) ?? 0) + u.amount)); txnCountByUnit.set(u.key, (txnCountByUnit.get(u.key) ?? 0) + 1) }
        }
        const unitRemaining = (u: Unit) => round(u.amount - (matchedByUnit.get(u.key) ?? 0))
        const freeUnits = stmtUnits.filter((u) => unitRemaining(u) > 0.005)   // still has an outstanding balance
        const liveTxns = stmt.transactions.filter((t) => !t.ignored && t.direction !== "CREDIT")
        const matchedCount = liveTxns.filter((t) => t.matchedDocIds.length).length
        const missingFlagCount = liveTxns.filter((t) => !t.matchedDocIds.length && t.receiptMissing).length
        const unmatchedCount = liveTxns.length - matchedCount - missingFlagCount   // still need a decision
        // When "Unmatched only" is on, show just the live debits still needing a match (not matched, not marked-missing).
        const visibleTxns = unmatchedOnly ? stmt.transactions.filter((t) => !t.ignored && t.direction !== "CREDIT" && t.matchedDocIds.length === 0 && !t.receiptMissing) : stmt.transactions
        const isReading = readingId === stmt.id
        const isUploading = uploadingId === stmt.id
        const allDone = liveTxns.length > 0 && unmatchedCount === 0
        const isCollapsed = collapsed.has(stmt.id)

        // Summary stats (shown when the section is expanded)
        const liveCredits = stmt.transactions.filter((t) => !t.ignored && t.direction === "CREDIT")
        const ignoredCount = stmt.transactions.filter((t) => t.ignored).length
        const totalSpend = round(liveTxns.reduce((a, t) => a + t.amount, 0))
        const matchedSpend = round(liveTxns.filter((t) => t.matchedDocIds.length).reduce((a, t) => a + t.amount, 0))
        const missingSpend = round(liveTxns.filter((t) => !t.matchedDocIds.length && t.receiptMissing).reduce((a, t) => a + t.amount, 0))
        const unmatchedSpend = round(totalSpend - matchedSpend - missingSpend)
        const creditTotal = round(liveCredits.reduce((a, t) => a + t.amount, 0))
        const freeRemaining = round(freeUnits.reduce((a, u) => a + unitRemaining(u), 0))

        return (
          <div key={stmt.id} className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            {/* Statement header */}
            <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-800 flex-wrap">
              <button onClick={() => toggleCollapsed(stmt.id)} className="flex items-center gap-2 flex-wrap text-left" title={isCollapsed ? "Expand" : "Minimise"}>
                <span className="text-gray-400 w-4 text-center">{isCollapsed ? "▸" : "▾"}</span>
                <span className="font-semibold text-gray-800 dark:text-gray-100">{stmt.cardholder || "Unassigned"}</span>
                {stmt.label && <span className="text-xs text-gray-400">— {stmt.label}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${allDone ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" : "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300"}`}>
                  {matchedCount}/{liveTxns.length} matched
                </span>
                {missingFlagCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400">{missingFlagCount} receipt missing</span>}
                {isCollapsed && unmatchedSpend > 0.005 && <span className="text-xs text-amber-600 dark:text-amber-400">· {gbp(unmatchedSpend)} unmatched</span>}
              </button>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-gray-500 dark:text-gray-400">Card:
                  <select value={stmt.cardholder} disabled={busy} onChange={(e) => run(() => setStatementCardholder(stmt.id, e.target.value))} className={`${input} ml-1 text-xs py-1`} title="Change card — re-run Auto-match after">
                    {stmt.cardholder && !cardholders.includes(stmt.cardholder) && <option value={stmt.cardholder}>{stmt.cardholder}</option>}
                    {cardholders.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                {stmt.images.length > 0 && (
                  <button onClick={() => setViewer({ images: stmt.images, label: `${stmt.cardholder || "Statement"}${stmt.label ? " — " + stmt.label : ""}` })} className={btn("border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300")} title="View the uploaded statement full-screen">
                    👁 View ({stmt.images.length})
                  </button>
                )}
                {stmt.source !== "CSV" && (
                  <>
                    <button onClick={() => { addPageForIdRef.current = stmt.id; addPageInput.current?.click() }} disabled={isUploading} className={btn("border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300")}>
                      {isUploading ? "Uploading…" : `+ Add page (${stmt.images.length})`}
                    </button>
                    <button onClick={() => readStatement(stmt.id)} disabled={isReading || stmt.images.length === 0} className={btn("bg-blue-600 hover:bg-blue-500 text-white")}>
                      {isReading ? "Reading…" : "🤖 Read (AI)"}
                    </button>
                  </>
                )}
                <button onClick={() => run(() => autoMatchStatement(stmt.id))} disabled={busy || stmt.transactions.length === 0} className={btn("bg-emerald-600 hover:bg-emerald-500 text-white")}>⚡ Auto-match</button>
                <button onClick={() => { if (confirm("Clear all matches on this statement so you can start again? (the transactions stay, just the matches/ignores are reset)")) run(() => clearStatementMatches(stmt.id)) }} disabled={busy || stmt.transactions.length === 0} className={btn("border border-amber-400 dark:border-amber-600 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10")} title="Reset every match + un-ignore — lets you re-run Auto-match cleanly">↺ Clear matches</button>
                <button onClick={() => { if (confirm("Delete this statement and its transactions?")) run(() => deleteBankStatement(stmt.id)) }} disabled={busy} className="text-xs font-semibold px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-500/10">Delete</button>
              </div>
            </div>

            {!isCollapsed && (<>

            {stmt.transactions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                <SummaryStat label="Transactions" value={String(liveTxns.length)} />
                <SummaryStat label="Total spend" value={gbp(totalSpend)} />
                <SummaryStat label="Matched" value={gbp(matchedSpend)} tone="emerald" />
                <SummaryStat label="Unmatched" value={gbp(unmatchedSpend)} tone={unmatchedSpend > 0.005 ? "amber" : "emerald"} />
                {missingFlagCount > 0 && <SummaryStat label={`Receipt missing (${missingFlagCount})`} value={gbp(missingSpend)} tone="red" />}
                {liveCredits.length > 0 && <SummaryStat label={`Credits (${liveCredits.length})`} value={gbp(creditTotal)} tone="purple" />}
                {ignoredCount > 0 && <SummaryStat label="Ignored" value={String(ignoredCount)} />}
                {freeUnits.length > 0 && <SummaryStat label={`Entered, unmatched (${freeUnits.length})`} value={gbp(freeRemaining)} tone="amber" />}
              </div>
            )}

            {stmt.cardholder && <p className="text-[11px] text-gray-400 px-4 pt-2">Matching against <span className="font-semibold text-gray-500 dark:text-gray-300">{stmt.cardholder}</span>&apos;s entered lines only.</p>}

            {stmt.transactions.length === 0 ? (
              <p className="text-sm text-gray-400 p-4">{stmt.source === "CSV" ? "No rows imported." : "No transactions yet — press Read (AI) to extract them."}</p>
            ) : visibleTxns.length === 0 ? (
              <p className="text-sm text-emerald-600 dark:text-emerald-400 p-4">✓ Nothing unmatched on this statement.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-800">
                      <th className="text-left p-1.5">Date</th>
                      <th className="text-left p-1.5">Description</th>
                      <th className="text-right p-1.5">Amount</th>
                      <th className="text-left p-1.5">Match</th>
                      <th className="p-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTxns.map((t) => {
                      const credit = t.direction === "CREDIT"
                      // The entered line(s) attached to this transaction (as units, so a split
                      // invoice shows as one). Several units = a chunked payment covering many invoices.
                      const matchedUnits: Unit[] = (() => {
                        const seen = new Set<string>(); const out: Unit[] = []
                        for (const id of t.matchedDocIds) {
                          const u = stmtUnits.find((x) => x.docIds.includes(id))
                          if (u) { if (!seen.has(u.key)) { seen.add(u.key); out.push(u) } }
                          else { const e = entryById.get(id); if (e && !seen.has(id)) { seen.add(id); out.push({ key: id, docIds: [id], amount: round(e.gross), label: `${e.supplier || "(no description)"}${e.item ? " — " + e.item : ""}` }) } }
                        }
                        return out
                      })()
                      const isMatched = matchedUnits.length > 0
                      // How much of THIS payment the attached invoices account for. A single
                      // invoice ≥ the payment is a part-payment of a bigger invoice (fully uses
                      // the payment); otherwise sum the attached pieces.
                      const singleBig = matchedUnits.length === 1 && matchedUnits[0].amount >= t.amount - 0.005
                      const covered = singleBig ? t.amount : round(matchedUnits.reduce((a, u) => a + u.amount, 0))
                      const remaining = round(t.amount - covered)   // still to allocate on this payment

                      const txnText = `${t.description} ${t.reference || ""}`
                      // Suggestions target the OUTSTANDING amount on this payment (so after you add
                      // one invoice, the next dropdown looks for what fits the remainder).
                      const target = isMatched ? remaining : t.amount
                      const exactCands = freeUnits.filter((u) => Math.abs(unitRemaining(u) - target) < 0.005)
                      const partCands = freeUnits.filter((u) => unitRemaining(u) - target > 0.005)
                        .sort((a, b) => descSim(txnText, b.label) - descSim(txnText, a.label))
                      let kind: "exact" | "part" | "near"
                      let suggestions: Unit[]
                      if (exactCands.length) { kind = "exact"; suggestions = exactCands.slice().sort((a, b) => descSim(txnText, b.label) - descSim(txnText, a.label)) }
                      else if (partCands.length) { kind = "part"; suggestions = partCands }
                      else { kind = "near"; suggestions = freeUnits.slice().sort((a, b) => Math.abs(unitRemaining(a) - target) - Math.abs(unitRemaining(b) - target)).slice(0, 5) }
                      const optLabel = (u: Unit) => {
                        const rem = unitRemaining(u)
                        const partial = Math.abs(rem - u.amount) > 0.005   // already part-paid
                        if (kind === "part") return `↪ part of ${u.label} · ${gbp(rem)} outstanding`
                        if (kind === "near") return `~ ${u.label} · ${gbp(rem)}${partial ? " left" : ""}`
                        return `✓ ${u.label} · ${gbp(rem)}${partial ? " left" : ""}`
                      }
                      const placeholder = kind === "exact" ? `— ${suggestions.length} match${suggestions.length !== 1 ? "es" : ""} found —`
                        : kind === "part" ? `— part-payment of a larger invoice? —`
                        : `— no exact match (${suggestions.length} nearest) —`
                      const addMatch = (u: Unit) => run(() => setTransactionMatch(t.id, [...t.matchedDocIds, ...u.docIds]))
                      const removeMatch = (u: Unit) => run(() => setTransactionMatch(t.id, t.matchedDocIds.filter((id) => !u.docIds.includes(id))))
                      // Smart match: only untouched (fully-free) lines are candidates for a sum.
                      const fullyFree = freeUnits.filter((u) => Math.abs(unitRemaining(u) - u.amount) < 0.005)
                      const canSmart = fullyFree.length >= 2 && remaining > 0.005
                      const smartMatch = () => {
                        const combo = findCombo(target, fullyFree, txnText)
                        if (!combo) { alert(`Couldn't find a combination of entered lines that adds up to ${gbp(target)}. Add them manually, or some may not be entered yet.`); return }
                        run(() => setTransactionMatch(t.id, [...t.matchedDocIds, ...combo.flatMap((u) => u.docIds)]))
                      }

                      return (
                        <tr key={t.id} className={`border-b border-gray-100 dark:border-gray-800/60 align-top ${t.ignored ? "opacity-40" : isMatched ? "bg-emerald-50/40 dark:bg-emerald-500/5" : credit ? "" : t.receiptMissing ? "bg-red-50/40 dark:bg-red-500/5" : "bg-amber-50/40 dark:bg-amber-500/5"}`}>
                          <td className="p-1.5 whitespace-nowrap text-gray-500 dark:text-gray-400 text-xs">{(t.tranDate || t.postDate || "").split("-").reverse().join("/")}</td>
                          <td className="p-1.5">
                            <span className="text-gray-800 dark:text-gray-200">{t.description || "(no description)"}</span>
                            {t.reference && <span className="text-gray-400 text-xs"> · {t.reference}</span>}
                            {credit && <span className="ml-1 text-[10px] text-purple-600 dark:text-purple-400">(payment/credit)</span>}
                          </td>
                          <td className="p-1.5 text-right whitespace-nowrap tabular-nums font-semibold text-gray-900 dark:text-gray-100">
                            {gbp(t.amount)}
                            {t.currency !== "GBP" && t.originalAmount != null && <div className="text-[10px] font-normal text-sky-600 dark:text-sky-400">{fmtCcy(t.currency, t.originalAmount)}</div>}
                          </td>
                          <td className="p-1.5 min-w-[14rem]">
                            {t.ignored ? (
                              <span className="text-xs text-gray-400">Ignored</span>
                            ) : t.receiptMissing ? (
                              <span className="text-xs font-semibold text-red-600 dark:text-red-400">⚠ Receipt missing — no invoice for this payment</span>
                            ) : (() => {
                                const single = matchedUnits.length === 1 ? matchedUnits[0] : null
                                const singleRem = single ? unitRemaining(single) : 0
                                // Part payment = a single invoice spread across several txns, or one txn
                                // leaving a materially large balance on a bigger invoice (not pennies).
                                const partPaid = !!single && ((txnCountByUnit.get(single.key) ?? 0) > 1 || singleRem > Math.max(5, t.amount * 0.1))
                                const showAdd = remaining > 0.005   // payment not fully accounted for yet
                                return (
                                  <div className="space-y-1">
                                    {matchedUnits.length > 0 && (
                                      <div className="space-y-0.5">
                                        {matchedUnits.map((u) => (
                                          <div key={u.key} className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-xs text-emerald-700 dark:text-emerald-300">✓ {u.label} · {gbp(u.amount)}</span>
                                            {/* Snap only for a single, near-amount match (foreign-settlement pennies) */}
                                            {single && !partPaid && Math.abs(single.amount - t.amount) > 0.005 && Math.abs(single.amount - t.amount) <= Math.max(5, t.amount * 0.1) && single.docIds.length === 1 && (
                                              <button onClick={() => run(() => snapDocAmount(single.docIds[0], t.amount))} disabled={busy} className="text-[10px] font-semibold text-sky-600 hover:underline">set to {gbp(t.amount)}</button>
                                            )}
                                            <button onClick={() => removeMatch(u)} disabled={busy} className="text-[11px] text-gray-400 hover:text-red-500" title="Remove this line">×</button>
                                          </div>
                                        ))}
                                        {partPaid && (
                                          <p className={`text-[10px] font-semibold ${singleRem > 0.005 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                            Part payment · {gbp(matchedByUnit.get(single!.key) ?? 0)} of {gbp(single!.amount)} matched{singleRem > 0.005 ? ` · ${gbp(singleRem)} still to match` : " · complete ✓"}
                                          </p>
                                        )}
                                        {!partPaid && matchedUnits.length >= 1 && showAdd && (
                                          <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">{gbp(covered)} of {gbp(t.amount)} covered · {gbp(remaining)} to go — add another line:</p>
                                        )}
                                      </div>
                                    )}
                                    {showAdd && (
                                      <div className="space-y-1">
                                        {canSmart && (
                                          <button onClick={smartMatch} disabled={busy} className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline" title="Find a set of entered lines that add up to this payment and match them all">
                                            ✨ Smart match — find lines adding up to {gbp(remaining)}
                                          </button>
                                        )}
                                        <select disabled={busy} value="" onChange={(e) => { const u = freeUnits.find((x) => x.key === e.target.value); if (u) addMatch(u) }} className={`${input} w-full text-xs`}>
                                          <option value="">{isMatched ? `— add a line (${gbp(remaining)} to go) —` : placeholder}</option>
                                          {suggestions.map((u) => (
                                            <option key={u.key} value={u.key}>{optLabel(u)}</option>
                                          ))}
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                )
                              })()}
                          </td>
                          <td className="p-1.5 text-right whitespace-nowrap">
                            {isMatched && !t.ignored && <button onClick={() => run(() => setTransactionMatch(t.id, []))} disabled={busy} className="text-xs text-gray-400 hover:text-red-500 mr-2">unmatch</button>}
                            {!t.ignored && !isMatched && !credit && (
                              <button onClick={() => run(() => setTransactionReceiptMissing(t.id, !t.receiptMissing))} disabled={busy} className={`text-xs mr-2 ${t.receiptMissing ? "text-emerald-600 hover:text-emerald-500" : "text-red-500 hover:text-red-400"}`} title={t.receiptMissing ? "Found the receipt — unmark" : "No invoice/receipt exists for this payment"}>
                                {t.receiptMissing ? "found it" : "receipt missing"}
                              </button>
                            )}
                            <button onClick={() => run(() => setTransactionIgnored(t.id, !t.ignored))} disabled={busy} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">{t.ignored ? "un-ignore" : "ignore"}</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {freeUnits.length > 0 && stmt.transactions.length > 0 && (
              <div className="border-t border-gray-100 dark:border-gray-800 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">⚠ Entered, but not matched ({freeUnits.length})</p>
                  <button onClick={() => { if (confirm(`Park all ${freeUnits.length} unmatched line${freeUnits.length === 1 ? "" : "s"} in the reserve? (they belong to another check — you can pull them back any time)`)) run(() => setDocumentsReserved(freeUnits.flatMap((u) => u.docIds), true)) }} disabled={busy} className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline">⤓ Reserve all</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {freeUnits.map((u) => {
                    const rem = unitRemaining(u)
                    const partial = Math.abs(rem - u.amount) > 0.005
                    return (
                      <span key={u.key} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300">
                        {u.label} · {partial ? <>{gbp(rem)} of {gbp(u.amount)} left</> : gbp(u.amount)}
                        <button onClick={() => run(() => setDocumentsReserved(u.docIds, true))} disabled={busy} className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 font-bold" title="Park in the reserve — belongs to another check">⤓</button>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            </>)}
          </div>
        )
      })}

      {/* Shared reserve pool (parked entered lines from any check) */}
      {reserveUnits.length > 0 && (
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-amber-300/60 dark:border-amber-700/50 p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-amber-700 dark:text-amber-400">🅿 Reserve ({reserveUnits.length}) · {gbp(reserveTotal)}</h3>
            <a href="/tools/accounts/reserves" className="text-[11px] font-semibold text-gray-400 hover:text-amber-500">open full grid →</a>
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5 mb-2">Entered receipts parked from other checks. If one belongs to this statement, <span className="font-semibold">pull it into {displayLabel || "this month"}</span> to match it; otherwise leave it here for next time.</p>

          {/* Filter + bulk actions */}
          <div className="flex items-center gap-2 flex-wrap mb-2 text-xs">
            <input value={reserveFilter} onChange={(e) => setReserveFilter(e.target.value)} placeholder="Filter reserve…" className={`${input} text-xs py-1 w-48`} />
            {reserveFilter && <span className="text-gray-400">{reserveShown.length} of {reserveUnits.length}</span>}
            <button onClick={() => setReserveSel(reserveAllShownSelected ? new Set() : new Set(reserveShown.map((u) => u.key)))} className="font-semibold text-amber-700 dark:text-amber-400 hover:underline">{reserveAllShownSelected ? "Clear selection" : "Select all shown"}</button>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <button onClick={() => { const ids = reserveSelUnits.flatMap((u) => u.docIds); if (!ids.length) return; setReserveSel(new Set()); run(() => pullDocumentsFromReserve(ids, monthId)) }} disabled={busy || reserveSelUnits.length === 0} className="font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40">Pull selected ({reserveSelUnits.length}){reserveSelUnits.length ? ` · ${gbp(reserveSelTotal)}` : ""} →</button>
            <button onClick={() => { const ids = reserveSelUnits.flatMap((u) => u.docIds); if (!ids.length) return; setReserveSel(new Set()); run(() => setDocumentsReserved(ids, false)) }} disabled={busy || reserveSelUnits.length === 0} className="font-semibold px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40">Un-reserve selected</button>
            <button onClick={() => { const ids = reserveShown.flatMap((u) => u.docIds); if (!ids.length) return; if (confirm(`Pull all ${reserveShown.length} shown line${reserveShown.length === 1 ? "" : "s"} into ${displayLabel || "this month"}?`)) { setReserveSel(new Set()); run(() => pullDocumentsFromReserve(ids, monthId)) } }} disabled={busy || reserveShown.length === 0} className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-40">Pull all shown</button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {reserveShown.map((u) => {
              const sel = reserveSel.has(u.key)
              return (
                <span key={u.key} className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border ${sel ? "bg-amber-100 dark:bg-amber-500/20 border-amber-400 dark:border-amber-600" : "bg-amber-50 dark:bg-amber-500/10 border-transparent"} text-amber-800 dark:text-amber-200`}>
                  <input type="checkbox" checked={sel} onChange={() => toggleReserveSel(u.key)} className="w-3.5 h-3.5 accent-amber-600" />
                  {u.label} · {gbp(u.amount)} <span className="text-amber-500/80">· {u.monthLabel}</span>
                  <button onClick={() => run(() => pullDocumentsFromReserve(u.docIds, monthId))} disabled={busy} className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline" title={`Move into ${displayLabel || "this month"} and match`}>pull in →</button>
                  <button onClick={() => run(() => setDocumentsReserved(u.docIds, false))} disabled={busy} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Take out of reserve, back to its own month">un-reserve</button>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Hidden file inputs */}
      <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { uploadFiles(e.target.files, null, newCardholder); e.currentTarget.value = "" }} />
      <input ref={addPageInput} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { uploadFiles(e.target.files, addPageForIdRef.current); e.currentTarget.value = "" }} />
      <input ref={csvInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { importCsv(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />

      {viewer && <ImageViewer images={viewer.images} startIndex={0} label={viewer.label} onClose={() => setViewer(null)} />}
    </div>
  )

  if (standalone) {
    return (
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Link href={`/tools/accounts/${monthId}`} prefetch={false} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 inline-flex items-center gap-1.5">← <LinkSpinner className="w-3.5 h-3.5" /></Link>
            {renaming ? (
              <input
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onBlur={doRename}
                onKeyDown={(e) => { if (e.key === "Enter") doRename(); if (e.key === "Escape") setRenaming(false) }}
                className={`${input} font-bold text-base`}
                autoFocus
              />
            ) : (
              <button onClick={() => { setRenameVal(displayLabel); setRenaming(true) }} className="text-base font-bold text-gray-800 dark:text-gray-100 hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-1.5">
                {displayLabel || "Untitled month"} <span className="text-gray-400 text-xs font-normal">✏</span>
              </button>
            )}
            <span className="text-gray-400">/ 🏦 Reconcile</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{totalMatched} matched · {totalUnmatched} unmatched{totalMissing > 0 ? <span className="text-red-500"> · {totalMissing} receipt missing</span> : null}</span>
            {statements.length > 1 && (
              <button onClick={() => setAllCollapsed(statements.map((s) => s.id), collapsed.size < statements.length)} title="Minimise or expand every statement" className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-500/10">
                {collapsed.size >= statements.length ? "Expand all" : "Collapse all"}
              </button>
            )}
            <button onClick={() => setUnmatchedOnly((v) => !v)} title="Hide transactions that are already matched" className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${unmatchedOnly ? "border-amber-500 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-500/10"}`}>
              Unmatched only{unmatchedOnly ? " ✓" : ""}
            </button>
            <button onClick={() => { setCopied(false); setMissingOpen(true) }} disabled={missingCount === 0} title="Email text listing the payments you've marked as 'receipt missing'" className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40">
              ✉ Missing invoices{missingCount ? ` (${missingCount})` : ""}
            </button>
            <a href={`/api/accounts/export?monthId=${monthId}&reconciled=true`} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">
              Export matched to Excel →
            </a>
          </div>
        </div>

        {statementsContent}

        {missingOpen && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setMissingOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">✉ Missing invoices ({missingCount})</h3>
                <button onClick={() => setMissingOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none">×</button>
              </div>
              <div className="p-4 overflow-y-auto">
                <p className="text-xs text-gray-400 mb-2">The payments you&apos;ve marked &ldquo;receipt missing&rdquo;. Copy this and email it to chase the paperwork.</p>
                <textarea readOnly value={missingText} className="w-full h-72 text-sm font-mono bg-gray-50 dark:bg-[#2C2C2E] text-gray-800 dark:text-gray-100 rounded-lg border border-gray-200 dark:border-gray-700 p-3 focus:outline-none" />
              </div>
              <div className="flex items-center gap-2 p-4 border-t border-gray-100 dark:border-gray-800">
                <button onClick={copyMissing} className="text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">{copied ? "✓ Copied" : "Copy text"}</button>
                <a href={`mailto:?subject=${encodeURIComponent(`Missing invoices — ${displayLabel || "accounts"}`)}&body=${encodeURIComponent(missingText)}`} className="text-sm font-semibold px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Open in email</a>
                <button onClick={() => setMissingOpen(false)} className="text-sm font-semibold px-4 py-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 ml-auto">Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 mt-6">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 p-4 text-left">
        <div>
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">🏦 Reconcile against bank statement</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {statements.length === 0 ? "Upload a card/bank statement to check it against your entered lines." :
              `${totalMatched} matched · ${totalUnmatched} unmatched · ${statements.length} statement${statements.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <span className="text-gray-400 text-lg">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="p-4 pt-0">{statementsContent}</div>}
    </div>
  )
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "amber" | "purple" | "red" }) {
  const toneCls = tone === "emerald" ? "text-emerald-700 dark:text-emerald-300"
    : tone === "amber" ? "text-amber-700 dark:text-amber-300"
    : tone === "purple" ? "text-purple-700 dark:text-purple-300"
    : tone === "red" ? "text-red-600 dark:text-red-400"
    : "text-gray-700 dark:text-gray-200"
  return (
    <span className="inline-flex flex-col px-2.5 py-1 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
      <span className="text-[9px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className={`text-xs font-semibold tabular-nums ${toneCls}`}>{value}</span>
    </span>
  )
}
