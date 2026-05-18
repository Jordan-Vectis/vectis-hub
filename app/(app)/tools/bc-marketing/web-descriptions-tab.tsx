"use client"

import { useState, useEffect, useCallback } from "react"

type Auction = {
  id: string
  code: string
  name: string
  auctionType: string
  auctionDate: string | null
  lotCount: number
}

type SavedDescription = {
  id: string
  auctionId: string
  auctionCode: string
  auctionName: string
  description: string
  createdAt: string
  updatedAt: string
}

export default function WebDescriptionsTab() {
  // Auction picker
  const [auctions,       setAuctions]       = useState<Auction[]>([])
  const [auctionSearch,  setAuctionSearch]  = useState("")
  const [selectedId,     setSelectedId]     = useState<string | null>(null)
  const [loadingAuctions, setLoadingAuctions] = useState(false)

  // Generation
  const [modelList,      setModelList]      = useState<string[]>([])
  const [modelId,        setModelId]        = useState("gemini-2.5-flash-preview-04-17")
  const [generating,     setGenerating]     = useState(false)
  const [genError,       setGenError]       = useState<string | null>(null)
  const [generated,      setGenerated]      = useState<string | null>(null)

  // Saving
  const [saving,         setSaving]         = useState(false)
  const [savedMsg,       setSavedMsg]       = useState<string | null>(null)

  // Saved list
  const [saved,          setSaved]          = useState<SavedDescription[]>([])
  const [loadingSaved,   setLoadingSaved]   = useState(false)
  const [deletingId,     setDeletingId]     = useState<string | null>(null)

  // Copy state
  const [copied,         setCopied]         = useState(false)

  // ── Load auctions ──
  useEffect(() => {
    setLoadingAuctions(true)
    fetch("/api/marketing/web-descriptions/auctions")
      .then(r => r.json())
      .then(d => { if (d.auctions) setAuctions(d.auctions) })
      .catch(() => {})
      .finally(() => setLoadingAuctions(false))
  }, [])

  // ── Load models ──
  useEffect(() => {
    fetch("/api/auction-ai/models").then(r => r.json()).then(d => {
      if (d.models?.length) {
        setModelList(d.models)
        const saved = localStorage.getItem("bc_marketing_default_model")
        setModelId(saved && d.models.includes(saved) ? saved : d.models[0])
      }
    }).catch(() => {})
  }, [])

  // ── Load saved descriptions ──
  const loadSaved = useCallback(() => {
    setLoadingSaved(true)
    fetch("/api/marketing/web-descriptions")
      .then(r => r.json())
      .then(d => { if (d.descriptions) setSaved(d.descriptions) })
      .catch(() => {})
      .finally(() => setLoadingSaved(false))
  }, [])

  useEffect(() => { loadSaved() }, [loadSaved])

  const selectedAuction = auctions.find(a => a.id === selectedId) ?? null

  const filteredAuctions = auctions.filter(a => {
    const q = auctionSearch.toLowerCase()
    return !q || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
  })

  // ── Generate ──
  async function generate() {
    if (!selectedId) return
    setGenerating(true)
    setGenError(null)
    setGenerated(null)
    setSavedMsg(null)

    try {
      const res = await fetch("/api/marketing/web-descriptions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionId: selectedId, modelId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Generation failed")
      setGenerated(data.description)
    } catch (e: any) {
      setGenError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  // ── Save ──
  async function save() {
    if (!selectedId || !generated) return
    setSaving(true)
    setSavedMsg(null)

    try {
      const res = await fetch("/api/marketing/web-descriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionId: selectedId, description: generated }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Save failed")
      setSavedMsg("Saved!")
      loadSaved()
    } catch (e: any) {
      setSavedMsg(`Error: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ──
  async function deleteDesc(id: string) {
    setDeletingId(id)
    try {
      await fetch(`/api/marketing/web-descriptions/${id}`, { method: "DELETE" })
      setSaved(prev => prev.filter(d => d.id !== id))
    } catch {}
    finally { setDeletingId(null) }
  }

  // ── Copy ──
  function copy() {
    if (!generated) return
    navigator.clipboard.writeText(generated).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-1 min-h-0 gap-0">

        {/* ── Left panel — generator ── */}
        <div className="w-1/2 border-r border-gray-800 flex flex-col min-h-0 overflow-y-auto p-6 gap-5">

          <div>
            <h2 className="text-base font-bold text-white mb-1">Web Description Generator</h2>
            <p className="text-xs text-gray-400">
              Select an auction and generate a unique, SEO-friendly description of its contents.
            </p>
          </div>

          {/* Auction search + picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Select Auction
            </label>
            <input
              type="text"
              placeholder="Search by code or name..."
              value={auctionSearch}
              onChange={e => setAuctionSearch(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-pink-500 mb-2"
            />
            <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-700 divide-y divide-gray-800">
              {loadingAuctions ? (
                <div className="px-4 py-6 text-center text-gray-500 text-xs">Loading auctions…</div>
              ) : filteredAuctions.length === 0 ? (
                <div className="px-4 py-6 text-center text-gray-500 text-xs">No auctions found.</div>
              ) : filteredAuctions.map(a => (
                <button
                  key={a.id}
                  onClick={() => { setSelectedId(a.id); setGenerated(null); setGenError(null); setSavedMsg(null) }}
                  className={`w-full text-left px-4 py-2.5 transition-colors text-sm flex justify-between items-center ${
                    selectedId === a.id
                      ? "bg-pink-900/40 text-pink-300"
                      : "hover:bg-gray-800 text-gray-300"
                  }`}
                >
                  <span>
                    <span className="font-mono font-semibold text-white mr-2">{a.code}</span>
                    <span className="text-gray-400">{a.name}</span>
                  </span>
                  <span className="text-xs text-gray-600 ml-2 shrink-0">{a.lotCount} lots</span>
                </button>
              ))}
            </div>
          </div>

          {/* Model selector */}
          {modelList.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                AI Model
              </label>
              <select
                value={modelId}
                onChange={e => setModelId(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                {modelList.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={generate}
            disabled={!selectedId || generating}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all bg-pink-600 hover:bg-pink-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <span className="animate-spin text-lg">⟳</span>
                Generating…
              </>
            ) : (
              "✨ Generate Description"
            )}
          </button>

          {/* Error */}
          {genError && (
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-sm text-red-300">
              {genError}
            </div>
          )}

          {/* Generated output */}
          {generated && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex flex-col gap-3">
              <p className="text-sm text-gray-200 leading-relaxed">{generated}</p>

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={copy}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                >
                  {copied ? "✓ Copied!" : "Copy"}
                </button>
                <button
                  onClick={generate}
                  disabled={generating}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-gray-700 hover:bg-gray-600 text-white transition-colors disabled:opacity-40"
                >
                  ⟳ Regenerate
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-pink-600 hover:bg-pink-500 text-white transition-colors disabled:opacity-40 ml-auto"
                >
                  {saving ? "Saving…" : "💾 Save"}
                </button>
              </div>

              {savedMsg && (
                <p className={`text-xs font-semibold ${savedMsg.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>
                  {savedMsg}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Right panel — saved descriptions ── */}
        <div className="w-1/2 flex flex-col min-h-0 overflow-y-auto p-6 gap-4">
          <div>
            <h2 className="text-base font-bold text-white mb-1">Saved Descriptions</h2>
            <p className="text-xs text-gray-400">One description per auction — saving again will overwrite.</p>
          </div>

          {loadingSaved ? (
            <div className="text-center text-gray-500 text-sm py-10">Loading…</div>
          ) : saved.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <span className="text-4xl mb-3">📝</span>
              <p className="text-sm font-medium">No descriptions saved yet.</p>
              <p className="text-xs mt-1">Generate and save one to see it here.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {saved.map(d => (
                <div key={d.id} className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="font-mono font-bold text-pink-400 text-xs mr-2">{d.auctionCode}</span>
                      <span className="text-white text-sm font-semibold">{d.auctionName}</span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(d.description)
                        }}
                        title="Copy"
                        className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                      >
                        Copy
                      </button>
                      <button
                        onClick={() => {
                          setSelectedId(d.auctionId)
                          setAuctionSearch("")
                          setGenerated(d.description)
                          setGenError(null)
                          setSavedMsg(null)
                          window.scrollTo({ top: 0, behavior: "smooth" })
                        }}
                        title="Load into generator"
                        className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteDesc(d.id)}
                        disabled={deletingId === d.id}
                        title="Delete"
                        className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-800/60 text-red-400 transition-colors disabled:opacity-40"
                      >
                        {deletingId === d.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-gray-300 leading-relaxed">{d.description}</p>

                  <p className="text-xs text-gray-600">
                    Saved {new Date(d.updatedAt).toLocaleDateString("en-GB", {
                      day: "numeric", month: "short", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
