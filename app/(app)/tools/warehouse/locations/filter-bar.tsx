"use client"

import { useState, type RefObject } from "react"
import { LOCATION_KINDS, type LocationKind } from "@/lib/goods-in/model"
import { LOCATION_AREAS, type LocationArea } from "@/lib/goods-in/location-codes"
import { btn, input, label, mono } from "../_components/ui"
import {
  CONTENTS_OPTIONS, SORT_OPTIONS, STATUS_OPTIONS, USED_OPTIONS, filterChips, n,
  type ContentsFilter, type Facets, type Filters, type Option, type SortKey, type StatusFilter, type UsedFilter,
} from "./filters"
import { useLetGoAfterMouse } from "./select-focus"

// Goods In → Locations: the filters. Kind buttons, the search/scan box, then the choices — every
// one with how many locations it would show given the others (the one picked shows what the list
// shows now). On a phone the choices fold away behind a "Filters" button so the list stays in
// view; whatever is switched on is always shown as a chip that removes it.

type Choice = { value: string; label: string; count?: number }

function Select({ id, title, value, options, total, onChange }: {
  id: string; title: string; value: string; options: Choice[]
  /** What the list shows now — the count beside the choice that is picked. */
  total?: number
  onChange: (v: string) => void
}) {
  const focus = useLetGoAfterMouse()
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={label}>{title}</label>
      <select
        id={id}
        className={`${input} dark:[color-scheme:dark]`}
        value={value}
        onPointerDown={focus.onPointerDown}
        onKeyDown={focus.onKeyDown}
        onChange={e => { onChange(e.target.value); focus.letGo(e.currentTarget) }}
      >
        {options.map(o => {
          const count = o.value === value && total !== undefined ? total : o.count
          return <option key={o.value} value={o.value}>{count === undefined ? o.label : `${o.label} (${n(count)})`}</option>
        })}
      </select>
    </div>
  )
}

const withCount = (o: { value: string; label: string }, count: number | undefined): Choice => ({ value: o.value, label: o.label, count: count ?? 0 })
const facetChoices = (all: string, allCount: number, list: Option[]): Choice[] => [{ value: "", label: all, count: allCount }, ...list]

export default function FilterBar({ filters, facets, onChange, onClearAll, searchRef, onSearchEnter }: {
  filters: Filters
  facets: Facets
  onChange: (patch: Partial<Filters>) => void
  onClearAll: () => void
  searchRef: RefObject<HTMLInputElement | null>
  /** Enter in the search box — what a scanner sends after a label's code. */
  onSearchEnter: () => void
}) {
  const [open, setOpen] = useState(false)
  const chips = filterChips(filters)
  const kinds: { value: LocationKind | "all"; label: string }[] = [{ value: "all", label: "All" }, ...LOCATION_KINDS]
  const total = facets.total

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by kind">
        {kinds.map(k => {
          const on = filters.kind === k.value
          return (
            <button
              key={k.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ kind: k.value })}
              className={`min-h-11 px-4 rounded-lg border text-sm font-medium transition-colors ${on ? "border-indigo-500 bg-indigo-600 text-white" : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
            >
              {k.label} <span className={on ? "text-indigo-100" : "text-gray-500 dark:text-gray-400"}>{n(on ? total : facets.kind[k.value] ?? 0)}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <label htmlFor="loc-search" className="sr-only">Search or scan a location</label>
          <input
            id="loc-search"
            ref={searchRef}
            className={`${input} ${mono}`}
            value={filters.q}
            onChange={e => onChange({ q: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onSearchEnter() } }}
            placeholder="Search by code or name — or scan a location label"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="search"
          />
        </div>
        <button type="button" className={`${btn} md:hidden shrink-0`} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="loc-filters">
          {open ? "Hide filters" : chips.length ? `Filters (${chips.length})` : "Filters"}
        </button>
      </div>

      <div id="loc-filters" className={`${open ? "grid" : "hidden"} md:grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-3`}>
        <Select
          id="f-area" title="Part of the warehouse" value={filters.area} total={total}
          options={[withCount({ value: "all", label: "Everywhere" }, facets.area.all), ...LOCATION_AREAS.map(a => withCount(a, facets.area[a.value]))]}
          onChange={v => onChange({ area: v as LocationArea | "all", aisle: "", bay: "", shelf: "", cabinet: "" })}
        />
        {filters.area === "aisle" && (
          <>
            {/* A different aisle may not have the bay or shelf picked, so picking one starts those again; "All" keeps them. */}
            <Select id="f-aisle" title="Aisle" value={filters.aisle} total={total} options={facetChoices("All aisles", facets.aisleAll, facets.aisles)} onChange={v => onChange(v ? { aisle: v, bay: "", shelf: "" } : { aisle: "" })} />
            <Select id="f-bay" title="Bay" value={filters.bay} total={total} options={facetChoices(filters.aisle ? `All bays in aisle ${filters.aisle}` : "All bays", facets.bayAll, facets.bays)} onChange={v => onChange(v ? { bay: v, shelf: "" } : { bay: "" })} />
            <Select id="f-shelf" title="Shelf" value={filters.shelf} total={total} options={facetChoices("All shelves", facets.shelfAll, facets.shelves)} onChange={v => onChange({ shelf: v })} />
          </>
        )}
        {filters.area === "cabinet" && (
          <Select id="f-cabinet" title="Cabinet" value={filters.cabinet} total={total} options={facetChoices("All cabinets", facets.cabinetAll, facets.cabinets)} onChange={v => onChange({ cabinet: v })} />
        )}
        <Select id="f-status" title="Switched on or off" value={filters.status} total={total} options={STATUS_OPTIONS.map(o => withCount(o, facets.status[o.value]))} onChange={v => onChange({ status: v as StatusFilter })} />
        <Select id="f-contents" title="What's there" value={filters.contents} total={total} options={CONTENTS_OPTIONS.map(o => withCount(o, facets.contents[o.value]))} onChange={v => onChange({ contents: v as ContentsFilter })} />
        <Select id="f-used" title="Last used" value={filters.used} total={total} options={USED_OPTIONS.map(o => withCount(o, facets.used[o.value]))} onChange={v => onChange({ used: v as UsedFilter })} />
        <Select id="f-sort" title="Sort by" value={filters.sort} options={SORT_OPTIONS} onChange={v => onChange({ sort: v as SortKey })} />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.clear)}
              aria-label={`Remove filter: ${c.label}`}
              className="inline-flex items-center gap-2 min-h-11 max-w-full pl-3 pr-2 rounded-full border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 text-sm text-indigo-900 dark:text-indigo-100 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
            >
              <span className="truncate">{c.label}</span>
              <span aria-hidden="true" className="text-lg leading-none px-1">×</span>
            </button>
          ))}
          <button type="button" onClick={onClearAll} className="min-h-11 px-3 text-sm text-indigo-700 dark:text-indigo-300 underline underline-offset-2">Clear all filters</button>
        </div>
      )}
    </div>
  )
}
