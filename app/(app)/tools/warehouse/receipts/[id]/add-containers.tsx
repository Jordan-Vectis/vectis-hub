"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { addContainers, type ContainerInput } from "@/lib/actions/goods-in"
import type { ContainerKind } from "@/lib/goods-in/model"
import { ErrorBox, OkBox, btn, btnGo, input, label, mono } from "../../_components/ui"
import { useRefreshOnReturn } from "./refresh-on-return"

// "Add totes or pallets" — for a customer who comes back with a second car-load. Goods are grouped
// by category, not item, so each line is one category; "How many" makes that many totes (or
// pallets) of it, each with its own number. Numbers come from the series in one go (addContainers).

type Line = { key: number; kind: ContainerKind; category: string; description: string; qty: number }

const MAX_PER_LINE = 50
const MAX_TOTAL = 200
let nextKey = 1
const blankLine = (kind: ContainerKind = "tote"): Line => ({ key: nextKey++, kind, category: "", description: "", qty: 1 })

export default function AddContainers({ receiptId, categoriesListId }: { receiptId: string; categoriesListId: string }) {
  const router = useRouter()
  const refreshOnReturn = useRefreshOnReturn()
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState<Line[]>(() => [blankLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string[] | null>(null)

  const set = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))
  const totes = lines.filter(l => l.kind === "tote").reduce((n, l) => n + l.qty, 0)
  const pallets = lines.filter(l => l.kind === "pallet").reduce((n, l) => n + l.qty, 0)
  const total = totes + pallets
  const summary = [totes ? `${totes} tote${totes === 1 ? "" : "s"}` : null, pallets ? `${pallets} pallet${pallets === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (total === 0) { setError("Nothing to add — set how many on at least one line."); return }
    if (total > MAX_TOTAL) { setError(`That's ${total} at once — add at most ${MAX_TOTAL} in one go.`); return }
    const rows: ContainerInput[] = lines.flatMap(l =>
      Array.from({ length: l.qty }, () => ({ kind: l.kind, category: l.category.trim() || null, description: l.description.trim() || null })),
    )
    setSaving(true)
    setError(null)
    setAdded(null)
    const res = await addContainers(receiptId, rows)
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    if (res.data.length === 0) { setError("Nothing was added — please try again."); return }
    setAdded(res.data)
    setLines([blankLine()])
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {added && (
        <OkBox>
          <p>
            Added {added.length === 1 ? "" : `${added.length} — `}<span className={`${mono} font-semibold`}>{added.join(", ")}</span> to {receiptId}.
            {" "}Print {added.length === 1 ? "its label" : "their labels"} and put {added.length === 1 ? "it" : "them"} away.
          </p>
          <a href={`/api/goods-in/labels?containers=${added.map(encodeURIComponent).join(",")}`} target="_blank" rel="noopener" onClick={refreshOnReturn} className="mt-2 inline-flex items-center min-h-11 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">
            Print {added.length === 1 ? "the new label" : `the ${added.length} new labels`}
          </a>
        </OkBox>
      )}

      {!open ? (
        <button type="button" className={btn} onClick={() => { setOpen(true); setAdded(null); setError(null) }}>+ Add totes or pallets</button>
      ) : (
        <form onSubmit={submit} className="rounded-xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 space-y-4">
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Add totes or pallets to {receiptId}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">One line per category. Each tote or pallet gets its own number and label.</p>
          </div>

          <div className="space-y-3">
            {lines.map((l, i) => (
              <fieldset key={l.key} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 grid gap-3 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.5fr)_auto_auto] md:items-end">
                <legend className="sr-only">Line {i + 1}</legend>
                <div>
                  <span className={label}>Kind</span>
                  <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden" role="group" aria-label="Tote or pallet">
                    {(["tote", "pallet"] as const).map(k => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={l.kind === k}
                        onClick={() => set(l.key, { kind: k })}
                        className={`min-h-11 px-4 text-sm font-medium transition-colors ${l.kind === k ? "bg-indigo-600 text-white" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
                      >
                        {k === "tote" ? "Tote" : "Pallet"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor={`add-cat-${l.key}`} className={label}>Category</label>
                  <input id={`add-cat-${l.key}`} list={categoriesListId} className={input} value={l.category} maxLength={80} onChange={e => set(l.key, { category: e.target.value })} placeholder="e.g. Comics" autoComplete="off" />
                </div>
                <div>
                  <label htmlFor={`add-desc-${l.key}`} className={label}>What&apos;s in it</label>
                  <input id={`add-desc-${l.key}`} className={input} value={l.description} maxLength={500} onChange={e => set(l.key, { description: e.target.value })} placeholder="e.g. 5 boxes of 1980s comics" autoComplete="off" />
                </div>
                <div>
                  <span className={label} id={`add-qty-${l.key}`}>How many</span>
                  <div className="flex items-center gap-1" role="group" aria-labelledby={`add-qty-${l.key}`}>
                    <button type="button" className={`${btn} !px-0 w-11`} aria-label="One fewer" disabled={l.qty <= 1} onClick={() => set(l.key, { qty: Math.max(1, l.qty - 1) })}>−</button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_PER_LINE}
                      aria-label="How many"
                      className={`${input} !w-16 text-center tabular-nums`}
                      value={l.qty === 0 ? "" : l.qty}
                      onChange={e => set(l.key, { qty: Math.min(MAX_PER_LINE, Math.max(0, Math.floor(Number(e.target.value)) || 0)) })}
                      onBlur={() => { if (l.qty === 0) set(l.key, { qty: 1 }) }}
                    />
                    <button type="button" className={`${btn} !px-0 w-11`} aria-label="One more" disabled={l.qty >= MAX_PER_LINE} onClick={() => set(l.key, { qty: Math.min(MAX_PER_LINE, l.qty + 1) })}>+</button>
                  </div>
                </div>
                <div>
                  {lines.length > 1 && (
                    <button type="button" className={`${btn} w-full md:w-auto`} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label={`Remove line ${i + 1}`}>Remove</button>
                  )}
                </div>
              </fieldset>
            ))}
          </div>

          <button type="button" className={btn} onClick={() => setLines(ls => [...ls, blankLine(ls[ls.length - 1]?.kind ?? "tote")])}>+ Another category</button>

          {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="submit" className={btnGo} disabled={saving || total === 0}>
              {saving ? `Adding ${summary}…` : total ? `Add ${summary}` : "Add"}
            </button>
            <button type="button" className={btn} disabled={saving} onClick={() => { setOpen(false); setError(null); setLines([blankLine()]) }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
