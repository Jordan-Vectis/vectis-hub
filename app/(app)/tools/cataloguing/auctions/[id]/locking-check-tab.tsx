"use client"

// The last screen before a sale goes to BC and onto the website.
//
// ⚠ It reuses the existing checkers rather than growing its own copies: lib/tote-check.ts for
// the BC tote/vendor/receipt comparison (the same code behind the Tote Check tab) and
// lib/condition.ts for "is the condition actually in the description". A second implementation
// of either would drift and the two screens would start disagreeing about the same sale.
//
// Two tiers, deliberately:
//   BLOCKING     — would go to BC or the website wrong. Fix before locking.
//   WORTH A LOOK — probably fine, but nobody has confirmed it. Never blocks.
// Everything blocking is something a buyer or BC would actually see.

import { useEffect, useMemo, useState } from "react"
import { buildToteMap, checkLot as checkToteLot, type BcTote, type ToteCheckIssue } from "@/lib/tote-check"
import { checkConditionInDescription } from "@/lib/condition"

interface LotItem {
  id: string
  barcode: string | null
  receiptUniqueId: string | null
  title: string
  description: string
  condition: string | null
  estimateLow: number | null
  estimateHigh: number | null
  imageUrls: string[]
  aiExcluded: boolean
  vendor: string | null
  tote: string | null
  receipt: string | null
  category: string | null
  aiFlagNote: string | null
  reviewFlag: string | null
}

type Severity = "blocking" | "look"
interface Issue { key: string; label: string; severity: Severity }

/** RULES.md: a lot title is the first 83 characters of the description, truncated with "…".
 *  No sentence splitting — a full stop does not end the title. */
const TITLE_MAX = 83
function titleFromDescription(description: string): string {
  const d = (description ?? "").trim()
  if (!d) return "Untitled"
  return d.length <= TITLE_MAX ? d : `${d.slice(0, TITLE_MAX)}…`
}

const TOTE_LABEL: Record<ToteCheckIssue, string> = {
  no_tote:            "No tote on the lot",
  tote_unknown:       "Tote not found in BC",
  receipt_mismatch:   "Receipt ≠ BC",
  receipt_missing:    "No receipt",
  vendor_mismatch:    "Vendor ≠ BC",
  vendor_missing:     "No vendor",
  unique_id_mismatch: "Unique ID ≠ receipt",
}

function checkOne(lot: LotItem, toteMap: Map<string, BcTote> | null): Issue[] {
  const out: Issue[] = []
  const desc = (lot.description ?? "").trim()

  // ── Blocking ──────────────────────────────────────────────────────────────
  if (!desc) out.push({ key: "description", label: "No description", severity: "blocking" })
  if (lot.imageUrls.length === 0) out.push({ key: "photo", label: "No photos", severity: "blocking" })
  if (!lot.barcode?.trim()) out.push({ key: "barcode", label: "No barcode", severity: "blocking" })

  // ⚠ An AI-excluded lot is hand-written, and its condition is typed into the description
  // rather than graded on the lot — so it is exempt (Jordan's rule).
  if (!lot.aiExcluded && !(lot.condition ?? "").trim())
    out.push({ key: "condition", label: "No condition", severity: "blocking" })

  const lo = lot.estimateLow, hi = lot.estimateHigh
  if (lo == null || hi == null) out.push({ key: "estimate", label: "Estimate missing", severity: "blocking" })
  else if (lo > hi)            out.push({ key: "estimate", label: `Estimate backwards (£${lo}–£${hi})`, severity: "blocking" })
  else if (lo <= 0 || hi <= 0) out.push({ key: "estimate", label: "Estimate is zero", severity: "blocking" })

  // The title must match the description it came from — a description edited after the title
  // was generated leaves the old title on the lot, and that is what goes to BC and the site.
  if (desc) {
    const expected = titleFromDescription(desc)
    const actual = (lot.title ?? "").trim()
    if (!actual || actual === "Untitled") out.push({ key: "title", label: "No title", severity: "blocking" })
    else if (actual !== expected)         out.push({ key: "title", label: "Title doesn't match the description", severity: "blocking" })
  }

  if (toteMap) {
    for (const issue of checkToteLot(lot, toteMap).issues) {
      // "No tote" and "no receipt/vendor" are blocking in their own right; the rest are
      // disagreements with BC, which are exactly what this screen is for.
      out.push({ key: `tote_${issue}`, label: TOTE_LABEL[issue] ?? issue, severity: "blocking" })
    }
  }

  // ── Worth a look ──────────────────────────────────────────────────────────
  if (lot.reviewFlag?.trim())  out.push({ key: "reviewFlag", label: "Flagged in Review", severity: "look" })
  if (lot.aiFlagNote?.trim())  out.push({ key: "aiFlag",     label: "AI flagged a possible mistake", severity: "look" })
  if (!lot.category?.trim())   out.push({ key: "category",   label: "No category", severity: "look" })
  if ((lot.title ?? "").length > TITLE_MAX)
    out.push({ key: "titleLong", label: `Title over ${TITLE_MAX} characters`, severity: "look" })
  if (desc.includes("**") || /^\s*FLAG:/mi.test(desc))
    out.push({ key: "artefact", label: "Leftover AI text in the description", severity: "look" })

  // Reuses the Description Copier's checker — a graded condition that never made it into the
  // description is not visible to a buyer.
  if (desc && !lot.aiExcluded) {
    const c = checkConditionInDescription(desc, lot.condition ?? "")
    if (c.state === "missing") out.push({ key: "condDesc", label: "Condition not in the description", severity: "look" })
  }

  return out
}

