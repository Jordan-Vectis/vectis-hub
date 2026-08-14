"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import InductionSlideView from "@/components/induction-slide"
import InductionSign, { type SignForm } from "@/components/induction-sign"
import { LIVE_BLOCKS, SLIDE_LAYOUTS, SLIDE_GRAPHICS, parseSignedItems } from "@/lib/induction"
import type { DeckSlide, LiveData } from "@/lib/induction-data"
import {
  saveInductionSlide, deleteInductionSlide, clearInductionSlideImage, moveInductionSlide,
  saveInductionForm, deleteInductionForm, saveInductionFormItem, deleteInductionFormItem,
  deleteInductionSignature, applyInductionSlideText,
} from "@/lib/actions/induction"

// ⚠ Standing line on every AI answer in here. The induction is a legal record and the model is
// not an H&S adviser — the same stance the accident book takes about not being certified.
const NOT_ADVICE = "AI suggestion — not legal advice. Anything here needs a person to agree it before it goes in front of a new starter."

type AiIssue = { severity?: string; area?: string; what?: string; why?: string; fix?: string; slide?: string | null }

function SeverityChip({ level }: { level?: string }) {
  const l = (level ?? "").toLowerCase()
  const cls = l === "high"   ? "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300"
            : l === "medium" ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300"
            :                  "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
  return <span className={`shrink-0 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${cls}`}>{l || "note"}</span>
}

type FormItem = { id: string; label: string; detail: string | null; required: boolean; sortOrder: number }
type Form = {
  id: string; key: string; title: string; intro: string | null; body: string | null; declaration: string | null
  updatedAt: string
  askCompany: boolean; askJobTitle: boolean; askStartDate: boolean; askNotes: boolean
  active: boolean; sortOrder: number; items: FormItem[]
}
// ⚠ No `signature` here on purpose — the drawn images are fetched one at a time when a record
// is opened, not shipped with the page. See /api/induction/signature.
type Sig = {
  id: string; formId: string; formTitle: string; personName: string
  company: string | null; jobTitle: string | null; startDate: string | null; notes: string | null
  takenByName: string | null; signedAt: string; items: unknown
}

const TABS = [
  ["run",     "Run the induction"],
  ["records", "Records"],
  ["slides",  "Slides"],
  ["forms",   "Forms"],
] as const

