"use client"

import { useEffect } from "react"

// ─── The pickable instruction list, shared by every run tab ───────────────────
//
// GET /api/auction-ai/presets returns { key: text } for the instructions that
// are OFFERED — getAllInstructions drops archived ones, so this is the single
// place the run tabs learn what may be picked.
//
// ⚠⚠ WHY THIS IS A HOOK AND NOT FOUR COPIES OF A useEffect (2026-09-04).
// Every picker used to fetch once on mount with an empty dependency array, and
// the Auction AI page keeps its tabs MOUNTED (hidden with CSS, not unmounted).
// So archiving an instruction on the Instructions tab emptied it out of the
// server's list immediately but left it sitting in the Batch, Chat, Pipeline and
// Instructions Testing dropdowns until a full page reload — still pickable, and
// still runnable. Jordan: "If they are archived I dont want them to show on any
// drop downs anywhere."
//
// Anything that changes which instructions exist calls announceInstructionsChanged()
// and every mounted picker reloads. Add the call to any new one.

const INSTRUCTIONS_CHANGED = "vectis:instructions-changed"

/** Tell every mounted picker the list has changed (archived, restored, deleted, added). */
export function announceInstructionsChanged() {
  try { window.dispatchEvent(new Event(INSTRUCTIONS_CHANGED)) } catch { /* SSR — nothing is mounted */ }
}

/**
 * Load the pickable instructions, and reload them whenever the list changes.
 * Both setters are useState setters, so they are stable and the effect runs once.
 */
export function useInstructionOptions(
  setInstructions: (m: Record<string, string>) => void,
  setPreset: (updater: (prev: string) => string) => void,
) {
  useEffect(() => {
    const load = () =>
      fetch("/api/auction-ai/presets")
        .then(r => r.json())
        .then((m: Record<string, string>) => {
          setInstructions(m)
          // ⚠ Keep the current choice only while it is still ON the list. Without
          // the `m[p]` test, archiving the selected instruction leaves the picker
          // showing a value with no matching <option> — it renders blank, and the
          // run posts a key that is no longer offered anywhere.
          setPreset(p => (p && m[p] ? p : Object.keys(m)[0] || ""))
        })
        .catch(() => {})
    load()
    window.addEventListener(INSTRUCTIONS_CHANGED, load)
    return () => window.removeEventListener(INSTRUCTIONS_CHANGED, load)
  }, [setInstructions, setPreset])
}
