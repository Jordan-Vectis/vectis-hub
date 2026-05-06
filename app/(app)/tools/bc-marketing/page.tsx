"use client"

import { useState, useEffect } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

type Lot = {
  uniqueId:     string
  lotNo:        string | null
  description:  string | null
  category:     string | null
  hammerPrice:  number | null
  lowEstimate:  number | null
  highEstimate: number | null
  auctionCode:  string | null
  auctionName:  string | null
  auctionDate:  string | null
}

const ARTICLE_TYPES = [
  { value: "sale_highlight",   label: "Sale Highlight",    desc: "Top results from a sale" },
  { value: "news_story",       label: "News Story",        desc: "Vectis editorial style" },
  { value: "collectors_guide", label: "Collector's Guide", desc: "Guide for enthusiasts" },
  { value: "market_report",    label: "Market Report",     desc: "Trends & price analysis" },
]

const MONTHS = [
  { value: "01", label: "January" },   { value: "02", label: "February" },
  { value: "03", label: "March" },     { value: "04", label: "April" },
  { value: "05", label: "May" },       { value: "06", label: "June" },
  { value: "07", label: "July" },      { value: "08", label: "August" },
  { value: "09", label: "September" }, { value: "10", label: "October" },
  { value: "11", label: "November" },  { value: "12", label: "December" },
]

const THIS_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => String(THIS_YEAR - i))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null) {
  if (n == null) return "—"
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 0 })
}

