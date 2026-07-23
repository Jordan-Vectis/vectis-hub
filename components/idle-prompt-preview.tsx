"use client"

import { useState } from "react"
import type { IdleReason } from "@/lib/idle-timer-config"

// Admin → Cataloguer Activity Timer: a faithful, read-only PREVIEW of the
// activity/away popup cataloguers get (the "What were you doing?" modal), driven
// by the reasons configured on this page. Nothing is saved — it's for admins to
// see how their reasons, icons, labels and note prompts appear.
//
// ⚠ This mirrors the REAL popup, whose markup lives inline in the lot wizard
// (app/(app)/tools/cataloguing/auctions/[id]/lot-wizard-tab.tsx — search
// "What were you doing?"). If you restyle one, restyle the other. The popup card
// is always white (even in dark mode), so this uses light text throughout.
export default function IdlePromptPreview({ reasons }: { reasons: IdleReason[] }) {
  const [open, setOpen]     = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [notes, setNotes]   = useState("")
  const [totes, setTotes]   = useState("")

  const SAMPLE_SECS = 12 * 60 + 30   // realistic sample gap (the popup fires past the red threshold)

  function openPreview() { setReason(null); setNotes(""); setTotes(""); setOpen(true) }

  // Faithful copy of the wizard's duration formatter.
  const fmtIdleDuration = (secs: number) => {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }
  const now   = Date.now()
  const start = now - SAMPLE_SECS * 1000
  const hhmm  = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

  // Note / follow-up field logic, same as the real popup.
  const cfg      = reasons.find(r => r.key === reason)
  const prompt   = cfg?.notePrompt?.trim()
  const required = !!cfg?.requiresNotes
  const showNote = reason !== "LUNCH_BREAK" && (required || !!prompt)
  const missing  = required && !notes.trim()

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold border border-[#2AB4A6] text-[#1a8a80] dark:text-[#2AB4A6] hover:bg-[#2AB4A6] hover:text-white transition-colors"
      >
        👁 Preview the popup
      </button>

      {open && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
            {/* Preview chrome — not part of the real popup */}
            <span className="absolute top-4 left-4 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Preview</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close preview"
              className="absolute top-3 right-3 h-8 w-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-lg leading-none"
            >✕</button>

            <div className="text-center mb-5 mt-2">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-600 mb-1">What were you doing?</p>
              <p className="text-5xl font-mono font-bold text-gray-900">{fmtIdleDuration(SAMPLE_SECS)}</p>
              <p className="text-sm font-semibold text-gray-700 mt-1.5">{hhmm(start)} – {hhmm(now)}</p>
              <p className="text-xs text-gray-500 mt-1">since your last saved lot — working hours (Mon–Fri, 9–5) only</p>
            </div>

            {/* Reason buttons — exactly the reasons configured on this page */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {reasons.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => { setReason(opt.key); setNotes(""); setTotes("") }}
                  className={`py-3 rounded-xl text-sm font-semibold border-2 transition-all ${
                    reason === opt.key
                      ? "border-[#2AB4A6] bg-[#2AB4A6]/10 text-[#1a8a80]"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>

            {/* Lotting Up — tote numbers field */}
            {reason === "LOTTING_UP" && (
              <div className="space-y-2 mb-4">
                <input
                  value={totes}
                  onChange={e => setTotes(e.target.value)}
                  placeholder="Tote numbers (e.g. F001, F002)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#2AB4A6]"
                />
              </div>
            )}

            {/* Note / follow-up question — shown for reasons that require a note OR carry a custom prompt */}
            {showNote && (
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  {prompt || "Note"}
                  {required && <> <span className="text-red-500">*</span><span className="font-normal text-gray-400 ml-1">required</span></>}
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={prompt ? `${prompt}…` : "Please explain what you were doing…"}
                  className={`w-full border rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none resize-none transition-colors ${
                    missing ? "border-red-300 bg-red-50 focus:border-red-400" : "border-gray-200 focus:border-[#2AB4A6]"
                  }`}
                  rows={3}
                />
                {missing && <p className="text-xs text-red-500 mt-1">An answer is required before you can continue.</p>}
              </div>
            )}

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full py-3 bg-[#2AB4A6] hover:bg-[#22a090] text-white font-bold rounded-xl transition-colors"
            >
              Close preview
            </button>
            <p className="text-center text-xs text-gray-400 mt-2">Preview only — nothing is saved.</p>
          </div>
        </div>
      )}
    </>
  )
}
