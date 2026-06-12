"use client"

import { useState } from "react"

type Item = {
  id: string
  name: string
  description: string | null
  signedPhotoUrls: string[]
  externalEstimate: number | null
  externalNotes: string | null
}

type ItemDraft = { estimate: string; notes: string }

export default function ValueClient({
  token,
  items,
  alreadySubmitted,
  overallNotes: savedOverallNotes,
}: {
  token: string
  items: Item[]
  alreadySubmitted: boolean
  overallNotes: string
}) {
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>(() =>
    Object.fromEntries(
      items.map(i => [
        i.id,
        { estimate: i.externalEstimate != null ? String(i.externalEstimate) : "", notes: i.externalNotes ?? "" },
      ])
    )
  )
  const [overallNotes, setOverallNotes] = useState(savedOverallNotes)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(alreadySubmitted)
  const [error, setError] = useState("")
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  function updateDraft(itemId: string, field: keyof ItemDraft, value: string) {
    setDrafts(d => ({ ...d, [itemId]: { ...d[itemId], [field]: value } }))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch(`/api/public/submission/${token}/save-valuation`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map(i => ({
            id:       i.id,
            estimate: drafts[i.id]?.estimate ? Number(drafts[i.id].estimate) : null,
            notes:    drafts[i.id]?.notes || null,
          })),
          overallNotes: overallNotes || null,
        }),
      })
      if (!res.ok) throw new Error("Failed to save")
      setDone(true)
    } catch {
      setError("Something went wrong — please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="w-full max-w-2xl">
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center shadow-sm">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✓</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Valuation Submitted</h2>
          <p className="text-gray-500">
            Thank you — Vectis Auctions has received your valuation.
          </p>
          <p className="text-sm text-gray-400 mt-4">You can now close this page.</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="w-full max-w-2xl space-y-5">
        {items.map((item, index) => {
          const draft = drafts[item.id] ?? { estimate: "", notes: "" }
          return (
            <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-start gap-3 mb-4">
                <span className="w-7 h-7 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-semibold text-gray-900">{item.name}</h3>
                  {item.description && (
                    <p className="text-sm text-gray-500 mt-0.5">{item.description}</p>
                  )}
                </div>
              </div>

              {/* Photos */}
              {item.signedPhotoUrls.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {item.signedPhotoUrls.map((url, pi) => (
                    <button
                      key={pi}
                      onClick={() => setLightboxSrc(url)}
                      className="w-20 h-20 rounded-xl overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors flex-shrink-0"
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {item.signedPhotoUrls.length === 0 && (
                <p className="text-sm text-gray-400 italic mb-4">No photos provided</p>
              )}

              {/* Estimate */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estimate (£)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">£</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={draft.estimate}
                      onChange={e => updateDraft(item.id, "estimate", e.target.value)}
                      className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes for this item</label>
                <textarea
                  rows={2}
                  placeholder="Condition, caveats, comparable sales..."
                  value={draft.notes}
                  onChange={e => updateDraft(item.id, "notes", e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white text-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
          )
        })}

        {/* Overall notes */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-3">Overall Comments</h3>
          <textarea
            rows={4}
            placeholder="General comments, combined lot value, anything else Vectis should know..."
            value={overallNotes}
            onChange={e => setOverallNotes(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white text-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {error && (
          <p className="text-red-600 text-sm text-center">{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-lg py-4 rounded-2xl transition-colors disabled:opacity-40"
        >
          {submitting ? "Submitting…" : "Submit Valuation to Vectis →"}
        </button>

        <p className="text-center text-xs text-gray-400 pb-6">
          Your response is sent securely to Vectis Auctions.
        </p>
      </div>

      {/* Lightbox */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setLightboxSrc(null)}
        >
          <img
            src={lightboxSrc}
            alt=""
            className="max-w-full max-h-full rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxSrc(null)}
            className="absolute top-4 right-4 text-white text-2xl font-bold bg-black/40 rounded-full w-10 h-10 flex items-center justify-center"
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}
