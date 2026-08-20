"use client"

// End of Day → BC. One click at the end of the day: every lot catalogued in
// the Hub that hasn't yet reached Business Central, grouped by receipt, exported
// as the hotkey sheet (ToteNumber,LotCount,Barcodes) the overnight "add to BC"
// macro works through. Same file shape as BC Import Check reads and writes, so
// a broken overnight run can be reconciled there and re-run.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { autocorrectLotsForAuctions, dismissEodChecks, lookupToteOrReceipt, massRemapPendingLots, matchBcLinesAcrossAuctions, restoreEodChecks, setLotsVendorReceiptAcrossAuctions, type AutocorrectChange, type EodMatchRow, type RemapLineResult } from "@/lib/actions/catalogue"
import { readSheet, parseBcLinesForMatch, parseHotkeySheet, parseBcLinesExport, reconcileImport, buildHotkeyCsv, type HotkeyToteRow, type BcLinesRow } from "@/lib/bc-import-sheets"

type ReceiptRow = { receipt: string; count: number; barcodes: string[]; sales: string[] }
type SaleRow = { id: string; code: string; name: string; complete: boolean; count: number }
type Problem = { id: string; auctionId: string; barcode?: string; uniqueId: string; tote?: string; sale: string; title: string; cataloguedBy: string }
type CheckLot = {
  id: string; auctionId: string; barcode: string; uniqueId: string; tote: string; receipt: string
  vendor: string; sale: string; cataloguedBy: string
  bcReceipt?: string; bcVendor?: string; dupGroups?: string[]
  vendorName?: string; bcVendorName?: string
}
type Check = { key: string; count: number; lots: CheckLot[]; ignored?: CheckLot[]; ignoredCount?: number }
type Data = {
  generatedAt: string
  toteLastSync: string | null
  totalLots: number
  alreadyInBc: number
  readyCount: number
  receipts: ReceiptRow[]
  sales: SaleRow[]
  checks: Check[]
  noBarcode: Problem[]
  noReceipt: Problem[]
}

// Same wording and severity as the Tote Check tab for the shared checks, plus
// the three sheet-specific ones. Order = display order, worst first.
const CHECK_META: Record<string, { label: string; hint: string; tone: "bad" | "warn"; order: number }> = {
  duplicate_barcode: {
    label: "Same barcode under two receipts — taken OFF tonight's sheet", tone: "bad", order: 0,
    hint: "One of the receipts is wrong, and importing would create the BC line on the wrong receipt. Fix the wrong lot (tick + apply, or Manage Lots → Change Vendor), then refresh — they go back on the sheet.",
  },
  receipt_not_in_bc: {
    label: "Receipt doesn't exist in BC", tone: "bad", order: 1,
    hint: "No synced BC tote or item carries this receipt number — likely a typo, or a receipt not booked into BC yet. Still on the sheet, but the overnight run will fail on it.",
  },
  tote_receipt_mismatch: {
    label: "Tote belongs to another receipt", tone: "warn", order: 2,
    hint: "The receipt on the lot is confirmed by BC's own unique ID, so the receipt is right and the tote is the odd one out. Still on the sheet. Do NOT correct the receipt from the tote.",
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
    label: "No tote on the lot", tone: "warn", order: 9,
    hint: "Still on the sheet (it runs on receipts), but without a tote the lot can't be verified against the BC tote data. Tick them, type the right tote in the bar below, apply.",
  },
  no_receipt: {
    label: "No receipt on the lot — off the sheet until one is set", tone: "bad", order: 10,
    hint: "The sheet is grouped by receipt, so these can't go on it. Tick them, type the tote or receipt in the bar that appears, and apply.",
  },
}

// "16:42 · just now" / "16:42 · 25m ago" / "yesterday 16:42" — how fresh the
// data on screen is, shown under the ⟳ Refresh button (re-rendered each minute
// by the age tick so the relative part stays honest).
function fmtPulled(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  const sameDay = d.toDateString() === new Date().toDateString()
  if (!sameDay) {
    const yesterday = new Date(Date.now() - 86_400_000).toDateString() === d.toDateString()
    const day = yesterday ? "yesterday" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    return `${day} ${time}`
  }
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return `${time} · just now`
  if (m < 60) return `${time} · ${m}m ago`
  return `${time} · ${Math.floor(m / 60)}h ${m % 60}m ago`
}

