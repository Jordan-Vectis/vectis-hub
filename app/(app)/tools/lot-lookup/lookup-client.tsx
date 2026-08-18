"use client"

// Admin Centre — ONE page, one place to search, five things you can search by.
//
// Jordan, 2026-08-18: *"I want to combine all the options on this page to be a single page so
// keep the find a customers lots and the 3 options but all the data needs to show up on a single
// page. We also need to be able to search by auction and lot number on the first page. I want to
// make this as simple and idiot proof as possible."* Then, on the sale search:
// *"this needs to be like how it was before with a drop down list of the auctions and then an
// optional lot number box."*
//
// It used to be three tabs, each hiding the other two and each with its own search box — so you
// had to know which tab answered your question before you could ask it. Now: pick what you have
// in your hand, fill in the one thing it asks for, and the answer appears underneath.
//
// ⚠ EACH BUTTON ASKS FOR EXACTLY ONE KIND OF THING. That is the whole design: no box where you
// have to know which of three formats to type. The sale search is a DROPDOWN of real sales from
// BC (so the code is always one that exists) plus an optional lot number; a barcode has its own
// button and its own box.
//
// ⚠ The three tab components still hold all the rendering. They take a `controlled` prop from
// here, which hides their own search card and runs the query this page gives them. Their result
// markup was not touched — it is the part that has been checked against real BC data.
//
// ⚠ Deliberately LARGE type and hit targets (see ui.ts). The people using this are not the ones
// who read 11px tables. Do not compact it.

import { useEffect, useState } from "react"
import Link from "next/link"
import FindLotsTab from "./find-lots-tab"
import WhoCataloguedTab from "./who-catalogued-tab"
import BySaleTab from "./by-sale-tab"
import { CARD, INPUT, BTN_PRIMARY, HINT, formatSaleDate } from "./ui"

type Mode = "receipt" | "tote" | "vendor" | "sale" | "code"
type Sale = { code: string; name: string; date: string; lots: number }

const MODES: { key: Mode; icon: string; label: string; blurb: string }[] = [
  { key: "receipt", icon: "🧾", label: "Receipt number",     blurb: "Everything booked in on one receipt" },
  { key: "tote",    icon: "📦", label: "Tote number",        blurb: "Everything on that tote's receipt" },
  { key: "vendor",  icon: "👤", label: "Customer number",    blurb: "Everything for one customer" },
  { key: "sale",    icon: "🔨", label: "Sale and lot number", blurb: "Pick a sale, then a lot if you want one" },
  { key: "code",    icon: "🏷️", label: "Barcode",            blurb: "One lot, by barcode or unique ID" },
]

const PLACEHOLDER: Partial<Record<Mode, string>> = {
  receipt: "R000009", tote: "T001868", vendor: "C224652", code: "F109400",
}

