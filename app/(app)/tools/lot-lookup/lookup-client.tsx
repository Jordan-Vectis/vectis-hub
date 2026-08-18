"use client"

// Admin Centre — ONE page, one search bar, four things you can search by.
//
// Jordan, 2026-08-18: *"I want to combine all the options on this page to be a single page so
// keep the find a customers lots and the 3 options but all the data needs to show up on a single
// page. We also need to be able to search by auction and lot number on the first page. I want to
// make this as simple and idiot proof as possible."*
//
// It used to be three tabs, each hiding the other two and each with its own search box — so you
// had to know which tab answered your question before you could ask it. Now: pick what you have
// in your hand, type it, press Search, and the answer appears underneath. Nothing is hidden.
//
// ⚠ The three tab components still hold all the rendering. They take a `controlled` prop from
// here, which hides their own search card and runs the query this page gives them. Their result
// markup was not touched — it is the part that has been checked against real BC data.
//
// ⚠ Deliberately LARGE type and hit targets (see ui.ts). The people using this are not the ones
// who read 11px tables. Do not compact it.

import { useState } from "react"
import Link from "next/link"
import FindLotsTab from "./find-lots-tab"
import WhoCataloguedTab from "./who-catalogued-tab"
import BySaleTab from "./by-sale-tab"
import { CARD, INPUT, BTN_PRIMARY, HINT } from "./ui"

type Mode = "receipt" | "tote" | "vendor" | "lot"

const MODES: { key: Mode; icon: string; label: string; blurb: string; placeholder: string; example: string }[] = [
  { key: "receipt", icon: "🧾", label: "Receipt number",  blurb: "Everything booked in on one receipt", placeholder: "R000009", example: "R000009" },
  { key: "tote",    icon: "📦", label: "Tote number",     blurb: "Everything on that tote's receipt",   placeholder: "T001868", example: "T001868" },
  { key: "vendor",  icon: "👤", label: "Customer number", blurb: "Everything for one customer",         placeholder: "C224652", example: "C224652" },
  { key: "lot",     icon: "🔨", label: "Sale or lot",     blurb: "A whole sale, one lot, or a barcode", placeholder: "F109 400", example: "F109 400" },
]

// What did they type into the Sale-or-lot box?
//
// ⚠ Three shapes, all of which people actually use, and telling them apart is the whole point of
// this box. A BARCODE is a sale code with the lot run together (F109400), so it has to be tried
// as a lot lookup rather than split — splitting it would ask BC for "sale F109, lot 400" when
// the barcode may not follow that pattern at all.
export type LotQuery =
  | { kind: "sale";     sale: string; lot: string }   // F109  ·  F109 400  ·  F109/400
  | { kind: "lot";      value: string }               // F109400  ·  R009478-28
  | { kind: "unknown" }

export function parseLotQuery(raw: string): LotQuery {
  const q = (raw ?? "").trim().replace(/\s+/g, " ")
  if (!q) return { kind: "unknown" }

  // A unique ID (R009478-28) is always a single lot.
  if (/^[A-Za-z]\d{4,7}-\d{1,6}$/.test(q)) return { kind: "lot", value: q }

  // Sale code and lot number given separately: "F109 400", "F109/400", "F109-400".
  const split = q.match(/^([A-Za-z]{1,3}\d{2,4})\s*[\s/\\.-]\s*(\d{1,5})$/)
  if (split) return { kind: "sale", sale: split[1].toUpperCase(), lot: split[2] }

  // A bare sale code: F109, DM0126.
  if (/^[A-Za-z]{1,3}\d{2,4}$/.test(q)) return { kind: "sale", sale: q.toUpperCase(), lot: "" }

  // Anything else that looks like an identifier — a full barcode.
  // ⚠ Must contain a digit: without that, typing a word ("what") was accepted as a barcode and
  // searched for, instead of saying plainly that it wasn't understood.
  if (/^(?=.*\d)[A-Za-z0-9-]{4,}$/.test(q)) return { kind: "lot", value: q.toUpperCase() }

  return { kind: "unknown" }
}

