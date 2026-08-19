"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"

// The real panel, running inside the practice tab.
//
// ⚠ This is the ACTUAL Admin Centre page, not a mock-up of it and not its sub-components. A
// screenshot goes out of date the first time the screen changes, and practising on a fake
// teaches the fake. The trade is that the embedded panel calls the same APIs and is therefore
// subject to the same permissions — the practice tab checks that before rendering one and says
// so plainly if the trainee cannot use it yet.
//
// ⚠ Embed the PAGE (LookupClient), never the three tab components underneath it. Jordan rebuilt
// the Admin Centre on 2026-08-18 into one page with five search buttons; the old tab components
// still exist as renderers, but they are driven by a `controlled` prop from the page and their
// own search cards are dead code on that route. Embedding them individually would put a search
// box in front of the trainee that nobody sees in the real tool.
//
// To add practice for another panel: add one entry here. Nothing else in Training needs to know.

const loading = () => (
  <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading the panel…</div>
)

const AdminCentre = dynamic(() => import("@/app/(app)/tools/lot-lookup/lookup-client"), { loading })

/** moduleKey → the whole panel, as the trainee will actually meet it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PANEL_EMBEDS: Record<string, ComponentType<any>> = {
  LOT_LOOKUP: AdminCentre,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function embedFor(moduleKey: string): ComponentType<any> | null {
  return PANEL_EMBEDS[moduleKey] ?? null
}
