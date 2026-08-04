"use client"

// "What is this going to cost?" — shown next to the Run button on the Auction AI
// run tabs, before anything is spent.
//
// ⚠ It is an ESTIMATE and says so on screen. Token counts are worked out from
// what is actually in front of the user (how many lots are ticked, how many
// photos each has, how long the instruction is), but the per-photo token cost
// and the length of the reply are assumptions — see lib/ai-pricing.ts. Treat it
// as "pennies or pounds?", not as an invoice.

import { useEffect, useState } from "react"
import {
  estimateRun, formatUsd, formatTokens, tokensOfText, tokensOfPhotos,
  type ModelRate,
} from "@/lib/ai-pricing"

type Props = {
  model:  string
  /** How many lots / items the run will process. */
  items:  number
  /** Total photos across all of them (0 for text-only runs). */
  photos?: number
  /** The instruction / prompt text sent for EACH item. */
  promptText?: string
  /** Roughly how many characters come back per item (a description is ~700). */
  outputCharsPerItem?: number
  /** Shown under the figure, e.g. "3 stages — Batch, Key Points, Double Check". */
  note?: string
  /** Multiplies the whole estimate — the pipeline runs several stages per lot. */
  passes?: number
}

let cachedOverrides: Record<string, ModelRate> | null = null

export default function RunCostEstimate({
  model, items, photos = 0, promptText = "", outputCharsPerItem = 700, note, passes = 1,
}: Props) {
  const [overrides, setOverrides] = useState<Record<string, ModelRate> | null>(cachedOverrides)

  useEffect(() => {
    if (cachedOverrides) return
    fetch("/api/ai-rates")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.overrides) { cachedOverrides = d.overrides; setOverrides(d.overrides) } })
      .catch(() => { cachedOverrides = {}; setOverrides({}) })
  }, [])

  if (items <= 0) return null

  const photosPerItem = items > 0 ? photos / items : 0
  const est = estimateRun({
    model,
    items: items * Math.max(1, passes),
    perItemInputTokens:  tokensOfText(promptText) + tokensOfPhotos(model, photosPerItem),
    perItemOutputTokens: Math.ceil(outputCharsPerItem / 4),
    overrides: overrides ?? {},
  })

  const unknown  = est.source === "unknown"
  const assumed  = est.source === "assumed"

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${
      unknown
        ? "border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50"
        : "border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10"
    }`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-gray-600 dark:text-gray-400">Estimated cost</span>
        <span className={`text-2xl font-bold ${unknown ? "text-gray-500" : "text-emerald-700 dark:text-emerald-300"}`}>
          {unknown ? "Price not set" : formatUsd(est.usd)}
        </span>
        {!unknown && <span className="text-gray-500 dark:text-gray-500">USD, as billed</span>}
      </div>

      <p className="text-gray-600 dark:text-gray-400 mt-1.5">
        {items.toLocaleString()} lot{items === 1 ? "" : "s"}
        {photos > 0 && <> · {photos.toLocaleString()} photo{photos === 1 ? "" : "s"}</>}
        {passes > 1 && <> · {passes} passes each</>}
        {" · "}≈ {formatTokens(est.inputTokens)} in, {formatTokens(est.outputTokens)} out
        {" · "}<span className="font-mono">{model}</span>
      </p>

      {note && <p className="text-gray-500 dark:text-gray-500 mt-1">{note}</p>}

      {unknown ? (
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          No price is recorded for this model, so no figure can be given. Add one in Admin → AI Models rather than
          guessing.
        </p>
      ) : (
        <p className="text-gray-500 dark:text-gray-500 mt-2">
          A rough estimate to tell pennies from pounds — not a quote. Based on the photos and instruction actually
          selected; the reply length is assumed.
          {assumed && " The price for this model is a best match rather than a published figure — check it in Admin → AI Models."}
        </p>
      )}
    </div>
  )
}
