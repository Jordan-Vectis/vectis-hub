"use client"

// End of Day → BC. One click at the end of the day: every lot catalogued in
// the Hub that hasn't yet reached Business Central, grouped by tote, exported
// as the hotkey sheet (ToteNumber,LotCount,Barcodes) the overnight "add to BC"
// macro works through. Same file shape as BC Import Check reads and writes, so
// a broken overnight run can be reconciled there and re-run.

import { useCallback, useEffect, useMemo, useState } from "react"
import { autocorrectLotsForAuctions } from "@/lib/actions/catalogue"

type ToteRow = { tote: string; count: number; barcodes: string[]; sales: string[] }
type SaleRow = { id: string; code: string; name: string; complete: boolean; count: number }
type Problem = { id: string; barcode?: string; uniqueId: string; tote?: string; sale: string; title: string; cataloguedBy: string }
type CheckLot = {
  id: string; barcode: string; uniqueId: string; tote: string; receipt: string
  vendor: string; sale: string; cataloguedBy: string
  bcReceipt?: string; bcVendor?: string; totes?: string[]
}
type Check = { key: string; count: number; lots: CheckLot[] }
type Data = {
  generatedAt: string
  toteLastSync: string | null
  totalLots: number
  alreadyInBc: number
  readyCount: number
  totes: ToteRow[]
  sales: SaleRow[]
  checks: Check[]
  noBarcode: Problem[]
  noTote: Problem[]
}

// Same wording and severity as the Tote Check tab for the shared checks, plus
// the three sheet-specific ones. Order = display order, worst first.
const CHECK_META: Record<string, { label: string; hint: string; tone: "bad" | "warn"; order: number }> = {
  duplicate_barcode: {
    label: "Same barcode in two totes — taken OFF tonight's sheet", tone: "bad", order: 0,
    hint: "One of the totes is wrong, and importing would put the BC line on the wrong receipt. Fix the tote on the wrong lot (Manage Lots → Change Vendor), then refresh — they go back on the sheet.",
  },
  receipt_not_in_bc: {
    label: "Receipt doesn't exist in BC", tone: "bad", order: 1,
    hint: "No synced BC tote or item carries this receipt number — likely a typo, or a receipt not booked into BC yet. Still on the sheet, but the overnight run will fail on it.",
  },
  receipt_mismatch: {
    label: "Receipt doesn't match the tote", tone: "bad", order: 2,
    hint: "The tote belongs to a different receipt in BC. Either the wrong receipt was typed, or the item is in the wrong tote.",
  },
  vendor_mismatch: {
    label: "Vendor doesn't match the tote", tone: "bad", order: 3,
    hint: "The tote belongs to a different vendor in BC — often the previous batch's vendor left in place.",
  },
  unique_id_mismatch: {
    label: "Unique ID against a different receipt", tone: "warn", order: 4,
    hint: "The unique ID starts with one receipt but the lot's receipt field says another — usually the receipt was corrected after the ID was minted. Harmless for tonight (the sheet runs on barcodes) and self-corrects when 🔗 BC Match imports BC's own IDs after the run; only investigate if it persists after that.",
  },
  invalid_barcode: {
    label: "Barcode looks malformed", tone: "warn", order: 5,
    hint: "Doesn't match the F066001 format. Still on the sheet, but check it before the run — the macro may not accept it.",
  },
  tote_unknown: {
    label: "Tote not in the BC data", tone: "warn", order: 6,
    hint: "No tote with this number came back from BC — either a typo, or the tote hasn't synced yet. Check the sync time before treating these as mistakes.",
  },
  receipt_missing: {
    label: "No receipt on the lot", tone: "warn", order: 7,
    hint: "The tote has a receipt in BC but the lot doesn't. Manage Lots → Change Vendor fills these.",
  },
  vendor_missing: {
    label: "No vendor on the lot", tone: "warn", order: 8,
    hint: "The tote has a vendor in BC but the lot doesn't.",
  },
}