export default function InductionClient({
  slides, forms, signatures, signatureTotal, live, isAdmin, takenByName,
}: {
  slides: DeckSlide[]; forms: Form[]; signatures: Sig[]; signatureTotal: number
  live: LiveData; isAdmin: boolean; takenByName: string
}) {
  const [tab, setTab] = useState<typeof TABS[number][0]>("run")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const [signing, setSigning] = useState<Form | null>(null)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null)
    start(async () => {
      const res = await fn()
      setMsg(res.ok ? { ok: true, text: okText } : { ok: false, text: res.error ?? "Failed" })
    })
  }

  const input = "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-amber-500"
  const card  = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5"
  const btn   = "px-4 py-2 min-h-[44px] bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold rounded-xl"

  const activeForms  = forms.filter(f => f.active)
  const activeSlides = slides.filter(s => s.active).length

  return (
    <div className="space-y-5">
      <div className="flex gap-2 flex-wrap">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setMsg(null) }}
            className={`px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
              tab === k ? "bg-amber-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            }`}>
            {label}{k === "records" && signatureTotal > 0 ? ` (${signatureTotal})` : ""}
          </button>
        ))}
      </div>

      {/* Sticky: the Slides tab is thousands of pixels long, so a confirmation at the very top
          is invisible from slide 14 — it looked as though Save had done nothing, and the second
          tap wiped the first message. The pending state is shown for the same reason. */}
      {(msg || pending) && (
        <p className={`sticky top-2 z-30 rounded-lg px-3 py-2 text-sm font-medium backdrop-blur bg-white/85 dark:bg-gray-900/85 ${
          pending ? "text-gray-600 dark:text-gray-300"
          : msg!.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {pending ? "Saving…" : `${msg!.ok ? "✓ " : "✗ "}${msg!.text}`}
        </p>
      )}

      {/* ── Run ─────────────────────────────────────────────────────────── */}
      {tab === "run" && (
        <div className="space-y-5">
          <div className={card + " flex flex-wrap items-center gap-5"}>
            <div className="flex-1 min-w-[260px]">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">1. Present the slides</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {activeSlides === 0
                  ? "No slides are in the running order — tick one back on the Slides tab before you start."
                  : <>Put it on the big screen and press F for full screen. Arrow keys, space or a click move through it,
                      N shows the presenter notes, Esc finishes. {activeSlides} slides.</>}
              </p>
            </div>
            {/* A live amber button with nothing behind it is found out in front of the room. */}
            {activeSlides === 0 ? (
              <span className="px-6 py-3 min-h-[44px] rounded-xl bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-bold inline-flex items-center cursor-not-allowed">
                ▶ Start the presentation
              </span>
            ) : (
              <Link href="/tools/induction/present"
                className="px-6 py-3 min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold inline-flex items-center">
                ▶ Start the presentation
              </Link>
            )}
          </div>

          <div className={card}>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">2. Hand the tablet over</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">
              Each form fills the screen so the Hub is out of the way. They type their own name and company, read it,
              tick each point and sign. You stay signed in — the record notes that {takenByName} took it.
            </p>
            {activeForms.length === 0 ? (
              <p className="text-sm text-gray-500">No forms are switched on. Add one on the Forms tab.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {activeForms.map(f => {
                  const signed = signatures.filter(s => s.formId === f.id).length
                  return (
                    <div key={f.id} className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-3">
                      <div>
                        <p className="font-bold text-gray-900 dark:text-white leading-snug">{f.title}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {f.items.length} point{f.items.length === 1 ? "" : "s"} to confirm · signed {signed} time{signed === 1 ? "" : "s"}
                        </p>
                      </div>
                      <button type="button" onClick={() => setSigning(f)} className={btn + " mt-auto"}>Hand over to sign →</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Records ─────────────────────────────────────────────────────── */}
      {tab === "records" && <Records signatures={signatures} total={signatureTotal} isAdmin={isAdmin} run={run} card={card} input={input} />}

      {/* ── Slides ──────────────────────────────────────────────────────── */}
      {tab === "slides" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-3xl">
            One slide per card, in running order. Each line is its own block: a line starting &quot;- &quot; is a
            bullet, &quot;## &quot; forces a heading, and a short line with no full stop at the end becomes a
            heading automatically. Presenter notes are never shown on the big screen unless you press N.
          </p>

          <DeckReview card={card} />
          {slides.map((sl, idx) => (
            <SlideEditor key={sl.id} slide={sl} live={live} idx={idx} total={slides.length} run={run} card={card} input={input} btn={btn} />
          ))}
          <form action={fd => run(() => saveInductionSlide(fd), "Slide added.")} className={card + " space-y-3 border-dashed"}>
            <p className="text-sm font-bold text-gray-900 dark:text-white">Add a slide</p>
            <input name="title" placeholder="Title" required maxLength={150} className={input} />
            <input name="subtitle" placeholder="Subtitle (optional)" maxLength={200} className={input} />
            <textarea name="body" rows={4} placeholder={"Body — one line per block. \"- \" makes a bullet, \"## \" makes a heading, and a short line with no full stop becomes a heading too."} maxLength={8000} className={input} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <input name="videoUrl" placeholder="Video link (optional)" maxLength={500} className={input} />
              <select name="liveBlock" defaultValue="NONE" className={input}>
                {LIVE_BLOCKS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
              <select name="layout" defaultValue="CONTENT" className={input}>
                {SLIDE_LAYOUTS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
              <select name="graphic" defaultValue="NONE" className={input}>
                {SLIDE_GRAPHICS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="text-xs text-gray-500 dark:text-gray-400">Order <input type="number" name="sortOrder" defaultValue={(slides.length + 1) * 10} className="ml-1 w-20 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-2 min-h-[44px] text-sm dark:[color-scheme:dark]" /></label>
              <label className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="active" defaultChecked className="accent-amber-600 h-5 w-5 shrink-0" /> In the running order</label>
              <label className="text-xs text-gray-500 dark:text-gray-400">Image <input type="file" name="image" accept="image/*" className="ml-1 file-input" /></label>
              <button className={btn + " ml-auto"}>Add slide</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Forms ───────────────────────────────────────────────────────── */}
      {tab === "forms" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-3xl">
            Editing a form only changes what the <em>next</em> person sees. Everything already signed keeps its own copy
            of the wording that was on the screen at the time, so old records never change meaning — and deleting a form
            here does not delete anything anyone signed.
          </p>
          {forms.map(f => (
            <FormEditor key={f.id} form={f} run={run} card={card} input={input} btn={btn} />
          ))}
          <form action={fd => run(() => saveInductionForm(fd), "Form added.")} className={card + " space-y-3 border-dashed"}>
            <p className="text-sm font-bold text-gray-900 dark:text-white">Add a form</p>
            <input name="title" placeholder="Title" required maxLength={200} className={input} />
            <textarea name="intro" rows={2} placeholder="Short introduction shown at the top (optional)" maxLength={4000} className={input} />
            <textarea name="body" rows={5} placeholder="The terms they read" maxLength={20000} className={input} />
            <textarea name="declaration" rows={2} placeholder="The sentence directly above the signature" maxLength={4000} className={input} />
            <div className="flex items-center gap-4 flex-wrap text-xs text-gray-600 dark:text-gray-300">
              <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="askCompany" defaultChecked className="accent-amber-600 h-5 w-5 shrink-0" /> Ask for company</label>
              <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="askJobTitle" defaultChecked className="accent-amber-600 h-5 w-5 shrink-0" /> Ask for job title</label>
              <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="askStartDate" className="accent-amber-600 h-5 w-5 shrink-0" /> Ask for start date</label>
              <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="askNotes" className="accent-amber-600 h-5 w-5 shrink-0" /> Add a questions box</label>
              <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="active" defaultChecked className="accent-amber-600 h-5 w-5 shrink-0" /> Switched on</label>
              <button className={btn + " ml-auto"}>Add form</button>
            </div>
          </form>
        </div>
      )}

      {signing && (
        <InductionSign
          form={signing as SignForm}
          takenByName={takenByName}
          onClose={() => setSigning(null)}
        />
      )}
    </div>
  )
}

// ─── Slides ───────────────────────────────────────────────────────────────

function SlideEditor({
  slide, live, idx, total, run, card, input, btn,
}: {
  slide: DeckSlide; live: LiveData; idx: number; total: number
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => void
  card: string; input: string; btn: string
}) {
  const [open, setOpen]       = useState(false)
  const [preview, setPreview] = useState(false)
  const [ai, setAi]           = useState<{ title: string; subtitle: string; body: string; changed: boolean; issues: AiIssue[] } | null>(null)
  const [aiBusy, setAiBusy]   = useState(false)
  const [aiErr, setAiErr]     = useState<string | null>(null)

  async function askAi() {
    setAiBusy(true); setAiErr(null); setAi(null)
    try {
      const res = await fetch("/api/induction/ai/rewrite", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideId: slide.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "The rewrite failed")
      setAi(json)
    } catch (e: any) {
      setAiErr(e?.message ?? "The rewrite failed")
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <div className={card + (slide.active ? "" : " opacity-60")}>
      <div className="flex items-start gap-3 flex-wrap">
        <span className="text-xs font-bold text-gray-400 tabular-nums pt-1 w-8">{idx + 1}</span>
        <div className="flex-1 min-w-[200px]">
          <p className="font-bold text-gray-900 dark:text-white">{slide.title}</p>
          {slide.subtitle && <p className="text-xs text-amber-600 dark:text-amber-400">{slide.subtitle}</p>}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {!slide.active && "Not in the running order · "}
            {slide.layout && slide.layout !== "CONTENT" && `${SLIDE_LAYOUTS.find(l => l.key === slide.layout)?.label.split(" — ")[0]} · `}
            {slide.graphic && slide.graphic !== "NONE" && `${SLIDE_GRAPHICS.find(g => g.key === slide.graphic)?.label.split(" — ")[0]} · `}
            {slide.liveBlock !== "NONE" && `${LIVE_BLOCKS.find(b => b.key === slide.liveBlock)?.label} · `}
            {slide.videoUrl && "video · "}
            {slide.imageKey && "image · "}
            {slide.notes && "presenter note"}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* ⚠ These carried NO text colour, so the arrows inherited the near-black default and
              were invisible on the dark theme — two empty boxes. Dark is the default here. */}
          <button type="button" title="Move up" aria-label="Move this slide up"
            onClick={() => run(() => moveInductionSlide(slide.id, "up"), "Moved.")} disabled={idx === 0}
            className="px-3 py-2 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-bold text-gray-700 dark:text-gray-200 disabled:opacity-30">↑</button>
          <button type="button" title="Move down" aria-label="Move this slide down"
            onClick={() => run(() => moveInductionSlide(slide.id, "down"), "Moved.")} disabled={idx === total - 1}
            className="px-3 py-2 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-bold text-gray-700 dark:text-gray-200 disabled:opacity-30">↓</button>
          <button type="button" onClick={() => setPreview(p => !p)}
            className="px-3 py-2 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300">
            {preview ? "Hide" : "Preview"}
          </button>
          <button type="button" onClick={askAi} disabled={aiBusy}
            className="px-3 py-2 min-h-[44px] rounded-lg border border-violet-400 dark:border-violet-600 text-sm font-semibold text-violet-700 dark:text-violet-300 disabled:opacity-50">
            {aiBusy ? "Checking…" : "✨ Rewrite & check"}
          </button>
          <button type="button" onClick={() => setOpen(o => !o)} className={btn}>{open ? "Close" : "Edit"}</button>
        </div>
      </div>

      {aiErr && <p className="mt-3 text-sm text-red-500 font-semibold">✗ {aiErr}</p>}

      {ai && (
        <div className="mt-4 rounded-2xl border-2 border-violet-300 dark:border-violet-700/60 bg-violet-50 dark:bg-violet-500/5 p-4 space-y-4">
          <p className="text-xs text-violet-700 dark:text-violet-300 font-semibold">{NOT_ADVICE}</p>

          {ai.issues.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-bold text-gray-900 dark:text-white">What it found wrong with this slide</p>
              {ai.issues.map((it, k) => (
                <div key={k} className="flex gap-2 items-start rounded-xl bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 p-3">
                  <SeverityChip level={it.severity} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{it.what}</p>
                    {it.why && <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{it.why}</p>}
                    {it.area && <p className="text-[11px] uppercase tracking-wide text-gray-400 mt-1">{it.area}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              It found nothing wrong with what this slide says{ai.changed ? " — the rewrite below is wording only." : "."}
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">Now</p>
              <div className="rounded-xl bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 p-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">
                <span className="font-bold block">{slide.title}</span>
                {slide.subtitle && <span className="block text-gray-500">{slide.subtitle}</span>}
                {slide.body}
              </div>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-violet-500 mb-1">Suggested</p>
              <div className="rounded-xl bg-white dark:bg-gray-900/60 border border-violet-300 dark:border-violet-700/60 p-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">
                <span className="font-bold block">{ai.title}</span>
                {ai.subtitle && <span className="block text-gray-500">{ai.subtitle}</span>}
                {ai.body}
              </div>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {/* Applying is a deliberate human action — the AI never writes to a slide itself. */}
            <button type="button"
              onClick={() => { run(() => applyInductionSlideText(slide.id, ai.title, ai.subtitle, ai.body), "Rewrite applied."); setAi(null) }}
              className="px-4 py-2 min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold">Use the suggested wording</button>
            <button type="button" onClick={() => setAi(null)}
              className="px-4 py-2 min-h-[44px] rounded-xl border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-sm font-bold">Discard</button>
          </div>
        </div>
      )}

      {preview && (
        <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 bg-gray-50 dark:bg-gray-950/40">
          <InductionSlideView slide={slide} live={live} />
        </div>
      )}

      {open && (
        <form action={fd => run(() => saveInductionSlide(fd), "Slide saved.")} className="mt-4 space-y-3 border-t border-gray-200 dark:border-gray-800 pt-4">
          <input type="hidden" name="id" value={slide.id} />
          <input name="title" defaultValue={slide.title} maxLength={150} className={input} />
          <input name="subtitle" defaultValue={slide.subtitle ?? ""} placeholder="Subtitle" maxLength={200} className={input} />
          <textarea name="body" rows={8} defaultValue={slide.body ?? ""} maxLength={8000} className={input} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <input name="videoUrl" defaultValue={slide.videoUrl ?? ""} placeholder="Video link" maxLength={500} className={input} />
            <select name="liveBlock" defaultValue={slide.liveBlock} className={input}>
              {LIVE_BLOCKS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <select name="layout" defaultValue={slide.layout || "CONTENT"} className={input}>
              {SLIDE_LAYOUTS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
            <select name="graphic" defaultValue={slide.graphic || "NONE"} className={input}>
              {SLIDE_GRAPHICS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-1">Presenter note — only ever seen by whoever is running it</label>
            <textarea name="notes" rows={2} defaultValue={slide.notes ?? ""} maxLength={4000} className={input} />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="text-xs text-gray-500 dark:text-gray-400">Order <input type="number" name="sortOrder" defaultValue={slide.sortOrder} className="ml-1 w-20 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-2 min-h-[44px] text-sm dark:[color-scheme:dark]" /></label>
            <label className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="active" defaultChecked={slide.active} className="accent-amber-600 h-5 w-5 shrink-0" /> In the running order</label>
            <label className="text-xs text-gray-500 dark:text-gray-400">Image <input type="file" name="image" accept="image/*" className="ml-1 file-input" /></label>
            {slide.imageKey && (
              <button type="button" onClick={() => run(() => clearInductionSlideImage(slide.id), "Image removed.")}
                className="text-xs font-semibold text-gray-500 hover:text-red-500 underline">Remove image</button>
            )}
            <div className="ml-auto flex gap-2">
              <button className={btn}>Save</button>
              <button type="button"
                onClick={() => { if (confirm(`Delete the slide "${slide.title}"?`)) run(() => deleteInductionSlide(slide.id), "Slide deleted.") }}
                className="px-4 py-2 min-h-[44px] border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-red-500 hover:border-red-400 text-sm font-bold rounded-xl">Delete</button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

// ─── Whole-deck AI review ─────────────────────────────────────────────────

type ReviewResult = {
  summary: string
  slideCount: number
  issues: AiIssue[]
  missing: { topic?: string; why?: string; suggestion?: string }[]
}

type FixState = { status: "done" | "failed" | "skipped"; detail?: string }

function DeckReview({ card }: { card: string }) {
  const router = useRouter()
  const [busy, setBusy]   = useState(false)
  const [res, setRes]     = useState<ReviewResult | null>(null)
  const [err, setErr]     = useState<string | null>(null)
  const [fixing, setFixing]   = useState<string | null>(null)  // slide title being worked on
  const [fixed, setFixed]     = useState<Record<number, FixState>>({})

  async function run() {
    setBusy(true); setErr(null); setRes(null); setFixed({})
    try {
      const r = await fetch("/api/induction/ai/review", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error ?? "The review failed")
      setRes(json)
    } catch (e: any) {
      setErr(e?.message ?? "The review failed")
    } finally {
      setBusy(false)
    }
  }

  /**
   * Applies every listed issue for ONE slide in a single pass — a slide with three findings is
   * rewritten once, not three times over the top of itself.
   * ⚠ Findings with no slide against them are about the induction as a whole (something
   * missing, something that needs a decision) and cannot be auto-applied. They are reported,
   * never silently counted as done.
   */
  async function applySlide(slideTitle: string, idxs: number[]): Promise<void> {
    if (!res) return
    setFixing(slideTitle)
    const mark = (status: FixState["status"], detail?: string) =>
      setFixed(prev => ({ ...prev, ...Object.fromEntries(idxs.map(i => [i, { status, detail }])) }))
    try {
      const issues = idxs.map(i => ({ what: res.issues[i]?.what ?? "", fix: res.issues[i]?.fix ?? "" }))
      const r = await fetch("/api/induction/ai/fix", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideTitle, issues }),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) { mark("failed", json.error ?? "The fix failed"); return }

      const write = await applyInductionSlideText(json.slideId, json.title, json.subtitle, json.body)
      if (!write.ok) { mark("failed", write.error ?? "Could not save the slide"); return }
      mark("done", json.notes || undefined)
    } catch (e: any) {
      mark("failed", e?.message ?? "The fix failed")
    } finally {
      setFixing(null)
      router.refresh()
    }
  }

  /** Grouped by slide, run one after another — the AI routes are rate-limited per call. */
  async function applyAll() {
    if (!res) return
    const bySlide = new Map<string, number[]>()
    res.issues.forEach((it, i) => {
      // Anything already applied is skipped; a FAILED one is included so "Fix all" retries it.
      if (!it.slide || fixed[i]?.status === "done") return
      const list = bySlide.get(it.slide) ?? []
      list.push(i)
      bySlide.set(it.slide, list)
    })
    if (bySlide.size === 0) return
    if (!confirm(`Rewrite ${bySlide.size} slide${bySlide.size === 1 ? "" : "s"} to fix ${[...bySlide.values()].flat().length} finding${[...bySlide.values()].flat().length === 1 ? "" : "s"}? Each slide is changed straight away — check them afterwards on this tab.`)) return
    for (const [title, idxs] of bySlide) {
      await applySlide(title, idxs)
    }
  }

  const applicable = res ? res.issues.map((it, i) => (it.slide && fixed[i]?.status !== "done" ? i : -1)).filter(i => i >= 0) : []

  return (
    <div className={card + " space-y-4"}>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Check the whole induction</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Reads every slide and both forms, and reports what looks wrong — factually, legally or in plain
            readability — plus anything a new starter here ought to be told that is not covered anywhere.
          </p>
        </div>
        <button type="button" onClick={run} disabled={busy}
          className="px-6 py-3 min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold disabled:opacity-50">
          {busy ? "Reading it all…" : "🔍 Review the induction"}
        </button>
      </div>

      {err && <p className="text-sm text-red-500 font-semibold">✗ {err}</p>}

      {res && (
        <div className="space-y-5 border-t border-gray-200 dark:border-gray-800 pt-4">
          <p className="text-xs text-violet-700 dark:text-violet-300 font-semibold">{NOT_ADVICE}</p>

          {res.summary && <p className="text-[15px] text-gray-800 dark:text-gray-200 leading-relaxed">{res.summary}</p>}

          <div>
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <p className="text-sm font-bold text-gray-900 dark:text-white">
                What looks wrong {res.issues.length > 0 && <span className="text-gray-400 font-normal">({res.issues.length})</span>}
              </p>
              {applicable.length > 0 && (
                <button type="button" onClick={applyAll} disabled={!!fixing}
                  className="ml-auto px-4 py-2 min-h-[44px] rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold disabled:opacity-50">
                  {fixing ? `Rewriting ${fixing}…` : `✨ Fix all ${applicable.length} on the slides`}
                </button>
              )}
            </div>
            {res.issues.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">It did not flag anything. That is worth a second opinion, not a full stop.</p>
            ) : (
              <div className="space-y-2">
                {res.issues.map((it, k) => {
                  const state = fixed[k]
                  return (
                    <div key={k} className={`flex gap-2 items-start rounded-xl border p-3 ${
                      state?.status === "done"   ? "border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-500/5"
                      : state?.status === "failed" ? "border-red-300 dark:border-red-700/60 bg-red-50 dark:bg-red-500/5"
                      : "border-gray-200 dark:border-gray-700"}`}>
                      <SeverityChip level={it.severity} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{it.what}</p>
                        {it.fix && <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{it.fix}</p>}
                        <p className="text-[11px] uppercase tracking-wide text-gray-400 mt-1">
                          {it.slide ? `Slide: ${it.slide}` : "Whole induction — needs a person"}{it.area ? ` · ${it.area}` : ""}
                        </p>
                        {state?.status === "done" && (
                          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mt-1">
                            ✓ The slide has been rewritten{state.detail ? ` — the AI could not do all of it: ${state.detail}` : ""}
                          </p>
                        )}
                        {state?.status === "failed" && (
                          <p className="text-xs font-semibold text-red-600 dark:text-red-400 mt-1">✗ {state.detail}</p>
                        )}
                      </div>
                      {/* A failed fix keeps its button — the usual cause is the AI's answer
                          coming back unreadable, which the next attempt normally clears. */}
                      {it.slide && (!state || state.status === "failed") && (
                        <button type="button" onClick={() => applySlide(it.slide!, [k])} disabled={!!fixing}
                          className="shrink-0 px-3 py-2 min-h-[44px] rounded-lg border border-violet-400 dark:border-violet-600 text-sm font-semibold text-violet-700 dark:text-violet-300 disabled:opacity-50">
                          {state?.status === "failed" ? "Try again" : "Fix this"}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-white mb-2">
              What is missing {res.missing.length > 0 && <span className="text-gray-400 font-normal">({res.missing.length})</span>}
            </p>
            {res.missing.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing suggested.</p>
            ) : (
              <div className="space-y-2">
                {res.missing.map((m, k) => (
                  <div key={k} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{m.topic}</p>
                    {m.why && <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{m.why}</p>}
                    {m.suggestion && <p className="text-sm text-gray-500 dark:text-gray-500 mt-1 italic">{m.suggestion}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400">
            Add a missing topic as a new slide at the bottom of this tab — those are never applied automatically,
            because they need someone to decide what the company is committing to. Anything marked ✓ above has
            already changed the slide; the rest of the induction is untouched.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Forms ────────────────────────────────────────────────────────────────

function FormEditor({
  form, run, card, input, btn,
}: {
  form: Form
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => void
  card: string; input: string; btn: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className={card + (form.active ? "" : " opacity-60")}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <p className="font-bold text-gray-900 dark:text-white">{form.title}</p>
          <p className="text-xs text-gray-500 mt-1">
            {form.items.length} point{form.items.length === 1 ? "" : "s"} to confirm
            {!form.active && " · switched off"}
          </p>
        </div>
        <button type="button" onClick={() => setOpen(o => !o)} className={btn}>{open ? "Close" : "Edit"}</button>
      </div>

      {open && (
        <div className="mt-4 space-y-5 border-t border-gray-200 dark:border-gray-800 pt-4">
          <form action={fd => run(() => saveInductionForm(fd), "Form saved.")} className="space-y-3">
            <input type="hidden" name="id" value={form.id} />
            <input name="title" defaultValue={form.title} maxLength={200} className={input} />
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-1">Introduction</label>
              <textarea name="intro" rows={2} defaultValue={form.intro ?? ""} maxLength={4000} className={input} />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-1">The terms they read</label>
              <textarea name="body" rows={10} defaultValue={form.body ?? ""} maxLength={20000} className={input} />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-1">Declaration — sits directly above the signature</label>
              <textarea name="declaration" rows={3} defaultValue={form.declaration ?? ""} maxLength={4000} className={input} />
            </div>
            <div className="flex items-center gap-4 flex-wrap text-xs text-gray-600 dark:text-gray-300">
              <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="askCompany" defaultChecked={form.askCompany} className="accent-amber-600 h-5 w-5 shrink-0" /> Ask for company</label>
              <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="askJobTitle" defaultChecked={form.askJobTitle} className="accent-amber-600 h-5 w-5 shrink-0" /> Ask for job title</label>
              <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="askStartDate" defaultChecked={form.askStartDate} className="accent-amber-600 h-5 w-5 shrink-0" /> Ask for start date</label>
              <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="askNotes" defaultChecked={form.askNotes} className="accent-amber-600 h-5 w-5 shrink-0" /> Questions box</label>
              <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="active" defaultChecked={form.active} className="accent-amber-600 h-5 w-5 shrink-0" /> Switched on</label>
              <label className="text-gray-500">Order <input type="number" name="sortOrder" defaultValue={form.sortOrder} className="ml-1 w-20 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-2 min-h-[44px] text-sm dark:[color-scheme:dark]" /></label>
              <div className="ml-auto flex gap-2">
                <button className={btn}>Save</button>
                <button type="button"
                  onClick={() => { if (confirm(`Delete "${form.title}"? Anything already signed is kept.`)) run(() => deleteInductionForm(form.id), "Form deleted.") }}
                  className="px-4 py-2 min-h-[44px] border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-red-500 hover:border-red-400 text-sm font-bold rounded-xl">Delete</button>
              </div>
            </div>
          </form>

          <div className="space-y-2">
            <p className="text-sm font-bold text-gray-900 dark:text-white">Points they tick</p>
            {form.items.map(it => (
              <form key={it.id} action={fd => run(() => saveInductionFormItem(fd), "Item saved.")} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                <input type="hidden" name="id" value={it.id} />
                <textarea name="label" rows={2} defaultValue={it.label} maxLength={1000} className={input} />
                <input name="detail" defaultValue={it.detail ?? ""} placeholder="Extra line underneath (optional)" maxLength={2000} className={input} />
                <div className="flex items-center gap-4 flex-wrap text-xs text-gray-600 dark:text-gray-300">
                  <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="required" defaultChecked={it.required} className="accent-amber-600 h-5 w-5 shrink-0" /> Must be ticked before they can sign</label>
                  <label className="text-gray-500">Order <input type="number" name="sortOrder" defaultValue={it.sortOrder} className="ml-1 w-20 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-2 min-h-[44px] text-sm dark:[color-scheme:dark]" /></label>
                  <div className="ml-auto flex gap-2">
                    <button className="px-3 py-2 min-h-[44px] bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg">Save</button>
                    <button type="button" onClick={() => { if (confirm("Delete this point?")) run(() => deleteInductionFormItem(it.id), "Item deleted.") }}
                      className="px-3 py-2 min-h-[44px] border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-red-500 hover:border-red-400 text-xs font-bold rounded-lg">Delete</button>
                  </div>
                </div>
              </form>
            ))}
            <form action={fd => run(() => saveInductionFormItem(fd), "Item added.")} className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-3 space-y-2">
              <input type="hidden" name="formId" value={form.id} />
              <textarea name="label" rows={2} placeholder="Add another point they must confirm" required maxLength={1000} className={input} />
              <div className="flex items-center gap-4 flex-wrap text-xs text-gray-600 dark:text-gray-300">
                <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name="required" defaultChecked className="accent-amber-600 h-5 w-5 shrink-0" /> Must be ticked</label>
                <button className="ml-auto px-3 py-2 min-h-[44px] bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Records ──────────────────────────────────────────────────────────────

function Records({
  signatures, total, isAdmin, run, card, input,
}: {
  signatures: Sig[]; total: number; isAdmin: boolean
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => void
  card: string; input: string
}) {
  const [q, setQ] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)
  // Fetched one at a time as records are opened, and remembered for this visit.
  const [sigImages, setSigImages] = useState<Record<string, string>>({})

  async function openRecord(id: string) {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    if (sigImages[id]) return
    try {
      const res = await fetch(`/api/induction/signature?id=${encodeURIComponent(id)}`)
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.signature) setSigImages(prev => ({ ...prev, [id]: json.signature }))
    } catch { /* the ✗ below says the image could not be loaded */ }
  }

  // Grouped by person so "what has this person signed?" is one row, not a hunt through a log.
  const people = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const map = new Map<string, { name: string; rows: Sig[] }>()
    for (const s of signatures) {
      if (needle && ![s.personName, s.company ?? "", s.formTitle].some(v => v.toLowerCase().includes(needle))) continue
      const key = s.personName.toLowerCase()
      const entry = map.get(key) ?? { name: s.personName, rows: [] }
      entry.rows.push(s)
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => b.rows[0].signedAt.localeCompare(a.rows[0].signedAt))
  }, [signatures, q])

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })

  if (signatures.length === 0) {
    return <p className={card + " text-sm text-gray-500"}>Nothing has been signed yet.</p>
  }

  return (
    <div className="space-y-4">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a name, company or form…" className={input + " max-w-md"} />
      {/* RULES.md: never let a silent cap read as "that is everything". */}
      {total > signatures.length && (
        <p className="text-sm text-amber-700 dark:text-amber-300 font-semibold">
          Showing the most recent {signatures.length} of {total} signed records. The search only looks at those.
        </p>
      )}
      {people.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">Nothing matches “{q}”.</p>}

      {people.map(p => (
        <div key={p.name} className={card}>
          <p className="font-bold text-gray-900 dark:text-white">{p.name}</p>
          <p className="text-xs text-gray-500 mb-3">
            {p.rows[0].company ? `${p.rows[0].company} · ` : ""}
            {p.rows.length} form{p.rows.length === 1 ? "" : "s"} signed
          </p>

          <div className="space-y-2">
            {p.rows.map(s => {
              const items = parseSignedItems(s.items)
              const open  = openId === s.id
              return (
                <div key={s.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.formTitle}</p>
                      <p className="text-xs text-gray-500">
                        {fmt(s.signedAt)}{s.takenByName ? ` · taken by ${s.takenByName}` : ""}
                        {items.length ? ` · ${items.filter(i => i.ticked).length}/${items.length} confirmed` : ""}
                      </p>
                    </div>
                    <button type="button" onClick={() => openRecord(s.id)}
                      className="px-3 py-2 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300">
                      {open ? "Hide" : "View"}
                    </button>
                    <a href={`/api/induction/pdf?id=${s.id}`} target="_blank" rel="noreferrer"
                      className="px-3 py-2 min-h-[44px] rounded-lg bg-gray-800 dark:bg-gray-700 hover:bg-gray-700 dark:hover:bg-gray-600 text-white text-sm font-semibold inline-flex items-center">
                      🖨 PDF
                    </a>
                    {isAdmin && (
                      <button type="button"
                        onClick={() => { if (confirm(`Delete ${p.name}'s signed record of "${s.formTitle}"? This cannot be undone.`)) run(() => deleteInductionSignature(s.id), "Record deleted.") }}
                        className="px-3 py-2 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-red-500 hover:border-red-400 text-sm font-semibold">Delete</button>
                    )}
                  </div>

                  {open && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-800 space-y-3">
                      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
                        {s.jobTitle  && <div><dt className="inline font-semibold">Job title: </dt><dd className="inline">{s.jobTitle}</dd></div>}
                        {s.company   && <div><dt className="inline font-semibold">Company: </dt><dd className="inline">{s.company}</dd></div>}
                        {s.startDate && <div><dt className="inline font-semibold">Start date: </dt><dd className="inline">{s.startDate}</dd></div>}
                      </dl>
                      {items.length > 0 && (
                        // ⚠ An unticked line here is an OPTIONAL point left blank — a required
                        // one cannot be saved unticked at all. Showing it in red said "refused".
                        <ul className="text-sm space-y-1">
                          {items.map((it, k) => (
                            <li key={k} className={it.ticked ? "text-emerald-700 dark:text-emerald-400" : "text-gray-500 dark:text-gray-400"}>
                              {it.ticked ? "✓" : "○"} {it.label}{it.ticked ? "" : " — optional, not ticked"}
                            </li>
                          ))}
                        </ul>
                      )}
                      {s.notes && (
                        <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-700/50 p-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1">They asked</p>
                          <p className="text-sm text-amber-900 dark:text-amber-200 whitespace-pre-line">{s.notes}</p>
                        </div>
                      )}
                      {sigImages[s.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={sigImages[s.id]} alt={`${p.name}'s signature`} className="h-24 w-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white" />
                      ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-400">Loading the signature…</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