export default function LookupClient() {
  const [mode, setMode]   = useState<Mode>("receipt")
  const [value, setValue] = useState("")          // the free-text modes
  const [sale, setSale]   = useState("")          // the sale dropdown
  const [lot, setLot]     = useState("")          // optional lot number
  // Bumped on every Search press, so pressing it twice re-runs the same query.
  const [run, setRun] = useState<{ mode: Mode; value: string; sale: string; lot: string; nonce: number } | null>(null)

  // The sale list comes from BC itself, so every code offered is one that actually has lots
  // against it. Loaded once, the first time the sale search is opened.
  const [sales, setSales]         = useState<Sale[]>([])
  const [salesError, setSalesErr] = useState<string | null>(null)
  const [salesLoaded, setLoaded]  = useState(false)
  useEffect(() => {
    if (mode !== "sale" || salesLoaded) return
    let cancelled = false
    ;(async () => {
      try {
        const res  = await fetch("/api/lot-lookup/sale?sales=1")
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? res.statusText)
        if (!cancelled) { setSales(json.sales ?? []); setLoaded(true) }
      } catch (e: any) { if (!cancelled) { setSalesErr(e.message); setLoaded(true) } }
    })()
    return () => { cancelled = true }
  }, [mode, salesLoaded])

  const active = MODES.find(m => m.key === mode)!
  const canGo  = mode === "sale" ? !!sale.trim() : !!value.trim()

  function search() {
    if (!canGo) return
    setRun(prev => ({
      mode, value: value.trim(), sale: sale.trim().toUpperCase(), lot: lot.trim(),
      nonce: (prev?.nonce ?? 0) + 1,
    }))
  }

  function pick(m: Mode) {
    setMode(m)
    setValue(""); setSale(""); setLot("")
  }

  return (
    <div className="px-6 py-8 max-w-[1800px] mx-auto space-y-6">
      <div>
        <Link href="/hub" className="inline-block text-base text-gray-500 hover:text-indigo-500 mb-3">← Back to the Hub</Link>
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">🎛️ Admin Centre</h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 mt-2 max-w-4xl">
          Look up anything across both systems — the Hub cataloguing tool and Business Central — to see what has been
          catalogued, who catalogued it, and which sale it is in.
        </p>
      </div>

      {/* ── The one search ────────────────────────────────────────────────── */}
      <div className={`${CARD} p-6`}>
        <p className="text-lg font-semibold text-gray-900 dark:text-white mb-4">1 · What have you got?</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-6">
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => pick(m.key)}
              aria-pressed={mode === m.key}
              className={`flex items-start gap-3 text-left px-5 py-4 rounded-xl border-2 transition ${
                mode === m.key
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10"
                  : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700"
              }`}
            >
              <span className="text-2xl leading-none">{m.icon}</span>
              <span className="min-w-0">
                <span className={`block text-lg font-semibold ${mode === m.key ? "text-indigo-700 dark:text-indigo-300" : "text-gray-900 dark:text-white"}`}>
                  {m.label}
                </span>
                <span className="block text-sm text-gray-500 dark:text-gray-400 mt-0.5">{m.blurb}</span>
              </span>
            </button>
          ))}
        </div>

        {mode === "sale" ? (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_14rem] gap-5">
              <div>
                <label htmlFor="sale-select" className="block text-lg font-semibold text-gray-900 dark:text-white mb-1">
                  2 · Which sale?
                </label>
                <p className={`${HINT} mb-3`}>Straight from Business Central — newest first.</p>
                <select
                  id="sale-select"
                  value={sales.some(s => s.code === sale) ? sale : ""}
                  onChange={e => setSale(e.target.value)}
                  className={INPUT}
                >
                  <option value="">{salesLoaded ? "Choose a sale…" : "Loading the sales…"}</option>
                  {sales.map(s => (
                    <option key={s.code} value={s.code}>
                      {[s.code, s.name].filter(Boolean).join(" — ")}
                      {formatSaleDate(s.date) ? ` · ${formatSaleDate(s.date)}` : ""}
                      {` · ${s.lots} lots`}
                    </option>
                  ))}
                </select>
                {/* Free-text fallback: a brand-new sale, or one the list didn't load. */}
                <input
                  value={sale}
                  onChange={e => setSale(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") search() }}
                  placeholder="…or type the sale code, e.g. F109"
                  aria-label="Sale code"
                  autoComplete="off"
                  className={`${INPUT} mt-3 sm:max-w-sm`}
                />
              </div>

              <div className="lg:border-l-2 lg:border-gray-100 lg:dark:border-gray-800 lg:pl-5">
                <label htmlFor="lot-number" className="block text-lg font-semibold text-gray-900 dark:text-white mb-1">
                  3 · Lot number
                </label>
                <p className={`${HINT} mb-3`}>Optional. Leave it blank for the whole sale.</p>
                <input
                  id="lot-number"
                  value={lot}
                  onChange={e => setLot(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") search() }}
                  onFocus={e => e.currentTarget.select()}
                  placeholder="400"
                  inputMode="numeric"
                  autoComplete="off"
                  className={`${INPUT} text-2xl`}
                />
              </div>
            </div>
            {salesError && (
              <p className="mt-3 text-base text-amber-700 dark:text-amber-300">
                Couldn&apos;t load the sale list ({salesError}) — type the sale code instead.
              </p>
            )}
            <button onClick={search} disabled={!canGo} className={`${BTN_PRIMARY} mt-5 w-full sm:w-auto`}>
              {lot.trim() ? `Find lot ${lot.trim()}` : sale.trim() ? `Show the whole of ${sale.trim().toUpperCase()}` : "Search"}
            </button>
          </>
        ) : (
          <>
            <label htmlFor="lookup-input" className="block text-lg font-semibold text-gray-900 dark:text-white mb-1">
              2 · Type the {active.label.toLowerCase()}
            </label>
            <p className={`${HINT} mb-4`}>
              For example <span className="font-mono">{PLACEHOLDER[mode]}</span>
              {mode === "vendor" && <> — or type part of a customer&apos;s name to search Business Central</>}
              {mode === "code"   && <> — a barcode or a unique ID like <span className="font-mono">R009478-28</span></>}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                id="lookup-input"
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") search() }}
                onFocus={e => e.currentTarget.select()}
                placeholder={PLACEHOLDER[mode]}
                autoFocus
                autoComplete="off"
                className={INPUT}
              />
              <button onClick={search} disabled={!canGo} className={`${BTN_PRIMARY} whitespace-nowrap`}>
                Search
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── The answer, on this same page ─────────────────────────────────── */}
      {!run && (
        <div className={`${CARD} p-10 text-center`}>
          <p className="text-2xl">🔎</p>
          <p className="text-lg text-gray-600 dark:text-gray-400 mt-2">
            Pick what you have above, fill it in, and the answer appears here.
          </p>
        </div>
      )}

      {run && (run.mode === "receipt" || run.mode === "tote" || run.mode === "vendor") && (
        <FindLotsTab controlled={{ mode: run.mode, value: run.value, nonce: run.nonce }} />
      )}

      {run && run.mode === "sale" && (
        <BySaleTab controlled={{ sale: run.sale, lot: run.lot, nonce: run.nonce }} />
      )}

      {run && run.mode === "code" && (
        <WhoCataloguedTab controlled={{ value: run.value, nonce: run.nonce }} />
      )}
    </div>
  )
}
