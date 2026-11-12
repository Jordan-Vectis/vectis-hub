import type { BcStep, LotPreview } from "@/lib/goods-in/bc-sandbox"
import { mono } from "./ui"

// The pieces both "Lots → Business Central test" panels show — the receipt page's (receipts/[id]/bc-lots-test.tsx)
// and the sale page's (cataloguing/auctions/[id]/bc-sale-lots-test.tsx) — so a lot reads the same in both.

export const MARK: Record<BcStep["outcome"], { sym: string; cls: string; word: string }> = {
  made: { sym: "✓", cls: "text-emerald-700 dark:text-emerald-300", word: "made in the BC test environment now" },
  there: { sym: "=", cls: "text-gray-500 dark:text-gray-400", word: "it was already there, nothing sent" },
  failed: { sym: "✗", cls: "text-red-700 dark:text-red-300", word: "Business Central refused it (its words shown)" },
}

const money = (n: number) => `£${n.toLocaleString("en-GB")}`

function estimateText(lo: number | null, hi: number | null): string | null {
  if (lo == null && hi == null) return null
  if (lo != null && hi != null) return `${money(lo)}–${money(hi)}`
  return lo != null ? `low ${money(lo)}` : `high ${money(hi as number)}`
}

/** One field on a lot card: the value as it goes to BC, or a plain "not sent" when the lot has none. */
function Field({ label, value, note }: { label: string; value: string | null; note?: string | null }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-amber-800/80 dark:text-amber-200/70">{label} </span>
      {value
        ? <b className="font-medium text-gray-900 dark:text-white">{value}</b>
        : <span className="italic text-gray-500 dark:text-gray-400">not sent{note ? ` (${note})` : ""}</span>}
    </span>
  )
}

/** What one lot will put on its BC line — the same values the send uses (lotPreview in bc-sandbox.ts). */
export function LotCard({ n, lot }: { n: number; lot: LotPreview }) {
  const category = lot.category ? `${lot.category}${lot.subCategory ? ` / ${lot.subCategory}` : ""}` : null
  return (
    <li className="rounded-md border border-amber-200 dark:border-amber-900 bg-white/70 dark:bg-gray-900/50 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">{n}.</span>
        <span className={`${mono} font-semibold text-gray-900 dark:text-white`}>{lot.barcode ?? "no barcode"}</span>
        <span className="text-gray-900 dark:text-white">{lot.shortDescription}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Field label="Sale" value={lot.sale} />
        <Field label="Cleared for sale" value={lot.clearedForSale ? "Yes" : null} note="no sale" />
        <Field label="Estimate" value={estimateText(lot.estimateLow, lot.estimateHigh)} />
        <Field label="Category" value={category} />
        <Field label="Tote" value={lot.tote} />
        <Field label="Size" value={lot.size} note={lot.sizeUnknown ? `"${lot.sizeUnknown}" isn't a size BC has` : null} />
      </div>
      {lot.description ? (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer select-none text-indigo-700 dark:text-indigo-300 min-h-8 inline-flex items-center">
            Description ({lot.description.length} characters)
          </summary>
          <p className="mt-1 whitespace-pre-wrap text-gray-800 dark:text-gray-200">{lot.description}</p>
        </details>
      ) : (
        <p className="mt-1 text-xs"><Field label="Description" value={null} /></p>
      )}
    </li>
  )
}

/** BC's own Receipt Lines list for one receipt, in the test environment — where the lines can be seen. */
export function BcLink({ url, environment, receiptId }: { url: string; environment: string; receiptId: string }) {
  return (
    <p className="mt-3 text-sm">
      <a href={url} target="_blank" rel="noreferrer"
        className="font-medium underline text-indigo-700 dark:text-indigo-300 inline-flex items-center min-h-11">
        See {receiptId}&apos;s lines in BC ({environment}) ↗
      </a>
    </p>
  )
}

/** Each step as ✓ / = / ✗ with BC's own words. */
export function StepList({ steps }: { steps: BcStep[] }) {
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className={`w-4 shrink-0 font-bold ${MARK[s.outcome].cls}`}>{MARK[s.outcome].sym}</span>
          <span>
            <span className={`${mono} font-medium text-gray-900 dark:text-white`}>{s.what}</span>
            <span className="sr-only"> — {MARK[s.outcome].word}</span>
            <span className={s.outcome === "failed" ? " text-red-700 dark:text-red-300" : " text-gray-600 dark:text-gray-300"}> — {s.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The key to ✓ / = / ✗ (design rule 3). */
export function StepKey() {
  return (
    <p className="text-xs text-gray-500 dark:text-gray-400">
      {(["made", "there", "failed"] as const).map(k => (
        <span key={k} className="mr-3"><b className={MARK[k].cls}>{MARK[k].sym}</b> {MARK[k].word}</span>
      ))}
    </p>
  )
}

/** How one lot's send came out, for the end-of-run numbers. A sale BC wouldn't take is reported on its own
 *  step ("Sale …") — the lot is still on its receipt. */
export function lotOutcome(steps: BcStep[]): "full" | "already" | "refused" | "noSale" {
  const failed = steps.filter(s => s.outcome === "failed")
  if (failed.some(s => !s.what.startsWith("Sale "))) return "refused"
  if (failed.length) return "noSale"
  return steps.some(s => s.outcome === "made") ? "full" : "already"
}
