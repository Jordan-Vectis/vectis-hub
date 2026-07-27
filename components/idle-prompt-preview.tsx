"use client"

import { useState } from "react"
import type { IdleReason } from "@/lib/idle-timer-config"

// Admin → Cataloguer Activity Timer: a faithful, read-only PREVIEW of the
// activity/away popup cataloguers get (the "How was this time spent?" modal),
// driven by the reasons configured on this page. Nothing is saved — it's for
// admins to see how their reasons, icons, labels and note prompts appear,
// including the multi-select time-split sliders.
//
// ⚠ This mirrors the REAL popup, whose markup lives inline in the lot wizard
// (app/(app)/tools/cataloguing/auctions/[id]/lot-wizard-tab.tsx — search
// "How was this time spent?"). If you restyle one, restyle the other. The popup
// card is always white (even in dark mode), so this uses light text throughout.
export default function IdlePromptPreview({ reasons }: { reasons: IdleReason[] }) {
  const [open, setOpen]             = useState(false)
  const [selected, setSelected]     = useState<string[]>([])
  const [alloc, setAlloc]           = useState<Record<string, number>>({})
  const [notes, setNotes]           = useState<Record<string, string>>({})
  const [totes, setTotes]           = useState("")
  const [otherWarn, setOtherWarn]   = useState(false)
  const [unallocWarn, setUnallocWarn] = useState(false)

  // Admin chooses the gap duration to simulate, then fires the popup on themselves.
  // Nothing is saved — this only drives how the read-only replica renders, so it is
  // handy for checking the whole-minute split sliders at any duration (including a
  // sub-minute gap, to see the rounding). Defaults to a realistic 3-minute gap.
  const [durMin, setDurMin]         = useState(3)
  const [durSec, setDurSec]         = useState(0)
  const [gapSecs, setGapSecs]       = useState(3 * 60)   // the duration the OPEN popup shows

  function openPreview() {
    setSelected([]); setAlloc({}); setNotes({}); setTotes(""); setOtherWarn(false); setUnallocWarn(false)
    setGapSecs(Math.max(1, Math.round(durMin) * 60 + Math.round(durSec)))   // freeze at open
    setOpen(true)
  }

  // Faithful copies of the wizard's formatters + split maths.
  // Whole minutes, ROUNDED UP — the popup deliberately shows no seconds.
  const fmtIdleDuration = (secs: number) => {
    if (secs <= 0) return "0m"
    const mins = Math.max(1, Math.ceil(secs / 60))
    const h = Math.floor(mins / 60), m = mins % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }
  const now   = Date.now()
  const start = now - gapSecs * 1000
  const hhmm  = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

  // Faithful copy of the wizard's MANUAL split: each selected reason starts at
  // 0m and only moves when its own slider is dragged — nothing auto-adjusts.
  // Whatever is left over shows as (and would be logged as) unallocated.
  // Whole-minute total so the header, per-reason labels and the split sliders all
  // agree — the real popup rounds the gap UP to whole minutes, so mirror that here
  // (otherwise a 2m-of-"3m" slice would sit at the wrong fraction of the bar).
  const totalMs = Math.ceil(gapSecs / 60) * 60 * 1000
  const segMs = new Map<string, number>(selected.map(k => [k, selected.length <= 1 ? totalMs : (alloc[k] ?? 0)]))
  const multi = selected.length > 1
  const sliderStep = 60_000   // whole minutes — the popup shows no seconds
  const unallocMs  = multi ? Math.max(0, totalMs - selected.reduce((s, k) => s + (alloc[k] ?? 0), 0)) : 0

  // A slider was dragged: snap to whole minutes, hard-stop at what's still
  // unallocated (the final drag may take the exact sub-minute remainder).
  function setSplit(key: string, rawMs: number) {
    const others = selected.reduce((s, k) => (k === key ? s : s + (alloc[k] ?? 0)), 0)
    const v = Math.max(0, Math.min(Math.round(rawMs / 60_000) * 60_000, totalMs - others))
    setAlloc(a => ({ ...a, [key]: v }))
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Simulate a gap of</label>
          <div className="flex items-center gap-1.5">
            <input
              type="number" min={0} value={durMin}
              onChange={e => setDurMin(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              aria-label="Minutes"
              className="w-16 border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-[#2AB4A6]"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">min</span>
            <input
              type="number" min={0} max={59} value={durSec}
              onChange={e => setDurSec(Math.min(59, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
              aria-label="Seconds"
              className="w-16 border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-[#2AB4A6]"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">sec</span>
          </div>
        </div>
        <button
          type="button"
          onClick={openPreview}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold border border-[#2AB4A6] text-[#1a8a80] dark:text-[#2AB4A6] hover:bg-[#2AB4A6] hover:text-white transition-colors"
        >
          ▶ Test the popup on me
        </button>
      </div>
      <p className="text-[11px] text-gray-400 mt-1.5">Fires the activity popup on you at the chosen duration — read-only, nothing is saved.</p>

      {open && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative max-h-[92vh] overflow-y-auto">
            {/* Preview chrome — not part of the real popup */}
            <span className="absolute top-4 left-4 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Preview</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close preview"
              className="absolute top-3 right-3 h-8 w-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-lg leading-none"
            >✕</button>

            <div className="text-center mb-5 mt-2">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-600 mb-1">How was this time spent?</p>
              <p className="text-5xl font-mono font-bold text-gray-900">{fmtIdleDuration(gapSecs)}</p>
              <p className="text-sm font-semibold text-gray-700 mt-1.5">{hhmm(start)} – {hhmm(now)}</p>
              <p className="text-xs text-gray-500 mt-1">since your last saved lot — working hours (Mon–Fri, 9–5) only</p>
            </div>

            {/* Reason buttons — exactly the reasons configured on this page */}
            <div className="grid grid-cols-3 gap-2 mb-1.5">
              {reasons.map(opt => {
                const on = selected.includes(opt.key)
                return (
                  <button
                    key={opt.key}
                    onClick={() => {
                      // Selecting "Other" goes via the reminder first; deselecting is instant.
                      if (!on && opt.key === "OTHER") { setOtherWarn(true); return }
                      setSelected(sel => on ? sel.filter(k => k !== opt.key) : [...sel, opt.key])
                    }}
                    className={`py-3 rounded-xl text-sm font-semibold border-2 transition-all ${
                      on
                        ? "border-[#2AB4A6] bg-[#2AB4A6]/10 text-[#1a8a80]"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    {opt.icon} {opt.label}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-gray-400 text-center mb-3">Doing more than one thing? Tap all that apply.</p>

            {/* Split sliders — only when more than one reason is picked */}
            {multi && (
              <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold text-gray-700">Split the time between them</p>
                <p className="text-[11px] text-gray-500 mb-2.5">A rough estimate is absolutely fine — it doesn&apos;t need to be exact.</p>
                <div className="space-y-2.5">
                  {selected.map(key => {
                    const cfg = reasons.find(r => r.key === key)
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between text-xs mb-0.5">
                          <span className="font-semibold text-gray-700">{cfg?.icon} {cfg?.label ?? key}</span>
                          <span className="font-mono font-bold text-[#1a8a80]">{fmtIdleDuration(Math.round((segMs.get(key) ?? 0) / 1000))}</span>
                        </div>
                        <input type="range" min={0} max={totalMs} step={sliderStep}
                          value={segMs.get(key) ?? 0}
                          onChange={e => setSplit(key, Number(e.target.value))}
                          className="w-full accent-[#2AB4A6]" />
                      </div>
                    )
                  })}
                </div>
                {/* Whatever isn't given to a reason is recorded as unallocated */}
                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-200 text-xs">
                  <span className="font-semibold text-gray-500">❔ Not allocated</span>
                  <span className={`font-mono font-bold ${unallocMs >= 1000 ? "text-amber-600" : "text-gray-400"}`}>
                    {fmtIdleDuration(Math.round(unallocMs / 1000))}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Anything left over is recorded as unallocated time.</p>
              </div>
            )}

            {/* Lotting Up — tote numbers field */}
            {selected.includes("LOTTING_UP") && (
              <div className="space-y-2 mb-4">
                <input
                  value={totes}
                  onChange={e => setTotes(e.target.value)}
                  placeholder="Tote numbers (e.g. F001, F002)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#2AB4A6]"
                />
              </div>
            )}

            {/* Note / follow-up question — one per selected reason that needs one */}
            {selected.map(key => {
              if (key === "LUNCH_BREAK") return null
              const cfg = reasons.find(r => r.key === key)
              const prompt   = cfg?.notePrompt?.trim()
              const required = !!cfg?.requiresNotes
              if (!required && !prompt) return null
              const missing = required && !notes[key]?.trim()
              return (
                <div key={key} className="mb-4">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    {multi ? `${cfg?.icon} ${cfg?.label} — ` : ""}{prompt || "Note"}
                    {required && <> <span className="text-red-500">*</span><span className="font-normal text-gray-400 ml-1">required</span></>}
                  </label>
                  <textarea
                    value={notes[key] ?? ""}
                    onChange={e => setNotes(m => ({ ...m, [key]: e.target.value }))}
                    placeholder={prompt ? `${prompt}…` : "Please explain what you were doing…"}
                    className={`w-full border rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none resize-none transition-colors ${
                      missing ? "border-red-300 bg-red-50 focus:border-red-400" : "border-gray-200 focus:border-[#2AB4A6]"
                    }`}
                    rows={multi ? 2 : 3}
                  />
                  {missing && <p className="text-xs text-red-500 mt-1">An answer is required before you can continue.</p>}
                </div>
              )
            })}

            <button
              type="button"
              onClick={() => { if (unallocMs >= 60_000) setUnallocWarn(true); else setOpen(false) }}
              className="w-full py-3 bg-[#2AB4A6] hover:bg-[#22a090] text-white font-bold rounded-xl transition-colors"
            >
              Close preview
            </button>
            <p className="text-center text-xs text-gray-400 mt-2">Preview only — nothing is saved.</p>
          </div>

          {/* "Other" reminder — pick a listed option if one fits */}
          {otherWarn && (
            <div className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
                <p className="text-sm font-bold text-gray-900 mb-1.5">⚠️ Before you pick Other…</p>
                <p className="text-sm text-gray-600 mb-4">
                  Only use Other when none of the options above cover what you were doing.
                  If there&apos;s an option for it, please pick that one instead.
                </p>
                <div className="flex flex-col gap-2">
                  <button type="button" onClick={() => setOtherWarn(false)}
                    className="w-full py-2.5 bg-[#2AB4A6] hover:bg-[#22a090] text-white text-sm font-bold rounded-xl transition-colors">
                    ← I&apos;ll pick an option instead
                  </button>
                  <button type="button"
                    onClick={() => { setSelected(sel => sel.includes("OTHER") ? sel : [...sel, "OTHER"]); setOtherWarn(false) }}
                    className="w-full py-2.5 border-2 border-gray-200 hover:border-gray-300 text-gray-600 text-sm font-semibold rounded-xl transition-colors">
                    None of them fit — use Other
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Unallocated-time warning — shown when they submit with time left over */}
          {unallocWarn && (
            <div className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
                <p className="text-sm font-bold text-gray-900 mb-1.5">⚠️ You have unallocated time</p>
                <p className="text-sm text-gray-600 mb-4">
                  <span className="font-bold text-amber-600">{fmtIdleDuration(Math.round(unallocMs / 1000))}</span> of
                  this time hasn&apos;t been given to an activity. You can go back and share it out using the sliders,
                  or continue and it will be recorded as unallocated time.
                </p>
                <div className="flex flex-col gap-2">
                  <button type="button" onClick={() => setUnallocWarn(false)}
                    className="w-full py-2.5 bg-[#2AB4A6] hover:bg-[#22a090] text-white text-sm font-bold rounded-xl transition-colors">
                    ← Go back and allocate it
                  </button>
                  <button type="button" onClick={() => { setUnallocWarn(false); setOpen(false) }}
                    className="w-full py-2.5 border-2 border-gray-200 hover:border-gray-300 text-gray-600 text-sm font-semibold rounded-xl transition-colors">
                    Continue anyway
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
