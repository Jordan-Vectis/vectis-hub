"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { saveAiFlagSnapshot, deleteAiFlagBatch } from "@/lib/actions/saved-ai-flags"
import { analyseKeyPoints, HighlightedDescription, kpColour } from "@/lib/kp-analysis"
import LotPhotoViewer from "@/components/lot-photo-viewer"

// Admin → Saved Flagged Lots.
//
// ⚠ The lot cards below deliberately MIRROR the Review tab: same photo-left/details-under, same
// orange AI-flag banner, same key points and description blocks. Jack: "it has to save with the
// same UI as the review tool."
//
// ⚠ The ticks, the colour dots and the highlighted description ARE the Review tab's own —
// analyseKeyPoints, HighlightedDescription and kpColour, imported rather than reimplemented.
// That is safe because analyseKeyPoints is PURE: the description, the key points and the sale's
// matching mode are all snapshotted onto the row, so it reproduces exactly the verdict that was
// on screen the day the save was taken, not today's.
//
// ⚠ What the cards do NOT have is the Review tab's buttons — no auto-fix, no edit description,
// no ignore. This is a frozen record. A button here would either do nothing or edit a live lot
// from a screen showing month-old text, and both are worse than no button.

export type SavedBatch = {
  batchId: string
  label: string
  savedAt: string
  savedByName: string
  sales: string[]
  lots: number
  aiFlags: number
}

export type SavedFlagRow = {
  id: string
  lotId: string
  auctionCode: string
  auctionName: string
  barcode: string | null
  receiptUniqueId: string | null
  title: string
  keyPoints: string | null
  description: string | null
  condition: string | null
  category: string | null
  subCategory: string | null
  brand: string | null
  estimateLow: number | null
  estimateHigh: number | null
  aiEstimateLow: number | null
  aiEstimateHigh: number | null
  imageUrls: string[]
  cataloguedBy: string | null
  aiFlagNote: string | null
  reviewFlag: string | null
  reviewFlaggedBy: string | null
  reviewFlaggedAt: string | null
  kpFixNote: string | null
  kpFixedBy: string | null
  kpFixedAt: string | null
  kpMode: "strict" | "relaxed"
  savedAt: string
  savedByName: string
}

// The Review tab's own photo proxy, so a saved lot's pictures load exactly as they do there.
function proxyUrl(key: string) {
  return `/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`
}

function fmtEstimate(low: number | null, high: number | null): string | null {
  if (low == null && high == null) return null
  if (low != null && high != null) return `£${low.toLocaleString("en-GB")}–£${high.toLocaleString("en-GB")}`
  return `£${(low ?? high)!.toLocaleString("en-GB")}`
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
})

