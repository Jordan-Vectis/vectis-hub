"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { signInductionForm } from "@/lib/actions/induction"

// The signing screen for Facilities → Induction.
//
// ⚠ The person signing is NOT the logged-in user. An admin opens this on the tablet and hands
// it over, so the name, company and job title are TYPED IN, and the record separately stores
// who was signed in when it was taken. That is why this cannot reuse the AUP terms gate, which
// keys everything to the session user.
//
// It covers the whole screen deliberately: the Hub's nav must not be sitting there while a new
// starter is holding the tablet.

type Item = { id: string; label: string; detail: string | null; required: boolean }
export type SignForm = {
  id: string
  /** When this copy of the form was loaded. Sent back on submit so the server can refuse to
   *  store a snapshot the signer never saw — see signInductionForm. */
  updatedAt: string
  title: string
  intro: string | null
  body: string | null
  declaration: string | null
  askCompany: boolean
  askJobTitle: boolean
  askStartDate: boolean
  askNotes: boolean
  items: Item[]
}

const STEPS = ["Your details", "Read and confirm", "Sign"] as const

export default function InductionSign({ form, takenByName, onClose }: { form: SignForm; takenByName: string; onClose: () => void }) {
  const router = useRouter()
  const [step, setStep]   = useState(0)
  const [name, setName]   = useState("")
  const [company, setCompany]     = useState("")
  const [jobTitle, setJobTitle]   = useState("")
  const [startDate, setStartDate] = useState("")
  const [notes, setNotes]         = useState("")
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [hasSig, setHasSig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [done, setDone]     = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing   = useRef(false)
  const last      = useRef<{ x: number; y: number } | null>(null)

  const missing = form.items.filter(i => i.required && !ticked.has(i.id))

  // ⚠ The canvas only exists on step 2, so stepping BACK unmounts it and coming forward again
  // mounts a fresh, blank one. `hasSig` has to be cleared with it — otherwise the Submit button
  // stays enabled over an empty canvas and a signed record is created with a blank white
  // signature that nothing downstream can tell apart from a real one.
  useEffect(() => {
    if (step !== 2) { setHasSig(false); return }
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111827"
  }, [step])

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
    // A single dot counts as a mark. Setting this only on move meant someone whose signature is
    // a short stab could not submit and had no idea why.
    const ctx = canvasRef.current?.getContext("2d")
    if (ctx && last.current) {
      ctx.beginPath(); ctx.arc(last.current.x, last.current.y, 1.25, 0, Math.PI * 2); ctx.fill()
    }
    if (!hasSig) setHasSig(true)
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
  function clearSig() {
    const c = canvasRef.current
    if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height)
    setHasSig(false)
  }

  // Nothing is saved until Submit, so closing throws away everything they have typed and
  // drawn. Ask first once there is anything to lose — on a tablet the ✕ is easy to catch.
  function close() {
    if (!name.trim() && ticked.size === 0 && !hasSig) { onClose(); return }
    if (confirm("Close this form? Nothing has been saved, and anything filled in will be lost.")) onClose()
  }

  function toggle(id: string) {
    setTicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  /** Is there actually ink on the canvas? The last line of defence against storing a blank
   *  white PNG that every downstream check would happily accept as a signature. */
  function hasInk(c: HTMLCanvasElement): boolean {
    try {
      const data = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data
      if (!data) return true          // can't tell — don't block a genuine signer
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true
      return false
    } catch { return true }
  }

  async function submit() {
    const c = canvasRef.current
    if (!c || !hasSig || saving) return
    if (!hasInk(c)) { setError("The signature box is empty — please sign it."); setHasSig(false); return }
    setSaving(true); setError(null)
    try {
      // Composite onto white — a transparent PNG of dark ink is invisible everywhere it is
      // later shown, and it has to print.
      const out = document.createElement("canvas")
      out.width = c.width; out.height = c.height
      const octx = out.getContext("2d")!
      octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, out.width, out.height)
      octx.drawImage(c, 0, 0)

      const res = await signInductionForm({
        formId: form.id,
        formUpdatedAt: form.updatedAt,
        personName: name,
        company, jobTitle, startDate, notes,
        ticked: [...ticked],
        signature: out.toDataURL("image/png"),
      })
      if (!res.ok) { setError(res.error); setSaving(false); return }
      setDone(true)
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? "Could not save the signature")
      setSaving(false)
    }
  }

  const input = "w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-base text-gray-900 dark:text-white focus:outline-none focus:border-amber-500"
  const label = "block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5"

  if (done) {
    return (
      <div className="fixed inset-0 z-[200] bg-white dark:bg-[#141416] flex items-center justify-center p-6">
        <div className="text-center max-w-lg">
          <div className="text-6xl mb-4">✓</div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Signed and recorded</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            {name} signed <span className="font-semibold">{form.title}</span>. It is saved against their name and can be
            printed from the Records tab at any time.
          </p>
          <button type="button" onClick={onClose}
            className="mt-6 px-8 py-3 min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold">
            Back to the forms
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[200] bg-white dark:bg-[#141416] flex flex-col">
      {/* Header — the person holding this is not staff, so it shows the form and nothing else */}
      <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-4 flex-wrap">
        <span className="inline-flex items-center bg-white rounded-full px-3 py-1 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/vectis-logo.svg" alt="Vectis Auctions" className="h-6 w-auto" />
        </span>
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white leading-tight">{form.title}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">Being taken by {takenByName}</p>
        </div>
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <span key={s} className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              i === step ? "bg-amber-500 text-white"
              : i < step ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
              : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"}`}>{i + 1}. {s}</span>
          ))}
        </div>
        <button type="button" onClick={close} aria-label="Close"
          className="h-11 w-11 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 text-xl leading-none">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6">
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Please fill these in yourself, then read the form on the next screen.
              </p>
              {/* The DPIA says to tell people what the record is for AT THE POINT OF SIGNING.
                  Most people signing this have no other relationship with Vectis and no Hub
                  account, so this line is the only privacy notice they will ever get. */}
              <p className="text-xs text-gray-500 dark:text-gray-400 rounded-xl border border-gray-200 dark:border-gray-700 p-3 leading-relaxed">
                What you type here, and your signature, are kept by Vectis Auctions as the record that this was
                covered with you. It is used for health and safety and employment purposes only, is visible to the
                managers who run inductions, and is not shared with anyone outside the company. Ask the person
                inducting you if you want to know more.
              </p>
              <div>
                <label className={label}>Your full name</label>
                <input value={name} onChange={e => setName(e.target.value)} className={input} autoFocus placeholder="First name and surname" />
              </div>
              {form.askCompany && (
                <div>
                  <label className={label}>Company</label>
                  <input value={company} onChange={e => setCompany(e.target.value)} className={input} placeholder="e.g. Vectis Auctions" />
                </div>
              )}
              {form.askJobTitle && (
                <div>
                  <label className={label}>Job title</label>
                  <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} className={input} />
                </div>
              )}
              {form.askStartDate && (
                <div>
                  <label className={label}>Start date</label>
                  {/* RULES.md: a native date control draws its picker glyph and drop-down in the
                      BROWSER's colours. color-scheme is what actually tells it we are dark —
                      styling the text alone leaves a black glyph on a dark field. */}
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className={input + " dark:[color-scheme:dark]"} />
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              {form.intro && <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">{form.intro}</p>}
              {form.body && (
                <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 p-5">
                  <p className="text-[15px] text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">{form.body}</p>
                </div>
              )}
              {form.items.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tick each one to confirm</p>
                  {form.items.map(it => {
                    const on = ticked.has(it.id)
                    return (
                      <button key={it.id} type="button" onClick={() => toggle(it.id)}
                        className={`w-full text-left flex gap-3 items-start rounded-xl border p-4 min-h-[44px] transition-colors ${
                          on ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                             : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800/40 hover:border-gray-400"}`}>
                        <span className={`shrink-0 mt-0.5 h-6 w-6 rounded-md border-2 flex items-center justify-center text-sm font-bold ${
                          on ? "border-emerald-500 bg-emerald-500 text-white" : "border-gray-400 dark:border-gray-600 text-transparent"}`}>✓</span>
                        <span>
                          <span className="block text-[15px] text-gray-900 dark:text-gray-100 leading-snug">{it.label}</span>
                          {it.detail && <span className="block text-sm text-gray-500 dark:text-gray-400 mt-0.5">{it.detail}</span>}
                          {!it.required && <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">Optional</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
              {form.askNotes && (
                <div>
                  <label className={label}>Anything you are unsure about, or want to ask?</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={input}
                    placeholder="Optional — this is saved with your form and read by the health and safety team." />
                  {/* ⚠ A box on a slide deck about defibrillators, pacemakers and lifting invites
                      "I have a heart condition, is that a problem?" — special-category health data
                      landing in a plain text column that everyone with the permission can read. */}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                    Please do not type medical or health details here — tell the person inducting you, or your
                    manager, in person instead.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {form.declaration && (
                <div className="rounded-2xl border-2 border-amber-400 dark:border-amber-600/60 bg-amber-50 dark:bg-amber-500/10 p-5">
                  <p className="text-[15px] text-gray-900 dark:text-gray-100 leading-relaxed whitespace-pre-line">{form.declaration}</p>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-semibold text-gray-800 dark:text-gray-200">Sign here{name ? ` — ${name}` : ""}</label>
                <button type="button" onClick={clearSig} className="text-sm font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline min-h-[44px] px-2">Clear</button>
              </div>
              {/* touch-none, or the page scrolls under the finger instead of drawing (RULES.md) */}
              <canvas ref={canvasRef} width={900} height={260}
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
                className="w-full h-[220px] rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white touch-none cursor-crosshair" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Draw your signature above with your finger. If you are unable to sign, or have any trouble signing,
                please say so before continuing.
              </p>
              <dl className="text-sm text-gray-600 dark:text-gray-400 grid sm:grid-cols-2 gap-x-6 gap-y-1 pt-2 border-t border-gray-200 dark:border-gray-800">
                <div><dt className="inline font-semibold">Name: </dt><dd className="inline">{name || "—"}</dd></div>
                {form.askCompany   && <div><dt className="inline font-semibold">Company: </dt><dd className="inline">{company || "—"}</dd></div>}
                {form.askJobTitle  && <div><dt className="inline font-semibold">Job title: </dt><dd className="inline">{jobTitle || "—"}</dd></div>}
                {form.askStartDate && <div><dt className="inline font-semibold">Start date: </dt><dd className="inline">{startDate || "—"}</dd></div>}
              </dl>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400 font-semibold">{error}</p>}
        </div>
      </div>

      {/* Footer — one clear action, always in the same place */}
      <div className="border-t border-gray-200 dark:border-gray-800 px-5 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <button type="button" onClick={() => (step === 0 ? close() : setStep(step - 1))}
            className="px-5 py-3 min-h-[44px] rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold">
            {step === 0 ? "Cancel" : "Back"}
          </button>

          {step === 0 && (
            <button type="button" disabled={!name.trim()} onClick={() => setStep(1)}
              className="px-8 py-3 min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40">
              Read the form →
            </button>
          )}
          {step === 1 && (
            <div className="flex items-center gap-3">
              {missing.length > 0 && (
                <span className="text-sm text-gray-500 dark:text-gray-400">{missing.length} still to tick</span>
              )}
              <button type="button" disabled={missing.length > 0} onClick={() => setStep(2)}
                className="px-8 py-3 min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40">
                Continue to sign →
              </button>
            </div>
          )}
          {step === 2 && (
            <button type="button" disabled={!hasSig || saving} onClick={submit}
              className="px-8 py-3 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40">
              {saving ? "Saving…" : "Submit signature ✓"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
