// Shared look for the Admin Centre tabs.
//
// This tool is used by non-technical admins, so everything here is deliberately
// LARGE: base text rather than the 11-12px the rest of the Hub uses, generous
// row height, and buttons big enough to hit without aiming.

export const CARD = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm"

export const INPUT =
  "w-full px-5 py-4 rounded-xl border-2 border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 " +
  "text-gray-900 dark:text-white text-lg font-mono placeholder:font-sans placeholder:text-gray-400 " +
  "focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition"

export const BTN_PRIMARY =
  "px-8 py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-lg font-semibold " +
  "disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"

export const SECTION_TITLE = "text-xl font-bold text-gray-900 dark:text-white"
export const HINT          = "text-sm text-gray-500 dark:text-gray-400"

// ⚠ Lot STATUS is deliberately not shown anywhere in the Admin Centre. It was
// dropped from Manage Lots for the same reason — it reads ENTERED on virtually
// every lot and tells an admin nothing. Don't reintroduce a status column here.

// Plain-English wording for the lot audit trail (CatalogueLotEvent).
export const ACTION_LABELS: Record<string, string> = {
  created: "Created the lot", updated: "Edited", deleted: "Deleted the lot",
  photo_added: "Added a photo", photo_removed: "Removed a photo", photo_reordered: "Reordered the photos",
}

export const SOURCE_LABELS: Record<string, string> = {
  lot_create: "Lot wizard / Add lot", lot_wizard: "Lot wizard", photo_only: "Photo-only lot",
  lot_editor: "Lot editor", review_tab: "Review tab", photo_tab: "Photos",
  ai_apply: "AI (applied)", ai_flag: "AI flag", bulk: "Bulk action", import: "Import",
  mass_create: "Mass create", warehouse_fill: "Warehouse fill", vendor_change: "Change vendor",
  transfer: "Transfer", undo: "Undo", admin_db: "Admin databases", restore: "Backup restore",
}

export const FIELD_LABELS: Record<string, string> = {
  title: "Title", description: "Description", keyPoints: "Key points", condition: "Condition",
  estimateLow: "Estimate (low)", estimateHigh: "Estimate (high)",
  aiEstimateLow: "AI estimate (low)", aiEstimateHigh: "AI estimate (high)",
  barcode: "Barcode", receiptUniqueId: "Unique ID", receipt: "Receipt", tote: "Tote",
  vendor: "Customer", category: "Category", subCategory: "Sub-category", status: "Status",
  addedToBC: "Added to BC", imageUrls: "Photos", notes: "Notes", extraDetails: "Extra details",
  reviewFlag: "Review flag", aiFlagNote: "AI flag note", aiExcluded: "Excluded from AI",
}

export const fieldLabel  = (f: string) => FIELD_LABELS[f] ?? f
export const actionLabel = (a: string) => ACTION_LABELS[a] ?? a
export const sourceLabel = (s: string) => (s ? SOURCE_LABELS[s] ?? s : "")

// "3 Aug 2026, 14:32" — the format the rest of the Hub prints dates in.
export function formatWhen(iso: string): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
    })
  } catch { return iso }
}

// Sale date. The Hub sends an ISO string; BC sends its own plain string and uses
// 0001-01-01 for "no date", so anything absurdly old is treated as blank.
export function formatSaleDate(value: string): string {
  if (!value) return ""
  const d = new Date(value)
  if (isNaN(d.getTime()) || d.getFullYear() < 1990) return ""
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })
}

// "F088 — Diecast Sale · 15 Aug 2026", skipping whatever is missing.
export function saleLine(code: string, name: string, date: string, fallback = "—"): string {
  const head = [code, name].filter(Boolean).join(" — ")
  const when = formatSaleDate(date)
  if (!head && !when) return fallback
  return [head || fallback, when].filter(Boolean).join(" · ")
}

export function formatDay(iso: string): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London",
    })
  } catch { return iso }
}
