"use client"

import { useState } from "react"

interface LotItem {
  id: string
  barcode: string | null
  receiptUniqueId: string | null
  title: string
  description: string
  estimateLow: number | null
  estimateHigh: number | null
  imageUrls: string[]
}

interface FailReason {
  field: string
  label: string
}

interface Props {
  lots: LotItem[]
  onOpenLot: (id: string) => void
}

function checkLot(lot: LotItem): FailReason[] {
  const fails: FailReason[] = []
  if (!lot.title || lot.title === "Untitled" || !lot.title.trim())
    fails.push({ field: "title", label: "No title" })
  if (!lot.description || !lot.description.trim())
    fails.push({ field: "description", label: "No description" })
  if (lot.estimateLow == null)
    fails.push({ field: "estimateLow", label: "No estimate (low)" })
  if (lot.estimateHigh == null)
    fails.push({ field: "estimateHigh", label: "No estimate (high)" })
  if (lot.imageUrls.length === 0)
    fails.push({ field: "photo", label: "No photos" })
  return fails
}

export default function LockingCheckTab({ lots, onOpenLot }: Props) {
  const [filter, setFilter] = useState<"all" | "failing">("failing")

  const results = lots.map(lot => ({ lot, fails: checkLot(lot) }))
  const failing = results.filter(r => r.fails.length > 0)
  const passing = results.filter(r => r.fails.length === 0)

  const displayed = filter === "failing"
    ? failing
    : [...failing, ...passing]

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Locking Check</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Checks every lot has a title, description, estimates, and at least one photo.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{lots.length}</div>
          <div className="text-xs text-gray-500 mt-1">Total lots</div>
        </div>
        <div className="bg-green-950/20 border border-green-800/40 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-green-400">{passing.length}</div>
          <div className="text-xs text-green-500 mt-1">Ready</div>
        </div>
        <div className={`${failing.length > 0 ? "bg-red-950/20 border-red-800/40" : "bg-green-950/20 border-green-800/40"} border rounded-xl p-4 text-center`}>
          <div className={`text-2xl font-bold ${failing.length > 0 ? "text-red-400" : "text-green-400"}`}>{failing.length}</div>
          <div className={`text-xs mt-1 ${failing.length > 0 ? "text-red-500" : "text-green-500"}`}>Failing</div>
        </div>
      </div>

      {failing.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-950/20 border border-green-800/40 rounded-xl text-green-400 text-sm">
          ✅ All lots are ready — nothing is blocking the lock.
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <button
              onClick={() => setFilter("failing")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === "failing" ? "bg-red-700 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"}`}>
              Failing only ({failing.length})
            </button>
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === "all" ? "bg-gray-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"}`}>
              All lots ({results.length})
            </button>
          </div>

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
                {displayed.map(({ lot, fails }, i) => (
                  <tr
                    key={lot.id}
                    className={`border-b border-gray-100 dark:border-gray-800 last:border-0 ${i % 2 === 0 ? "" : "bg-gray-50/50 dark:bg-white/[0.02]"}`}>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {lot.receiptUniqueId || lot.barcode || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 max-w-xs truncate">
                      {lot.title || <span className="text-gray-400 italic">No title</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {fails.length === 0 ? (
                        <span className="text-green-400 text-xs">✓ Ready</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {fails.map(f => (
                            <span key={f.field} className="px-1.5 py-0.5 bg-red-950/40 border border-red-800/40 text-red-400 rounded text-xs">
                              {f.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {fails.length > 0 && (
                        <button
                          onClick={() => onOpenLot(lot.id)}
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
        </>
      )}
    </div>
  )
}