export default function SavedFlagsClient({
  batches, auctions, openBatch, rows,
}: {
  batches: SavedBatch[]
  auctions: { id: string; label: string }[]
  openBatch: string | null
  rows: SavedFlagRow[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [scope, setScope] = useState("ALL")
  const [label, setLabel] = useState("")
  const [viewer, setViewer] = useState<{ lot: SavedFlagRow; index: number } | null>(null)
  const [aiOnly, setAiOnly] = useState(false)

  function save() {
    setMsg(null)
    start(async () => {
      const res = await saveAiFlagSnapshot(scope, label)
      if (res.ok) {
        setMsg({ ok: true, text: `Saved ${res.saved} flagged lot${res.saved === 1 ? "" : "s"}. They are now safe to overwrite.` })
        setLabel("")
        router.refresh()
      } else {
        setMsg({ ok: false, text: res.error })
      }
    })
  }

  function remove(batchId: string) {
    if (!confirm("Delete this archive permanently? The flags in it cannot be recovered afterwards.")) return
    setMsg(null)
    start(async () => {
      const res = await deleteAiFlagBatch(batchId)
      setMsg(res.ok ? { ok: true, text: "Archive deleted" } : { ok: false, text: res.error ?? "Failed" })
      if (res.ok) router.push("/admin/saved-flagged-lots")
      router.refresh()
    })
  }

  const shown = aiOnly ? rows.filter(r => r.aiFlagNote) : rows
  const batch = batches.find(b => b.batchId === openBatch)

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <Link href="/admin" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">← Admin</Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🗂️ Saved Flagged Lots</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
        A frozen copy of the Review tab&apos;s flagged lots. Re-running the AI overwrites the flag on a
        lot and keeps no record of what it said, so take a save here first — then the old flags stay
        readable, photos and all, however many times the AI runs afterwards.
      </p>

      {msg && (
        <div className={`mt-5 rounded-xl border-2 px-4 py-3 text-sm font-semibold ${
          msg.ok
            ? "border-green-500/50 bg-green-50 dark:bg-green-500/10 text-green-800 dark:text-green-300"
            : "border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-300"
        }`}>
          {msg.text}
        </div>
      )}

      {/* ── Take a save ── */}
      <div className="mt-5 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Save the flags as they are now</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Which sale</span>
            <select
              value={scope}
              onChange={e => setScope(e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white min-w-[18rem]"
            >
              <option value="ALL">Every sale</option>
              {auctions.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
          <label className="block flex-1 min-w-[14rem]">
            <span className="block text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">What to call it</span>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Before the August re-run"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white"
            />
          </label>
          <button
            onClick={save}
            disabled={pending}
            className="px-5 py-2.5 min-h-[44px] rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-sm font-bold disabled:opacity-50"
          >
            {pending ? "Saving…" : "💾 Save flagged lots"}
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
          Saves every lot that currently has an AI flag or a human review flag, with its photos, key
          points and description exactly as they are now.
        </p>
      </div>

      {/* ── The archives ── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] items-start">
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-2xl p-3 lg:sticky lg:top-4">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-gray-500 dark:text-gray-400 px-2 py-2">
            Saves ({batches.length})
          </p>
          {batches.length === 0 ? (
            <p className="px-2 pb-3 text-sm text-gray-500 dark:text-gray-400">
              Nothing saved yet. If this is a fresh deploy, an admin needs to press Run Migrations first.
            </p>
          ) : (
            <ul className="space-y-1">
              {batches.map(b => (
                <li key={b.batchId}>
                  <Link
                    href={`/admin/saved-flagged-lots?batch=${encodeURIComponent(b.batchId)}`}
                    className={`block px-3 py-2.5 rounded-lg text-sm transition ${
                      openBatch === b.batchId
                        ? "bg-orange-100 dark:bg-orange-500/20 text-orange-800 dark:text-orange-200 font-semibold"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}
                  >
                    <span className="block truncate">{b.label || "Untitled save"}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {b.lots} lot{b.lots === 1 ? "" : "s"} · {b.aiFlags} AI · {when(b.savedAt)}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
                      {b.sales.length === 1 ? b.sales[0] : `${b.sales.length} sales`} · {b.savedByName}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          {!openBatch ? (
            <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-2xl p-10 text-center">
              <p className="text-lg text-gray-600 dark:text-gray-400">Pick a save on the left to read it.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white truncate">
                    {batch?.label || "Untitled save"}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {rows.length} lot{rows.length === 1 ? "" : "s"} · saved {batch ? when(batch.savedAt) : ""} by {batch?.savedByName}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={() => setAiOnly(v => !v)}
                    className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                      aiOnly
                        ? "bg-orange-600/20 border-orange-500 text-orange-500"
                        : "bg-white dark:bg-[#2C2C2E] border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"
                    }`}
                  >
                    ⚠️ AI-flagged only
                  </button>
                  <button
                    onClick={() => remove(openBatch)}
                    disabled={pending}
                    className="px-3 py-2 text-sm font-medium rounded-lg border border-red-500/50 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    Delete archive
                  </button>
                </div>
              </div>

              {/* ⚠ The page is paged. Say so — a partial archive that looks complete is worse
                  than no archive, because nobody goes looking for the rest. Nothing is missing
                  from the SAVE; this is only what is being rendered. */}
              {batch && batch.lots > rows.length && (
                <div className="mb-4 rounded-xl border-2 border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                  Showing the first {rows.length.toLocaleString()} of {batch.lots.toLocaleString()} saved lots.
                  All {batch.lots.toLocaleString()} are safely stored — this page just does not render them all at once.
                </div>
              )}

              {shown.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">
                  {rows.length === 0 ? "This archive is empty." : "No lots match that filter."}
                </p>
              ) : (
                <>
                <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                  Key points: <span className="text-green-500">✓</span> found ·
                  <span className="text-amber-500"> ≈</span> partly worded ·
                  <span className="text-amber-500"> ✍</span> reworded ·
                  <span className="text-red-500"> ⚠</span> not found.
                  A coloured dot marks where that key point appears in the description.
                </p>
                <div className="space-y-4">
                  {shown.map(lot => (
                    <SavedLotCard key={lot.id} lot={lot} onPhoto={i => setViewer({ lot, index: i })} />
                  ))}
                </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {viewer && (
        <LotPhotoViewer
          images={viewer.lot.imageUrls}
          label={viewer.lot.barcode || viewer.lot.receiptUniqueId || ""}
          index={viewer.index}
          onIndex={i => setViewer({ lot: viewer.lot, index: i })}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  )
}

// ─── One saved lot, laid out the way the Review tab lays it out ──────────────

function SavedLotCard({ lot, onPhoto }: { lot: SavedFlagRow; onPhoto: (index: number) => void }) {
  const est   = fmtEstimate(lot.estimateLow, lot.estimateHigh)
  const aiEst = fmtEstimate(lot.aiEstimateLow, lot.aiEstimateHigh)

  const a = analyseKeyPoints(lot.description ?? "", lot.keyPoints ?? "", lot.kpMode)
  const notFound = a.matches.filter(m => m.status === "missing").length

  return (
    <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-4">
      {/* Identity */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono font-semibold text-gray-900 dark:text-white">
          {lot.barcode || lot.receiptUniqueId || "—"}
        </span>
        {lot.receiptUniqueId && lot.barcode && (
          <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{lot.receiptUniqueId}</span>
        )}
        {lot.auctionCode && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 font-semibold">
            {lot.auctionCode}
          </span>
        )}
        <span className="text-sm text-gray-600 dark:text-gray-400 truncate">{lot.title}</span>
        {notFound > 0 && (
          <span className="ml-auto shrink-0 text-xs px-2 py-1 rounded-lg bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 font-semibold">
            ⚠ {notFound} key point{notFound === 1 ? "" : "s"} not found
          </span>
        )}
      </div>

      {/* Human flag */}
      {lot.reviewFlag && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-red-500 dark:text-red-400 font-semibold mb-1">🚩 Flagged</p>
          <p className="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">{lot.reviewFlag}</p>
          <p className="text-xs text-red-400/80 mt-2">
            {lot.reviewFlaggedBy ?? ""}{lot.reviewFlaggedAt ? ` · ${when(lot.reviewFlaggedAt)}` : ""}
          </p>
        </div>
      )}

      {/* The AI flag — the thing this archive exists to keep */}
      {lot.aiFlagNote && (
        <div className="rounded-xl bg-orange-50 dark:bg-orange-950/30 border border-orange-300 dark:border-orange-700 px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-orange-500 dark:text-orange-400 font-semibold mb-1">
            ⚠️ Possible cataloguer mistake (flagged by AI)
          </p>
          <p className="text-sm text-orange-800 dark:text-orange-200 whitespace-pre-wrap">{lot.aiFlagNote}</p>
        </div>
      )}

      {/* Photo + key points, exactly as the Review tab arranges them */}
      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4">
        <div>
          {lot.imageUrls.length > 0 ? (
            <button onClick={() => onPhoto(0)} className="relative block w-full" title="Click to enlarge and zoom in">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={proxyUrl(lot.imageUrls[0])}
                alt={lot.barcode ?? "Lot photo"}
                loading="lazy"
                className="w-full aspect-square object-cover rounded-xl border border-gray-200 dark:border-gray-700"
              />
              {lot.imageUrls.length > 1 && (
                <span className="absolute bottom-2 right-2 text-xs px-2 py-0.5 rounded-full bg-black/70 text-white">
                  1 / {lot.imageUrls.length}
                </span>
              )}
            </button>
          ) : (
            <div className="w-full aspect-square rounded-xl border border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center text-xs text-red-400">
              No photos
            </div>
          )}

          <div className="mt-3 space-y-1.5 text-sm">
            {est && <p><span className="text-gray-500 dark:text-gray-400">Estimate:</span> <span className="font-semibold text-[#2AB4A6]">{est}</span></p>}
            {!est && aiEst && <p><span className="text-gray-500 dark:text-gray-400">AI Est:</span> <span className="font-semibold text-purple-400">{aiEst}</span></p>}
            {lot.condition && <p><span className="text-gray-500 dark:text-gray-400">Condition:</span> <span className="text-gray-700 dark:text-gray-300">{lot.condition}</span></p>}
            {(lot.category || lot.subCategory) && (
              <p><span className="text-gray-500 dark:text-gray-400">Category:</span> <span className="text-gray-700 dark:text-gray-300">{[lot.category, lot.subCategory].filter(Boolean).join(" / ")}</span></p>
            )}
            {lot.brand && <p><span className="text-gray-500 dark:text-gray-400">Brand:</span> <span className="text-gray-700 dark:text-gray-300">{lot.brand}</span></p>}
            {lot.cataloguedBy && <p><span className="text-gray-500 dark:text-gray-400">Cataloguer:</span> <span className="text-gray-700 dark:text-gray-300">{lot.cataloguedBy}</span></p>}
          </div>
        </div>

        <div className="space-y-3 min-w-0">
          {a.matches.length > 0 && (
            <div className="rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 px-4 py-3">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Key Points</p>
              <ul className="space-y-1">
                {a.matches.map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={`shrink-0 ${m.status === "found" ? "text-green-500" : m.status === "missing" ? "text-red-500" : "text-amber-500"}`}>
                      {m.status === "found" ? "✓" : m.status === "partial" ? "≈" : m.status === "reworded" ? "✍" : "⚠"}
                    </span>
                    {m.status !== "missing" && (
                      <span className={`shrink-0 w-2.5 h-2.5 rounded-full mt-1.5 ${kpColour(i).dot}`} title="Highlight colour in the description" />
                    )}
                    <span className={
                      m.status === "found"     ? "text-gray-700 dark:text-gray-300"
                      : m.status === "missing" ? "text-red-700 dark:text-red-300 font-medium"
                      : "text-amber-700 dark:text-amber-300 font-medium"
                    }>{m.line}</span>
                    {m.status === "partial" && (
                      <span className="text-xs text-amber-500/80 shrink-0 mt-0.5">
                        partly worded{m.missing.length > 0 ? ` — missing: ${m.missing.slice(0, 4).join(", ")}` : " — check"}
                      </span>
                    )}
                    {m.status === "reworded" && (
                      <span className="text-xs text-amber-500/80 shrink-0 mt-0.5">
                        reworded{m.missing.length > 0 ? ` — wording differs on: ${m.missing.slice(0, 4).join(", ")}` : " — check wording"}
                      </span>
                    )}
                    {m.status === "missing" && (
                      <span className="text-xs text-red-500/80 shrink-0 mt-0.5">
                        not found{m.missing.length > 0 ? `: ${m.missing.slice(0, 5).join(", ")}` : ""}
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              {/* "The key points were wrong, not the description" — as recorded at save time. */}
              {lot.kpFixNote && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    ✓ {lot.kpFixNote}
                    <span className="text-gray-500 dark:text-gray-400">
                      {lot.kpFixedBy ? ` — ${lot.kpFixedBy}` : ""}
                      {lot.kpFixedAt ? ` · ${new Date(lot.kpFixedAt).toLocaleDateString("en-GB")}` : ""}
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Description</p>
            {lot.description
              ? <HighlightedDescription description={lot.description} ranges={a.ranges} />
              : <p className="text-sm text-red-400">No description</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
