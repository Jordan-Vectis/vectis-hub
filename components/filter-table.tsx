"use client"

// Excel-style filterable results table, shared by every BC Warehouse results
// table (Search by Location, Tote Data, Unsold Items, Sale Checklist).
//
// Click a column heading and you get the Excel dropdown: sort A→Z / Z→A, a
// search box, and a tickbox for every value actually present in that column
// (with counts). Like Excel, the options offered are the ones still available
// under the OTHER columns' filters, so you can't tick your way to an empty
// table by accident.
//
// The 🖨 PDF button prints exactly what is on screen — the visible rows, in the
// visible order, through /api/warehouse/table-pdf. It posts plain strings, so
// the sheet can never disagree with the table.
//
// The dropdown is rendered in a portal (fixed position) because these tables
// live inside `overflow-y-auto` panes that would otherwise clip it.

import { useState, useMemo, useRef, useEffect } from "react"
import { createPortal } from "react-dom"

export type FilterColumn<T> = {
  key:    string
  label:  string
  /** Plain text for filtering, sorting and the PDF. Keep it short and stable. */
  value:  (row: T) => string
  /** Optional rich cell (badges, colours). Falls back to `value`. */
  render?: (row: T) => React.ReactNode
  className?: string
  align?:  "left" | "right"
  /** Set false for a column nobody would filter on (e.g. a free-text description). */
  filterable?: boolean
  /** Relative column width in the PDF (default 1). */
  pdfWidth?: number
  /** Leave this column out of the PDF. */
  pdfHide?: boolean
}

type Props<T> = {
  columns:   FilterColumn<T>[]
  rows:      T[]
  rowKey:    (row: T, i: number) => string
  /** Extra classes for a whole row (e.g. red for a missing item). */
  rowClassName?: (row: T) => string
  /** Section heading shown top-left (the row count is appended). */
  title?:    string
  titleClassName?: string
  /** Printed under the title on the PDF — e.g. the search term used. */
  pdfSubtitle?: string
  pdfTitle?:    string
  pdfFilename?: string
  pdfOrientation?: "portrait" | "landscape"
  /** Render this many rows to begin with, with a "Show all" button (default: all). */
  initialRows?: number
  emptyMessage?: string
  className?: string
  /** Change this (e.g. to the search term) to drop the filters when the data set changes. */
  resetKey?: string
  /** Fires with the filtered + sorted rows, so a caller's own export can match the screen. */
  onVisibleChange?: (rows: T[]) => void
}

const PANEL_W = 260
const BLANK   = "(Blanks)"

// Empty cells get their own tickbox. Only "" counts as blank — "0" is a value.
const label = (v: string | undefined) => (v == null || v === "" ? BLANK : v)

