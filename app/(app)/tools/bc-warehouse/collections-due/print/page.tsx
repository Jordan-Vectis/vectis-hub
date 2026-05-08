"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"

// Print-styled view of the Collections Due report. Opens in a new tab from
// the BC Warehouse → Collections Due tab. Use Ctrl+P / Cmd+P (or the
// "Print this page" button below) to print or save as PDF.

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

export default function CollectionsDuePrintPage() {
  const params       = useSearchParams()
  const aisles       = params.get("aisles") ?? ""
  const groupByDocket = params.get("groupByDocket") === "1"

  const [items,   setItems]   = useState<Item[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!aisles) { setError("No aisles specified"); setLoading(false); return }
    const qs = new URLSearchParams({ aisles })
    fetch(`/api/warehouse/collections-due?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else         setItems(d.items as Item[])
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false))
  }, [aisles])

  // Auto-trigger print once the data has loaded — comment out if too aggressive
  // useEffect(() => { if (items && items.length > 0) setTimeout(() => window.print(), 500) }, [items])

  const grouped = items
    ? Object.values(items.reduce((acc, it) => {
        const key = it.collectionNo || "—"
        if (!acc[key]) acc[key] = { collectionNo: key, items: [] as Item[] }
        acc[key].items.push(it)
        return acc
      }, {} as Record<string, { collectionNo: string; items: Item[] }>))
        .sort((a, b) => a.collectionNo.localeCompare(b.collectionNo))
    : []

  const printedDate = new Date().toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "long", year: "numeric",
  })

  return (
    <div className="bg-white text-black min-h-screen">
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          @page { margin: 12mm; size: A4 portrait; }
          thead { display: table-header-group; }   /* repeat headers per page */
          tr, .docket-block { page-break-inside: avoid; }
        }
        @media screen {
          .page { max-width: 210mm; margin: 0 auto; padding: 16mm; }
        }
      `}</style>

      {/* Toolbar — hidden on print */}
      <div className="no-print sticky top-0 z-10 bg-gray-100 border-b border-gray-300 p-3 flex items-center justify-between gap-3">
        <div className="text-xs text-gray-600">
          <strong>Collections Due</strong> · Aisles: {aisles} · {items?.length ?? 0} items
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
        {/* Header */}
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
              <p>Aisles: <strong className="font-mono">{aisles}</strong></p>
            </div>
          </div>
        </div>

        {loading && <p className="text-sm text-gray-500">Loading from BC…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {items && items.length === 0 && (
          <p className="text-sm text-gray-500">No matching items found.</p>
        )}

        {items && items.length > 0 && !groupByDocket && (
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
                  Total: <strong>{items.length} item{items.length === 1 ? "" : "s"}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {items && items.length > 0 && groupByDocket && (
          <div className="space-y-4">
            {grouped.map(g => (
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
              Total: <strong>{items.length} item{items.length === 1 ? "" : "s"}</strong> across <strong>{grouped.length} docket{grouped.length === 1 ? "" : "s"}</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