export default function LockingCheckTab({ lots, auctionId, onOpenLot }: {
  lots: LotItem[]
  auctionId: string
  onOpenLot: (id: string) => void
}) {
  const [filter, setFilter] = useState<"blocking" | "look" | "all">("blocking")
  const [toteMap, setToteMap] = useState<Map<string, BcTote> | null>(null)
  const [bcState, setBcState] = useState<"loading" | "ready" | "failed">("loading")

  // The BC side of the check. ⚠ If it cannot be loaded the tote/vendor checks are SKIPPED and
  // said so plainly — silently passing every lot would make this screen claim a sale is ready
  // when the one thing it could not check is the thing most likely to be wrong.
  useEffect(() => {
    let live = true
    fetch(`/api/catalogue/tote-check?auctionId=${encodeURIComponent(auctionId)}`)
      .then(r => r.json())
      .then(j => {
        if (!live) return
        if (Array.isArray(j?.totes)) { setToteMap(buildToteMap(j.totes)); setBcState("ready") }
        else setBcState("failed")
      })
      .catch(() => { if (live) setBcState("failed") })
    return () => { live = false }
  }, [auctionId])

  const results = useMemo(
    () => lots.map(lot => {
      const issues = checkOne(lot, toteMap)
      return {
        lot, issues,
        blocking: issues.filter(i => i.severity === "blocking"),
        look:     issues.filter(i => i.severity === "look"),
      }
    }),
    [lots, toteMap],
  )

  const blocking = results.filter(r => r.blocking.length > 0)
  const lookOnly = results.filter(r => r.blocking.length === 0 && r.look.length > 0)
  const ready    = results.filter(r => r.issues.length === 0)

  const shown = filter === "blocking" ? blocking : filter === "look" ? lookOnly : results

  // Which problems are most common — tells you what to fix in bulk rather than lot by lot.
  const tally = useMemo(() => {
    const m = new Map<string, { label: string; severity: Severity; n: number }>()
    for (const r of results) for (const i of r.issues) {
      const e = m.get(i.key) ?? { label: i.label.replace(/\s*\(£.*\)$/, ""), severity: i.severity, n: 0 }
      e.n++; m.set(i.key, e)
    }
    return [...m.values()].sort((a, b) => b.n - a.n)
  }, [results])

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Locking Check</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The last look before this sale goes to BC and onto the website. <strong>Blocking</strong> means it would
          go across wrong; <strong>worth a look</strong> means nobody has confirmed it.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat n={lots.length} label="Total lots" tone="plain" />
        <Stat n={ready.length} label="Ready" tone="green" />
        <Stat n={blocking.length} label="Blocking" tone={blocking.length > 0 ? "red" : "green"} />
        <Stat n={lookOnly.length} label="Worth a look" tone={lookOnly.length > 0 ? "amber" : "green"} />
      </div>

      {bcState === "loading" && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading the BC tote data…</p>
      )}
      {bcState === "failed" && (
        <div className="px-4 py-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-sm text-amber-800 dark:text-amber-300">
          ⚠ The BC tote data could not be loaded, so <strong>tote, vendor and receipt have NOT been checked</strong> on
          any lot. Everything else below is still accurate. Run a Data Sync and reopen this tab.
        </div>
      )}

      {blocking.length === 0 && bcState === "ready" && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-950/20 border border-green-800/40 rounded-xl text-green-400 text-sm">
          ✅ Nothing is blocking the lock{lookOnly.length > 0 ? ` — ${lookOnly.length} lot${lookOnly.length === 1 ? "" : "s"} worth a glance below.` : "."}
        </div>
      )}

      {tally.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">What is wrong, most common first</p>
          <div className="flex flex-wrap gap-2">
            {tally.map(t => (
              <span key={t.label} className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                t.severity === "blocking"
                  ? "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300"
                  : "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
                {t.label} · {t.n}
              </span>
            ))}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <>
          <div className="flex gap-2 flex-wrap">
            <FilterBtn active={filter === "blocking"} onClick={() => setFilter("blocking")} tone="red">Blocking ({blocking.length})</FilterBtn>
            <FilterBtn active={filter === "look"}     onClick={() => setFilter("look")}     tone="amber">Worth a look ({lookOnly.length})</FilterBtn>
            <FilterBtn active={filter === "all"}      onClick={() => setFilter("all")}      tone="grey">All lots ({results.length})</FilterBtn>
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Nothing in this list.</p>
          ) : (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left px-4 py-2.5 text-gray-500 dark:text-gray-400 font-medium">Lot</th>
                    <th className="text-left px-4 py-2.5 text-gray-500 dark:text-gray-400 font-medium">Title</th>
                    <th className="text-left px-4 py-2.5 text-gray-500 dark:text-gray-400 font-medium">Issues</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ lot, issues }, i) => (
                    <tr key={lot.id}
                      className={`border-b border-gray-100 dark:border-gray-800 last:border-0 ${i % 2 === 0 ? "" : "bg-gray-50/50 dark:bg-white/[0.02]"}`}>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {lot.barcode || lot.receiptUniqueId || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 max-w-xs truncate">
                        {lot.title || <span className="text-gray-400 italic">No title</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {issues.length === 0 ? (
                          <span className="text-green-400 text-xs">✓ Ready</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {issues.map(f => (
                              <span key={f.key}
                                className={`px-1.5 py-0.5 rounded text-xs border ${
                                  f.severity === "blocking"
                                    ? "bg-red-950/40 border-red-800/40 text-red-400"
                                    : "bg-amber-950/30 border-amber-800/40 text-amber-400"}`}>
                                {f.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {issues.length > 0 && (
                          <button onClick={() => onOpenLot(lot.id)}
                            className="text-xs text-[#2AB4A6] hover:text-[#24a090] transition-colors whitespace-nowrap">
                            Fix →
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ n, label, tone }: { n: number; label: string; tone: "plain" | "green" | "red" | "amber" }) {
  const cls = tone === "green" ? "bg-green-950/20 border-green-800/40 text-green-400"
            : tone === "red"   ? "bg-red-950/20 border-red-800/40 text-red-400"
            : tone === "amber" ? "bg-amber-950/20 border-amber-800/40 text-amber-400"
            : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white"
  return (
    <div className={`border rounded-xl p-4 text-center ${cls}`}>
      <div className="text-2xl font-bold">{n}</div>
      <div className="text-xs mt-1 opacity-80">{label}</div>
    </div>
  )
}

function FilterBtn({ active, onClick, tone, children }: { active: boolean; onClick: () => void; tone: "red" | "amber" | "grey"; children: React.ReactNode }) {
  const on = tone === "red" ? "bg-red-700 text-white" : tone === "amber" ? "bg-amber-600 text-white" : "bg-gray-600 text-white"
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active ? on : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"}`}>
      {children}
    </button>
  )
}
