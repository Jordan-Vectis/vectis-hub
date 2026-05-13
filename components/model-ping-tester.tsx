"use client"

import { useRef, useState } from "react"

type Status = "testing" | "cancelled" | { ok: boolean; ms: number; error?: string }

// Reusable model ping tester popup. Drop it in next to any model dropdown.
// Sequential (per RULES.md — never Promise.all, burns quota) but a short
// 250ms gap between calls and a cancel button you can hit mid-run.

export default function ModelPingTester({
  models,
  current,
  onPick,
  triggerLabel = "⚡ Test models",
}: {
  models:       string[]
  current?:     string
  onPick?:      (model: string) => void
  triggerLabel?: string
}) {
  const [open, setOpen]     = useState(false)
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [busy, setBusy]     = useState(false)
  const cancelRef           = useRef(false)
  const abortRef            = useRef<AbortController | null>(null)

  async function runTests() {
    if (busy) return
    setBusy(true)
    cancelRef.current = false
    const initial: Record<string, Status> = {}
    models.forEach(m => { initial[m] = "testing" })
    setStatus(initial)

    for (const m of models) {
      if (cancelRef.current) {
        // Mark anything still "testing" as cancelled
        setStatus(prev => {
          const next = { ...prev }
          for (const k of Object.keys(next)) {
            if (next[k] === "testing") next[k] = "cancelled"
          }
          return next
        })
        break
      }
      const ac = new AbortController()
      abortRef.current = ac
      try {
        const r = await fetch("/api/auction-ai/model-test", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ model: m }),
          signal:  ac.signal,
        })
        const d = await r.json()
        setStatus(prev => ({ ...prev, [m]: d }))
      } catch (e: any) {
        if (ac.signal.aborted) {
          setStatus(prev => ({ ...prev, [m]: "cancelled" }))
        } else {
          setStatus(prev => ({ ...prev, [m]: { ok: false, ms: 0, error: e?.message ?? "Network error" } }))
        }
      } finally {
        abortRef.current = null
      }
      if (cancelRef.current) continue   // skip the gap if we're cancelling
      // Short gap — sequential but snappier than 1s
      await new Promise(res => setTimeout(res, 250))
    }
    setBusy(false)
  }

  function cancel() {
    cancelRef.current = true
    abortRef.current?.abort()
  }

  function pick(m: string) {
    onPick?.(m)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-gray-500 hover:text-gray-900 hover:underline"
        title="Ping each model and report latency"
      >
        {triggerLabel}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Model ping test</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sequential test, 1-second gap between models. Click a model to pick it.
                </p>
              </div>
              {busy ? (
                <button
                  onClick={cancel}
                  className="bg-red-600 hover:bg-red-500 text-white text-xs font-semibold px-3 py-1.5 rounded-md"
                >
                  ✕ Cancel
                </button>
              ) : (
                <button
                  onClick={runTests}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold px-3 py-1.5 rounded-md"
                >
                  ▶ Run test
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
              {models.length === 0 && (
                <p className="text-sm text-gray-500 italic">No models loaded.</p>
              )}
              {models.map(m => {
                const s = status[m]
                const isCurrent = m === current
                return (
                  <button
                    key={m}
                    onClick={() => pick(m)}
                    disabled={!onPick}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left border rounded-md transition-colors ${
                      isCurrent
                        ? "border-cyan-300 bg-cyan-50"
                        : "border-gray-200 hover:bg-gray-50"
                    } ${onPick ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <span className="font-mono text-xs text-gray-800 flex-1 truncate">
                      {m}{isCurrent && <span className="ml-2 text-cyan-600">(selected)</span>}
                    </span>
                    {s === "testing"   && <span className="text-xs text-gray-500 animate-pulse">testing…</span>}
                    {s === "cancelled" && <span className="text-xs text-gray-400">— skipped</span>}
                    {s && s !== "testing" && s !== "cancelled" && (
                      s.ok
                        ? <span className={`text-xs font-medium ${s.ms < 5000 ? "text-green-600" : s.ms < 12000 ? "text-yellow-600" : "text-orange-600"}`}>
                            ✓ {(s.ms / 1000).toFixed(1)}s
                          </span>
                        : <span className="text-xs text-red-600 truncate max-w-[160px]" title={s.error}>
                            ✗ {s.error?.match(/\[(\d{3}[^\]]*)\]/)?.[1] ?? "error"}
                          </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
