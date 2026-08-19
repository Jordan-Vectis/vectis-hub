"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CRT_KEY } from "@/components/crt-mode"

// The secret menu UI — retro terminal styling, because obviously.
// Feature 01: RETRO CRT MODE — scanlines/phosphor overlay across the whole Hub,
// per browser (localStorage), applied everywhere by components/crt-mode.tsx.

const GREEN = "#33ff66"

export default function JordanMenu() {
  const [crt, setCrt] = useState(false)
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    queueMicrotask(() => {
      try { setCrt(localStorage.getItem(CRT_KEY) === "1") } catch {}
    })
    const t = setTimeout(() => setBooted(true), 400)
    return () => clearTimeout(t)
  }, [])

  function toggleCrt() {
    const next = !crt
    setCrt(next)
    try {
      if (next) localStorage.setItem(CRT_KEY, "1")
      else localStorage.removeItem(CRT_KEY)
    } catch {}
    document.documentElement.classList.toggle("crt-mode", next)
  }

  const row = "flex items-center justify-between gap-4 px-4 py-3 border border-[#1f5c33] rounded-lg"

  return (
    <div className="min-h-full bg-black p-6 font-mono" style={{ color: GREEN }}>
      <div className="w-full pt-10">
        <pre className="text-[9px] sm:text-xs leading-tight mb-1 select-none overflow-x-auto" style={{ color: GREEN }}>
{`     ██  ██████  ██████  ██████   █████  ███    ██    ███████ ██    ██ ███████
     ██ ██    ██ ██   ██ ██   ██ ██   ██ ████   ██    ██       ██  ██  ██
     ██ ██    ██ ██████  ██   ██ ███████ ██ ██  ██    ███████   ████   ███████
██   ██ ██    ██ ██   ██ ██   ██ ██   ██ ██  ██ ██         ██    ██         ██
 █████   ██████  ██   ██ ██████  ██   ██ ██   ████ ██ ███████    ██    ███████`}
        </pre>
        <p className="text-xs mb-8 opacity-70">
          PERSONAL CONTROL PANEL v1.0 — ACCESS GRANTED: JORDAN.ORANGE
          <span className="inline-block w-2 h-3.5 ml-1 align-middle animate-pulse" style={{ background: GREEN }} />
        </p>

        {!booted ? (
          <p className="text-sm">INITIALISING…</p>
        ) : (
          <div className="space-y-3 text-sm">
            <button onClick={toggleCrt} className={`${row} w-full text-left hover:bg-[#0a2214] transition-colors`}>
              <span>01 &nbsp;RETRO CRT MODE <span className="opacity-50">— scanlines &amp; phosphor, whole Hub, this browser</span></span>
              <span className="shrink-0 font-bold" style={{ color: crt ? GREEN : "#777" }}>
                [ {crt ? "ON " : "OFF"} ]
              </span>
            </button>

            <Link href="/jordan/chat" prefetch={false} className={`${row} w-full hover:bg-[#0a2214] transition-colors`}>
              <span>02 &nbsp;ASK AI <span className="opacity-50">— day-to-day chat, silly questions welcome</span></span>
              <span className="shrink-0 font-bold">[ OPEN ]</span>
            </Link>
            <Link href="/jordan/cooking" prefetch={false} className={`${row} w-full hover:bg-[#0a2214] transition-colors`}>
              <span>03 &nbsp;COOKING <span className="opacity-50">— expert chef chat + air fryer photo converter</span></span>
              <span className="shrink-0 font-bold">[ OPEN ]</span>
            </Link>
            <Link href="/jordan/mcoc" prefetch={false} className={`${row} w-full hover:bg-[#0a2214] transition-colors`}>
              <span>04 &nbsp;MCOC <span className="opacity-50">— counters, roster, deck builder, war planner &amp; champion DB</span></span>
              <span className="shrink-0 font-bold">[ OPEN ]</span>
            </Link>
            <Link href="/jordan/cv" prefetch={false} className={`${row} w-full hover:bg-[#0a2214] transition-colors`}>
              <span>05 &nbsp;CV WORKSHOP <span className="opacity-50">— upload a CV, edit it, tailor it to a job + covering letter</span></span>
              <span className="shrink-0 font-bold">[ OPEN ]</span>
            </Link>
            <Link href="/jordan/garage" prefetch={false} className={`${row} w-full hover:bg-[#0a2214] transition-colors`}>
              <span>06 &nbsp;GARAGE <span className="opacity-50">— MOT, tax &amp; service due dates, history and past cars</span></span>
              <span className="shrink-0 font-bold">[ OPEN ]</span>
            </Link>
            <Link href="/jordan/docs" prefetch={false} className={`${row} w-full hover:bg-[#0a2214] transition-colors`}>
              <span>07 &nbsp;DOCUMENTS <span className="opacity-50">— private file store, folders &amp; subfolders, drag to move</span></span>
              <span className="shrink-0 font-bold">[ OPEN ]</span>
            </Link>
            <div className={`${row} opacity-40 select-none`}>
              <span>08 &nbsp;????????????</span>
              <span className="shrink-0">[ LOCKED ]</span>
            </div>

            <p className="text-xs opacity-50 pt-4">
              &gt; CRT mode stays on everywhere in the Hub until switched off here. More features when you think of them.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
