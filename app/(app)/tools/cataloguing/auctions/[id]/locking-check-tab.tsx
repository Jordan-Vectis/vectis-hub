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
// ⚠ We do NOT re-run the tote check here. /api/catalogue/tote-check already runs it
// server-side with lib/tote-check.ts and returns the lots that failed — this screen just
// reads that answer. (It first tried to rebuild a tote map from a `totes` field the route
// has never returned, so the check silently reported "BC data unavailable" on every sale.)
import type { ToteCheckIssue } from "@/lib/tote-check"
import { checkConditionInDescription, CONDITION_GRADES } from "@/lib/condition"
import { bulkSetLotConditions } from "@/lib/actions/catalogue"
// ⚠ The SAME rule the Generate Titles button uses. Writing a second copy here from the
// description in RULES.md got both the newline handling and the truncation wrong, and
// reported 634 of 635 correct titles as mismatched.
import { titleFromDescription, TITLE_MAX } from "@/lib/lot-title"

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



const TOTE_LABEL: Record<ToteCheckIssue, string> = {
  no_tote:            "No tote on the lot",
  tote_unknown:       "Tote not found in BC",
  receipt_mismatch:   "Receipt ≠ BC",
  tote_receipt_mismatch: "Tote is on another receipt",
  receipt_missing:    "No receipt",
  vendor_mismatch:    "Vendor ≠ BC",
  vendor_missing:     "No vendor",
  unique_id_mismatch: "Unique ID ≠ receipt",
}

