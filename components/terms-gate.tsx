"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { TERMS, TERMS_TITLE } from "@/lib/terms"

// App-wide blocking modal: a signed-in user who hasn't accepted the current policy
// version must read it, accept, and draw a signature before using the app. Rendered
// by app/(app)/layout.tsx only when needed.
export default function TermsGate({ userName }: { userName: string }) {
  const router = useRouter()
  const [accepted, setAccepted] = useState(false)     // phase 1 done → show signature pad
  const [hasSig, setHasSig]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [done, setDone]         = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing   = useRef(false)
  const last      = useRef<{ x: number; y: number } | null>(null)

  // Prepare the canvas once the signature step is shown.
  useEffect(() => {
    if (!accepted) return
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext("2d")
    if (!ctx) return
    ctx.lineWidth = 2.5
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "#111827"
  }, [accepted])

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = pos(e)
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx || !last.current) return
    const p = pos(e)
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p
    if (!hasSig) setHasSig(true)
  }
  function up() { drawing.current = false; last.current = null }
  function clear() {
    const c = canvasRef.current
    if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height)
    setHasSig(false)
  }

  async function submit() {
    const c = canvasRef.current
    if (!c || !hasSig || submitting) return
    setSubmitting(true); setError(null)
    try {
      // Composite onto white so the stored PNG isn't transparent dark ink (which
      // would be invisible on a dark background in the admin viewer / anywhere).
      const out = document.createElement("canvas")
      out.width = c.width; out.height = c.height
      const octx = out.getContext("2d")!
      octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, out.width, out.height)
      octx.drawImage(c, 0, 0)
      const signature = out.toDataURL("image/png")
      const res = await fetch("/api/terms/accept", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signature }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "Could not save your signature")
      setDone(true)
      router.refresh()
    } catch (e: any) { setError(e.message); setSubmitting(false) }
  }

  if (done) return null

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          {/* Vectis letterhead — on a white oval so it stands out in dark mode too */}
          <span className="inline-flex items-center bg-white rounded-full px-4 py-1.5 mb-3 shadow-sm">
            <img src="/vectis-logo.svg" alt="Vectis Auctions" className="h-8 w-auto" />
          </span>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{TERMS_TITLE}</h2>
          <p className="text-xs text-gray-500 mt-0.5">Please read this policy carefully. You need to accept and sign it once before using the app.</p>
        </div>

        {/* Terms */}
        <div className="px-5 py-4 overflow-y-auto space-y-4 text-sm text-gray-700 dark:text-gray-300 flex-1">
          {TERMS.map((section, i) => (
            <section key={i}>
              <h3 className="font-bold text-gray-900 dark:text-white mb-1">{section.title}</h3>
              <div className="space-y-2">
                {section.blocks.map((b, j) => {
                  if (b.type === "h") return <p key={j} className="font-semibold text-gray-800 dark:text-gray-200 pt-1">{b.text}</p>
                  if (b.type === "ul") return (
                    <ul key={j} className="list-disc pl-5 space-y-0.5">
                      {b.items.map((it, k) => <li key={k}>{it}</li>)}
                    </ul>
                  )
                  return <p key={j} className="leading-relaxed">{b.text}</p>
                })}
              </div>
            </section>
          ))}
        </div>

        {/* Footer — phase 1 accept, then phase 2 sign */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
          {!accepted ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-gray-500">By continuing you confirm you have read and understood the above.</p>
              <button type="button" onClick={() => setAccepted(true)}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">
                I accept — sign below →
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-semibold text-gray-800 dark:text-gray-200">Sign here{userName ? ` — ${userName}` : ""}</label>
                <button type="button" onClick={clear} className="text-xs font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline">Clear</button>
              </div>
              <canvas
                ref={canvasRef} width={600} height={180}
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
                className="w-full h-[150px] rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white touch-none cursor-crosshair"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Draw your signature in the box above with your finger or the mouse. If you&apos;re unable to sign, or you have any trouble
                signing, please speak to your manager before continuing.
              </p>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => { setAccepted(false); clear() }}
                  className="px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-semibold">Back</button>
                <button type="button" onClick={submit} disabled={!hasSig || submitting}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
                  {submitting ? "Saving…" : "Submit signature ✓"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