export default function EndOfDayPage() {
  const [data, setData]       = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [includeComplete, setIncludeComplete] = useState(false)
  const [copied, setCopied]   = useState(false)
  const [openTote, setOpenTote] = useState<string | null>(null)
  const [fixing, setFixing]   = useState(false)
  const [fixResult, setFixResult] = useState<string | null>(null)

  const load = useCallback(async (withComplete: boolean) => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/catalogue/end-of-day${withComplete ? "?includeComplete=1" : ""}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      setData(d)
    } catch (e: any) { setError(e?.message ?? "Failed to load"); setData(null) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(includeComplete) }, [load, includeComplete])

  // Exactly the hotkey-sheet format the macro consumes (and BC Import Check
  // round-trips): header row + one line per tote, barcodes pipe-separated.
  const csv = useMemo(() => {
    if (!data || data.totes.length === 0) return ""
    const lines = ["ToteNumber,LotCount,Barcodes"]
    for (const t of data.totes) lines.push(`${t.tote},${t.count},${t.barcodes.join("|")}`)
    return lines.join("\r\n")
  }, [data])

  function download() {
    const stamp = new Date().toISOString().slice(0, 10)
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `bc-import-${stamp}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function copy() {
    try { await navigator.clipboard.writeText(csv); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch {}
  }

  // The same fix as Tote Check → Match BC, run over every sale on the sheet.
  // Only corrects what BC can prove (a known tote's receipt/vendor) — unknown
  // totes are never guessed at, so it can't fix everything the checks flag.
  async function fixFromBc() {
    if (!data) return
    const ids = data.sales.map(s => s.id).filter(Boolean)
    if (ids.length === 0) return
    if (!confirm(
      "Fix the flagged lots from the BC tote data?\n\n" +
      "Where a lot's tote is known in BC, its receipt and vendor are corrected to what BC says (the same as Match BC on each sale's Tote Check tab). " +
      "Unknown totes are left alone — they can't be fixed automatically. Every change is logged in the Lot Change Log."
    )) return
    setFixing(true); setFixResult(null)
    try {
      const res = await autocorrectLotsForAuctions(ids)
      if (!res.ok && res.error) {
        setFixResult(`Couldn't fix: ${res.error}`)
      } else {
        setFixResult(
          `Fixed ${res.updated} lot${res.updated === 1 ? "" : "s"} from the BC tote data` +
          (res.corrections ? ` · ${res.corrections} had already gone into BC wrong — they're on the BC Corrections list to put right in BC` : "") +
          (res.skipped ? ` · ${res.skipped} couldn't be fixed (tote not in BC)` : "") +
          (res.lockedSales ? ` · ${res.lockedSales} sale${res.lockedSales === 1 ? "" : "s"} skipped (BC-locked — admin only)` : "")
        )
        await load(includeComplete)
      }
    } finally {
      setFixing(false)
    }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🌙 End of Day → BC</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
            Every lot catalogued in the Hub that hasn&apos;t yet reached Business Central, grouped by tote and ready to
            download as the hotkey sheet the overnight import runs through. Checked against the synced BC data by
            barcode — so lots missed on a previous day are swept up automatically.
          </p>
        </div>
        <button
          onClick={() => load(includeComplete)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
        >
          ⟳ Refresh
        </button>
      </div>

      {error && (
        <p className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Checking the day&apos;s lots against BC…</p>
      ) : data && (
        <>
          {/* ── Headline numbers ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{data.readyCount.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Lots ready for tonight&apos;s sheet</div>
            </div>
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{data.totes.length.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Totes</div>
            </div>
            <div className={`border rounded-xl p-4 text-center ${data.noTote.length || data.noBarcode.length ? "bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800/40" : "bg-white dark:bg-[#1C1C1E] border-gray-200 dark:border-gray-800"}`}>
              <div className={`text-2xl font-bold ${data.noTote.length || data.noBarcode.length ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"}`}>
                {(data.noTote.length + data.noBarcode.length).toLocaleString()}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">Can&apos;t go on the sheet</div>
            </div>
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{data.alreadyInBc.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Already in BC</div>
            </div>
          </div>

          {/* ── Export ── */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={download}
              disabled={!csv}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              ⬇ Download tonight&apos;s hotkey sheet{data.totes.length ? ` (${data.totes.length} totes)` : ""}
            </button>
            <button
              onClick={copy}
              disabled={!csv}
              className="px-4 py-2.5 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 hover:border-emerald-500 disabled:opacity-40 text-gray-700 dark:text-gray-300 text-sm rounded-lg transition-colors"
            >
              {copied ? "✓ Copied" : "Copy to clipboard"}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeComplete}
                onChange={e => setIncludeComplete(e.target.checked)}
                className="accent-blue-500"
              />
              Include completed sales
            </label>
          </div>

          {/* ── Checks — same engine as the Tote Check tab ── */}
          {data.checks.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  🔎 Checks — {data.checks.reduce((s, c) => s + c.count, 0)} thing{data.checks.reduce((s, c) => s + c.count, 0) === 1 ? "" : "s"} worth a look before tonight
                  {data.toteLastSync && (
                    <span className="font-normal text-xs text-gray-500 ml-2">
                      BC tote data last synced {new Date(data.toteLastSync).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </p>
                <button
                  onClick={fixFromBc}
                  disabled={fixing}
                  title="The same fix as Match BC on each sale's Tote Check tab — corrects receipt and vendor from the BC tote data wherever the tote is known. Unknown totes are never guessed at."
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {fixing ? "Fixing from BC…" : "🔧 Fix what BC can prove"}
                </button>
              </div>
              {fixResult && (
                <p className={`px-4 py-3 rounded-xl border text-sm ${fixResult.startsWith("Couldn't")
                  ? "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300"
                  : "bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-300"}`}>
                  {fixResult}
                </p>
              )}
              {[...data.checks]
                .sort((a, b) => (CHECK_META[a.key]?.order ?? 99) - (CHECK_META[b.key]?.order ?? 99))
                .map(c => <CheckPanel key={c.key} check={c} />)}
            </div>
          )}
          {data.checks.length === 0 && fixResult && (
            <p className="px-4 py-3 rounded-xl border text-sm bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-300">
              {fixResult}
            </p>
          )}
          {data.checks.length === 0 && data.totes.length > 0 && (
            <p className="text-sm text-green-600 dark:text-green-400">
              ✅ All checks passed — every lot's tote, receipt and vendor agrees with the BC data.
            </p>
          )}

          {/* ── Problems that need fixing before tonight ── */}
          {data.noTote.length > 0 && (
            <ProblemList
              label={`⚠ ${data.noTote.length} lot${data.noTote.length === 1 ? "" : "s"} with no tote — fix the tote (Manage Lots → Change Vendor) or they stay off the sheet`}
              rows={data.noTote.map(p => ({ id: p.id, main: p.barcode ?? "", extra: [p.uniqueId, p.sale, p.cataloguedBy].filter(Boolean).join(" · "), title: p.title }))}
            />
          )}
          {data.noBarcode.length > 0 && (
            <ProblemList
              label={`⚠ ${data.noBarcode.length} lot${data.noBarcode.length === 1 ? "" : "s"} with no barcode — the macro is barcode-driven, so these can't be imported until one is set`}
              rows={data.noBarcode.map(p => ({ id: p.id, main: p.uniqueId, extra: [p.tote, p.sale, p.cataloguedBy].filter(Boolean).join(" · "), title: p.title }))}
            />
          )}

          {/* ── Per-sale summary ── */}
          {data.sales.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.sales.map(s => (
                <span key={s.code} className={`text-xs px-2.5 py-1 rounded-full border ${s.complete ? "border-amber-400 dark:border-amber-700 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20" : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-[#1C1C1E]"}`}>
                  <span className="font-mono font-semibold">{s.code}</span> · {s.count} lot{s.count === 1 ? "" : "s"}{s.complete ? " · completed sale" : ""}
                </span>
              ))}
            </div>
          )}

          {/* ── The sheet, on screen ── */}
          <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Tote</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Lots</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Sale</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Barcodes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800/60">
                {data.totes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                      🎉 Nothing waiting — every catalogued lot is already in BC.
                    </td>
                  </tr>
                )}
                {data.totes.map(t => {
                  const open = openTote === t.tote
                  return (
                    <tr key={t.tote} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
                      <td className="px-4 py-2.5 font-mono font-semibold text-cyan-700 dark:text-cyan-300 whitespace-nowrap">{t.tote}</td>
                      <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{t.count}</td>
                      <td className="px-4 py-2.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{t.sales.join(", ") || "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-600 dark:text-gray-400">
                        {open ? t.barcodes.join(" | ") : `${t.barcodes.slice(0, 6).join(" | ")}${t.barcodes.length > 6 ? " …" : ""}`}
                        {t.barcodes.length > 6 && (
                          <button
                            onClick={() => setOpenTote(open ? null : t.tote)}
                            className="ml-2 text-blue-500 hover:text-blue-400"
                          >
                            {open ? "less" : `all ${t.barcodes.length}`}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-500">
            Checked against BC data synced {`at ${new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`} —
            if today&apos;s BC sync hasn&apos;t run recently, run Data Sync in BC Warehouse first or already-imported lots may reappear here.
            If the overnight run breaks part-way, reconcile with Auction AI → BC Import Check.
          </p>
        </>
      )}
    </div>
  )
}

function CheckPanel({ check }: { check: Check }) {
  const [open, setOpen] = useState(false)
  const meta = CHECK_META[check.key] ?? { label: check.key, hint: "", tone: "warn" as const, order: 99 }
  const tone = meta.tone === "bad"
    ? "border-red-300 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300"
    : "border-amber-300 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300"
  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-sm font-medium w-full text-left">
        <span className="text-xs">{open ? "▼" : "▶"}</span>
        <span>{meta.tone === "bad" ? "⛔" : "⚠"} {meta.label} ({check.count})</span>
      </button>
      <p className="text-xs opacity-80 mt-1 ml-5">{meta.hint}</p>
      {open && (
        <div className="mt-2 ml-5 space-y-1 max-h-64 overflow-y-auto">
          {check.lots.map(l => (
            <div key={l.id} className="text-xs flex flex-wrap gap-x-2">
              <span className="font-mono font-semibold">{l.barcode || l.uniqueId || "—"}</span>
              {l.tote && <span className="opacity-80">tote {l.tote}</span>}
              {l.totes && l.totes.length > 1 && <span className="opacity-80">totes {l.totes.join(" + ")}</span>}
              {l.receipt && <span className="opacity-80">receipt {l.receipt}</span>}
              {l.bcReceipt && l.receipt && l.bcReceipt.toUpperCase() !== l.receipt.toUpperCase() && (
                <span className="font-semibold">BC says {l.bcReceipt}</span>
              )}
              {l.bcVendor && l.vendor && l.bcVendor.toUpperCase() !== l.vendor.toUpperCase() && (
                <span className="font-semibold">BC vendor {l.bcVendor}</span>
              )}
              {l.sale && <span className="opacity-70">{l.sale}</span>}
              {l.cataloguedBy && <span className="opacity-70">{l.cataloguedBy}</span>}
            </div>
          ))}
          {check.count > check.lots.length && (
            <p className="text-xs opacity-70">…and {check.count - check.lots.length} more</p>
          )}
        </div>
      )}
    </div>
  )
}

function ProblemList({ label, rows }: { label: string; rows: { id: string; main: string; extra: string; title: string }[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-amber-300 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300 w-full text-left">
        <span className="text-xs">{open ? "▼" : "▶"}</span>
        <span>{label}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
          {rows.map(r => (
            <div key={r.id} className="text-xs text-amber-900 dark:text-amber-200 flex flex-wrap gap-x-2">
              <span className="font-mono font-semibold">{r.main || "—"}</span>
              {r.extra && <span className="opacity-70">{r.extra}</span>}
              <span className="opacity-90 truncate max-w-md">{r.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
