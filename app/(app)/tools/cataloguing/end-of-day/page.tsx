"use client"

// End of Day → BC. One click at the end of the day: every lot catalogued in
// the Hub that hasn't yet reached Business Central, grouped by tote, exported
// as the hotkey sheet (ToteNumber,LotCount,Barcodes) the overnight "add to BC"
// macro works through. Same file shape as BC Import Check reads and writes, so
// a broken overnight run can be reconciled there and re-run.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { autocorrectLotsForAuctions, lookupToteOrReceipt, massRemapPendingLots, setLotsVendorReceiptAcrossAuctions, type RemapLineResult } from "@/lib/actions/catalogue"

type ToteRow = { tote: string; count: number; barcodes: string[]; sales: string[] }
type SaleRow = { id: string; code: string; name: string; complete: boolean; count: number }
type Problem = { id: string; auctionId: string; barcode?: string; uniqueId: string; tote?: string; sale: string; title: string; cataloguedBy: string }
type CheckLot = {
  id: string; auctionId: string; barcode: string; uniqueId: string; tote: string; receipt: string
  vendor: string; sale: string; cataloguedBy: string
  bcReceipt?: string; bcVendor?: string; totes?: string[]
  vendorName?: string; bcVendorName?: string
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
    hint: "The receipt saved on the lot isn't the one this tote belongs to in BC. Either the wrong receipt was typed, or the item is in the wrong tote. If the tote is right: tick them, type the tote in the bar below, Apply — the receipt is corrected from BC.",
  },
  vendor_mismatch: {
    label: "Vendor doesn't match the tote", tone: "bad", order: 3,
    hint: "The vendor saved on the lot isn't the tote's owner in BC — often the previous batch's vendor left in place. If the tote is right: tick them, type the tote in the bar below, Apply — the vendor is corrected from BC.",
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
  no_tote: {
    label: "No tote on the lot — off the sheet until one is set", tone: "warn", order: 9,
    hint: "The sheet is grouped by tote, so these can't go on it. Tick them, type the right tote in the bar that appears, and apply.",
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

  // ── Manual intervention: tick lots in the panels, look up the right tote /
  //    receipt, apply. lotId → auctionId (the apply action groups by sale).
  const [selected, setSelected] = useState<Map<string, string>>(new Map())
  const [lookupQ, setLookupQ]   = useState("")
  const [looking, setLooking]   = useState(false)
  const [lookup, setLookup]     = useState<Awaited<ReturnType<typeof lookupToteOrReceipt>> | null>(null)
  const [applying, setApplying] = useState(false)

  const toggleLot = useCallback((lotId: string, auctionId: string) => {
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(lotId)) next.delete(lotId)
      else next.set(lotId, auctionId)
      return next
    })
  }, [])

  const load = useCallback(async (withComplete: boolean) => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/catalogue/end-of-day${withComplete ? "?includeComplete=1" : ""}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
      setData(d)
      setSelected(new Map())   // stale lot ids must not survive a refresh
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

  async function runLookup() {
    const q = lookupQ.trim()
    if (!q) return
    setLooking(true); setLookup(null)
    try { setLookup(await lookupToteOrReceipt(q)) }
    finally { setLooking(false) }
  }

  async function applyToSelected() {
    if (!lookup?.ok || selected.size === 0) return
    const what = lookup.kind === "tote"
      ? `tote ${lookup.tote} (receipt ${lookup.receipt ?? "—"}, ${lookup.vendorName ?? lookup.vendor ?? "unknown vendor"})`
      : `receipt ${lookup.receipt} (${lookup.vendorName ?? lookup.vendor ?? "unknown vendor"})`
    if (!confirm(
      `Move the ${selected.size} ticked lot${selected.size === 1 ? "" : "s"} to ${what}?\n\n` +
      "Vendor and receipt are set from the BC data" +
      (lookup.kind === "tote" ? ", and the lot's tote is corrected too" : "") +
      ". Existing unique IDs are kept. Every change is logged and can be undone per sale from Manage Lots → Undo."
    )) return
    setApplying(true); setFixResult(null)
    try {
      const res = await setLotsVendorReceiptAcrossAuctions(
        [...selected.entries()].map(([lotId, auctionId]) => ({ lotId, auctionId })),
        {
          vendor:  lookup.vendor ?? "",
          receipt: lookup.receipt ?? "",
          ...(lookup.kind === "tote" && lookup.tote ? { tote: lookup.tote } : {}),
        },
      )
      if (!res.ok && res.error) {
        setFixResult(`Couldn't change the lots: ${res.error}`)
      } else {
        setFixResult(
          `Moved ${res.updated} lot${res.updated === 1 ? "" : "s"} to ${what}` +
          (res.lockedSales ? ` · ${res.lockedSales} sale${res.lockedSales === 1 ? "" : "s"} skipped (BC-locked — admin only)` : "")
        )
        setLookup(null); setLookupQ("")
        await load(includeComplete)
      }
    } finally {
      setApplying(false)
    }
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
                .map(c => <CheckPanel key={c.key} check={c} selected={selected} onToggle={toggleLot} />)}
            </div>
          )}
          {data.checks.length === 0 && fixResult && (
            <p className="px-4 py-3 rounded-xl border text-sm bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-300">
              {fixResult}
            </p>
          )}
          {data.checks.length === 0 && data.totes.length > 0 && (
            <p className="text-sm text-green-600 dark:text-green-400">
              ✅ All checks passed — every lot&apos;s tote, receipt and vendor agrees with the BC data.
            </p>
          )}

          {/* ── Problems that need fixing before tonight ── */}
          {data.noTote.length > 0 && (
            <CheckPanel
              check={{
                key: "no_tote",
                count: data.noTote.length,
                lots: data.noTote.map(p => ({
                  id: p.id, auctionId: p.auctionId, barcode: p.barcode ?? "", uniqueId: p.uniqueId,
                  tote: "", receipt: "", vendor: "", sale: p.sale, cataloguedBy: p.cataloguedBy,
                })),
              }}
              selected={selected}
              onToggle={toggleLot}
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

          {/* ── Mass re-map: type the corrections instead of ticking lots ── */}
          <MassRemap onApplied={async (msg) => { setFixResult(msg); await load(includeComplete) }} />

          {/* ── Intervention bar — appears when lots are ticked in any panel ── */}
          {selected.size > 0 && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(60rem,calc(100vw-2rem))] rounded-2xl border-2 border-blue-400 dark:border-blue-500/60 bg-white dark:bg-[#15151a] shadow-2xl px-5 py-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="px-3 py-1.5 rounded-full bg-blue-600 text-white text-sm font-bold shrink-0">
                  {selected.size} lot{selected.size === 1 ? "" : "s"} ticked
                </span>
                <span className="text-sm text-gray-700 dark:text-gray-300">Move them to:</span>
                <input
                  value={lookupQ}
                  onChange={e => { setLookupQ(e.target.value.toUpperCase()); setLookup(null) }}
                  onKeyDown={e => { if (e.key === "Enter") runLookup() }}
                  placeholder="Tote (T001234) or receipt (R000123)"
                  className="flex-1 min-w-[14rem] bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 dark:text-white placeholder:font-sans focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={runLookup}
                  disabled={looking || !lookupQ.trim()}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 disabled:opacity-40 text-gray-900 dark:text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {looking ? "Checking…" : "Check in BC"}
                </button>
                <button
                  onClick={applyToSelected}
                  disabled={applying || !lookup?.ok}
                  title={lookup?.ok ? "" : "Check the tote or receipt in BC first"}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  {applying ? "Applying…" : "Apply to ticked lots"}
                </button>
                <button
                  onClick={() => { setSelected(new Map()); setLookup(null); setLookupQ("") }}
                  className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline"
                >
                  Clear
                </button>
              </div>
              {/* The looked-up truth, before anything is applied — same confirm-first
                  pattern as Manage Lots → Change Vendor. */}
              {lookup && (
                lookup.ok ? (
                  <p className="text-sm text-green-700 dark:text-green-400">
                    ✓ {lookup.kind === "tote"
                      ? <>Tote <span className="font-mono font-bold">{lookup.tote}</span> belongs to receipt{" "}
                          <span className="font-mono font-bold">{lookup.receipt ?? "—"}</span> — {lookup.vendorName ?? lookup.vendor ?? "unknown vendor"}.
                          The ticked lots&apos; tote, receipt and vendor will all be set to match.</>
                      : <>Receipt <span className="font-mono font-bold">{lookup.receipt}</span> — {lookup.vendorName ?? lookup.vendor ?? "unknown vendor"}
                          {typeof lookup.toteCount === "number" ? ` (${lookup.toteCount} tote${lookup.toteCount === 1 ? "" : "s"} in BC)` : ""}.
                          Receipt and vendor will be set; the lots&apos; totes are left as they are.</>}
                  </p>
                ) : (
                  <p className="text-sm text-red-600 dark:text-red-400">{lookup.error}</p>
                )
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Typed mass corrections: one change per line, "wrong → right". Preview shows
// what every line would hit BEFORE anything is written; Apply reuses the same
// verified Change Vendor machinery as the tick-and-move bar.
function MassRemap({ onApplied }: { onApplied: (msg: string) => Promise<void> }) {
  const [open, setOpen]       = useState(false)
  const [text, setText]       = useState("")
  const [busy, setBusy]       = useState<"preview" | "apply" | null>(null)
  const [results, setResults] = useState<RemapLineResult[] | null>(null)
  const [error, setError]     = useState<string | null>(null)

  // Accepts →, ->, comma, tab or plain spaces between the two values.
  function parse(): { from: string; to: string }[] {
    return text
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        const parts = l.split(/→|->|,|\t/).map(p => p.trim()).filter(Boolean)
        const fallback = l.split(/\s+/).filter(Boolean)
        const [from, to] = parts.length >= 2 ? parts : fallback
        return { from: from ?? "", to: to ?? "" }
      })
  }

  async function run(apply: boolean) {
    const lines = parse()
    if (lines.length === 0) return
    if (apply) {
      const total = (results ?? []).reduce((s, r) => s + (r.ok ? r.matched : 0), 0)
      if (!confirm(
        `Apply ${lines.length} change${lines.length === 1 ? "" : "s"}${total ? ` to ${total} lot${total === 1 ? "" : "s"}` : ""}?\n\n` +
        "Each right-hand value has been checked against the BC data. Vendor and receipt are set from BC (and the tote too where a tote was given). " +
        "Existing unique IDs are kept, everything is logged, and each sale can be undone from Manage Lots → Undo."
      )) return
    }
    setBusy(apply ? "apply" : "preview"); setError(null)
    try {
      const res = await massRemapPendingLots(lines, apply)
      if (!res.ok && res.error) { setError(res.error); return }
      setResults(res.results)
      if (apply) {
        const updated = res.results.reduce((s, r) => s + (r.updated ?? 0), 0)
        const failed  = res.results.filter(r => !r.ok).length
        await onApplied(
          `Re-map applied — ${updated} lot${updated === 1 ? "" : "s"} moved` +
          (failed ? ` · ${failed} line${failed === 1 ? "" : "s"} couldn't run (see the re-map panel)` : "")
        )
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E]">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white text-left">
        <span className="text-xs">{open ? "▼" : "▶"}</span>
        📝 Mass re-map — type the corrections
        <span className="font-normal text-xs text-gray-500 ml-1">one per line: wrong tote or receipt → right one</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setResults(null) }}
            rows={5}
            placeholder={"P05696 → P005696\nR08414 → R008414\nT026394 → T026395"}
            className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 dark:text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
          />
          <p className="text-xs text-gray-500 dark:text-gray-500">
            The left side finds every not-yet-in-BC lot carrying that tote or receipt; the right side must exist in the BC
            data and is what they&apos;re moved to. Preview first — nothing is written until Apply.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => run(false)}
              disabled={busy !== null || !text.trim()}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 disabled:opacity-40 text-gray-900 dark:text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {busy === "preview" ? "Checking…" : "Preview"}
            </button>
            <button
              onClick={() => run(true)}
              disabled={busy !== null || !results || results.every(r => !r.ok || r.matched === 0)}
              title={results ? "" : "Preview first so you can see what each line will hit"}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
            >
              {busy === "apply" ? "Applying…" : "Apply the changes"}
            </button>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {results && (
            <div className="space-y-1">
              {results.map((r, i) => (
                <div key={i} className={`text-xs px-3 py-2 rounded-lg border flex flex-wrap items-center gap-x-2 ${
                  !r.ok
                    ? "border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300"
                    : r.matched === 0
                      ? "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-500"
                      : "border-green-200 dark:border-green-800/40 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300"
                }`}>
                  <span className="font-mono font-semibold">{r.from || "?"} → {r.to || "?"}</span>
                  {!r.ok ? (
                    <span>{r.error}</span>
                  ) : (
                    <>
                      <span>
                        {r.kind === "tote"
                          ? <>tote → receipt {r.receipt ?? "—"}, {r.vendorName ?? r.vendor ?? "unknown vendor"}</>
                          : <>receipt — {r.vendorName ?? r.vendor ?? "unknown vendor"}</>}
                      </span>
                      <span className="font-semibold">
                        {r.updated !== undefined
                          ? `moved ${r.updated} lot${r.updated === 1 ? "" : "s"}`
                          : r.matched === 0
                            ? "matches no pending lots"
                            : `will move ${r.matched} lot${r.matched === 1 ? "" : "s"}`}
                      </span>
                      {!!r.lockedSales && <span>· {r.lockedSales} sale{r.lockedSales === 1 ? "" : "s"} BC-locked</span>}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CheckPanel({ check, selected, onToggle }: {
  check: Check
  selected: Map<string, string>
  onToggle: (lotId: string, auctionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const meta = CHECK_META[check.key] ?? { label: check.key, hint: "", tone: "warn" as const, order: 99 }
  const tone = meta.tone === "bad"
    ? "border-red-300 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300"
    : "border-amber-300 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300"
  const allTicked = check.lots.length > 0 && check.lots.every(l => selected.has(l.id))
  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="flex items-center gap-3">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-sm font-medium flex-1 text-left">
          <span className="text-xs">{open ? "▼" : "▶"}</span>
          <span>{meta.tone === "bad" ? "⛔" : "⚠"} {meta.label} ({check.count})</span>
        </button>
        {open && (
          <button
            onClick={() => check.lots.forEach(l => { if (allTicked ? selected.has(l.id) : !selected.has(l.id)) onToggle(l.id, l.auctionId) })}
            className="text-xs underline opacity-80 hover:opacity-100 shrink-0"
          >
            {allTicked ? "Untick all" : `Tick all ${check.lots.length}`}
          </button>
        )}
      </div>
      <p className="text-xs opacity-80 mt-1 ml-5">{meta.hint}</p>
      {open && (
        <div className="mt-2 ml-5 space-y-1.5 max-h-96 overflow-y-auto pr-1">
          {check.lots.map(l => (
            <label
              key={l.id}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-black/5 dark:border-white/10 bg-white/70 dark:bg-black/25 px-3 py-2 ${l.auctionId ? "cursor-pointer" : ""}`}
            >
              <input
                type="checkbox"
                className="accent-blue-500 h-4 w-4"
                checked={selected.has(l.id)}
                onChange={() => onToggle(l.id, l.auctionId)}
                disabled={!l.auctionId}
              />
              <span className="font-mono font-bold text-sm text-gray-900 dark:text-white">{l.barcode || l.uniqueId || "—"}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs">
                <IssueLine checkKey={check.key} l={l} />
              </span>
              <span className="ml-auto text-[11px] opacity-60 whitespace-nowrap">
                {[l.sale, l.cataloguedBy].filter(Boolean).join(" · ")}
              </span>
            </label>
          ))}
          {check.count > check.lots.length && (
            <p className="text-xs opacity-70">…and {check.count - check.lots.length} more</p>
          )}
        </div>
      )}
    </div>
  )
}

// One coloured value pill inside a check row — a tiny caption saying WHERE the
// value comes from, then the value itself. Red = the wrong side, green = what
// BC says it should be, grey = context.
function Chip({ tone, label, children }: { tone: "bad" | "good" | "plain"; label?: string; children: ReactNode }) {
  const cls = tone === "bad"
    ? "border-red-300 dark:border-red-500/40 bg-red-100 dark:bg-red-500/15 text-red-900 dark:text-red-200"
    : tone === "good"
    ? "border-green-300 dark:border-green-500/40 bg-green-100 dark:bg-green-500/15 text-green-900 dark:text-green-200"
    : "border-gray-300 dark:border-white/15 bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-200"
  return (
    <span className={`inline-flex items-baseline gap-1.5 rounded-md border px-2 py-0.5 ${cls}`}>
      {label && <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70 whitespace-nowrap">{label}</span>}
      <span className="font-mono font-semibold whitespace-nowrap">{children}</span>
    </span>
  )
}

// The plain-words explanation of ONE issue row: what the lot says, what BC
// says, which side is wrong. Vendor chips carry the vendor's name so nobody
// has to decode C-numbers.
function IssueLine({ checkKey, l }: { checkKey: string; l: CheckLot }) {
  const vend = (no?: string, name?: string) => (no ? (name ? `${no} · ${name}` : no) : "—")
  switch (checkKey) {
    case "vendor_mismatch":
      return (<>
        <Chip tone="bad" label="on the lot">{vend(l.vendor, l.vendorName)}</Chip>
        <span className="opacity-70">should be</span>
        <Chip tone="good" label={`tote ${l.tote} in BC`}>{vend(l.bcVendor, l.bcVendorName)}</Chip>
      </>)
    case "vendor_missing":
      return (<>
        <Chip tone="bad" label="on the lot">no vendor</Chip>
        <span className="opacity-70">BC says</span>
        <Chip tone="good" label={`tote ${l.tote} in BC`}>{vend(l.bcVendor, l.bcVendorName)}</Chip>
      </>)
    case "receipt_mismatch":
      return (<>
        <Chip tone="bad" label="on the lot">{l.receipt || "—"}</Chip>
        <span className="opacity-70">should be</span>
        <Chip tone="good" label={`tote ${l.tote} in BC`}>{l.bcReceipt || "—"}</Chip>
      </>)
    case "receipt_missing":
      return (<>
        <Chip tone="bad" label="on the lot">no receipt</Chip>
        <span className="opacity-70">BC says</span>
        <Chip tone="good" label={`tote ${l.tote} in BC`}>{l.bcReceipt || "—"}</Chip>
      </>)
    case "receipt_not_in_bc":
      return (<>
        <Chip tone="bad" label="receipt on the lot">{l.receipt || "—"}</Chip>
        <span className="opacity-70">isn&apos;t on any synced BC tote or item</span>
        {l.tote && <Chip tone="plain" label="tote">{l.tote}</Chip>}
      </>)
    case "tote_unknown":
      return (<>
        <Chip tone="bad" label="tote on the lot">{l.tote || "—"}</Chip>
        <span className="opacity-70">isn&apos;t in the synced BC tote list</span>
        {l.receipt && <Chip tone="plain" label="receipt">{l.receipt}</Chip>}
      </>)
    case "unique_id_mismatch":
      return (<>
        <Chip tone="plain" label="unique id">{l.uniqueId || "—"}</Chip>
        <span className="opacity-70">points at receipt {(l.uniqueId.split("-")[0] ?? "").toUpperCase()}, but the lot&apos;s receipt is</span>
        <Chip tone="plain" label="on the lot">{l.receipt || "—"}</Chip>
      </>)
    case "duplicate_barcode":
      return (<>
        <span className="opacity-70">same barcode saved under</span>
        <Chip tone="bad" label="totes">{(l.totes ?? [l.tote]).filter(Boolean).join(" + ")}</Chip>
      </>)
    case "invalid_barcode":
      return (<>
        <span className="opacity-70">doesn&apos;t match the F066001 format</span>
        {l.tote && <Chip tone="plain" label="tote">{l.tote}</Chip>}
      </>)
    case "no_tote":
      return (<>
        <Chip tone="bad" label="tote">none</Chip>
        <span className="opacity-70">tick, type the right tote below, apply</span>
      </>)
    default:
      return (<>
        {l.tote && <Chip tone="plain" label="tote">{l.tote}</Chip>}
        {l.receipt && <Chip tone="plain" label="receipt">{l.receipt}</Chip>}
      </>)
  }
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
