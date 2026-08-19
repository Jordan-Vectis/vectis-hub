"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { EMPTY_CV, cvToText, normaliseCv, type Cv, type CvRole, type CvStudy, type CvExtra } from "@/lib/jordan-cv"

// JORDAN.SYS → CV WORKSHOP. Private to /jordan (every route 404s for anyone else).
//
// Three panels: the PROFILES strip (one per person, so a partner's CV lives here
// too), the EDITOR for that profile's master CV, and TAILOR — paste a job advert
// and get a CV cut for it plus a covering letter, saved as an application.
//
// ⚠ The uploaded file is read by the model, not by a parsing library: the Hub has
// pdf-lib (which writes PDFs, it cannot read them) and nothing else. See the
// parse route for why that is the right trade here.

const GREEN = "#33ff66"
const box   = "border border-[#1f5c33] rounded-lg bg-[#040f08]"
const input = "w-full bg-black border border-[#1f5c33] rounded px-2.5 py-1.5 text-sm text-[#33ff66] placeholder:text-[#1f5c33] focus:outline-none focus:border-[#33ff66]"
const btn   = "px-3 py-1.5 text-xs border border-[#1f5c33] rounded hover:bg-[#0a2214] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const btnGo = "px-4 py-2 text-sm font-bold rounded bg-[#33ff66] text-black hover:bg-[#5cff88] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"

type Profile = { id: string; name: string; sourceName: string; updatedAt: string; applications: number; cv: Cv }
type Application = {
  id: string; jobTitle: string; company: string; jobText: string
  coverLetter: string; notes: string; createdAt: string; cv: Cv
}

export default function CvClient() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeId, setActiveId] = useState<string>("")
  const [cv, setCv]             = useState<Cv>(EMPTY_CV)
  const [dirty, setDirty]       = useState(false)
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [note, setNote]         = useState<string | null>(null)
  const [needsMigration, setNeedsMigration] = useState(false)

  // Tailoring
  const [jobText, setJobText]   = useState("")
  const [jobTitle, setJobTitle] = useState("")
  const [company, setCompany]   = useState("")
  const [apps, setApps]         = useState<Application[]>([])
  const [openApp, setOpenApp]   = useState<Application | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const active  = profiles.find(p => p.id === activeId) ?? null

  const loadProfiles = useCallback(async (selectId?: string) => {
    setLoading(true)
    try {
      const r = await fetch("/api/jordan/cv/profiles")
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't load profiles")
      setNeedsMigration(!!j.needsMigration)
      const list: Profile[] = j.profiles ?? []
      setProfiles(list)
      const pick = selectId ?? (list.some(p => p.id === activeId) ? activeId : list[0]?.id ?? "")
      setActiveId(pick)
      const chosen = list.find(p => p.id === pick)
      setCv(chosen ? normaliseCv(chosen.cv) : EMPTY_CV)
      setDirty(false)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  useEffect(() => { void loadProfiles() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  // Applications follow the selected profile.
  useEffect(() => {
    if (!activeId) { setApps([]); return }
    fetch(`/api/jordan/cv/applications?profileId=${encodeURIComponent(activeId)}`)
      .then(r => r.json()).then(j => setApps(j.applications ?? [])).catch(() => {})
  }, [activeId])

  function selectProfile(id: string) {
    if (dirty && !confirm("You have unsaved changes to this CV. Switch anyway?")) return
    setActiveId(id)
    const p = profiles.find(x => x.id === id)
    setCv(p ? normaliseCv(p.cv) : EMPTY_CV)
    setDirty(false)
    setOpenApp(null)
  }

  function edit(patch: Partial<Cv>) { setCv(c => ({ ...c, ...patch })); setDirty(true) }

  async function api(url: string, body: any, method = "POST") {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? "Something went wrong")
    return j
  }

  async function newProfile() {
    const name = prompt("Whose CV is this? (e.g. Me, Kate)")?.trim()
    if (!name) return
    setError(null); setBusy("new")
    try {
      const j = await api("/api/jordan/cv/profiles", { name, cv: EMPTY_CV })
      await loadProfiles(j.id)
      setNote(`Created "${name}" — upload a CV or fill it in below.`)
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  async function saveProfile() {
    if (!activeId) return
    setError(null); setBusy("save")
    try {
      await api("/api/jordan/cv/profiles", { id: activeId, cv, rawText: cvToText(cv) }, "PUT")
      setDirty(false)
      setNote("Saved.")
      setProfiles(ps => ps.map(p => p.id === activeId ? { ...p, cv } : p))
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  async function renameProfile() {
    if (!active) return
    const name = prompt("Rename this profile", active.name)?.trim()
    if (!name || name === active.name) return
    try {
      await api("/api/jordan/cv/profiles", { id: active.id, name }, "PUT")
      setProfiles(ps => ps.map(p => p.id === active.id ? { ...p, name } : p))
    } catch (e: any) { setError(e.message) }
  }

  async function deleteProfile() {
    if (!active) return
    if (!confirm(`Delete "${active.name}" and its ${active.applications} saved application(s)? This can't be undone.`)) return
    try {
      await api("/api/jordan/cv/profiles", { id: active.id }, "DELETE")
      await loadProfiles("")
    } catch (e: any) { setError(e.message) }
  }

  async function upload(file: File) {
    setError(null); setNote(null); setBusy("upload")
    try {
      const fd = new FormData()
      fd.append("file", file)
      const r = await fetch("/api/jordan/cv/parse", { method: "POST", body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't read that file")

      const parsed = normaliseCv(j.cv)
      if (activeId) {
        // ⚠ Never silently overwrite a CV that has been worked on.
        const replace = confirm(`Read "${j.sourceName}". Replace the CV on "${active?.name}" with it?\n\nOK = replace · Cancel = create a new profile instead.`)
        if (replace) {
          await api("/api/jordan/cv/profiles", { id: activeId, cv: parsed, rawText: j.rawText, sourceName: j.sourceName }, "PUT")
          await loadProfiles(activeId)
          setNote(`Loaded ${j.sourceName}. Check it over — nothing was rewritten, it is just what the file said.`)
          return
        }
      }
      const name = prompt("Whose CV is this?", parsed.name || "New profile")?.trim() || parsed.name || "New profile"
      const created = await api("/api/jordan/cv/profiles", { name, cv: parsed, rawText: j.rawText, sourceName: j.sourceName })
      await loadProfiles(created.id)
      setNote(`Loaded ${j.sourceName} into "${name}". Check it over — nothing was rewritten.`)
    } catch (e: any) { setError(e.message) } finally { setBusy(null); if (fileRef.current) fileRef.current.value = "" }
  }

  async function tailor() {
    if (!activeId || !jobText.trim()) return
    setError(null); setNote(null); setBusy("tailor")
    try {
      const j = await api("/api/jordan/cv/tailor", { profileId: activeId, jobText, jobTitle, company })
      const fresh = await fetch(`/api/jordan/cv/applications?profileId=${encodeURIComponent(activeId)}`).then(r => r.json())
      setApps(fresh.applications ?? [])
      setOpenApp((fresh.applications ?? []).find((a: Application) => a.id === j.id) ?? null)
      setJobText(""); setJobTitle(""); setCompany("")
      setNote("Done — read it through before you send anything.")
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  async function deleteApp(id: string) {
    if (!confirm("Delete this application?")) return
    try {
      await api("/api/jordan/cv/applications", { id }, "DELETE")
      setApps(a => a.filter(x => x.id !== id))
      if (openApp?.id === id) setOpenApp(null)
    } catch (e: any) { setError(e.message) }
  }

  async function downloadPdf(kind: "cv" | "letter", doc: Cv, letter = "", meta: { company?: string; jobTitle?: string; filename?: string } = {}) {
    setError(null); setBusy(`pdf-${kind}`)
    try {
      const r = await fetch("/api/jordan/cv/pdf", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, cv: doc, letter, ...meta }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't build the PDF")
      const blob = await r.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href = url
      a.download = `${meta.filename || (kind === "letter" ? "Covering letter" : doc.name || "CV")}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  function copy(text: string, what: string) {
    navigator.clipboard.writeText(text).then(() => setNote(`${what} copied.`)).catch(() => setError("Couldn't copy."))
  }

  // ── Editor helpers ─────────────────────────────────────────────────────────
  const setRole  = (i: number, patch: Partial<CvRole>) =>
    edit({ experience: cv.experience.map((r, n) => n === i ? { ...r, ...patch } : r) })
  const setStudy = (i: number, patch: Partial<CvStudy>) =>
    edit({ education: cv.education.map((e, n) => n === i ? { ...e, ...patch } : e) })
  const setExtra = (i: number, patch: Partial<CvExtra>) =>
    edit({ extras: cv.extras.map((x, n) => n === i ? { ...x, ...patch } : x) })
  const move = <T,>(arr: T[], i: number, dir: -1 | 1): T[] => {
    const j = i + dir
    if (j < 0 || j >= arr.length) return arr
    const next = [...arr]; const [it] = next.splice(i, 1); next.splice(j, 0, it); return next
  }

  return (
    <div className="space-y-4 text-sm pb-16">
      {needsMigration && (
        <div className="border border-amber-600 bg-amber-950/30 text-amber-300 rounded-lg px-4 py-2.5 text-xs">
          The CV tables aren&apos;t in the database yet — press <strong>Run Migrations</strong> on the Admin page, then reload.
        </div>
      )}
      {error && <div className="border border-red-700 bg-red-950/40 text-red-300 rounded-lg px-4 py-2.5 text-xs">{error}</div>}
      {note  && <div className="border border-[#1f5c33] bg-[#0a2214] rounded-lg px-4 py-2.5 text-xs opacity-90">{note}</div>}

      {/* ── Profiles ── */}
      <div className={`${box} p-4`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="text-xs tracking-widest opacity-60">PROFILES</span>
          <div className="flex gap-2">
            <button className={btn} onClick={newProfile} disabled={busy === "new"}>+ NEW</button>
            <button className={btn} onClick={() => fileRef.current?.click()} disabled={busy === "upload"}>
              {busy === "upload" ? "READING…" : "⬆ UPLOAD CV"}
            </button>
            <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
          </div>
        </div>

        {loading ? <p className="text-xs opacity-60">LOADING…</p> : profiles.length === 0 ? (
          <p className="text-xs opacity-60">
            Nothing here yet. <strong>Upload a CV</strong> (PDF, or a clear photo of one) and it will be read in automatically — or create an empty profile and type it.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {profiles.map(p => (
              <button key={p.id} onClick={() => selectProfile(p.id)}
                className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                  p.id === activeId ? "border-[#33ff66] bg-[#0a2214]" : "border-[#1f5c33] hover:bg-[#0a2214]"}`}>
                {p.name}
                <span className="opacity-50 ml-2">{p.applications} job{p.applications === 1 ? "" : "s"}</span>
              </button>
            ))}
            {active && (
              <span className="ml-auto flex gap-2">
                <button className={btn} onClick={renameProfile}>RENAME</button>
                <button className={`${btn} hover:border-red-500 hover:text-red-400`} onClick={deleteProfile}>DELETE</button>
              </span>
            )}
          </div>
        )}
        {active?.sourceName && <p className="text-[11px] opacity-40 mt-2">from {active.sourceName}</p>}
      </div>

      {active && (
        <>
          {/* ── Editor ── */}
          <div className={`${box} p-4 space-y-4`}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs tracking-widest opacity-60">MASTER CV — {active.name.toUpperCase()}</span>
              <div className="flex gap-2 items-center">
                {dirty && <span className="text-[11px] text-amber-400">unsaved</span>}
                <button className={btn} onClick={() => copy(cvToText(cv), "CV")}>COPY TEXT</button>
                <button className={btn} onClick={() => downloadPdf("cv", cv, "", { filename: cv.name || active.name })}
                  disabled={busy === "pdf-cv"}>{busy === "pdf-cv" ? "…" : "⬇ PDF"}</button>
                <button className={btnGo} onClick={saveProfile} disabled={!dirty || busy === "save"}>
                  {busy === "save" ? "SAVING…" : "SAVE"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Name"      value={cv.name}     onChange={v => edit({ name: v })} />
              <Field label="Headline"  value={cv.headline} onChange={v => edit({ headline: v })} placeholder="IT Manager" />
              <Field label="Email"     value={cv.email}    onChange={v => edit({ email: v })} />
              <Field label="Phone"     value={cv.phone}    onChange={v => edit({ phone: v })} />
              <Field label="Location"  value={cv.location} onChange={v => edit({ location: v })} />
              <Field label="Links (one per line)" value={cv.links.join("\n")} multiline rows={2}
                onChange={v => edit({ links: v.split("\n").map(s => s.trim()).filter(Boolean) })} />
            </div>

            <Field label="Profile / personal statement" value={cv.summary} multiline rows={4}
              onChange={v => edit({ summary: v })} />

            {/* Experience */}
            <Section title="Experience" onAdd={() => edit({ experience: [...cv.experience, { title: "", employer: "", location: "", start: "", end: "", bullets: [] }] })}>
              {cv.experience.map((r, i) => (
                <div key={i} className="border border-[#123d22] rounded p-3 space-y-2">
                  <RowTools
                    onUp={() => edit({ experience: move(cv.experience, i, -1) })}
                    onDown={() => edit({ experience: move(cv.experience, i, 1) })}
                    onDelete={() => edit({ experience: cv.experience.filter((_, n) => n !== i) })}
                    label={r.title || r.employer || `Role ${i + 1}`}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Field label="Job title" value={r.title}    onChange={v => setRole(i, { title: v })} />
                    <Field label="Employer"  value={r.employer} onChange={v => setRole(i, { employer: v })} />
                    <Field label="Location"  value={r.location} onChange={v => setRole(i, { location: v })} />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="From" value={r.start} onChange={v => setRole(i, { start: v })} placeholder="Mar 2019" />
                      <Field label="To"   value={r.end}   onChange={v => setRole(i, { end: v })}   placeholder="Present" />
                    </div>
                  </div>
                  <Field label="What you did — one per line" value={r.bullets.join("\n")} multiline rows={4}
                    onChange={v => setRole(i, { bullets: v.split("\n").map(s => s.trim()).filter(Boolean) })} />
                </div>
              ))}
            </Section>

            {/* Education */}
            <Section title="Education" onAdd={() => edit({ education: [...cv.education, { qualification: "", institution: "", year: "", detail: "" }] })}>
              {cv.education.map((e, i) => (
                <div key={i} className="border border-[#123d22] rounded p-3 space-y-2">
                  <RowTools
                    onUp={() => edit({ education: move(cv.education, i, -1) })}
                    onDown={() => edit({ education: move(cv.education, i, 1) })}
                    onDelete={() => edit({ education: cv.education.filter((_, n) => n !== i) })}
                    label={e.qualification || e.institution || `Entry ${i + 1}`}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Field label="Qualification" value={e.qualification} onChange={v => setStudy(i, { qualification: v })} />
                    <Field label="Institution"   value={e.institution}   onChange={v => setStudy(i, { institution: v })} />
                    <Field label="Year"          value={e.year}          onChange={v => setStudy(i, { year: v })} />
                    <Field label="Detail"        value={e.detail}        onChange={v => setStudy(i, { detail: v })} placeholder="Grade, modules" />
                  </div>
                </div>
              ))}
            </Section>

            <Field label="Skills (one per line)" value={cv.skills.join("\n")} multiline rows={4}
              onChange={v => edit({ skills: v.split("\n").map(s => s.trim()).filter(Boolean) })} />

            {/* Anything else the CV had */}
            <Section title="Other sections" onAdd={() => edit({ extras: [...cv.extras, { heading: "", lines: [] }] })}>
              {cv.extras.map((x, i) => (
                <div key={i} className="border border-[#123d22] rounded p-3 space-y-2">
                  <RowTools
                    onUp={() => edit({ extras: move(cv.extras, i, -1) })}
                    onDown={() => edit({ extras: move(cv.extras, i, 1) })}
                    onDelete={() => edit({ extras: cv.extras.filter((_, n) => n !== i) })}
                    label={x.heading || `Section ${i + 1}`}
                  />
                  <Field label="Heading" value={x.heading} onChange={v => setExtra(i, { heading: v })} />
                  <Field label="Lines (one per line)" value={x.lines.join("\n")} multiline rows={3}
                    onChange={v => setExtra(i, { lines: v.split("\n").map(s => s.trim()).filter(Boolean) })} />
                </div>
              ))}
            </Section>
          </div>

          {/* ── Tailor for a job ── */}
          <div className={`${box} p-4 space-y-3`}>
            <span className="text-xs tracking-widest opacity-60">TAILOR FOR A JOB</span>
            <p className="text-[11px] opacity-50">
              Paste the advert. It reorders and rewords what is already on the CV and writes a covering letter — it is told never to invent
              experience, dates or qualifications. Read it before you send it.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Job title (optional)" value={jobTitle} onChange={setJobTitle} />
              <Field label="Company (optional)"   value={company}  onChange={setCompany} />
            </div>
            <Field label="The job advert" value={jobText} onChange={setJobText} multiline rows={8}
              placeholder="Paste the whole advert — the more of it the better." />
            <div className="flex items-center gap-3">
              <button className={btnGo} onClick={tailor} disabled={!jobText.trim() || busy === "tailor" || dirty}>
                {busy === "tailor" ? "WRITING…" : "▶ TAILOR CV + LETTER"}
              </button>
              {dirty && <span className="text-[11px] text-amber-400">Save the CV first — it tailors from the saved version.</span>}
            </div>
          </div>

          {/* ── Saved applications ── */}
          <div className={`${box} p-4`}>
            <span className="text-xs tracking-widest opacity-60">APPLICATIONS ({apps.length})</span>
            {apps.length === 0 ? (
              <p className="text-xs opacity-50 mt-2">Nothing yet — tailor the CV for a job above and it will be kept here.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {apps.map(a => (
                  <div key={a.id} className="border border-[#123d22] rounded">
                    <button onClick={() => setOpenApp(openApp?.id === a.id ? null : a)}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#0a2214] transition-colors">
                      <span className="opacity-50 text-xs">{openApp?.id === a.id ? "▼" : "▶"}</span>
                      <span className="text-sm">{[a.jobTitle, a.company].filter(Boolean).join(" — ") || "Untitled application"}</span>
                      <span className="ml-auto text-[11px] opacity-40">
                        {new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </button>
                    {openApp?.id === a.id && (
                      <div className="px-3 pb-3 space-y-3">
                        {a.notes && <p className="text-[11px] opacity-60 border-l-2 border-[#1f5c33] pl-2">{a.notes}</p>}
                        <div className="flex flex-wrap gap-2">
                          <button className={btn} onClick={() => copy(a.coverLetter, "Covering letter")}>COPY LETTER</button>
                          <button className={btn} onClick={() => copy(cvToText(a.cv), "Tailored CV")}>COPY CV</button>
                          <button className={btn} disabled={busy === "pdf-letter"}
                            onClick={() => downloadPdf("letter", a.cv, a.coverLetter, { company: a.company, jobTitle: a.jobTitle, filename: `Covering letter — ${a.company || a.jobTitle || "job"}` })}>
                            ⬇ LETTER PDF
                          </button>
                          <button className={btn} disabled={busy === "pdf-cv"}
                            onClick={() => downloadPdf("cv", a.cv, "", { filename: `${a.cv.name || active.name} — ${a.company || a.jobTitle || "CV"}` })}>
                            ⬇ CV PDF
                          </button>
                          <button className={`${btn} ml-auto hover:border-red-500 hover:text-red-400`} onClick={() => deleteApp(a.id)}>DELETE</button>
                        </div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                          <Pane title="Covering letter" text={a.coverLetter || "—"} />
                          <Pane title="Tailored CV"     text={cvToText(a.cv) || "—"} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Field({ label, value, onChange, multiline, rows = 3, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  multiline?: boolean; rows?: number; placeholder?: string
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider opacity-50 mb-1">{label}</span>
      {multiline
        ? <textarea value={value} rows={rows} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={`${input} resize-y`} />
        : <input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={input} />}
    </label>
  )
}

function Section({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider opacity-50">{title}</span>
        <button className={btn} onClick={onAdd}>+ ADD</button>
      </div>
      {children}
    </div>
  )
}

function RowTools({ label, onUp, onDown, onDelete }: { label: string; onUp: () => void; onDown: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs opacity-60 truncate flex-1">{label}</span>
      <button className={btn} onClick={onUp} title="Move up">↑</button>
      <button className={btn} onClick={onDown} title="Move down">↓</button>
      <button className={`${btn} hover:border-red-500 hover:text-red-400`} onClick={onDelete} title="Remove">✕</button>
    </div>
  )
}

function Pane({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider opacity-50 mb-1">{title}</p>
      <pre className="whitespace-pre-wrap text-xs leading-relaxed bg-black border border-[#123d22] rounded p-3 max-h-96 overflow-y-auto" style={{ color: GREEN }}>{text}</pre>
    </div>
  )
}
