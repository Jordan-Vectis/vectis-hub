"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"

// The real panel, running inside the practice tab.
//
// ⚠ These are the ACTUAL tab components from the tool being taught, not a mock-up of them.
// A screenshot of a screen is out of date the first time the screen changes, and practising on
// a fake teaches the fake. The trade is that the embedded panel calls the same APIs and is
// therefore subject to the same permissions — the practice tab checks that before rendering
// one and says so plainly if the trainee cannot use it yet.
//
// To add practice for another panel: export its tab components and add an entry here. Nothing
// else in Training needs to know the panel exists.

const loading = () => (
  <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading the panel…</div>
)

const FindLotsTab = dynamic(() => import("@/app/(app)/tools/lot-lookup/find-lots-tab"), { loading })
const WhoCataloguedTab = dynamic(() => import("@/app/(app)/tools/lot-lookup/who-catalogued-tab"), { loading })
const BySaleTab = dynamic(() => import("@/app/(app)/tools/lot-lookup/by-sale-tab"), { loading })

/** moduleKey → panel key → the component. Panel keys match TrainingExercise.panel. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PANEL_EMBEDS: Record<string, Record<string, ComponentType<any>>> = {
  LOT_LOOKUP: {
    find: FindLotsTab,
    who:  WhoCataloguedTab,
    sale: BySaleTab,
  },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function embedFor(moduleKey: string, panel: string | null | undefined): ComponentType<any> | null {
  if (!panel) return null
  return PANEL_EMBEDS[moduleKey]?.[panel] ?? null
}

export function hasEmbed(moduleKey: string): boolean {
  return !!PANEL_EMBEDS[moduleKey]
}
