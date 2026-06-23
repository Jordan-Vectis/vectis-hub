"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  deleteBankStatement, autoMatchStatement, setTransactionMatch,
  setTransactionIgnored, snapDocAmount, createBankStatementFromRows,
} from "@/lib/actions/accounting"

type Entry = {
  id: string; cardholder: string; supplier: string; item: string; gross: number
  currency: string; originalAmount: number | null; splitGroupId: string | null
  docDate: string; column: string
}
type Txn = {
  id: string; postDate: string; tranDate: string; description: string; reference: string
  amount: number; currency: string; originalAmount: number | null; feeAmount: number | null
  direction: string; matchedDocIds: string[]; ignored: boolean
}
type Statement = { id: string; label: string; cardholder: string; source: string; images: string[]; transactions: Txn[] }

const round = (n: number) => Math.round((n || 0) * 100) / 100
const gbp = (n: number) => "£" + (n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const CCY: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" }
const fmtCcy = (c: string, n: number) => (CCY[c] ?? c + " ") + (n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Unit = { key: string; docIds: string[]; amount: number; label: string }

export default function AccountsReconcile({
  monthId, entries, statements, cardholders,
}: { monthId: string; entries: Entry[]; statements: Statement[]; cardholders: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, startBusy] = useTransition()
  const [reading, setReading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(statements[statements.length - 1]?.id ?? null)
  const [newCardholder, setNewCardholder] = useState<string>(cardholders[0] ?? "Vectis")
  const fileInput = useRef<HTMLInputElement>(null)
  const addPageInput = useRef<HTMLInputElement>(null)
  const csvInput = useRef<HTMLInputElement>(null)

  const active = statements.find((s) => s.id === activeId) ?? statements[statements.length - 1] ?? null
  const entryById = new Map(entries.map((e) => [e.id, e]))
  const run = (fn: () => Promise<any>) => startBusy(async () => { await fn(); router.refresh() })

  // Only this statement's cardholder's entries are matchable against it.
  const scopedEntries = active && active.cardholder ? entries.filter((e) => e.cardholder === active.cardholder) : entries

  // Entered lines as match units (a split invoice = one unit summing its parts).
  const units: Unit[] = (() => {
    const out: Unit[] = []
    const groups = new Map<string, Entry[]>()
    for (const e of scopedEntries) {
      if (e.splitGroupId) { const a = groups.get(e.splitGroupId) ?? []; a.push(e); groups.set(e.splitGroupId, a) }
      else out.push({ key: e.id, docIds: [e.id], amount: round(e.gross), label: `${e.supplier || "(no description)"}${e.item ? " — " + e.item : ""}` })
    }
    for (const [gid, arr] of groups) {
      if (arr.length === 1) { const e = arr[0]; out.push({ key: e.id, docIds: [e.id], amount: round(e.gross), label: `${e.supplier || "(no description)"}${e.item ? " — " + e.item : ""}` }) }
      else out.push({ key: gid, docIds: arr.map((e) => e.id), amount: round(arr.reduce((a, e) => a + e.gross, 0)), label: `${arr[0].supplier || "(no description)"} (split, ${arr.length} parts)` })
    }
    return out
  })()

  const txns = active?.transactions ?? []
  const matchedSet = new Set<string>()
  for (const t of txns) for (const id of t.matchedDocIds) matchedSet.add(id)
  const freeUnits = units.filter((u) => !u.docIds.some((id) => matchedSet.has(id)))

  const liveTxns = txns.filter((t) => !t.ignored && t.direction !== "CREDIT")
  const matchedCount = liveTxns.filter((t) => t.matchedDocIds.length).length
  const unmatchedCount = liveTxns.length - matchedCount

  async function uploadFiles(files: FileList | null, statementId: string | null, cardholder?: string) {
    const arr = files ? Array.from(files) : []
    if (!arr.length) return
    setUploading(true)
    let sid = statementId
    try {
      for (const f of arr) {
        const fd = new FormData(); fd.append("monthId", monthId)
        if (sid) fd.append("statementId", sid); else if (cardholder) fd.append("cardholder", cardholder)
        fd.append("file", f)
        const res = await fetch("/api/accounts/statement/upload", { method: "POST", body: fd })
        if (res.ok) { const j = await res.json(); sid = j.id }
      }
      if (sid) setActiveId(sid)
    } finally { setUploading(false); router.refresh() }
  }

  async function readStatement(id: string) {
    setReading(true)
    try {
      const res = await fetch("/api/accounts/statement/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statementId: id }) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || "Couldn't read the statement — try clearer photos.") }
    } finally { setReading(false); router.refresh() }
  }

  // Basic CSV import (backup): expects a header row with Date, Description, Amount (and optional Currency, OriginalAmount).
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
    run(async () => { const res = await createBankStatementFromRows(monthId, file.name.replace(/\.csv$/i, ""), newCardholder, rows); setActiveId(res.id) })
  }

  const input = "px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"

  return (
    <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 mt-6">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 p-4 text-left">
        <div>
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">🏦 Reconcile against bank statement</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {statements.length === 0 ? "Upload a card/bank statement to check it against your entered lines." :
              `${matchedCount} matched · ${unmatchedCount} unmatched on statement · ${freeUnits.length} entered line(s) not on statement`}
          </p>
        </div>
        <span className="text-gray-400 text-lg">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="p-4 pt-0 space-y-4">
          {/* Statement picker + add */}
          <div className="flex items-center gap-2 flex-wrap">
            {statements.map((s) => (
              <button key={s.id} onClick={() => setActiveId(s.id)}
                className={`text-xs px-3 py-1.5 rounded-lg border ${active?.id === s.id ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>
                {s.source === "CSV" ? "📄" : "🧾"} <span className="font-semibold">{s.cardholder || "?"}</span>{s.label ? " — " + s.label : ""} · {s.transactions.length}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-500 dark:text-gray-400">New statement for card:
              <select value={newCardholder} onChange={(e) => setNewCardholder(e.target.value)} className={`${input} ml-1.5 text-xs py-1`}>
                {cardholders.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { uploadFiles(e.target.files, null, newCardholder); e.currentTarget.value = "" }} />
            <input ref={csvInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { importCsv(e.target.files?.[0] ?? null); e.currentTarget.value = "" }} />
            <button onClick={() => fileInput.current?.click()} disabled={uploading} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">{uploading ? "Uploading…" : "+ New statement (photo/PDF)"}</button>
            <button onClick={() => csvInput.current?.click()} disabled={uploading} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">Import CSV</button>
          </div>

          {active && (
            <>
              {/* Statement actions */}
              <div className="flex items-center gap-2 flex-wrap border-t border-gray-100 dark:border-gray-800 pt-3">
                {active.source !== "CSV" && (
                  <>
                    <input ref={addPageInput} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { uploadFiles(e.target.files, active.id); e.currentTarget.value = "" }} />
                    <button onClick={() => addPageInput.current?.click()} disabled={uploading} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300">+ Add page ({active.images.length})</button>
                    <button onClick={() => readStatement(active.id)} disabled={reading || active.images.length === 0} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">{reading ? "Reading…" : "🤖 Read statement (AI)"}</button>
                  </>
                )}
                <button onClick={() => run(() => autoMatchStatement(active.id))} disabled={busy || active.transactions.length === 0} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">⚡ Auto-match</button>
                <button onClick={() => { if (confirm("Delete this statement and its transactions?")) run(() => deleteBankStatement(active.id)) }} disabled={busy} className="text-xs font-semibold px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-500/10 ml-auto">Delete statement</button>
              </div>

              {active.cardholder && <p className="text-[11px] text-gray-400">Matching against <span className="font-semibold text-gray-500 dark:text-gray-300">{active.cardholder}</span>&apos;s entered lines only.</p>}

              {active.transactions.length === 0 ? (
                <p className="text-sm text-gray-400 py-4">{active.source === "CSV" ? "No rows imported." : "No transactions yet — press “Read statement (AI)” to pull them from the pages."}</p>
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
                      {active.transactions.map((t) => {
                        const matched = t.matchedDocIds.map((id) => entryById.get(id)).filter(Boolean) as Entry[]
                        const isMatched = matched.length > 0
                        const credit = t.direction === "CREDIT"
                        return (
                          <tr key={t.id} className={`border-b border-gray-100 dark:border-gray-800/60 align-top ${t.ignored ? "opacity-40" : isMatched ? "bg-emerald-50/40 dark:bg-emerald-500/5" : credit ? "" : "bg-amber-50/40 dark:bg-amber-500/5"}`}>
                            <td className="p-1.5 whitespace-nowrap text-gray-500 dark:text-gray-400 text-xs">{(t.tranDate || t.postDate || "").split("-").reverse().join("/")}</td>
                            <td className="p-1.5">
                              <span className="text-gray-800 dark:text-gray-200">{t.description || "(no description)"}</span>
                              {t.reference && <span className="text-gray-400 text-xs"> · {t.reference}</span>}
                              {credit && <span className="ml-1 text-[10px] text-purple-600 dark:text-purple-400">(payment/credit)</span>}
                            </td>
                            <td className="p-1.5 text-right whitespace-nowrap tabular-nums">
                              {gbp(t.amount)}
                              {t.currency !== "GBP" && t.originalAmount != null && <div className="text-[10px] text-sky-600 dark:text-sky-400">{fmtCcy(t.currency, t.originalAmount)}</div>}
                            </td>
                            <td className="p-1.5 min-w-[14rem]">
                              {t.ignored ? (
                                <span className="text-xs text-gray-400">Ignored</span>
                              ) : isMatched ? (
                                <div className="space-y-0.5">
                                  {matched.map((e) => (
                                    <div key={e.id} className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs text-emerald-700 dark:text-emerald-300">✓ {e.supplier || "(no description)"}{e.item ? " — " + e.item : ""} · {gbp(e.gross)}</span>
                                      {Math.abs(e.gross - t.amount) > 0.005 && matched.length === 1 && (
                                        <button onClick={() => run(() => snapDocAmount(e.id, t.amount))} disabled={busy} className="text-[10px] font-semibold text-sky-600 hover:underline">set to {gbp(t.amount)}</button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <select disabled={busy} value="" onChange={(e) => { const u = freeUnits.find((x) => x.key === e.target.value); if (u) run(() => setTransactionMatch(t.id, u.docIds)) }} className={`${input} w-full`}>
                                  <option value="">— match to an entered line —</option>
                                  {freeUnits.slice().sort((a, b) => Math.abs(a.amount - t.amount) - Math.abs(b.amount - t.amount)).map((u) => (
                                    <option key={u.key} value={u.key}>{Math.abs(u.amount - t.amount) < 0.005 ? "✓ " : ""}{u.label} · {gbp(u.amount)}</option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className="p-1.5 text-right whitespace-nowrap">
                              {isMatched && !t.ignored && <button onClick={() => run(() => setTransactionMatch(t.id, []))} disabled={busy} className="text-xs text-gray-400 hover:text-red-500 mr-2" title="Unmatch">unmatch</button>}
                              <button onClick={() => run(() => setTransactionIgnored(t.id, !t.ignored))} disabled={busy} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Ignore this transaction">{t.ignored ? "un-ignore" : "ignore"}</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Entered lines that aren't on the statement */}
              {freeUnits.length > 0 && active.transactions.length > 0 && (
                <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1">⚠ Entered, but not matched to any transaction ({freeUnits.length})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {freeUnits.map((u) => (
                      <span key={u.key} className="text-xs px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300">{u.label} · {gbp(u.amount)}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