/** Plain English for what the page decided, shown back so nobody has to guess. */
function readAs(q: LotQuery): string {
  if (q.kind === "sale") return q.lot ? `sale ${q.sale}, lot ${q.lot}` : `the whole of sale ${q.sale}`
  if (q.kind === "lot")  return `lot ${q.value}`
  return ""
}

export default function LookupClient() {
  const [mode, setMode]   = useState<Mode>("receipt")
  const [value, setValue] = useState("")
  // Bumped on every Search press, so pressing it twice re-runs the same query.
  const [run, setRun]     = useState<{ mode: Mode; value: string; nonce: number } | null>(null)

  const active  = MODES.find(m => m.key === mode)!
  const parsed  = parseLotQuery(value)
  const canGo   = value.trim().length > 0 && (mode !== "lot" || parsed.kind !== "unknown")

  function search() {
    if (!canGo) return
    setRun(prev => ({ mode, value: value.trim(), nonce: (prev?.nonce ?? 0) + 1 }))
  }

  // What the results below are actually showing.
  const ranLot = run?.mode === "lot" ? parseLotQuery(run.value) : null

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
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => { setMode(m.key); setValue("") }}
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

        <label htmlFor="lookup-input" className="block text-lg font-semibold text-gray-900 dark:text-white mb-1">
          2 · Type the {active.label.toLowerCase()}
        </label>
        <p className={`${HINT} mb-4`}>
          {mode === "lot"
            ? <>For example <span className="font-mono">F109</span> for a whole sale, <span className="font-mono">F109 400</span> for one lot, or a barcode like <span className="font-mono">F109400</span></>
            : <>For example <span className="font-mono">{active.example}</span>{mode === "vendor" && <> — or type part of a customer&apos;s name to search Business Central</>}</>}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="lookup-input"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") search() }}
            onFocus={e => e.currentTarget.select()}
            placeholder={active.placeholder}
            autoFocus
            autoComplete="off"
            className={INPUT}
          />
          <button onClick={search} disabled={!canGo} className={`${BTN_PRIMARY} whitespace-nowrap`}>
            Search
          </button>
        </div>

        {/* Say out loud what a Sale-or-lot entry was understood as, BEFORE searching. */}
        {mode === "lot" && value.trim() && (
          parsed.kind === "unknown"
            ? <p className="mt-4 text-base text-amber-700 dark:text-amber-300">
                That doesn&apos;t look like a sale code, a lot number or a barcode. Try <span className="font-mono">F109</span>, <span className="font-mono">F109 400</span> or <span className="font-mono">F109400</span>.
              </p>
            : <p className="mt-4 text-base text-gray-600 dark:text-gray-300">
                Will look up <span className="font-semibold text-gray-900 dark:text-white">{readAs(parsed)}</span>.
              </p>
        )}
      </div>

      {/* ── The answer, on this same page ─────────────────────────────────── */}
      {!run && (
        <div className={`${CARD} p-10 text-center`}>
          <p className="text-2xl">🔎</p>
          <p className="text-lg text-gray-600 dark:text-gray-400 mt-2">
            Pick what you have above, type it in, and the answer appears here.
          </p>
        </div>
      )}

      {run && run.mode !== "lot" && (
        <FindLotsTab controlled={{ mode: run.mode as "receipt" | "tote" | "vendor", value: run.value, nonce: run.nonce }} />
      )}

      {run && run.mode === "lot" && ranLot?.kind === "sale" && (
        <BySaleTab controlled={{ sale: ranLot.sale, lot: ranLot.lot, nonce: run.nonce }} />
      )}

      {run && run.mode === "lot" && ranLot?.kind === "lot" && (
        <WhoCataloguedTab controlled={{ value: ranLot.value, nonce: run.nonce }} />
      )}
    </div>
  )
}
