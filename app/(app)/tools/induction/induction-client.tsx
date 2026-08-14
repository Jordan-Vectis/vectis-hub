"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import InductionSlideView from "@/components/induction-slide"
import InductionSign, { type SignForm } from "@/components/induction-sign"
import { LIVE_BLOCKS, parseSignedItems } from "@/lib/induction"
import type { DeckSlide, LiveData } from "@/lib/induction-data"
import {
  saveInductionSlide, deleteInductionSlide, clearInductionSlideImage, moveInductionSlide,
  saveInductionForm, deleteInductionForm, saveInductionFormItem, deleteInductionFormItem,
  deleteInductionSignature,
} from "@/lib/actions/induction"

type FormItem = { id: string; label: string; detail: string | null; required: boolean; sortOrder: number }
type Form = {
  id: string; key: string; title: string; intro: string | null; body: string | null; declaration: string | null
  askCompany: boolean; askJobTitle: boolean; askStartDate: boolean; askNotes: boolean
  active: boolean; sortOrder: number; items: FormItem[]
}
type Sig = {
  id: string; formId: string; formTitle: string; personName: string
  company: string | null; jobTitle: string | null; startDate: string | null; notes: string | null
  signature: string; takenByName: string | null; signedAt: string; items: unknown
}

const TABS = [
  ["run",     "Run the induction"],
  ["records", "Records"],
  ["slides",  "Slides"],
  ["forms",   "Forms"],
] as const

