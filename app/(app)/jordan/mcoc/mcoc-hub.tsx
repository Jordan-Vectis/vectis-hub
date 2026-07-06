"use client"

import { useState } from "react"
import McocClient from "./mcoc-client"
import RosterClient from "../roster/roster-client"

export type Champ = { id: string; name: string; class: string; stars: number; rank: number; bgsDeck: boolean; imageUrl: string | null }

// The single MCOC section — Counters + My Roster as tabs. Both stay mounted
// (hidden when inactive) so switching tabs doesn't lose a lookup or edits.
export default function McocHub({ roster, initialTab }: { roster: Champ[]; initialTab: "counters" | "roster" }) {
  const [tab, setTab] = useState<"counters" | "roster">(initialTab)

  const btn = (active: boolean) =>
    `px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
      active ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] opacity-60 hover:opacity-100"
    }`

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex gap-2 mb-4 shrink-0">
        <button onClick={() => setTab("counters")} className={btn(tab === "counters")}>⚔ COUNTERS</button>
        <button onClick={() => setTab("roster")} className={btn(tab === "roster")}>★ MY ROSTER</button>
      </div>
      <div className={tab === "counters" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <McocClient roster={roster} />
      </div>
      <div className={tab === "roster" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <RosterClient initial={roster} />
      </div>
    </div>
  )
}
