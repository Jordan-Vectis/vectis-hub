"use client"

// Admin Centre shell. Three tabs, all aimed at non-technical admins:
//   • Find a customer's lots — the original cross-system receipt/tote/customer lookup
//   • Who catalogued this lot? — one barcode in, one name out
//   • Who catalogued this sale? — BC's lot numbers with the Hub's cataloguer against each
//
// Deliberately full-width with large type and large hit targets; the house
// 11px-table style is too small for the people using this.

import { useState } from "react"
import Link from "next/link"
import FindLotsTab from "./find-lots-tab"
import WhoCataloguedTab from "./who-catalogued-tab"
import BySaleTab from "./by-sale-tab"

type Tab = "find" | "who" | "sale"

const TABS: { key: Tab; icon: string; label: string; blurb: string }[] = [
  { key: "find", icon: "🔎", label: "Find a customer's lots", blurb: "By receipt, tote or customer number" },
  { key: "who",  icon: "👤", label: "Who catalogued this lot?", blurb: "By barcode or unique ID" },
  { key: "sale", icon: "🔨", label: "Who catalogued this sale?", blurb: "By sale, listed by BC lot number" },
]

export default function LookupClient() {
  const [tab, setTab] = useState<Tab>("find")

  return (
    <div className="px-6 py-8 max-w-[1800px] mx-auto">
      <Link href="/hub" className="inline-block text-base text-gray-500 hover:text-indigo-500 mb-3">← Back to the Hub</Link>

      <h1 className="text-4xl font-bold text-gray-900 dark:text-white">🎛️ Admin Centre</h1>
      <p className="text-lg text-gray-600 dark:text-gray-400 mt-2 mb-8 max-w-4xl">
        Look up any lot across both systems — the Hub cataloguing tool and Business Central — to see what has been
        catalogued, who catalogued it, and which sale it is in.
      </p>

      {/* Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8 max-w-5xl">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`flex items-center gap-4 text-left px-6 py-5 rounded-2xl border-2 transition ${
              tab === t.key
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 shadow-sm"
                : "border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] hover:border-gray-300 dark:hover:border-gray-700"
            }`}
          >
            <span className="text-3xl leading-none">{t.icon}</span>
            <span className="min-w-0">
              <span className={`block text-lg font-bold ${tab === t.key ? "text-indigo-700 dark:text-indigo-300" : "text-gray-900 dark:text-white"}`}>
                {t.label}
              </span>
              <span className="block text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t.blurb}</span>
            </span>
          </button>
        ))}
      </div>

      {tab === "find" ? <FindLotsTab /> : tab === "who" ? <WhoCataloguedTab /> : <BySaleTab />}
    </div>
  )
}