function checkOne(lot: LotItem, toteIssues: Map<string, ToteCheckIssue[]> | null): Issue[] {
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

  if (toteIssues) {
    for (const issue of toteIssues.get(lot.id) ?? []) {
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
  // ⚠ "*** collection only ***" is the cataloguers' OWN notation, not markdown — and it
  // contains "**", so a bare includes("**") flagged every one of those lots as leftover AI
  // text. Strip the house markers first; anything still holding a "**" pair is genuine
  // markdown the AI left behind (which nothing renders — see the bears clean-up).
  const withoutHouseMarkers = desc.replace(/\*\*\*[^*]*\*\*\*/g, " ")
  if (withoutHouseMarkers.includes("**") || /^\s*FLAG:/mi.test(desc))
    out.push({ key: "artefact", label: "Leftover AI text in the description", severity: "look" })

  // Reuses the Description Copier's checker — a graded condition that never made it into the
  // description is not visible to a buyer.
  if (desc && !lot.aiExcluded) {
    const c = checkConditionInDescription(desc, lot.condition ?? "")
    if (c.state === "missing") out.push({ key: "condDesc", label: "Condition not in the description", severity: "look" })
  }

  return out
}


/**
 * Every criterion this screen checks, in one list — so the checklist counts and the per-lot
 * issues can never disagree: a lot passes a criterion when checkOne emitted no issue with that
 * key. `scope` narrows the denominator (an AI-excluded lot is not counted for "has a condition",
 * so 496/496 reads honestly rather than 496/635).
 */
const CRITERIA: {
  key: string; label: string; severity: Severity
  scope?: (l: LotItem) => boolean
  needsBc?: boolean
}[] = [
  { key: "description", label: "Has a description",                        severity: "blocking" },
  { key: "condition",   label: "Has a condition — AI-excluded lots exempt", severity: "blocking", scope: l => !l.aiExcluded },
  { key: "tote",        label: "Tote, vendor and receipt match BC",         severity: "blocking", needsBc: true },
  { key: "title",       label: "Title matches the current description",     severity: "blocking", scope: l => !!(l.description ?? "").trim() },
  { key: "estimate",    label: "Estimates make sense",                      severity: "blocking" },
  { key: "photo",       label: "Has at least one photo",                    severity: "blocking" },
  { key: "barcode",     label: "Has a barcode",                             severity: "blocking" },
  { key: "category",    label: "Has a category",                            severity: "look" },
  { key: "reviewFlag",  label: "No unresolved Review flag",                 severity: "look" },
  { key: "aiFlag",      label: "No unresolved AI flag",                     severity: "look" },
  { key: "titleLong",   label: `Title within ${TITLE_MAX} characters`,      severity: "look" },
  { key: "artefact",    label: "No leftover AI text in the description",    severity: "look" },
  { key: "condDesc",    label: "Condition appears in the description",      severity: "look",
    scope: l => !l.aiExcluded && !!(l.description ?? "").trim() },
]

/** Tote issues are emitted as tote_<issue>, so that criterion matches on the prefix. */
const hasIssueFor = (issues: Issue[], key: string) =>
  key === "tote" ? issues.some(i => i.key.startsWith("tote_")) : issues.some(i => i.key === key)

export default function LockingCheckTab({ lots, auctionId, onOpenLot, onRefresh }: {
  lots: LotItem[]
  auctionId: string
  onOpenLot: (id: string) => void
  onRefresh: () => void
}) {
  const [filter, setFilter] = useState<"blocking" | "look" | "all">("blocking")
  const [only, setOnly] = useState<string | null>(null)   // drill into one criterion

  // ── AI condition suggestions ──────────────────────────────────────────────
  // ⚠ SUGGESTIONS. Nothing here reaches a lot until the button that writes them is pressed,
  // and each row can be edited or cleared first. RULES.md keeps condition a human judgement;
  // Jordan reversed that only as far as "the AI may propose one for a person to accept".
  const [suggesting, setSuggesting] = useState(false)
  const [sugProgress, setSugProgress] = useState({ done: 0, total: 0 })
  const [suggestions, setSuggestions] = useState<Record<string, { grade: string; reason: string; confidence: string }>>({})
  const [savingConds, setSavingConds] = useState(false)
  const [condMsg, setCondMsg] = useState<string | null>(null)
  const [toteIssues, setToteIssues] = useState<Map<string, ToteCheckIssue[]> | null>(null)
  const [lastSync, setLastSync] = useState<string | null>(null)
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
        // `rows` is the lots WITH tote issues — an empty array means every lot is clean, which
        // is a successful check, not a failed one.
        if (j && !j.error && Array.isArray(j.rows)) {
          setToteIssues(new Map(j.rows.map((r: { id: string; issues: ToteCheckIssue[] }) => [r.id, r.issues])))
          setLastSync(typeof j.lastSync === "string" ? j.lastSync : null)
          setBcState("ready")
        } else setBcState("failed")
      })
      .catch(() => { if (live) setBcState("failed") })
    return () => { live = false }
  }, [auctionId])

  const results = useMemo(
    () => lots.map(lot => {
      const issues = checkOne(lot, toteIssues)
      return {
        lot, issues,
        blocking: issues.filter(i => i.severity === "blocking"),
        look:     issues.filter(i => i.severity === "look"),
      }
    }),
    [lots, toteIssues],
  )

  const blocking = results.filter(r => r.blocking.length > 0)
  const lookOnly = results.filter(r => r.blocking.length === 0 && r.look.length > 0)
  const ready    = results.filter(r => r.issues.length === 0)

  const base  = filter === "blocking" ? blocking : filter === "look" ? lookOnly : results
  const shown = only ? results.filter(r => hasIssueFor(r.issues, only)) : base

  // The checklist: one row per criterion, passed / in-scope.
  const checklist = useMemo(
    () => CRITERIA.map(c => {
      const inScope = results.filter(r => !c.scope || c.scope(r.lot))
      const failed  = inScope.filter(r => hasIssueFor(r.issues, c.key))
      return { ...c, total: inScope.length, failed: failed.length, passed: inScope.length - failed.length }
    }),
    [results],
  )

  const needsCondition = useMemo(
    () => lots.filter(l => !l.aiExcluded && !(l.condition ?? "").trim()),
    [lots],
  )

  async function suggestConditions() {
    if (suggesting) return
    setSuggesting(true); setCondMsg(null)
    setSugProgress({ done: 0, total: needsCondition.length })
    try {
      for (const [i, lot] of needsCondition.entries()) {
        // Photos are the evidence — the route refuses to grade without them.
        const images = (await Promise.all(
          lot.imageUrls.slice(0, 4).map(async key => {
            try {
              const r = await fetch(`/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`)
              if (!r.ok) return null
              const buf = await r.arrayBuffer()
              return { data: btoa(String.fromCharCode(...new Uint8Array(buf))), mimeType: r.headers.get("content-type") || "image/jpeg" }
            } catch { return null }
          }),
        )).filter(Boolean) as { data: string; mimeType: string }[]

        try {
          const res = await fetch("/api/auction-ai/suggest-condition", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label: lot.barcode ?? lot.receiptUniqueId ?? "", description: lot.description, images }),
          })
          const j = await res.json()
          if (j?.grade) setSuggestions(prev => ({ ...prev, [lot.id]: { grade: j.grade, reason: j.reason ?? "", confidence: j.confidence ?? "low" } }))
        } catch { /* one lot failing must not stop the run */ }
        setSugProgress({ done: i + 1, total: needsCondition.length })
      }
    } finally {
      setSuggesting(false)
    }
  }

  async function applySuggestions() {
    const updates = Object.entries(suggestions)
      .filter(([, v]) => v.grade.trim())
      .map(([id, v]) => ({ id, condition: v.grade.trim() }))
    if (updates.length === 0) return
    if (!confirm(`Write ${updates.length} condition${updates.length === 1 ? "" : "s"} onto the lots?

Each one is the AI's suggestion — only accept what you have read.`)) return
    setSavingConds(true); setCondMsg(null)
    try {
      const res = await bulkSetLotConditions(auctionId, updates)
      setCondMsg(`✓ Wrote ${res.updated} condition${res.updated === 1 ? "" : "s"}.`)
      setSuggestions({})
      onRefresh()
    } catch (e: any) {
      setCondMsg(e?.message ?? "Could not save the conditions")
    } finally { setSavingConds(false) }
  }

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
        <p className="text-sm text-gray-500 dark:text-gray-400">Checking tote, vendor and receipt against BC…</p>
      )}
      {/* A stale sync makes a pile of "tote not found in BC" read as 600 mistakes rather than
          as data that has not been refreshed — say when it was last pulled. */}
      {bcState === "ready" && lastSync && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          BC tote data last synced {new Date(lastSync).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.
        </p>
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

      {/* Every criterion, passed / in scope. Click one to see just the lots failing it. */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 dark:border-gray-800">
          <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Every check, and how many lots pass it</p>
          {only && (
            <button onClick={() => setOnly(null)} className="ml-auto text-xs font-semibold text-[#2AB4A6] hover:underline">
              Clear ({CRITERIA.find(c => c.key === only)?.label})
            </button>
          )}
        </div>
        <ul>
          {checklist.map(c => {
            const skipped = c.needsBc && bcState !== "ready"
            const ok = !skipped && c.failed === 0
            return (
              <li key={c.key}>
                <button
                  onClick={() => { if (c.failed > 0 && !skipped) setOnly(only === c.key ? null : c.key) }}
                  disabled={skipped || c.failed === 0}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left border-t border-gray-100 dark:border-gray-800/60 first:border-t-0 ${
                    c.failed > 0 && !skipped ? "hover:bg-gray-50 dark:hover:bg-white/[0.03] cursor-pointer" : "cursor-default"} ${
                    only === c.key ? "bg-gray-50 dark:bg-white/[0.05]" : ""}`}>
                  <span className={`w-5 text-center ${skipped ? "text-gray-500" : ok ? "text-green-500" : c.severity === "blocking" ? "text-red-500" : "text-amber-500"}`}>
                    {skipped ? "–" : ok ? "✓" : c.severity === "blocking" ? "✗" : "⚠"}
                  </span>
                  <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">
                    {c.label}
                    {c.severity === "look" && <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">worth a look</span>}
                  </span>
                  {skipped ? (
                    <span className="text-xs text-gray-500">not checked — BC data unavailable</span>
                  ) : (
                    <span className={`text-sm font-semibold tabular-nums ${ok ? "text-green-500" : c.severity === "blocking" ? "text-red-400" : "text-amber-400"}`}>
                      {c.passed} / {c.total}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Conditions the AI can propose. ⚠ Below the checklist and nothing is written until the
          accept button is pressed — the grade a lot ends up with is always a person's call. */}
      {needsCondition.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {needsCondition.length} lot{needsCondition.length === 1 ? "" : "s"} have no condition
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                The AI can suggest a grade from each lot&apos;s photographs, using our grading system. It reads the photos,
                not the description, and says how sure it is. <strong>Nothing is written to a lot until you accept it</strong> —
                and it cannot see hidden damage, missing parts or the inside of a box, so read them.
              </p>
            </div>
            <button onClick={suggestConditions} disabled={suggesting}
              className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold disabled:opacity-50">
              {suggesting ? `Grading… ${sugProgress.done}/${sugProgress.total}` : "✨ Suggest conditions"}
            </button>
          </div>

          {condMsg && <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{condMsg}</p>}

          {Object.keys(suggestions).length > 0 && (
            <>
              <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
                <table className="w-full text-sm">
                  <tbody>
                    {needsCondition.filter(l => suggestions[l.id]).map(lot => {
                      const sg = suggestions[lot.id]
                      return (
                        <tr key={lot.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                          <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{lot.barcode || lot.receiptUniqueId}</td>
                          <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-xs truncate">{lot.title}</td>
                          <td className="px-3 py-2">
                            <select value={sg.grade}
                              onChange={e => setSuggestions(prev => ({ ...prev, [lot.id]: { ...prev[lot.id], grade: e.target.value } }))}
                              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#2C2C2E] px-2 py-1.5 text-sm text-gray-900 dark:text-white">
                              <option value="">— leave blank —</option>
                              {CONDITION_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                              {sg.grade.includes(" to ") && <option value={sg.grade}>{sg.grade}</option>}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {/* Low confidence is the AI telling you it could not see enough — the
                                one it is most likely to have got wrong. */}
                            <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${
                              sg.confidence === "high" ? "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300"
                              : sg.confidence === "medium" ? "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300"}`}>
                              {sg.confidence}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{sg.reason}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={applySuggestions} disabled={savingConds}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-50">
                  {savingConds ? "Saving…" : `Accept ${Object.values(suggestions).filter(v => v.grade.trim()).length} and write them to the lots`}
                </button>
                <button onClick={() => setSuggestions({})} disabled={savingConds}
                  className="px-3 py-2.5 text-sm font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
                  Discard
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400">Set any row to &quot;leave blank&quot; to skip it.</span>
              </div>
            </>
          )}
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
