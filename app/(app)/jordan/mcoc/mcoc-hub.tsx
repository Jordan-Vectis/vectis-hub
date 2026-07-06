"use client"

import { useState } from "react"
import McocClient from "./mcoc-client"
import RosterClient from "../roster/roster-client"
import ChampDbClient from "./champdb-client"
import DeckBuilderClient from "./deckbuilder-client"
import AwClient from "./aw-client"

export type Champ = { id: string; name: string; class: string; stars: number; rank: number; bgsDeck: boolean; imageUrl: string | null }
type Tab = "counters" | "roster" | "champdb" | "deck" | "aw"

// The single MCOC section. Counters/Roster stay mounted (hidden when inactive)
// so switching keeps state; the heavier tabs mount on demand.
export default function McocHub({ roster, initialTab }: { roster: Champ[]; initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)

  const btn = (active: boolean) =>
    `px-3.5 py-2 rounded-lg text-sm font-bold border transition-colors ${
      active ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] opacity-60 hover:opacity-100"
    }`

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex gap-2 mb-4 shrink-0 flex-wrap">
        <button onClick={() => setTab("counters")} className={btn(tab === "counters")}>⚔ COUNTERS</button>
        <button onClick={() => setTab("roster")} className={btn(tab === "roster")}>★ ROSTER</button>
        <button onClick={() => setTab("deck")} className={btn(tab === "deck")}>🃏 DECK BUILDER</button>
        <button onClick={() => setTab("aw")} className={btn(tab === "aw")}>🏰 WAR</button>
        <button onClick={() => setTab("champdb")} className={btn(tab === "champdb")}>🧬 CHAMPION DB</button>
      </div>
      <div className={tab === "counters" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <McocClient roster={roster} active={tab === "counters"} />
      </div>
      <div className={tab === "roster" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <RosterClient initial={roster} />
      </div>
      {tab === "deck" && (
        <div className="flex-1 min-h-0 flex flex-col"><DeckBuilderClient roster={roster} /></div>
      )}
      {tab === "aw" && (
        <div className="flex-1 min-h-0 flex flex-col"><AwClient roster={roster} /></div>
      )}
      {tab === "champdb" && (
        <div className="flex-1 min-h-0 flex flex-col"><ChampDbClient roster={roster} /></div>
      )}
    </div>
  )
}
