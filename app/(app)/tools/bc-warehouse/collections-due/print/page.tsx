"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"

// Print-styled view of the Collections Due report. Opens in a new tab from
// the BC Warehouse → Collections Due tab. Use Ctrl+P / Cmd+P (or the
// "Print this page" button below) to print or save as PDF.
//
// Multi-aisle behaviour: each aisle prefix gets its own report on its own
// page(s) so different pickers can be handed different aisle reports.

type Item = {
  uniqueId:     string
  receiptNo:    string
  articleNo:    string
  barcode:      string
  description:  string
  location:     string
  collectionNo: string
  vendorName:   string
}

// Group items by the matching aisle prefix from the user's input list.
// Returns the aisles in the same order the user supplied.
function groupByAisle(items: Item[], aisleList: string[]): { aisle: string; items: Item[] }[] {
  const groups = new Map<string, Item[]>()
  for (const aisle of aisleList) groups.set(aisle, [])

  // "Other" bucket for items whose location doesn't start with any supplied aisle
  // (shouldn't happen if BC filter and UI agree, but safer than dropping rows).
  const other: Item[] = []

  for (const it of items) {
    const matched = aisleList.find(a => it.location.toUpperCase().startsWith(a))
    if (matched) groups.get(matched)!.push(it)
    else         other.push(it)
  }

  const out: { aisle: string; items: Item[] }[] = []
  for (const aisle of aisleList) {
    const list = groups.get(aisle)!
    if (list.length > 0) out.push({ aisle, items: list })
  }
  if (other.length > 0) out.push({ aisle: "Other", items: other })
  return out
}

function groupByDocketFn(items: Item[]) {
  return Object.values(items.reduce((acc, it) => {
    const key = it.collectionNo || "—"
    if (!acc[key]) acc[key] = { collectionNo: key, items: [] as Item[] }
    acc[key].items.push(it)
    return acc
  }, {} as Record<string, { collectionNo: string; items: Item[] }>))
    .sort((a, b) => a.collectionNo.localeCompare(b.collectionNo))
}

