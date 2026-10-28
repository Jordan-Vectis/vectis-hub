import Link from "next/link"
import { recentLabelRuns, salesForLabels } from "@/lib/barcode-labels-server"
import { londonDay } from "@/lib/uncollected"
import type { LabelRunRow, LabelSale } from "@/lib/barcode-labels"
import LabelsClient from "./labels-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Barcode Labels" }

// Admin & Operations → 🏷️ Barcode Labels (Jack, 2026-10-28): a sale's Lot ID labels on the Avery
// sheets, without the Word mail merge. The layout (app/(app)/tools/barcodes/layout.tsx) lets in only
// people with the BARCODES app; the PDF route checks again. lib/barcode-labels.ts has the rules.

export default async function BarcodesPage() {
  // Each part on its own: a sale list that can't be read still leaves a sale to type in, and a log
  // that isn't there yet (before Run Migrations) still leaves labels to print.
  const [sales, log] = await Promise.all([
    salesForLabels().catch((e): LabelSale[] | null => { console.error("barcode labels sales error:", e); return null }),
    recentLabelRuns().catch((e): { ready: boolean; runs: LabelRunRow[] } | null => { console.error("barcode labels runs error:", e); return null }),
  ])
  return (
    <div className="p-4 sm:p-8">
      <div className="mb-5">
        <Link href="/hub" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">← Hub</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🏷️ Barcode Labels</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
          A sale&apos;s Lot ID labels — X160001, X160002 … — on the Avery L7651 sheets (65 a sheet), laid out exactly like the old mail merge.
          Pick the sale, say how many, press Print. No Word, no Excel.
        </p>
      </div>
      <LabelsClient sales={sales} runs={log?.runs ?? []} logReady={log?.ready ?? false} logFailed={!log} today={londonDay()} />
    </div>
  )
}
