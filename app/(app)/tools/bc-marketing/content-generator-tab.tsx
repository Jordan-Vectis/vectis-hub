"use client"

import { useState, useEffect } from "react"
import { Lot, Sale, CONTENT_TYPES, CONTENT_GROUPS, MONTHS, YEARS, fmt, htmlToPlain } from "./types"

export default function ContentGeneratorTab() {
  // Filters
  const [keyword,     setKeyword]     = useState("")
  const [category,    setCategory]    = useState("")
  const [subcategory, setSubcategory] = useState("")
  const [month,       setMonth]       = useState("")
  const [year,        setYear]        = useState("")
  const [topN,        setTopN]        = useState<number | "all">(10)
  const [mode,        setMode]        = useState<"sold" | "upcoming">("sold")
  const [contentType, setContentType] = useState("sale_highlight")
  const [length,      setLength]      = useState<"short" | "medium" | "long" | "max">("medium")

  const [categories, setCategories]       = useState<string[]>([])
  const [subcatsByCategory, setSubcatsByCategory] = useState<Record<string, string[]>>({})
  const [allSubcats, setAllSubcats]       = useState<string[]>([])
  const [allSales,   setAllSales]          = useState<Sale[]>([])
  const [selectedSales, setSelectedSales]  = useState<string[]>([])  // array of auctionCodes
  const [salesPickerOpen, setSalesPickerOpen] = useState(false)
  const [salesSearch, setSalesSearch]      = useState("")
  const [modelList, setModelList]   = useState<string[]>(["gemini-2.5-flash-preview-04-17"])
  const [modelId,   setModelId]     = useState("gemini-2.5-flash-preview-04-17")

  const [loadingLots,    setLoadingLots]    = useState(false)
  const [lotsError,      setLotsError]      = useState<string | null>(null)
  const [lots,           setLots]           = useState<Lot[] | null>(null)

  const [loadingArticle, setLoadingArticle] = useState(false)
  const [articleError,   setArticleError]   = useState<string | null>(null)
  const [article,        setArticle]        = useState<string | null>(null)

  const [copied,    setCopied]    = useState<"plain" | "html" | null>(null)
  const [savingMsg, setSavingMsg] = useState<string | null>(null)
  const [saveTitle, setSaveTitle] = useState("")

  const [savedDefault, setSavedDefault] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/marketing/categories").then(r => r.json()).then(d => {
      if (d.categories) setCategories(d.categories)
      if (d.subcategoriesByCategory) setSubcatsByCategory(d.subcategoriesByCategory)
      if (d.allSubcategories) setAllSubcats(d.allSubcategories)
    }).catch(() => {})
    fetch("/api/marketing/sales").then(r => r.json()).then(d => { if (d.sales) setAllSales(d.sales) }).catch(() => {})
    fetch("/api/auction-ai/models").then(r => r.json()).then(d => {
      if (d.models?.length) {
        setModelList(d.models)
        // Honour saved default if it's still in the available list, otherwise use first
        const saved = typeof window !== "undefined" ? localStorage.getItem("bc_marketing_default_model") : null
        setSavedDefault(saved)
        setModelId(saved && d.models.includes(saved) ? saved : d.models[0])
      }
    }).catch(() => {})
  }, [])

  // Seed the picker from the admin-configured default for this slot,
  // but only when the user hasn't already saved a per-user choice.
  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("bc_marketing_default_model")) return
    fetch("/api/ai-tool-model?slot=marketing_article").then(r => r.json()).then(j => { if (j?.model) setModelId(j.model) }).catch(() => {})
  }, [])

  function setAsDefault() {
    localStorage.setItem("bc_marketing_default_model", modelId)
    setSavedDefault(modelId)
  }
  function clearDefault() {
    localStorage.removeItem("bc_marketing_default_model")
    setSavedDefault(null)
  }

  // Auto-switch mode when contentType changes to preview_teaser
  useEffect(() => {
    if (contentType === "preview_teaser") setMode("upcoming")
    else if (mode === "upcoming") setMode("sold")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentType])

  async function findLots() {
    setLoadingLots(true)
    setLotsError(null)
    setLots(null)
    setArticle(null)

    const params = new URLSearchParams()
    if (keyword)       params.set("keyword",  keyword.trim())
    if (category)      params.set("category", category)
    if (subcategory)   params.set("subcategory", subcategory)
    if (month && year) params.set("month",    `${year}-${month}`)
    else if (year)     params.set("year",     year)   // year-only filter
    else if (month)    params.set("month",    month)  // month-only (current year)
    if (selectedSales.length > 0) params.set("auctionCodes", selectedSales.join(","))
    params.set("mode", mode)
    params.set("topN", topN === "all" ? "all" : String(topN))

    try {
      const res  = await fetch(`/api/marketing/lots?${params}`)
      const data = await res.json()
      if (!res.ok) { setLotsError(data.error ?? "Failed to load lots"); return }
      setLots(data.lots)
    } catch {
      setLotsError("Network error — please try again")
    } finally {
      setLoadingLots(false)
    }
  }

  async function generateArticle() {
    if (!lots?.length) return
    setLoadingArticle(true)
    setArticleError(null)
    setArticle(null)

    try {
      const res  = await fetch("/api/marketing/article", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ lots, articleType: contentType, modelId, length }),
      })
      const data = await res.json()
      if (!res.ok) { setArticleError(data.error ?? "Failed to generate"); return }
      setArticle(data.article)
      // Pre-fill save title
      const typeLabel = CONTENT_TYPES.find(t => t.value === contentType)?.label ?? "Untitled"
      setSaveTitle(`${typeLabel} — ${new Date().toLocaleDateString("en-GB")}`)
    } catch {
      setArticleError("Network error — please try again")
    } finally {
      setLoadingArticle(false)
    }
  }

  async function copyAs(modeArg: "plain" | "html") {
    if (!article) return
    const text = modeArg === "plain" ? htmlToPlain(article) : article
    await navigator.clipboard.writeText(text)
    setCopied(modeArg)
    setTimeout(() => setCopied(null), 2000)
  }

  async function saveDraft() {
    if (!article || !saveTitle.trim()) return
    setSavingMsg(null)
    try {
      const res = await fetch("/api/marketing/drafts", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          title:        saveTitle.trim(),
          contentType,
          content:      article,
          lotsSnapshot: lots,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setSavingMsg("✓ Saved to drafts")
        setTimeout(() => setSavingMsg(null), 3000)
      } else {
        setSavingMsg(data.error ?? "Failed to save")
      }
    } catch {
      setSavingMsg("Network error")
    }
  }

  const selectedType = CONTENT_TYPES.find(t => t.value === contentType)

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">

      {/* ── Content type picker ──────────────────────────────────────────── */}
      <div className="bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl p-5 space-y-4">
        <h2 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">What do you want to generate?</h2>
        <div className="space-y-3">
          {CONTENT_GROUPS.map(group => (
            <div key={group}>
              <p className="text-[10px] font-bold text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-1.5">{group}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {CONTENT_TYPES.filter(t => t.group === group).map(t => (
                  <button
                    key={t.value}
                    onClick={() => setContentType(t.value)}
                    className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                      contentType === t.value
                        ? "border-pink-500 bg-pink-900/30 text-pink-200"
                        : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <div className="font-semibold">{t.label}</div>
                    <div className="text-[10px] text-gray-600 dark:text-gray-500 mt-0.5">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl p-5 space-y-4">
        <h2 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Filters</h2>

        {/* Mode — Sold vs Upcoming */}
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5">Lot status</label>
          <div className="inline-flex gap-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-0.5">
            <button
              onClick={() => setMode("sold")}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                mode === "sold" ? "bg-pink-600 text-gray-900 dark:text-white font-semibold" : "text-gray-600 dark:text-gray-400 hover:text-white"
              }`}
            >🔨 Sold lots</button>
            <button
              onClick={() => setMode("upcoming")}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                mode === "upcoming" ? "bg-pink-600 text-gray-900 dark:text-white font-semibold" : "text-gray-600 dark:text-gray-400 hover:text-white"
              }`}
            >📅 Upcoming lots</button>
          </div>
          <p className="text-[11px] text-gray-600 dark:text-gray-500 mt-1.5">
            {mode === "sold"
              ? "Lots with a hammer price — use for sale highlights, market reports, year-in-review."
              : "Lots not yet sold (pre-sale) — use for sale previews, teaser articles, social posts before an auction."}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Keyword</label>
            <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && findLots()}
              placeholder="e.g. Star Wars, Batman…"
              className="w-full bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-pink-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Category</label>
            <select value={category} onChange={e => {
                const newCat = e.target.value
                setCategory(newCat)
                // Drop the sub-category if it no longer belongs to the chosen category
                const allowed = newCat ? (subcatsByCategory[newCat] ?? []) : allSubcats
                if (subcategory && !allowed.includes(subcategory)) setSubcategory("")
              }}
              className="w-full bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500">
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Sub-category</label>
            {(() => {
              const subOptions = category ? (subcatsByCategory[category] ?? []) : allSubcats
              return (
                <select value={subcategory} onChange={e => setSubcategory(e.target.value)}
                  disabled={subOptions.length === 0}
                  className="w-full bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500 disabled:opacity-50">
                  <option value="">All sub-categories</option>
                  {subOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )
            })()}
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Month / Year</label>
            <div className="flex gap-2">
              <select value={month} onChange={e => setMonth(e.target.value)}
                className="flex-1 bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-2 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500">
                <option value="">Any</option>
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <select value={year} onChange={e => setYear(e.target.value)}
                className="w-24 bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-2 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500">
                <option value="">Any</option>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
              Limit (sorted by {mode === "upcoming" ? "estimate" : "hammer price"})
            </label>
            <select
              value={String(topN)}
              onChange={e => setTopN(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="w-full bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500"
            >
              {[5, 10, 15, 20, 25, 50, 100, 250].map(n => <option key={n} value={n}>Top {n}</option>)}
              <option value="all">Show all (no limit)</option>
            </select>
          </div>
        </div>

        {/* Specific sales picker */}
        <div>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5">Specific sales (optional — leave empty to search across all)</label>
          <div className="relative">
            <button
              onClick={() => setSalesPickerOpen(o => !o)}
              type="button"
              className="w-full text-left bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white hover:border-gray-500 focus:outline-none focus:border-pink-500 flex items-center justify-between gap-2"
            >
              <span className="truncate">
                {selectedSales.length === 0
                  ? <span className="text-gray-600 dark:text-gray-500">All sales</span>
                  : `${selectedSales.length} sale${selectedSales.length === 1 ? "" : "s"} selected`
                }
              </span>
              <span className="text-gray-600 dark:text-gray-500 text-xs shrink-0">{salesPickerOpen ? "▲" : "▼"}</span>
            </button>

            {salesPickerOpen && (
              <div className="absolute z-20 mt-1 w-full bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-2xl max-h-96 overflow-hidden flex flex-col">
                <div className="p-2 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
                  <input
                    type="text"
                    value={salesSearch}
                    onChange={e => setSalesSearch(e.target.value)}
                    placeholder="Filter by name, code or date…"
                    className="flex-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5 text-xs text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-pink-500"
                    autoFocus
                  />
                  {selectedSales.length > 0 && (
                    <button
                      onClick={() => setSelectedSales([])}
                      className="text-xs text-gray-600 dark:text-gray-400 hover:text-pink-400 px-2 py-1"
                    >Clear</button>
                  )}
                  <button
                    onClick={() => setSalesPickerOpen(false)}
                    className="text-xs text-gray-600 dark:text-gray-400 hover:text-white px-2 py-1"
                  >Done</button>
                </div>

                <div className="overflow-y-auto flex-1">
                  {(() => {
                    const q = salesSearch.toLowerCase().trim()
                    const filtered = q
                      ? allSales.filter(s =>
                          s.auctionName.toLowerCase().includes(q) ||
                          s.auctionCode.toLowerCase().includes(q) ||
                          s.auctionDate.toLowerCase().includes(q)
                        )
                      : allSales
                    if (filtered.length === 0) {
                      return <p className="text-xs text-gray-600 dark:text-gray-500 p-3">No sales match.</p>
                    }
                    return filtered.slice(0, 200).map(s => {
                      const checked = selectedSales.includes(s.auctionCode)
                      return (
                        <label key={s.auctionCode}
                          className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 ${checked ? "bg-white dark:bg-gray-800/50" : ""}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedSales(prev =>
                                prev.includes(s.auctionCode)
                                  ? prev.filter(c => c !== s.auctionCode)
                                  : [...prev, s.auctionCode]
                              )
                            }}
                            className="accent-pink-500"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-gray-700 dark:text-gray-200 truncate">{s.auctionName || <span className="text-gray-600 dark:text-gray-500 italic">No name</span>}</div>
                            <div className="text-[11px] text-gray-600 dark:text-gray-500">
                              {s.auctionDate
                                ? new Date(s.auctionDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                                : "—"}
                              <span className="ml-2 font-mono text-gray-600">{s.auctionCode}</span>
                            </div>
                          </div>
                        </label>
                      )
                    })
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Selected sale chips */}
          {selectedSales.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {selectedSales.map(code => {
                const s = allSales.find(x => x.auctionCode === code)
                const label = s?.auctionName || code
                return (
                  <span key={code} className="inline-flex items-center gap-1.5 bg-pink-900/40 border border-pink-800 text-pink-200 text-xs px-2 py-1 rounded-md">
                    <span className="truncate max-w-[200px]">{label}</span>
                    <button
                      onClick={() => setSelectedSales(prev => prev.filter(c => c !== code))}
                      className="text-pink-400 hover:text-white"
                      aria-label="Remove"
                    >×</button>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        <button onClick={findLots} disabled={loadingLots}
          className="bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-gray-900 dark:text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
          {loadingLots ? "Searching…" : "Find Lots"}
        </button>
      </div>

      {lotsError && (
        <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-red-700 dark:text-red-300 text-sm">{lotsError}</div>
      )}

      {/* ── Lots Table ───────────────────────────────────────────────────── */}
      {lots !== null && (
        <div className="bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-300 dark:border-gray-700 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">
              {lots.length === 0 ? "No lots found" : `${lots.length} lot${lots.length === 1 ? "" : "s"} found`}
            </span>
            {lots.length > 0 && (
              <span className="text-xs text-gray-600 dark:text-gray-500">
                Sorted by {mode === "upcoming" ? "estimate" : "hammer price"} (highest first)
              </span>
            )}
          </div>

          {lots.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 dark:text-gray-400 text-xs border-b border-gray-200 dark:border-gray-800">
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Lot</th>
                    <th className="px-4 py-2 font-medium">Description</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 font-medium">Sub-category</th>
                    <th className="px-4 py-2 font-medium">Estimate</th>
                    <th className="px-4 py-2 font-medium">{mode === "upcoming" ? "—" : "Hammer"}</th>
                    <th className="px-4 py-2 font-medium">Sale</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((lot, i) => (
                    <tr key={lot.uniqueId} className="border-b border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-500">{i + 1}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{lot.currentLotNo ?? lot.lotNo ?? lot.uniqueId}</td>
                      <td className="px-4 py-2 text-gray-700 dark:text-gray-200 max-w-xs truncate">{lot.description ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{lot.category ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{lot.subcategory ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {lot.lowEstimate && lot.highEstimate ? `${fmt(lot.lowEstimate)}–${fmt(lot.highEstimate)}` : "—"}
                      </td>
                      <td className="px-4 py-2 font-semibold text-green-400 whitespace-nowrap">{lot.hammerPrice ? fmt(lot.hammerPrice) : "—"}</td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">
                        <div className="text-gray-600 dark:text-gray-300">{lot.auctionName ?? lot.auctionCode ?? "—"}</div>
                        {lot.auctionDate && (
                          <div className="text-gray-600 dark:text-gray-500 text-[11px] mt-0.5">
                            {new Date(lot.auctionDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                            {lot.auctionCode && lot.auctionName && <span className="ml-1.5 text-gray-600">· {lot.auctionCode}</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Generate ─────────────────────────────────────────────────────── */}
      {lots !== null && lots.length > 0 && (
        <div className="bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Length selector */}
            <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-600 rounded-lg p-0.5">
              {(["short", "medium", "long", "max"] as const).map(l => (
                <button
                  key={l}
                  onClick={() => setLength(l)}
                  className={`px-3 py-1.5 text-xs rounded transition-colors capitalize ${
                    length === l ? "bg-pink-600 text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400 hover:text-white"
                  }`}
                  title={
                    l === "short"  ? "Concise — about half the default length" :
                    l === "medium" ? "Default — the type's standard word range" :
                    l === "long"   ? "Detailed — about 1.5–2× the default" :
                                     "Maximum — as long as the model will write"
                  }
                >
                  {l}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <select value={modelId} onChange={e => setModelId(e.target.value)}
                className="bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-pink-500">
                {modelList.map(m => <option key={m} value={m}>{m}{savedDefault === m ? " ★" : ""}</option>)}
              </select>
              {savedDefault === modelId ? (
                <button
                  onClick={clearDefault}
                  title="Clear default — will use first model in list next time"
                  className="text-xs text-amber-400 hover:text-amber-300 px-2 py-1 rounded transition-colors"
                >
                  ★ Default · clear
                </button>
              ) : (
                <button
                  onClick={setAsDefault}
                  title="Use this model by default whenever you load the page"
                  className="text-xs text-gray-600 dark:text-gray-400 hover:text-pink-400 px-2 py-1 rounded transition-colors"
                >
                  Set as default
                </button>
              )}
            </div>
            <button onClick={generateArticle} disabled={loadingArticle}
              className="bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-gray-900 dark:text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
              {loadingArticle ? "Generating…" : `Generate ${selectedType?.label ?? ""}`}
            </button>
          </div>
          {articleError && (
            <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-red-700 dark:text-red-300 text-sm">{articleError}</div>
          )}
        </div>
      )}

      {/* ── Output ───────────────────────────────────────────────────────── */}
      {article && (
        <div className="bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-300 dark:border-gray-700 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">{selectedType?.label}</span>
            <div className="flex gap-2">
              <button onClick={() => copyAs("plain")} className="text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg">{copied === "plain" ? "✓ Copied!" : "Copy as Plain Text"}</button>
              <button onClick={() => copyAs("html")} className="text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg">{copied === "html" ? "✓ Copied!" : "Copy as HTML"}</button>
              <button onClick={generateArticle} disabled={loadingArticle} className="text-xs bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-gray-900 dark:text-white px-3 py-1.5 rounded-lg">Regenerate</button>
            </div>
          </div>

          {/* Save panel */}
          <div className="px-5 py-3 border-b border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800/40 flex items-center gap-3 flex-wrap">
            <input type="text" value={saveTitle} onChange={e => setSaveTitle(e.target.value)}
              placeholder="Title for saved draft"
              className="flex-1 min-w-[200px] bg-white dark:bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-pink-500" />
            <button onClick={saveDraft} disabled={!saveTitle.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-gray-900 dark:text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
              💾 Save to Drafts
            </button>
            {savingMsg && <span className="text-xs text-emerald-400">{savingMsg}</span>}
          </div>

          <div
            className="p-6 prose prose-invert prose-sm max-w-none text-gray-700 dark:text-gray-200 leading-relaxed
              [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-white [&_h1]:mb-3
              [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-5 [&_h2]:mb-2
              [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-200 [&_h3]:mt-4 [&_h3]:mb-1
              [&_p]:mb-4 [&_ul]:mb-4 [&_ol]:mb-4 [&_li]:mb-1 [&_strong]:text-white"
            dangerouslySetInnerHTML={{ __html: article }}
          />
        </div>
      )}
    </div>
  )
}
