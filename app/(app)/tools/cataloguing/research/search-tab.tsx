"use client"

// Research → Search. The original quick-launch screen, unchanged in behaviour:
// type a query, open it on one of the research sites in a new tab so the
// cataloguing screen stays put.

import { useEffect, useRef, useState } from "react"

const SITES = [
  { label: "Google",      icon: "🔍", url: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { label: "eBay",        icon: "🛒", url: (q: string) => `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(q)}` },
  { label: "WorthPoint",  icon: "💰", url: (q: string) => `https://www.worthpoint.com/worthopedia/${encodeURIComponent(q.replace(/\s+/g, "-"))}` },
  { label: "Catawiki",    icon: "🏷",  url: (q: string) => `https://www.catawiki.com/en/l?q=${encodeURIComponent(q)}` },
  { label: "Vectis",      icon: "📋", url: (q: string) => `https://www.vectis.co.uk/search?query=${encodeURIComponent(q)}` },
  { label: "Wikipedia",   icon: "📖", url: (q: string) => `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}` },
]

export default function SearchTab() {
  const [query, setQuery] = useState("")
  const [recent, setRecent] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("vectis_research_recent") ?? "[]")
      setRecent(Array.isArray(stored) ? stored.slice(0, 8) : [])
    } catch {}
    inputRef.current?.focus()
  }, [])

  function saveRecent(q: string) {
    try {
      const updated = [q, ...recent.filter(r => r !== q)].slice(0, 8)
      setRecent(updated)
      localStorage.setItem("vectis_research_recent", JSON.stringify(updated))
    } catch {}
  }

  function open(url: string, q: string) {
    if (!q.trim()) return
    saveRecent(q.trim())
    window.open(url, "_blank", "noopener")
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && query.trim()) {
      open(SITES[0].url(query.trim()), query.trim())
    }
  }

  return (
    <div className="flex flex-col items-center">
      <p className="text-sm text-gray-500 mb-6">Search opens in a new tab so you can keep cataloguing</p>

      {/* Search bar */}
      <div className="w-full max-w-xl mb-6">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search for an item…"
            className="flex-1 bg-[#2C2C2E] border border-gray-700 rounded-xl px-5 py-3.5 text-base text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
          />
          <button
            onClick={() => open(SITES[0].url(query.trim()), query.trim())}
            disabled={!query.trim()}
            className="px-5 py-3.5 rounded-xl font-semibold text-base transition-colors disabled:opacity-40"
            style={{ background: "#2AB4A6", color: "#1C1C1E" }}
          >
            Search
          </button>
        </div>
      </div>

      {/* Site buttons */}
      <div className="w-full max-w-xl mb-10">
        <p className="text-xs text-gray-600 uppercase tracking-wider mb-3">Open in…</p>
        <div className="flex flex-wrap gap-2">
          {SITES.map(site => (
            <button
              key={site.label}
              onClick={() => open(site.url(query.trim()), query.trim())}
              disabled={!query.trim()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors disabled:opacity-30"
              style={{
                background: "#1C1C1E",
                borderColor: "#374151",
                color: "#d1d5db",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#2AB4A6"; (e.currentTarget as HTMLButtonElement).style.color = "#2AB4A6" }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#374151"; (e.currentTarget as HTMLButtonElement).style.color = "#d1d5db" }}
            >
              <span>{site.icon}</span>
              {site.label}
            </button>
          ))}
        </div>
      </div>

      {/* Recent searches */}
      {recent.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="text-xs text-gray-600 uppercase tracking-wider mb-3">Recent searches</p>
          <div className="flex flex-col gap-1">
            {recent.map(r => (
              <button
                key={r}
                onClick={() => { setQuery(r); inputRef.current?.focus() }}
                className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-left text-sm text-gray-400 hover:bg-[#2C2C2E] hover:text-white transition-colors"
              >
                <span className="text-gray-600 text-xs">🕐</span>
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