function htmlToPlain(html: string) {
  return html
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "$1\n\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "$1")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "$1")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// ─── Article Generator Tab ────────────────────────────────────────────────────

function ArticleGeneratorTab() {
  // Filters
  const [keyword,     setKeyword]     = useState("")
  const [category,    setCategory]    = useState("")
  const [month,       setMonth]       = useState("")
  const [year,        setYear]        = useState("")
  const [topN,        setTopN]        = useState(10)
  const [articleType, setArticleType] = useState("sale_highlight")

  // Categories dropdown
  const [categories, setCategories] = useState<string[]>([])

  // State
  const [loadingLots,    setLoadingLots]    = useState(false)
  const [lotsError,      setLotsError]      = useState<string | null>(null)
  const [lots,           setLots]           = useState<Lot[] | null>(null)

  const [loadingArticle, setLoadingArticle] = useState(false)
  const [articleError,   setArticleError]   = useState<string | null>(null)
  const [article,        setArticle]        = useState<string | null>(null)

  const [copied, setCopied] = useState<"plain" | "html" | null>(null)

  // Load categories on mount
  useEffect(() => {
    fetch("/api/marketing/categories")
      .then(r => r.json())
      .then(d => { if (d.categories) setCategories(d.categories) })
      .catch(() => {})
  }, [])

  async function findLots() {
    setLoadingLots(true)
    setLotsError(null)
    setLots(null)
    setArticle(null)

    const params = new URLSearchParams()
    if (keyword)       params.set("keyword",  keyword.trim())
    if (category)      params.set("category", category)
    if (month && year) params.set("month",    `${year}-${month}`)
    params.set("topN", String(topN))

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
        body:    JSON.stringify({ lots, articleType }),
      })
      const data = await res.json()
      if (!res.ok) { setArticleError(data.error ?? "Failed to generate article"); return }
      setArticle(data.article)
    } catch {
      setArticleError("Network error — please try again")
    } finally {
      setLoadingArticle(false)
    }
  }

  async function copyAs(mode: "plain" | "html") {
    if (!article) return
    const text = mode === "plain" ? htmlToPlain(article) : article
    await navigator.clipboard.writeText(text)
    setCopied(mode)
    setTimeout(() => setCopied(null), 2000)
  }

  const selectedType = ARTICLE_TYPES.find(t => t.value === articleType)

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">

      {/* ── Filter Panel ────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Filters</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Keyword */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Keyword</label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && findLots()}
              placeholder="e.g. Star Wars, Batman…"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-pink-500"
            />
          </div>

          {/* Category dropdown */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-pink-500"
            >
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Month / Year */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Month / Year</label>
            <div className="flex gap-2">
              <select
                value={month}
                onChange={e => setMonth(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-pink-500"
              >
                <option value="">Any</option>
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <select
                value={year}
                onChange={e => setYear(e.target.value)}
                className="w-24 bg-gray-800 border border-gray-600 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-pink-500"
              >
                <option value="">Any</option>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {/* Top N */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Top N by hammer price</label>
            <select
              value={topN}
              onChange={e => setTopN(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-pink-500"
            >
              {[5, 10, 15, 20, 25, 50].map(n => <option key={n} value={n}>Top {n}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={findLots}
          disabled={loadingLots}
          className="bg-pink-600 hover:bg-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
        >
          {loadingLots ? "Searching…" : "Find Lots"}
        </button>
      </div>

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {lotsError && (
        <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-sm">
          {lotsError}
        </div>
      )}

      {/* ── Lots Table ───────────────────────────────────────────────────── */}
      {lots !== null && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-700 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-300">
              {lots.length === 0 ? "No lots found" : `${lots.length} lot${lots.length === 1 ? "" : "s"} found`}
            </span>
            {lots.length > 0 && (
              <span className="text-xs text-gray-500">Sorted by hammer price (highest first)</span>
            )}
          </div>

          {lots.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 text-xs border-b border-gray-800">
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Lot</th>
                    <th className="px-4 py-2 font-medium">Description</th>
                    <th className="px-4 py-2 font-medium">Category</th>
                    <th className="px-4 py-2 font-medium">Estimate</th>
                    <th className="px-4 py-2 font-medium">Hammer</th>
                    <th className="px-4 py-2 font-medium">Sale</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((lot, i) => (
                    <tr key={lot.uniqueId} className="border-b border-gray-800 hover:bg-gray-800/50">
                      <td className="px-4 py-2 text-gray-500">{i + 1}</td>
                      <td className="px-4 py-2 text-gray-300 whitespace-nowrap">{lot.lotNo ?? lot.uniqueId}</td>
                      <td className="px-4 py-2 text-gray-200 max-w-xs truncate">{lot.description ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-400">{lot.category ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                        {lot.lowEstimate && lot.highEstimate
                          ? `${fmt(lot.lowEstimate)}–${fmt(lot.highEstimate)}`
                          : "—"}
                      </td>
                      <td className="px-4 py-2 font-semibold text-green-400 whitespace-nowrap">
                        {fmt(lot.hammerPrice)}
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                        {lot.auctionName ?? lot.auctionCode ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Article Type + Generate ──────────────────────────────────────── */}
      {lots !== null && lots.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Generate Article</h2>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {ARTICLE_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setArticleType(t.value)}
                className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                  articleType === t.value
                    ? "border-pink-500 bg-pink-900/30 text-pink-300"
                    : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500"
                }`}
              >
                <div className="font-semibold text-sm">{t.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{t.desc}</div>
              </button>
            ))}
          </div>

          <button
            onClick={generateArticle}
            disabled={loadingArticle}
            className="bg-pink-600 hover:bg-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
          >
            {loadingArticle ? "Generating…" : `Generate ${selectedType?.label ?? "Article"}`}
          </button>

          {articleError && (
            <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-sm">
              {articleError}
            </div>
          )}
        </div>
      )}

      {/* ── Article Output ───────────────────────────────────────────────── */}
      {article && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-700 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-300">Generated Article</span>
            <div className="flex gap-2">
              <button
                onClick={() => copyAs("plain")}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                {copied === "plain" ? "✓ Copied!" : "Copy as Plain Text"}
              </button>
              <button
                onClick={() => copyAs("html")}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                {copied === "html" ? "✓ Copied!" : "Copy as HTML"}
              </button>
              <button
                onClick={generateArticle}
                disabled={loadingArticle}
                className="text-xs bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Regenerate
              </button>
            </div>
          </div>
          <div
            className="p-6 prose prose-invert prose-sm max-w-none text-gray-200 leading-relaxed
              [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-white [&_h1]:mb-3
              [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-5 [&_h2]:mb-2
              [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-200 [&_h3]:mt-4 [&_h3]:mb-1
              [&_p]:mb-4 [&_ul]:mb-4 [&_li]:mb-1 [&_strong]:text-white"
            dangerouslySetInnerHTML={{ __html: article }}
          />
        </div>
      )}

    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BcMarketingPage() {
  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Tab bar */}
      <div className="flex gap-1 px-4 pt-3 border-b border-gray-800 shrink-0">
        <button className="px-4 py-2 text-sm rounded-t transition-colors bg-gray-800 text-white border-b-2 border-pink-500">
          📰 SEO Article Generator
        </button>
      </div>

      {/* Content */}
      <ArticleGeneratorTab />
    </div>
  )
}