export function FilterTable<T>({
  columns, rows, rowKey, rowClassName, title, titleClassName,
  pdfSubtitle, pdfTitle, pdfFilename, pdfOrientation,
  initialRows, emptyMessage, className, resetKey, onVisibleChange,
}: Props<T>) {
  const [filters, setFilters] = useState<Record<string, string[]>>({})
  const [sort,    setSort]    = useState<{ key: string; dir: "asc" | "desc" } | null>(null)
  const [open,    setOpen]    = useState<{ key: string; x: number; y: number } | null>(null)
  const [search,  setSearch]  = useState("")
  const [showAll, setShowAll] = useState(false)
  const [busy,    setBusy]    = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)

  // Plain-text value of every cell, computed once per data change.
  const values = useMemo(
    () => rows.map(r => {
      const v: Record<string, string> = {}
      for (const c of columns) v[c.key] = (c.value(r) ?? "").trim()
      return v
    }),
    [rows, columns],
  )

  // A key being PRESENT means that column is filtered — an empty selection is a
  // real filter that matches nothing (untick everything and the table empties,
  // same as Excel), not "no filter".
  const activeKeys = Object.keys(filters)

  // A fresh search / new data set starts clean, otherwise a filter left over
  // from the last search silently empties the new results. (Skipped on mount —
  // there is nothing to clear yet and it would cost a second render.)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    setFilters({}); setSort(null); setShowAll(false); setOpen(null)
  }, [resetKey])

  // Rows passing every filter except (optionally) one — used both for the
  // visible rows and for building each dropdown's option list.
  const passing = useMemo(() => {
    const sets: Record<string, Set<string>> = {}
    for (const k of activeKeys) sets[k] = new Set(filters[k])
    return (i: number, exceptKey?: string) => {
      for (const k of activeKeys) {
        if (k === exceptKey) continue
        if (!sets[k].has(label(values[i][k]))) return false
      }
      return true
    }
  }, [filters, values, activeKeys.join("|")]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const idx = rows.map((_, i) => i).filter(i => passing(i))
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1
      idx.sort((a, b) => {
        const av = values[a][sort.key] ?? ""
        const bv = values[b][sort.key] ?? ""
        if (!av && bv) return 1          // blanks always last
        if (av && !bv) return -1
        return av.localeCompare(bv, "en-GB", { numeric: true, sensitivity: "base" }) * dir
      })
    }
    return idx
  }, [rows, values, passing, sort])

  // Let a caller export the same rows the user is looking at (Unsold Items'
  // picking sheet uses this). Deliberately not keyed on the callback identity.
  useEffect(() => {
    onVisibleChange?.(visible.map(i => rows[i]))
  }, [visible, rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const limit    = initialRows && !showAll ? initialRows : visible.length
  const shown    = visible.slice(0, limit)
  const filtered = activeKeys.length > 0

  // Options for the open dropdown: distinct values under the other filters.
  const options = useMemo(() => {
    if (!open) return [] as { value: string; count: number }[]
    const counts = new Map<string, number>()
    for (let i = 0; i < rows.length; i++) {
      if (!passing(i, open.key)) continue
      const v = label(values[i][open.key])
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => {
        if (a.value === BLANK) return 1
        if (b.value === BLANK) return -1
        return a.value.localeCompare(b.value, "en-GB", { numeric: true, sensitivity: "base" })
      })
  }, [open, rows, values, passing])

  const shownOptions = search
    ? options.filter(o => o.value.toLowerCase().includes(search.toLowerCase()))
    : options

  // Absent filter = everything ticked (Excel behaviour).
  const selected = open ? (filters[open.key] ?? options.map(o => o.value)) : []
  const selectedSet = new Set(selected)

  function setSelection(key: string, next: string[], all: string[]) {
    setFilters(f => {
      const copy = { ...f }
      // Everything ticked = no filter at all, so the column stops counting as filtered.
      if (next.length >= all.length) delete copy[key]
      else copy[key] = next
      return copy
    })
  }

  function toggleValue(v: string) {
    if (!open) return
    const all  = options.map(o => o.value)
    const base = filters[open.key] ?? all
    const next = base.includes(v) ? base.filter(x => x !== v) : [...base, v]
    setSelection(open.key, next, all)
  }

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      if ((t as HTMLElement).closest?.("[data-filter-head]")) return
      setOpen(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(null) }
    function onScroll(e: Event) {
      if (panelRef.current?.contains(e.target as Node)) return
      setOpen(null)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    document.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onScroll)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onScroll)
    }
  }, [open])

  function openFor(key: string, el: HTMLElement) {
    if (open?.key === key) { setOpen(null); return }
    const r = el.getBoundingClientRect()
    setSearch("")
    setOpen({
      key,
      x: Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8)),
      y: r.bottom + 4,
    })
  }

  async function downloadPdf() {
    setBusy(true)
    try {
      const cols = columns.filter(c => !c.pdfHide)
      const res = await fetch("/api/warehouse/table-pdf", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:       pdfTitle ?? title ?? "Warehouse",
          subtitle:    pdfSubtitle,
          filename:    pdfFilename ?? pdfTitle ?? title,
          orientation: pdfOrientation,
          columns:     cols.map(c => ({ label: c.label, width: c.pdfWidth ?? 1, align: c.align ?? "left" })),
          rows:        visible.map(i => cols.map(c => values[i][c.key] ?? "")),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error ?? "PDF generation failed")
        return
      }
      const blob = await res.blob()
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ?? "warehouse.pdf"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(link.href)
    } catch {
      alert("Network error while generating the PDF")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={className}>
      {/* Section header + toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-gray-100 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
        <div className={`text-xs font-medium uppercase tracking-wider ${titleClassName ?? "text-gray-600 dark:text-gray-400"}`}>
          {title}
          {title ? " · " : ""}
          {filtered
            ? `${visible.length.toLocaleString()} of ${rows.length.toLocaleString()}`
            : rows.length.toLocaleString()}
        </div>
        <div className="flex items-center gap-2">
          {filtered && (
            <button
              onClick={() => setFilters({})}
              className="text-[11px] px-2 py-1 rounded border border-amber-500/50 text-amber-600 dark:text-amber-300 hover:bg-amber-500/10 transition-colors"
            >
              ✕ Clear filters
            </button>
          )}
          <button
            onClick={downloadPdf}
            disabled={busy}
            title="Print exactly what is on screen"
            className="text-[11px] px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium transition-colors"
          >
            {busy ? "Generating…" : "🖨 PDF"}
          </button>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-500 sticky top-0 z-10">
          <tr>
            {columns.map(c => {
              const isFiltered = !!filters[c.key]?.length
              const canFilter  = c.filterable !== false
              const sorted     = sort?.key === c.key ? sort.dir : null
              return (
                <th key={c.key} className={`px-4 py-2 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}>
                  {canFilter ? (
                    <button
                      data-filter-head
                      onClick={e => openFor(c.key, e.currentTarget)}
                      className={`inline-flex items-center gap-1 rounded px-1 -mx-1 py-0.5 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors ${
                        isFiltered ? "text-blue-600 dark:text-blue-300" : ""
                      }`}
                    >
                      <span className="font-medium">{c.label}</span>
                      {sorted && <span className="text-[9px]">{sorted === "asc" ? "▲" : "▼"}</span>}
                      <Funnel active={isFiltered} />
                    </button>
                  ) : (
                    <span>{c.label}</span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-800/60">
          {shown.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-gray-600 dark:text-gray-400">
                {filtered ? (
                  <>
                    No rows match the current filters.{" "}
                    <button onClick={() => setFilters({})} className="text-blue-500 hover:text-blue-400 underline">Clear filters</button>
                  </>
                ) : (emptyMessage ?? "Nothing to show")}
              </td>
            </tr>
          )}
          {shown.map(i => (
            <tr key={rowKey(rows[i], i)} className={`hover:bg-gray-100 dark:hover:bg-gray-800/40 transition-colors ${rowClassName?.(rows[i]) ?? ""}`}>
              {columns.map(c => (
                <td key={c.key} className={`px-4 py-2.5 ${c.align === "right" ? "text-right" : ""} ${c.className ?? "text-gray-700 dark:text-gray-300"}`}>
                  {c.render
                    ? c.render(rows[i])
                    : values[i][c.key] !== ""
                      ? values[i][c.key]
                      : <span className="text-gray-400 dark:text-gray-700">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {initialRows != null && visible.length > initialRows && (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 text-center bg-gray-100 dark:bg-gray-900">
          <button onClick={() => setShowAll(v => !v)} className="text-xs text-blue-500 hover:text-blue-400 transition-colors">
            {showAll ? `Show first ${initialRows.toLocaleString()}` : `Show all ${visible.length.toLocaleString()} rows`}
          </button>
        </div>
      )}

      {/* ── Excel-style dropdown ── */}
      {open && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", left: open.x, top: open.y, width: PANEL_W, maxHeight: Math.max(220, window.innerHeight - open.y - 16) }}
          className="z-50 flex flex-col bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg shadow-2xl overflow-hidden text-xs"
        >
          <div className="border-b border-gray-200 dark:border-gray-800">
            <button
              onClick={() => { setSort({ key: open.key, dir: "asc" }); setOpen(null) }}
              className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
            >▲ Sort A → Z</button>
            <button
              onClick={() => { setSort({ key: open.key, dir: "desc" }); setOpen(null) }}
              className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
            >▼ Sort Z → A</button>
            {sort?.key === open.key && (
              <button
                onClick={() => { setSort(null); setOpen(null) }}
                className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
              >✕ Clear sort</button>
            )}
          </div>

          <div className="p-2 border-b border-gray-200 dark:border-gray-800">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search values…"
              autoFocus
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-xs text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer font-medium text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                className="accent-blue-500"
                checked={shownOptions.length > 0 && shownOptions.every(o => selectedSet.has(o.value))}
                onChange={e => {
                  const all = options.map(o => o.value)
                  const hit = shownOptions.map(o => o.value)
                  const next = e.target.checked
                    ? [...new Set([...selected, ...hit])]
                    : selected.filter(v => !hit.includes(v))
                  setSelection(open.key, next, all)
                }}
              />
              (Select all{search ? " matching" : ""}) <span className="text-gray-500 dark:text-gray-500">· {shownOptions.length.toLocaleString()}</span>
            </label>
            {shownOptions.length === 0 && (
              <div className="px-3 py-3 text-center text-gray-500">No matching values</div>
            )}
            {shownOptions.map(o => (
              <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  className="accent-blue-500 flex-shrink-0"
                  checked={selectedSet.has(o.value)}
                  onChange={() => toggleValue(o.value)}
                />
                <span className={`flex-1 truncate ${o.value === BLANK ? "italic text-gray-500" : ""}`} title={o.value}>{o.value}</span>
                <span className="text-gray-500 dark:text-gray-500 flex-shrink-0">{o.count.toLocaleString()}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
            <button
              onClick={() => setFilters(f => { const c = { ...f }; delete c[open.key]; return c })}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >Clear filter</button>
            <button
              onClick={() => setOpen(null)}
              className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
            >Done</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function Funnel({ active }: { active: boolean }) {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden className={active ? "text-blue-500" : "text-gray-400 dark:text-gray-600"}>
      <path d="M1 2h10L7 6.5V11L5 9.5V6.5L1 2z" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}