export default function EndOfDayPage() {
  const [data, setData]       = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [includeComplete, setIncludeComplete] = useState(false)
  const [copied, setCopied]   = useState(false)
  const [openReceipt, setOpenReceipt] = useState<string | null>(null)
  const [fixing, setFixing]   = useState(false)
  const [fixResult, setFixResult] = useState<string | null>(null)
  const [fixPreview, setFixPreview] = useState<{ changes: AutocorrectChange[]; skipped: number; lockedSales: number } | null>(null)
  // No auto-refresh (Jordan's call): after a change is applied the page keeps
  // what's on screen and flags itself stale — the ⟳ Refresh button re-runs the
  // heavy checks only when he's ready.
  const [stale, setStale] = useState(false)
  // Visible refresh feedback (Jordan: "the refresh button is not very clear
  // its done anything"): a ✓ flash on completion + a live "pulled Xm ago"
  // readout under the button, re-rendered each minute so the age stays honest.
  const [justRefreshed, setJustRefreshed] = useState(false)
  const [, setAgeTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setAgeTick(x => x + 1), 60_000)
    return () => clearInterval(t)
  }, [])

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
      setStale(false)
      setJustRefreshed(true)
      setTimeout(() => setJustRefreshed(false), 2500)
    } catch (e: any) { setError(e?.message ?? "Failed to load"); setData(null) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(includeComplete) }, [load, includeComplete])

  // Exactly the sheet the macro consumes (and BC Import Check round-trips):
  // header row + ONE line per RECEIPT, barcodes pipe-separated. Receipt-keyed
  // since 2026-08-07 (Jordan: the macro works receipt-by-receipt in BC — the
  // old tote grouping was wrong), and the filename must be BC_Import.csv
  // exactly, because that's the name the macro looks for.
  const csv = useMemo(() => {
    if (!data || data.receipts.length === 0) return ""
    const lines = ["ReceiptNumber,LotCount,Barcodes"]
    for (const r of data.receipts) lines.push(`${r.receipt},${r.count},${r.barcodes.join("|")}`)
    return lines.join("\r\n")
  }, [data])

  function download() {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "BC_Import.csv"
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
        setLookup(null); setLookupQ(""); setSelected(new Map())
        setStale(true)
      }
    } finally {
      setApplying(false)
    }
  }

  // The same fix as Tote Check → Match BC, run over every sale on the sheet.
  // Only corrects what BC can prove (a known tote's receipt/vendor) — unknown
  // totes are never guessed at, so it can't fix everything the checks flag.
  // Two steps: the button runs a PREVIEW (nothing written) and shows every
  // planned change in a modal; Apply then runs the same fix for real.
  async function fixFromBc() {
    if (!data) return
    const ids = data.sales.map(s => s.id).filter(Boolean)
    if (ids.length === 0) return
    setFixing(true); setFixResult(null)
    try {
      const res = await autocorrectLotsForAuctions(ids, false)
      if (!res.ok && res.error) {
        setFixResult(`Couldn't check what's fixable: ${res.error}`)
      } else {
        setFixPreview({ changes: res.changes, skipped: res.skipped, lockedSales: res.lockedSales })
      }
    } finally {
      setFixing(false)
    }
  }

  async function applyFixes() {
    if (!data) return
    const ids = data.sales.map(s => s.id).filter(Boolean)
    setFixing(true)
    try {
      const res = await autocorrectLotsForAuctions(ids, true)
      setFixPreview(null)
      if (!res.ok && res.error) {
        setFixResult(`Couldn't fix: ${res.error}`)
      } else {
        setFixResult(
          `Fixed ${res.updated} lot${res.updated === 1 ? "" : "s"} from the BC tote data` +
          (res.corrections ? ` · ${res.corrections} had already gone into BC wrong — they're on the BC Corrections list to put right in BC` : "") +
          (res.skipped ? ` · ${res.skipped} couldn't be fixed (tote not in BC)` : "") +
          (res.lockedSales ? ` · ${res.lockedSales} sale${res.lockedSales === 1 ? "" : "s"} skipped (BC-locked — admin only)` : "")
        )
        setStale(true)
      }
    } finally {
      setFixing(false)
    }
  }

  // Ignore / restore stale warnings (per lot + check type). The panels file
  // ignored rows separately — nothing on the lot changes, fully reversible.
  // These move the rows locally instead of re-running the whole check suite —
  // the page only does the heavy refresh on the ⟳ button (Jordan's call).
  function moveIgnored(pairs: { lotId: string; checkKey: string }[], dir: "ignore" | "restore") {
    const pairSet = new Set(pairs.map(p => `${p.lotId}::${p.checkKey}`))
    setData(d => {
      if (!d) return d
      return {
        ...d,
        checks: d.checks.map(c => {
          const inPanel = (l: CheckLot) => pairSet.has(`${l.id}::${c.key}`)
          if (dir === "ignore") {
            const moving = c.lots.filter(inPanel)
            if (!moving.length) return c
            return {
              ...c,
              lots: c.lots.filter(l => !inPanel(l)), count: c.count - moving.length,
              ignored: [...(c.ignored ?? []), ...moving], ignoredCount: (c.ignoredCount ?? 0) + moving.length,
            }
          }
          const moving = (c.ignored ?? []).filter(inPanel)
          if (!moving.length) return c
          return {
            ...c,
            ignored: (c.ignored ?? []).filter(l => !inPanel(l)), ignoredCount: (c.ignoredCount ?? 0) - moving.length,
            lots: [...c.lots, ...moving], count: c.count + moving.length,
          }
        }),
      }
    })
    if (dir === "ignore") {
      setSelected(prev => {
        const next = new Map(prev)
        for (const p of pairs) next.delete(p.lotId)
        return next
      })
    }
  }
  async function ignorePairs(pairs: { lotId: string; checkKey: string }[]) {
    const res = await dismissEodChecks(pairs)
    if (!res.ok && res.error) setFixResult(`Couldn't ignore: ${res.error}`)
    else moveIgnored(pairs, "ignore")
  }
  async function restorePairs(pairs: { lotId: string; checkKey: string }[]) {
    const res = await restoreEodChecks(pairs)
    if (!res.ok && res.error) setFixResult(`Couldn't restore: ${res.error}`)
    else moveIgnored(pairs, "restore")
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🌙 End of Day → BC</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
            Every lot catalogued in the Hub that hasn&apos;t yet reached Business Central, grouped by receipt and ready to
            download as the hotkey sheet the overnight import runs through. Checked against the synced BC data by
            barcode — so lots missed on a previous day are swept up automatically.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={() => load(includeComplete)}
            disabled={loading}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${loading
              ? "bg-blue-600 text-white opacity-70"
              : justRefreshed
                ? "bg-green-600 text-white"
                : stale
                  ? "bg-amber-500 hover:bg-amber-400 text-black animate-pulse"
                  : "bg-blue-600 hover:bg-blue-500 text-white"}`}
          >
            {loading ? "⟳ Pulling the lots in…" : justRefreshed ? "✓ Refreshed" : stale ? "⟳ Refresh — changes made" : "⟳ Refresh"}
          </button>
          {data && (
            <div className="text-right text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
              <div>📥 Lots last pulled: <strong className="text-gray-800 dark:text-gray-200">{fmtPulled(data.generatedAt)}</strong></div>
              {data.toteLastSync && (
                <div>🔄 BC data last synced: <strong className="text-gray-800 dark:text-gray-200">{fmtPulled(data.toteLastSync)}</strong></div>
              )}
            </div>
          )}
        </div>
      </div>

      {stale && (
        <p className="px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800/40 text-sm text-amber-800 dark:text-amber-300">
          Changes have been applied — the numbers, sheet and checks on screen are from before. Press <strong>⟳ Refresh</strong> when
          you&apos;re ready to re-run them (nothing refreshes on its own).
        </p>
      )}

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
              <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{data.receipts.length.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Receipts</div>
            </div>
            <div className={`border rounded-xl p-4 text-center ${data.noReceipt.length || data.noBarcode.length ? "bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800/40" : "bg-white dark:bg-[#1C1C1E] border-gray-200 dark:border-gray-800"}`}>
              <div className={`text-2xl font-bold ${data.noReceipt.length || data.noBarcode.length ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"}`}>
                {(data.noReceipt.length + data.noBarcode.length).toLocaleString()}
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
              ⬇ Download BC_Import.csv{data.receipts.length ? ` (${data.receipts.length} receipts)` : ""}
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
                  title="The same fix as Match BC on each sale's Tote Check tab — corrects receipt and vendor from the BC tote data wherever the tote is known. Unknown totes are never guessed at. Shows every planned change first — nothing happens until you Apply."
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {fixing && !fixPreview ? "Checking what's fixable…" : "🔧 Fix what BC can prove"}
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
                .map(c => <CheckPanel key={c.key} check={c} selected={selected} onToggle={toggleLot} onIgnore={ignorePairs} onRestore={restorePairs} />)}
            </div>
          )}
          {data.checks.length === 0 && fixResult && (
            <p className="px-4 py-3 rounded-xl border text-sm bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-300">
              {fixResult}
            </p>
          )}
          {data.checks.length === 0 && data.receipts.length > 0 && (
            <p className="text-sm text-green-600 dark:text-green-400">
              ✅ All checks passed — every lot&apos;s tote, receipt and vendor agrees with the BC data.
            </p>
          )}

          {/* ── Problems that need fixing before tonight ── */}
          {data.noReceipt.length > 0 && (
            <CheckPanel
              check={{
                key: "no_receipt",
                count: data.noReceipt.length,
                lots: data.noReceipt.map(p => ({
                  id: p.id, auctionId: p.auctionId, barcode: p.barcode ?? "", uniqueId: p.uniqueId,
                  tote: p.tote ?? "", receipt: "", vendor: "", sale: p.sale, cataloguedBy: p.cataloguedBy,
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
                  <th className="text-left px-4 py-2.5 font-semibold">Receipt</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Lots</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Sale</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Barcodes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800/60">
                {data.receipts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                      🎉 Nothing waiting — every catalogued lot is already in BC.
                    </td>
                  </tr>
                )}
                {data.receipts.map(t => {
                  const open = openReceipt === t.receipt
                  return (
                    <tr key={t.receipt} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
                      <td className="px-4 py-2.5 font-mono font-semibold text-cyan-700 dark:text-cyan-300 whitespace-nowrap">{t.receipt}</td>
                      <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{t.count}</td>
                      <td className="px-4 py-2.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{t.sales.join(", ") || "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-600 dark:text-gray-400">
                        {open ? t.barcodes.join(" | ") : `${t.barcodes.slice(0, 6).join(" | ")}${t.barcodes.length > 6 ? " …" : ""}`}
                        {t.barcodes.length > 6 && (
                          <button
                            onClick={() => setOpenReceipt(open ? null : t.receipt)}
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
          <MassRemap onApplied={async (msg) => { setFixResult(msg); setStale(true) }} />

          {/* ── The morning after — check the run, then link BC back up ── */}
          <div className="pt-2 space-y-2">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">🌅 The morning after</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 max-w-3xl">
                Once the overnight macro has run: check the run finished with <strong>Import Check</strong> (and get a re-run
                sheet for anything it missed), then upload the BC Lines export to <strong>BC Match</strong> to link BC&apos;s
                Unique IDs back onto the Hub lots — across every sale at once.
              </p>
            </div>
            <ImportCheckPanel receipts={data.receipts} />
            <BcMatchAllPanel onImported={msg => { setFixResult(msg); setStale(true) }} />
          </div>

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

      {/* ── 🔧 Fix preview — every planned change, shown BEFORE anything is written ── */}
      {fixPreview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setFixPreview(null)}>
          <div
            className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#15151a] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                🔧 Fix what BC can prove — {fixPreview.changes.length} lot{fixPreview.changes.length === 1 ? "" : "s"} would change
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Nothing has been changed yet. Each line shows what will be corrected from the BC tote data — red is what&apos;s on the lot now, green is what BC says.
                Every change is logged in the Lot Change Log, and anything already pushed to BC wrong lands on the BC Corrections list.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1.5">
              {fixPreview.changes.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-black/25 px-3 py-2">
                  <span className="font-mono font-bold text-sm text-gray-900 dark:text-white">{c.barcode || c.uniqueId || "—"}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                    {c.newVendor && (<>
                      <span className="opacity-70">vendor</span>
                      <Chip tone="bad">{c.oldVendor || "blank"}</Chip>
                      <span className="opacity-70">→</span>
                      <Chip tone="good">{c.vendorName ? `${c.newVendor} · ${c.vendorName}` : c.newVendor}</Chip>
                    </>)}
                    {c.newReceipt && (<>
                      <span className="opacity-70">receipt</span>
                      <Chip tone="bad">{c.oldReceipt || "blank"}</Chip>
                      <span className="opacity-70">→</span>
                      <Chip tone="good">{c.newReceipt}</Chip>
                    </>)}
                    {c.tote && <Chip tone="plain" label="tote">{c.tote}</Chip>}
                  </span>
                  <span className="ml-auto text-[11px] text-gray-500 whitespace-nowrap">{c.sale}</span>
                </div>
              ))}
              {fixPreview.changes.length === 0 && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Nothing to fix — none of the flagged lots have a tote BC can prove the right values from.
                </p>
              )}
              {(fixPreview.skipped > 0 || fixPreview.lockedSales > 0) && (
                <p className="text-xs text-gray-500 pt-1">
                  {fixPreview.skipped > 0 && <>{fixPreview.skipped} flagged lot{fixPreview.skipped === 1 ? "" : "s"} can&apos;t be fixed automatically (tote not in the BC data). </>}
                  {fixPreview.lockedSales > 0 && <>{fixPreview.lockedSales} sale{fixPreview.lockedSales === 1 ? "" : "s"} skipped (BC-locked — admin only).</>}
                </p>
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-3">
              <button
                onClick={() => setFixPreview(null)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel — change nothing
              </button>
              <button
                onClick={applyFixes}
                disabled={fixing || fixPreview.changes.length === 0}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {fixing ? "Fixing…" : `✓ Apply ${fixPreview.changes.length} fix${fixPreview.changes.length === 1 ? "" : "es"}`}
              </button>
            </div>
          </div>
        </div>
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

function CheckPanel({ check, selected, onToggle, onIgnore, onRestore }: {
  check: Check
  selected: Map<string, string>
  onToggle: (lotId: string, auctionId: string) => void
  onIgnore?: (pairs: { lotId: string; checkKey: string }[]) => Promise<void>
  onRestore?: (pairs: { lotId: string; checkKey: string }[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)
  const [busy, setBusy] = useState(false)
  const meta = CHECK_META[check.key] ?? { label: check.key, hint: "", tone: "warn" as const, order: 99 }
  const tone = meta.tone === "bad"
    ? "border-red-300 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300"
    : "border-amber-300 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300"
  const allTicked = check.lots.length > 0 && check.lots.every(l => selected.has(l.id))
  // duplicate_barcode changes what goes on the sheet, so it can't be ignored;
  // a missing tote/receipt is something to FIX, not hide.
  const ignorable = !!onIgnore && check.key !== "duplicate_barcode" && check.key !== "no_tote" && check.key !== "no_receipt"
  const tickedHere = check.lots.filter(l => selected.has(l.id))
  const ignored = check.ignored ?? []
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }
  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="flex items-center gap-3">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-sm font-medium flex-1 text-left">
          <span className="text-xs">{open ? "▼" : "▶"}</span>
          <span>
            {meta.tone === "bad" ? "⛔" : "⚠"} {meta.label} ({check.count})
            {ignored.length > 0 && <span className="font-normal opacity-70"> · {ignored.length} ignored</span>}
          </span>
        </button>
        {open && ignorable && tickedHere.length > 0 && (
          <button
            disabled={busy}
            onClick={() => run(() => onIgnore!(tickedHere.map(l => ({ lotId: l.id, checkKey: check.key }))))}
            title="Hide these warnings — for flags you know are wrong (e.g. the BC sync hasn't caught up). Nothing on the lot changes, and they can be restored below at any time."
            className="text-xs underline opacity-80 hover:opacity-100 shrink-0 disabled:opacity-40"
          >
            🔕 Ignore ticked ({tickedHere.length})
          </button>
        )}
        {open && check.lots.length > 0 && (
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
      {ignored.length > 0 && (
        <div className="mt-2 ml-5">
          <button onClick={() => setShowIgnored(v => !v)} className="text-xs underline opacity-70 hover:opacity-100">
            🔕 {ignored.length} ignored warning{ignored.length === 1 ? "" : "s"} {showIgnored ? "— hide" : "— show"}
          </button>
          {showIgnored && (
            <div className="mt-1.5 space-y-1.5 max-h-64 overflow-y-auto pr-1">
              <div className="flex justify-end">
                <button
                  disabled={busy}
                  onClick={() => run(() => onRestore!(ignored.map(l => ({ lotId: l.id, checkKey: check.key }))))}
                  className="text-xs underline opacity-70 hover:opacity-100 disabled:opacity-40"
                >
                  Restore all
                </button>
              </div>
              {ignored.map(l => (
                <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-black/5 dark:border-white/10 bg-white/40 dark:bg-black/10 px-3 py-2 opacity-60">
                  <span className="font-mono font-bold text-sm text-gray-900 dark:text-white">{l.barcode || l.uniqueId || "—"}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs">
                    <IssueLine checkKey={check.key} l={l} />
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    <span className="text-[11px] opacity-70 whitespace-nowrap">{[l.sale, l.cataloguedBy].filter(Boolean).join(" · ")}</span>
                    <button
                      disabled={busy}
                      onClick={() => run(() => onRestore!([{ lotId: l.id, checkKey: check.key }]))}
                      className="text-xs underline disabled:opacity-40"
                    >
                      Restore
                    </button>
                  </span>
                </div>
              ))}
              {(check.ignoredCount ?? 0) > ignored.length && (
                <p className="text-xs opacity-70">…and {(check.ignoredCount ?? 0) - ignored.length} more</p>
              )}
            </div>
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
    case "tote_receipt_mismatch":
      return (<>
        <Chip tone="good" label="on the lot, confirmed by BC">{l.receipt || "—"}</Chip>
        <span className="opacity-70">but tote {l.tote} is on</span>
        <Chip tone="plain" label="in BC">{l.bcReceipt || "—"}</Chip>
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
        <Chip tone="bad" label="receipts">{(l.dupGroups ?? [l.receipt]).filter(Boolean).join(" + ")}</Chip>
      </>)
    case "invalid_barcode":
      return (<>
        <span className="opacity-70">doesn&apos;t match the F066001 format</span>
        {l.tote && <Chip tone="plain" label="tote">{l.tote}</Chip>}
      </>)
    case "no_tote":
      return (<>
        <Chip tone="bad" label="tote">none</Chip>
        <span className="opacity-70">still on the sheet, but can&apos;t be checked against BC — tick, type the tote, apply</span>
        {l.receipt && <Chip tone="plain" label="receipt">{l.receipt}</Chip>}
      </>)
    case "no_receipt":
      return (<>
        <Chip tone="bad" label="receipt">none</Chip>
        <span className="opacity-70">off the sheet — tick, type the tote or receipt below, apply</span>
        {l.tote && <Chip tone="plain" label="tote">{l.tote}</Chip>}
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

// ─── The morning after: Import Check ─────────────────────────────────────────
// Same engine as Auction AI → BC Import Check (lib/bc-import-sheets.ts, ONE
// copy) restyled for this page: reconcile the hotkey sheet that ran overnight
// against the BC Lines export, get a re-run sheet of only what's missing.
function ImportCheckPanel({ receipts }: { receipts: ReceiptRow[] }) {
  const [open, setOpen]             = useState(false)
  const [hotkey, setHotkey]         = useState<HotkeyToteRow[] | null>(null)
  const [hotkeyName, setHotkeyName] = useState<string | null>(null)
  const [bc, setBc]                 = useState<{ barcodes: Set<string>; errors: { barcode: string; uniqueId: string; tote: string; error: string }[] } | null>(null)
  const [bcName, setBcName]         = useState<string | null>(null)
  const [err, setErr]               = useState<string | null>(null)
  const [copied, setCopied]         = useState(false)

  async function loadHotkey(file: File) {
    setErr(null)
    try { setHotkey(parseHotkeySheet(await readSheet(file))); setHotkeyName(file.name) }
    catch (e: any) { setErr(e?.message ?? "Could not read the hotkey sheet."); setHotkey(null); setHotkeyName(null) }
  }
  function useCurrentSheet() {
    setErr(null)
    setHotkey(receipts.map(r => ({ tote: r.receipt, barcodes: r.barcodes })))
    setHotkeyName("Tonight's sheet (as shown above)")
  }
  async function loadBc(file: File) {
    setErr(null)
    try { setBc(parseBcLinesExport(await readSheet(file))); setBcName(file.name) }
    catch (e: any) { setErr(e?.message ?? "Could not read the BC export."); setBc(null); setBcName(null) }
  }

  const result = useMemo(() => (hotkey && bc ? reconcileImport(hotkey, bc) : null), [hotkey, bc])
  const outputCsv = useMemo(() => (result ? buildHotkeyCsv(result.remainingTotes) : ""), [result])

  async function copyOut() {
    try { await navigator.clipboard.writeText(outputCsv); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch {}
  }
  function downloadOut() {
    const url = URL.createObjectURL(new Blob([outputCsv], { type: "text/csv" }))
    const a = document.createElement("a"); a.href = url; a.download = "BC_Import.csv"; a.click()
    URL.revokeObjectURL(url)
  }

  // `relative` contains the sr-only (position:absolute) file input — without a
  // positioned ancestor it resolves against the document and drags the window's
  // scroll height down with it.
  const drop = "relative flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-5 cursor-pointer hover:border-blue-500 transition-colors text-center"

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E]">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white text-left">
        <span className="text-xs">{open ? "▼" : "▶"}</span>
        🩹 Import Check — did the overnight run finish?
        <span className="font-normal text-xs text-gray-500 ml-1">compares the sheet against the BC export, gives a re-run sheet for what&apos;s missing</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* items-start: the left column carries a button under its drop zone, so a
              stretched right column would make the two dashed boxes different heights
              and their contents sit out of line. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            <div className="space-y-2">
              <label className={drop}>
                <span className="text-xl">⌨️</span>
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{hotkeyName ?? "Hotkey sheet that ran (the to-do list)"}</span>
                <span className="text-xs text-gray-500">CSV/XLSX with ToteNumber · Barcodes</span>
                <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) loadHotkey(f); e.target.value = "" }} />
              </label>
              <button
                onClick={useCurrentSheet}
                disabled={receipts.length === 0}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-500 disabled:opacity-40 transition-colors"
                title="Uses the sheet shown above. If you've run a Data Sync since the overnight run, the sheet has changed — upload the file you actually ran instead."
              >
                📄 Use tonight&apos;s sheet shown above
              </button>
            </div>
            <label className={drop}>
              <span className="text-xl">📋</span>
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{bcName ?? "BC export (Lines — what's in BC)"}</span>
              <span className="text-xs text-gray-500">XLSX with Internal Barcode · Errors</span>
              <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) loadBc(f); e.target.value = "" }} />
            </label>
          </div>

          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-center">
                  <div className="text-xl font-bold text-gray-900 dark:text-white">{result.totalHotkey}</div>
                  <div className="text-xs text-gray-500 mt-0.5">On the sheet</div>
                </div>
                <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 rounded-xl p-3 text-center">
                  <div className="text-xl font-bold text-green-600 dark:text-green-400">{result.totalDone}</div>
                  <div className="text-xs text-gray-500 mt-0.5">Made it into BC</div>
                </div>
                <div className={`border rounded-xl p-3 text-center ${result.totalRemaining > 0 ? "bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800/40" : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"}`}>
                  <div className={`text-xl font-bold ${result.totalRemaining > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"}`}>{result.totalRemaining}</div>
                  <div className="text-xs text-gray-500 mt-0.5">Still to do</div>
                </div>
                <div className={`border rounded-xl p-3 text-center ${result.errors.length > 0 ? "bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800/40" : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"}`}>
                  <div className={`text-xl font-bold ${result.errors.length > 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>{result.errors.length}</div>
                  <div className="text-xs text-gray-500 mt-0.5">In BC with errors</div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="rounded-xl border border-red-300 dark:border-red-700/50 bg-red-50 dark:bg-red-950/20 p-3">
                  <p className="text-xs uppercase tracking-wider text-red-700 dark:text-red-400 font-semibold mb-2">
                    ⚠ {result.errors.length} lot{result.errors.length === 1 ? "" : "s"} in BC with errors — fix in BC, then re-export and re-check
                  </p>
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <div key={`${e.barcode}-${i}`} className="text-xs text-red-800 dark:text-red-200 flex flex-wrap gap-x-2">
                        <span className="font-mono font-semibold">{e.barcode}</span>
                        {e.uniqueId && <span className="opacity-70">{e.uniqueId}</span>}
                        {e.tote && <span className="opacity-60">tote {e.tote}</span>}
                        <span>— {e.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.totalRemaining > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-1.5 gap-3 flex-wrap">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-300">
                      Re-run sheet — {result.totalRemaining} lot{result.totalRemaining === 1 ? "" : "s"} across {result.remainingTotes.length} tote{result.remainingTotes.length === 1 ? "" : "s"}
                    </span>
                    <div className="flex gap-2">
                      <button onClick={copyOut} className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${copied ? "bg-green-600 text-white" : "bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white"}`}>{copied ? "✓ Copied" : "Copy"}</button>
                      <button onClick={downloadOut} className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">⬇ Download CSV</button>
                    </div>
                  </div>
                  <textarea readOnly value={outputCsv} spellCheck={false} onFocus={e => e.target.select()}
                    className="w-full h-36 font-mono text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-blue-500 resize-y whitespace-pre overflow-x-auto" />
                  <p className="text-xs text-gray-500 mt-1.5">Same sheet format, finished receipts removed, counts recomputed — feed it back to the macro as BC_Import.csv.</p>
                </div>
              ) : (
                <p className="text-sm text-green-600 dark:text-green-400">✓ Every lot on the sheet is in BC — nothing left to re-run.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── The morning after: BC Match across every sale ───────────────────────────
// The overnight macro puts all the Hub sales' lots into ONE BC sale, so the
// morning's BC Lines export spans several Hub sales. Same rules as the 🔗 BC
// Match modal in Auction Manager (barcode match, receipt must agree, BC's
// UniqueID imported), applied across every non-complete sale server-side —
// matchBcLinesAcrossAuctions loops the same bulkAssignUniqueIds choke-point.
function BcMatchAllPanel({ onImported }: { onImported: (msg: string) => void }) {
  const [open, setOpen]         = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed]     = useState<BcLinesRow[] | null>(null)
  const [res, setRes]           = useState<Awaited<ReturnType<typeof matchBcLinesAcrossAuctions>> | null>(null)
  const [err, setErr]           = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)
  const [done, setDone]         = useState<string | null>(null)
  const [filter, setFilter]     = useState<"match" | "mismatch" | "not_found" | "pending">("match")

  async function handleFile(f: File) {
    setErr(null); setRes(null); setDone(null); setFilter("match")
    try {
      const rows = parseBcLinesForMatch(await readSheet(f))
      setParsed(rows); setFileName(f.name)
      setBusy(true)
      const r = await matchBcLinesAcrossAuctions(rows, false)
      if (!r.ok) { setErr(r.error ?? "Couldn't match the export"); setRes(null) }
      else setRes(r)
    } catch (e: any) {
      setErr(e?.message ?? "Could not read the file"); setParsed(null); setFileName(null)
    } finally { setBusy(false) }
  }

  async function doImport() {
    if (!parsed || !res || res.counts.match === 0) return
    setBusy(true)
    try {
      const r = await matchBcLinesAcrossAuctions(parsed, true)
      if (!r.ok) { setErr(r.error ?? "Couldn't import"); return }
      const msg =
        `Imported ${r.updated} Unique ID${r.updated === 1 ? "" : "s"} from BC` +
        (r.skipped ? ` · ${r.skipped} skipped` : "") +
        (r.lockedSales ? ` · ${r.lockedSales} sale${r.lockedSales === 1 ? "" : "s"} skipped (BC-locked — admin only)` : "") +
        (r.counts.mismatch ? ` · ${r.counts.mismatch} left alone (receipt disagrees)` : "")
      setDone(msg)
      setRes(r)
      onImported(msg)
    } finally { setBusy(false) }
  }

  const filterMeta: { key: typeof filter; label: string; count: number; tone: string }[] = res ? [
    { key: "match",     label: "Ready to import",   count: res.counts.match,              tone: "text-green-700 dark:text-green-400" },
    { key: "mismatch",  label: "Receipt disagrees", count: res.counts.mismatch,           tone: "text-red-700 dark:text-red-400" },
    { key: "not_found", label: "Not in the Hub",    count: res.counts.notFound,           tone: "text-gray-600 dark:text-gray-400" },
    { key: "pending",   label: "Didn't come back",  count: res.counts.pendingNotInExport, tone: "text-amber-700 dark:text-amber-400" },
  ] : []

  const shownRows: EodMatchRow[] = res && filter !== "pending" ? res.rows.filter(r => r.status === filter) : []

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E]">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white text-left">
        <span className="text-xs">{open ? "▼" : "▶"}</span>
        🔗 BC Match — link BC&apos;s Unique IDs back, all sales at once
        <span className="font-normal text-xs text-gray-500 ml-1">upload the BC Lines export; same rules as the per-sale BC Match button</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <label className="relative flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-5 cursor-pointer hover:border-blue-500 transition-colors text-center">
            <span className="text-xl">📋</span>
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{fileName ?? "BC Lines export"}</span>
            <span className="text-xs text-gray-500">XLSX/CSV with Internal Barcode · Receipt No. · UniqueID</span>
            <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = "" }} />
          </label>

          {busy && !res && <p className="text-sm text-gray-500">Matching against every open sale…</p>}
          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
          {done && (
            <p className="px-4 py-3 rounded-xl border text-sm bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-300">
              ✓ {done}
            </p>
          )}

          {res && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {filterMeta.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`rounded-xl border p-3 text-center transition-colors ${filter === f.key
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10"
                      : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:border-gray-400 dark:hover:border-gray-500"}`}
                  >
                    <div className={`text-xl font-bold ${f.tone}`}>{f.count.toLocaleString()}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{f.label}</div>
                  </button>
                ))}
              </div>

              <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                {filter !== "pending" && shownRows.map((r, i) => (
                  <div key={`${r.barcode}-${i}`} className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-black/25 px-3 py-1.5">
                    <span className="font-mono font-bold text-gray-900 dark:text-white">{r.barcode}</span>
                    {r.status === "match" && (<>
                      <span className="text-gray-500">receipt {r.bcReceipt} ✓</span>
                      <span className="text-green-700 dark:text-green-400 font-mono">gets {r.bcUniqueId || "—"}</span>
                    </>)}
                    {r.status === "mismatch" && (<>
                      <span className="text-red-700 dark:text-red-400">lot says {r.ourReceipt || "no receipt"} · BC says {r.bcReceipt || "—"}</span>
                      <span className="text-gray-500">not imported until they agree</span>
                    </>)}
                    {r.status === "not_found" && <span className="text-gray-500">no Hub lot carries this barcode in an open sale</span>}
                    {r.sale && <span className="ml-auto text-[11px] text-gray-500">{r.sale}</span>}
                  </div>
                ))}
                {filter !== "pending" && shownRows.length === 0 && (
                  <p className="text-xs text-gray-500">Nothing in this group.</p>
                )}
                {/* A huge export can still overflow the display cap for MATCHES (mismatches
                    always survive it) — say so rather than letting a short list read as all. */}
                {filter !== "pending" && shownRows.length > 0 &&
                  (filterMeta.find(f => f.key === filter)?.count ?? 0) > shownRows.length && (
                  <p className="text-xs text-gray-500">
                    Showing the first {shownRows.length.toLocaleString()} of {(filterMeta.find(f => f.key === filter)?.count ?? 0).toLocaleString()} — the counts above are the full picture.
                  </p>
                )}
                {filter === "pending" && res.pendingNotInExport.map((p, i) => (
                  <div key={`${p.barcode}-${i}`} className="text-xs flex flex-wrap items-center gap-x-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-black/25 px-3 py-1.5">
                    <span className="font-mono font-bold text-gray-900 dark:text-white">{p.barcode}</span>
                    <span className="text-gray-500">waiting for a Unique ID, but this export doesn&apos;t cover it</span>
                    {p.sale && <span className="ml-auto text-[11px] text-gray-500">{p.sale}</span>}
                  </div>
                ))}
                {filter === "pending" && res.counts.pendingNotInExport > res.pendingNotInExport.length && (
                  <p className="text-xs text-gray-500">…and {res.counts.pendingNotInExport - res.pendingNotInExport.length} more</p>
                )}
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={doImport}
                  disabled={busy || res.counts.match === 0 || !!done}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  {busy ? "Importing…" : `✓ Import ${res.counts.match.toLocaleString()} Unique ID${res.counts.match === 1 ? "" : "s"}`}
                </button>
                <span className="text-xs text-gray-500 max-w-md">
                  Only the green rows import — a lot whose receipt disagrees with BC is never linked automatically.
                  Fix those (checks above), then re-upload.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
