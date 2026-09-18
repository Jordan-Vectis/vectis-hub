"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CRT_KEY } from "@/components/crt-mode"
import { JsysLookPicker } from "./jsys-style"

// The secret menu UI.
// Feature 01: RETRO CRT MODE — scanlines/phosphor overlay across the whole Hub,
// per browser (localStorage), applied everywhere by components/crt-mode.tsx.
// Feature 10: LOOK & FEEL — the shape and colours of every /jordan screen, from the tables in
// lib/jordan-theme.ts (Jordan, 2026-09-18: "the green and black retro is a little jarring to some
// people" … "a retro option, a standard hub option and a modern option and whatever else you can
// come up with? Halo style option would be cool"). Per browser too. RETRO stays the default.
//
// ⚠⚠ TWO MENUS ARE IN THE MARKUP AND CSS SHOWS ONE. The terminal (`jsys-t`: banner, numbered rows,
// [ OPEN ]) and the tile grid every other look uses (`jsys-m`). Not a hook — the server does not
// know the browser's choice, and a hook would paint the terminal first and swap after hydration.
// The <html> attribute is set before paint, so CSS gets it right from the first frame.

const TEXT = "var(--j-text)"

const TOOLS = [
  { n: "02", href: "/jordan/chat",    icon: "💬", title: "Ask AI",       blurb: "day-to-day chat, silly questions welcome" },
  { n: "03", href: "/jordan/cooking", icon: "🍳", title: "Cooking",      blurb: "expert chef chat + air fryer photo converter" },
  { n: "04", href: "/jordan/mcoc",    icon: "⚔️", title: "MCOC",         blurb: "counters, roster, deck builder, war planner & champion DB" },
  { n: "05", href: "/jordan/cv",      icon: "📄", title: "CV workshop",  blurb: "upload a CV, edit it, tailor it to a job + covering letter" },
  { n: "06", href: "/jordan/garage",  icon: "🚗", title: "Garage",       blurb: "MOT, tax & service due dates, history and past cars" },
  { n: "07", href: "/jordan/docs",    icon: "🗂️", title: "Documents",    blurb: "private file store, folders & subfolders, drag to move" },
  { n: "08", href: "/jordan/meals",   icon: "🍽️", title: "Meal planner", blurb: "BMR & macro targets, AI meal plans, shopping list" },
  { n: "09", href: "/jordan/gym",     icon: "🏋️", title: "Gym",          blurb: "AI training programmes, log every set, weights that go up" },
]

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

  const row = "flex items-center justify-between gap-4 px-4 py-3 border border-(--j-dim) rounded-lg"
  const tile = "jsys-tile block border border-(--j-dim) rounded-xl bg-(--j-box) p-5 hover:bg-(--j-glow) transition-colors min-h-[128px]"

  return (
    <div className="min-h-full bg-(--j-bg) p-6 jsys-font" style={{ color: TEXT }}>

      {/* ── The terminal (the original) ── */}
      <div className="jsys-t w-full pt-10">
        <pre className="text-[9px] sm:text-xs leading-tight mb-1 select-none overflow-x-auto" style={{ color: "var(--j-acc)" }}>
{`     ██  ██████  ██████  ██████   █████  ███    ██    ███████ ██    ██ ███████
     ██ ██    ██ ██   ██ ██   ██ ██   ██ ████   ██    ██       ██  ██  ██
     ██ ██    ██ ██████  ██   ██ ███████ ██ ██  ██    ███████   ████   ███████
██   ██ ██    ██ ██   ██ ██   ██ ██   ██ ██  ██ ██         ██    ██         ██
 █████   ██████  ██   ██ ██████  ██   ██ ██   ████ ██ ███████    ██    ███████`}
        </pre>
        <p className="text-xs mb-8 opacity-70">
          PERSONAL CONTROL PANEL v1.0 — ACCESS GRANTED: JORDAN.ORANGE
          <span className="inline-block w-2 h-3.5 ml-1 align-middle animate-pulse" style={{ background: "var(--j-acc)" }} />
        </p>

        {!booted ? (
          <p className="text-sm">INITIALISING…</p>
        ) : (
          <div className="space-y-3 text-sm">
            <button onClick={toggleCrt} className={`${row} w-full text-left hover:bg-(--j-glow) transition-colors`}>
              <span>01 &nbsp;RETRO CRT MODE <span className="opacity-50">— scanlines &amp; phosphor, whole Hub, this browser</span></span>
              <span className={`shrink-0 font-bold ${crt ? "" : "opacity-40"}`}>[ {crt ? "ON " : "OFF"} ]</span>
            </button>
            {TOOLS.map(t => (
              <Link key={t.n} href={t.href} prefetch={false} className={`${row} w-full hover:bg-(--j-glow) transition-colors`}>
                <span>{t.n} &nbsp;{t.title.toUpperCase()} <span className="opacity-50">— {t.blurb}</span></span>
                <span className="shrink-0 font-bold">[ OPEN ]</span>
              </Link>
            ))}
            <div className={`${row} flex-wrap`}>
              <span>10 &nbsp;LOOK &amp; FEEL <span className="opacity-50">— the shape and colours of every screen in here, this browser</span></span>
              <JsysLookPicker />
            </div>
            <p className="text-xs opacity-50 pt-4">
              &gt; CRT mode stays on everywhere in the Hub until switched off here. A look stays until you pick another. More features when you think of them.
            </p>
          </div>
        )}
      </div>

      {/* ── The tile grid (Hub, Modern, Halo, Paper) ── */}
      <div className="jsys-m w-full space-y-6">
        <div>
          <h1 className="jsys-title text-2xl font-bold">Jordan&rsquo;s tools</h1>
          <p className="text-sm opacity-60 mt-1">Personal control panel — signed in as jordan.orange.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map(t => (
            <Link key={t.n} href={t.href} prefetch={false} className={tile}>
              <div className="text-2xl mb-2" aria-hidden>{t.icon}</div>
              <div className="jsys-title font-bold text-lg leading-tight">{t.title}</div>
              <div className="text-sm opacity-70 mt-1 leading-snug">{t.blurb[0].toUpperCase() + t.blurb.slice(1)}</div>
            </Link>
          ))}
          <button type="button" onClick={toggleCrt} className={`${tile} text-left`}>
            <div className="text-2xl mb-2" aria-hidden>📺</div>
            <div className="flex items-center justify-between gap-3">
              <div className="jsys-title font-bold text-lg leading-tight">Retro CRT mode</div>
              <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg border ${crt ? "border-(--j-acc) bg-(--j-acc) text-(--j-on-acc)" : "border-(--j-dim) opacity-60"}`}>{crt ? "ON" : "OFF"}</span>
            </div>
            <div className="text-sm opacity-70 mt-1 leading-snug">Scanlines and phosphor across the whole Hub, this browser.</div>
          </button>
        </div>

        <div className="border border-(--j-dim) rounded-xl bg-(--j-box) p-5 space-y-3">
          <div>
            <div className="jsys-title font-bold text-lg leading-tight">Look &amp; feel</div>
            <div className="text-sm opacity-70 mt-1">The shape and colours of every screen in here. Saved on this browser.</div>
          </div>
          <JsysLookPicker />
        </div>
      </div>
    </div>
  )
}