export default function CollectionsDuePrintPage() {
  const params        = useSearchParams()
  const aislesParam   = params.get("aisles") ?? ""
  const groupByDocket = params.get("groupByDocket") === "1"

  const aisleList = aislesParam
    .split(/[,\s.;/|]+/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)

  const [items,   setItems]   = useState<Item[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (aisleList.length === 0) { setError("No aisles specified"); setLoading(false); return }
    const qs = new URLSearchParams({ aisles: aislesParam })
    fetch(`/api/warehouse/collections-due?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else         setItems(d.items as Item[])
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aislesParam])

  const aisleGroups = items ? groupByAisle(items, aisleList) : []

  const printedDate = new Date().toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "long", year: "numeric",
  })

  return (
    <div className="bg-white text-black min-h-screen">
      <style jsx global>{`
        @media print {
          @page { margin: 12mm; size: A4 portrait; }

          html, body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            width: auto !important;
          }

          .page {
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }

          .no-print { display: none !important; }

          /* Each aisle starts a new page, except the very first. */
          .aisle-report + .aisle-report {
            page-break-before: always;
            break-before: page;
          }

          /* Repeat thead/tfoot on each printed page */
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }

          /* Don't split rows or docket blocks across pages */
          tr, .docket-block {
            page-break-inside: avoid;
            break-inside: avoid;
          }

          table { width: 100% !important; }
        }

        @media screen {
          .page { max-width: 210mm; margin: 0 auto; padding: 16mm; }
          .aisle-report + .aisle-report {
            margin-top: 24px;
            padding-top: 24px;
            border-top: 2px dashed #d1d5db;
          }
        }
      `}</style>

      {/* Toolbar — hidden on print */}
      <div className="no-print sticky top-0 z-10 bg-gray-100 border-b border-gray-300 p-3 flex items-center justify-between gap-3">
        <div className="text-xs text-gray-600">
          <strong>Collections Due</strong> · {aisleGroups.length} aisle report{aisleGroups.length === 1 ? "" : "s"} · {items?.length ?? 0} items
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-1.5 rounded transition-colors"
          >
            🖨 Print / Save as PDF
          </button>
          <button
            onClick={() => window.close()}
            className="bg-gray-300 hover:bg-gray-400 text-gray-800 text-sm px-4 py-1.5 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      <div className="page">
        {loading && <p className="text-sm text-gray-500">Loading from BC…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {items && items.length === 0 && (
          <p className="text-sm text-gray-500">No matching items found.</p>
        )}

        {aisleGroups.map(group => (
          <AisleReport
            key={group.aisle}
            aisle={group.aisle}
            items={group.items}
            groupByDocket={groupByDocket}
            printedDate={printedDate}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Per-aisle report ────────────────────────────────────────────────────────

function AisleReport({
  aisle,
  items,
  groupByDocket,
  printedDate,
}: {
  aisle:         string
  items:         Item[]
  groupByDocket: boolean
  printedDate:   string
}) {
  const docketGroups = groupByDocket ? groupByDocketFn(items) : []

  return (
    <section className="aisle-report">
      {/* Header — repeats per aisle so each printed report is self-contained */}
      <div className="border-b-2 border-black pb-3 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Vectis Auctions — Collections Due</h1>
            <p className="text-sm text-gray-700 mt-1">
              Items with a collection docket awaiting dispatch
            </p>
          </div>
          <div className="text-right text-xs text-gray-700">
            <p>Printed {printedDate}</p>
            <p>
              Aisle: <strong className="font-mono text-base">{aisle}</strong>
            </p>
            <p>
              <strong>{items.length}</strong> item{items.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

      {!groupByDocket && (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="text-left px-2 py-2 font-bold w-24">Location</th>
              <th className="text-left px-2 py-2 font-bold w-24">Barcode</th>
              <th className="text-left px-2 py-2 font-bold">Description</th>
              <th className="text-left px-2 py-2 font-bold w-32">Collection No.</th>
              <th className="text-left px-2 py-2 font-bold w-12">✓</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.uniqueId} className="border-b border-gray-300">
                <td className="px-2 py-1.5 font-mono align-top">{it.location}</td>
                <td className="px-2 py-1.5 font-mono align-top">{it.barcode}</td>
                <td className="px-2 py-1.5 align-top">{it.description}</td>
                <td className="px-2 py-1.5 font-mono align-top">{it.collectionNo}</td>
                <td className="px-2 py-1.5 align-top text-center">☐</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black">
              <td colSpan={5} className="px-2 py-2 text-xs text-gray-600">
                Aisle <strong>{aisle}</strong> total: <strong>{items.length} item{items.length === 1 ? "" : "s"}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      {groupByDocket && (
        <div className="space-y-4">
          {docketGroups.map(g => (
            <div key={g.collectionNo} className="docket-block border border-gray-400 rounded">
              <div className="bg-gray-100 border-b border-gray-400 px-3 py-2 flex items-center justify-between">
                <span className="font-mono font-bold">{g.collectionNo}</span>
                <span className="text-xs text-gray-700">{g.items.length} item{g.items.length === 1 ? "" : "s"}</span>
              </div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-400 bg-white">
                    <th className="text-left px-2 py-1.5 font-bold w-24">Location</th>
                    <th className="text-left px-2 py-1.5 font-bold w-24">Barcode</th>
                    <th className="text-left px-2 py-1.5 font-bold">Description</th>
                    <th className="text-left px-2 py-1.5 font-bold w-12">✓</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map(it => (
                    <tr key={it.uniqueId} className="border-b border-gray-200">
                      <td className="px-2 py-1.5 font-mono align-top">{it.location}</td>
                      <td className="px-2 py-1.5 font-mono align-top">{it.barcode}</td>
                      <td className="px-2 py-1.5 align-top">{it.description}</td>
                      <td className="px-2 py-1.5 align-top text-center">☐</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div className="border-t-2 border-black pt-2 text-xs text-gray-600">
            Aisle <strong>{aisle}</strong> total: <strong>{items.length} item{items.length === 1 ? "" : "s"}</strong> across <strong>{docketGroups.length} docket{docketGroups.length === 1 ? "" : "s"}</strong>
          </div>
        </div>
      )}
    </section>
  )
}