export default function InductionClient({
  slides, forms, signatures, live, isAdmin, takenByName,
}: {
  slides: DeckSlide[]; forms: Form[]; signatures: Sig[]; live: LiveData; isAdmin: boolean; takenByName: string
}) {
  const [tab, setTab] = useState<typeof TABS[number][0]>("run")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [, start] = useTransition()
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

  const activeForms = forms.filter(f => f.active)

  return (
    <div className="space-y-5">
      <div className="flex gap-2 flex-wrap">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setMsg(null) }}
            className={`px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
              tab === k ? "bg-amber-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            }`}>
            {label}{k === "records" && signatures.length > 0 ? ` (${signatures.length})` : ""}
          </button>
        ))}
      </div>

      {msg && <p className={`text-sm font-medium ${msg.ok ? "text-emerald-600" : "text-red-500"}`}>{msg.ok ? "✓ " : "✗ "}{msg.text}</p>}

      {/* ── Run ─────────────────────────────────────────────────────────── */}
      {tab === "run" && (
        <div className="space-y-5">
          <div className={card + " flex flex-wrap items-center gap-5"}>
            <div className="flex-1 min-w-[260px]">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">1. Present the slides</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Opens full screen on this device — put it on the big screen. Arrow keys or space to move through,
                N for the presenter notes, Esc to finish. {slides.filter(s => s.active).length} slides.
              </p>
            </div>
            <Link href="/tools/induction/present"
              className="px-6 py-3 min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold inline-flex items-center">
              ▶ Start the presentation
            </Link>
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
      {tab === "records" && <Records signatures={signatures} isAdmin={isAdmin} run={run} card={card} input={input} />}

      {/* ── Slides ──────────────────────────────────────────────────────── */}
      {tab === "slides" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-3xl">
            One slide per card, in running order. A blank line starts a new paragraph and a line beginning
            &quot;- &quot; becomes a bullet. Presenter notes are never shown on the big screen unless you press N.
          </p>
          {slides.map((sl, idx) => (
            <SlideEditor key={sl.id} slide={sl} live={live} idx={idx} total={slides.length} run={run} card={card} input={input} btn={btn} />
          ))}
          <form action={fd => run(() => saveInductionSlide(fd), "Slide added.")} className={card + " space-y-3 border-dashed"}>
            <p className="text-sm font-bold text-gray-900 dark:text-white">Add a slide</p>
            <input name="title" placeholder="Title" required maxLength={150} className={input} />
            <input name="subtitle" placeholder="Subtitle (optional)" maxLength={200} className={input} />
            <textarea name="body" rows={4} placeholder="Body — a blank line starts a paragraph, a line starting with - is a bullet" maxLength={8000} className={input} />
            <div className="grid gap-3 sm:grid-cols-2">
              <input name="videoUrl" placeholder="Video link (optional)" maxLength={500} className={input} />
              <select name="liveBlock" defaultValue="NONE" className={input}>
                {LIVE_BLOCKS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="text-xs text-gray-500 dark:text-gray-400">Order <input type="number" name="sortOrder" defaultValue={(slides.length + 1) * 10} className="ml-1 w-20 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1 text-sm" /></label>
              <label className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked className="accent-amber-600" /> In the running order</label>
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
              <label className="flex items-center gap-1.5"><input type="checkbox" name="askCompany" defaultChecked className="accent-amber-600" /> Ask for company</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="askJobTitle" defaultChecked className="accent-amber-600" /> Ask for job title</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="askStartDate" className="accent-amber-600" /> Ask for start date</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="askNotes" className="accent-amber-600" /> Add a questions box</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked className="accent-amber-600" /> Switched on</label>
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

  return (
    <div className={card + (slide.active ? "" : " opacity-60")}>
      <div className="flex items-start gap-3 flex-wrap">
        <span className="text-xs font-bold text-gray-400 tabular-nums pt-1 w-8">{idx + 1}</span>
        <div className="flex-1 min-w-[200px]">
          <p className="font-bold text-gray-900 dark:text-white">{slide.title}</p>
          {slide.subtitle && <p className="text-xs text-amber-600 dark:text-amber-400">{slide.subtitle}</p>}
          <p className="text-xs text-gray-500 mt-1">
            {!slide.active && "Not in the running order · "}
            {slide.liveBlock !== "NONE" && `${LIVE_BLOCKS.find(b => b.key === slide.liveBlock)?.label} · `}
            {slide.videoUrl && "video · "}
            {slide.imageKey && "image · "}
            {slide.notes && "presenter note"}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => run(() => moveInductionSlide(slide.id, "up"), "Moved.")} disabled={idx === 0}
            className="px-3 py-2 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-30">↑</button>
          <button type="button" onClick={() => run(() => moveInductionSlide(slide.id, "down"), "Moved.")} disabled={idx === total - 1}
            className="px-3 py-2 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-30">↓</button>
          <button type="button" onClick={() => setPreview(p => !p)}
            className="px-3 py-2 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300">
            {preview ? "Hide" : "Preview"}
          </button>
          <button type="button" onClick={() => setOpen(o => !o)} className={btn}>{open ? "Close" : "Edit"}</button>
        </div>
      </div>

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
          <div className="grid gap-3 sm:grid-cols-2">
            <input name="videoUrl" defaultValue={slide.videoUrl ?? ""} placeholder="Video link" maxLength={500} className={input} />
            <select name="liveBlock" defaultValue={slide.liveBlock} className={input}>
              {LIVE_BLOCKS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-400 mb-1">Presenter note — only ever seen by whoever is running it</label>
            <textarea name="notes" rows={2} defaultValue={slide.notes ?? ""} maxLength={4000} className={input} />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="text-xs text-gray-500 dark:text-gray-400">Order <input type="number" name="sortOrder" defaultValue={slide.sortOrder} className="ml-1 w-20 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1 text-sm" /></label>
            <label className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={slide.active} className="accent-amber-600" /> In the running order</label>
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
              <label className="flex items-center gap-1.5"><input type="checkbox" name="askCompany" defaultChecked={form.askCompany} className="accent-amber-600" /> Ask for company</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="askJobTitle" defaultChecked={form.askJobTitle} className="accent-amber-600" /> Ask for job title</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="askStartDate" defaultChecked={form.askStartDate} className="accent-amber-600" /> Ask for start date</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="askNotes" defaultChecked={form.askNotes} className="accent-amber-600" /> Questions box</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={form.active} className="accent-amber-600" /> Switched on</label>
              <label className="text-gray-500">Order <input type="number" name="sortOrder" defaultValue={form.sortOrder} className="ml-1 w-20 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1 text-sm" /></label>
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
                  <label className="flex items-center gap-1.5"><input type="checkbox" name="required" defaultChecked={it.required} className="accent-amber-600" /> Must be ticked before they can sign</label>
                  <label className="text-gray-500">Order <input type="number" name="sortOrder" defaultValue={it.sortOrder} className="ml-1 w-20 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1 text-sm" /></label>
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
                <label className="flex items-center gap-1.5"><input type="checkbox" name="required" defaultChecked className="accent-amber-600" /> Must be ticked</label>
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
  signatures, isAdmin, run, card, input,
}: {
  signatures: Sig[]; isAdmin: boolean
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => void
  card: string; input: string
}) {
  const [q, setQ] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)

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
      {people.length === 0 && <p className="text-sm text-gray-500">Nothing matches “{q}”.</p>}

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
                    <button type="button" onClick={() => setOpenId(open ? null : s.id)}
                      className="px-3 py-2 min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300">
                      {open ? "Hide" : "View"}
                    </button>
                    <a href={`/api/induction/pdf?id=${s.id}`} target="_blank" rel="noreferrer"
                      className="px-3 py-2 min-h-[44px] rounded-lg bg-gray-800 dark:bg-gray-700 hover:bg-gray-700 text-white text-sm font-semibold inline-flex items-center">
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
                        <ul className="text-sm space-y-1">
                          {items.map((it, k) => (
                            <li key={k} className={it.ticked ? "text-gray-700 dark:text-gray-300" : "text-red-600 dark:text-red-400"}>
                              {it.ticked ? "✓" : "✗"} {it.label}
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
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.signature} alt={`${p.name}'s signature`} className="h-24 w-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white" />
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
