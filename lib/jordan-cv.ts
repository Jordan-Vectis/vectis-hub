// JORDAN.SYS — CV workshop. The one shape a CV takes, shared by the parser, the
// editor, the tailoring route and the PDF builder, so none of them can drift.
//
// ⚠ Everything here is behind isJordan(). Nothing in this file is used by the
// rest of the Hub.

export type CvRole = {
  title:    string
  employer: string
  location: string
  /** Free text on purpose — "Mar 2019", "2019", "Summer 2019" are all real. */
  start:    string
  end:      string          // "Present" is normal
  /** One achievement or duty per line. The tailoring pass reorders and rewrites
   *  these, so they must stay separate rather than being one paragraph. */
  bullets:  string[]
}

export type CvStudy = {
  qualification: string
  institution:   string
  year:          string
  detail:        string     // grades, modules — optional
}

/** A section the parser met that isn't experience/education/skills — awards,
 *  publications, references, hobbies. Kept rather than dropped, because throwing
 *  away part of somebody's CV silently is the worst thing this tool could do. */
export type CvExtra = { heading: string; lines: string[] }

export type Cv = {
  name:      string
  headline:  string          // "IT Manager", the line under the name
  email:     string
  phone:     string
  location:  string
  links:     string[]        // LinkedIn, portfolio, GitHub
  summary:   string          // the personal profile paragraph
  experience: CvRole[]
  education:  CvStudy[]
  skills:     string[]
  extras:     CvExtra[]
}

export const EMPTY_CV: Cv = {
  name: "", headline: "", email: "", phone: "", location: "", links: [],
  summary: "", experience: [], education: [], skills: [], extras: [],
}

/** Coerce whatever the model (or an older saved row) gives us into a complete Cv.
 *  ⚠ Never trust the shape: a missing array here becomes a crash in the editor,
 *  and a half-parsed CV must still be editable rather than blowing up the page. */
export function normaliseCv(input: any): Cv {
  const o = input && typeof input === "object" ? input : {}
  const str = (v: any) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim()
  const list = (v: any): string[] =>
    Array.isArray(v) ? v.map(str).filter(Boolean)
    : typeof v === "string" && v.trim() ? v.split(/\r?\n/).map(str).filter(Boolean)
    : []

  return {
    name:     str(o.name),
    headline: str(o.headline),
    email:    str(o.email),
    phone:    str(o.phone),
    location: str(o.location),
    links:    list(o.links),
    summary:  str(o.summary),
    experience: Array.isArray(o.experience) ? o.experience.map((r: any) => ({
      title:    str(r?.title),
      employer: str(r?.employer),
      location: str(r?.location),
      start:    str(r?.start),
      end:      str(r?.end),
      bullets:  list(r?.bullets),
    })) : [],
    education: Array.isArray(o.education) ? o.education.map((e: any) => ({
      qualification: str(e?.qualification),
      institution:   str(e?.institution),
      year:          str(e?.year),
      detail:        str(e?.detail),
    })) : [],
    skills: list(o.skills),
    extras: Array.isArray(o.extras) ? o.extras.map((x: any) => ({
      heading: str(x?.heading),
      lines:   list(x?.lines),
    })).filter((x: CvExtra) => x.heading || x.lines.length) : [],
  }
}

/** The CV as plain text — what the "copy" buttons hand over, and what the
 *  tailoring pass is shown so it reads the same document a human would. */
export function cvToText(cv: Cv): string {
  const out: string[] = []
  if (cv.name) out.push(cv.name)
  if (cv.headline) out.push(cv.headline)
  const contact = [cv.email, cv.phone, cv.location, ...cv.links].filter(Boolean).join(" · ")
  if (contact) out.push(contact)

  if (cv.summary) out.push("", "PROFILE", cv.summary)

  if (cv.experience.length) {
    out.push("", "EXPERIENCE")
    for (const r of cv.experience) {
      const when  = [r.start, r.end].filter(Boolean).join(" – ")
      const where = [r.employer, r.location].filter(Boolean).join(", ")
      out.push("", [r.title, where].filter(Boolean).join(" — ") + (when ? `  (${when})` : ""))
      for (const b of r.bullets) out.push(`• ${b}`)
    }
  }

  if (cv.education.length) {
    out.push("", "EDUCATION")
    for (const e of cv.education) {
      const bits = [e.qualification, e.institution, e.year].filter(Boolean).join(" — ")
      out.push(bits + (e.detail ? ` (${e.detail})` : ""))
    }
  }

  if (cv.skills.length) out.push("", "SKILLS", cv.skills.join(" · "))

  for (const x of cv.extras) {
    if (!x.heading && !x.lines.length) continue
    out.push("", (x.heading || "OTHER").toUpperCase())
    for (const l of x.lines) out.push(l)
  }

  return out.join("\n").trim()
}

/** The JSON contract shown to the model. Kept beside the type so the two can
 *  never describe different shapes. */
export const CV_JSON_SHAPE = `{
  "name": "", "headline": "", "email": "", "phone": "", "location": "",
  "links": [], "summary": "",
  "experience": [{ "title": "", "employer": "", "location": "", "start": "", "end": "", "bullets": [] }],
  "education":  [{ "qualification": "", "institution": "", "year": "", "detail": "" }],
  "skills": [],
  "extras": [{ "heading": "", "lines": [] }]
}`

export const PARSE_PROMPT = `You are reading somebody's CV and turning it into structured data.

Return ONLY raw JSON in exactly this shape:
${CV_JSON_SHAPE}

Rules:
- Copy what is written. Do NOT improve, rewrite, summarise or correct anything at this stage — this is a faithful transcription, and the person will edit it themselves.
- Never invent a date, employer, qualification or skill that is not in the document. Leave a field empty rather than guessing.
- Keep every achievement or duty as its OWN entry in "bullets" — do not merge them into a paragraph.
- "headline" is the job title line under the name, if there is one. If not, leave it empty — do not make one up.
- Anything that is not experience, education or skills (awards, publications, hobbies, references, licences) goes in "extras" under its own heading. Do not drop it.
- Dates stay exactly as written ("Mar 2019", "2019", "Present").
- British English.`

/** Built per request — the job advert is the varying part. */
export function tailorPrompt(): string {
  return `You are tailoring somebody's CV and writing a covering letter for one specific job.

You are given their MASTER CV as JSON and the JOB ADVERT as text.

Return ONLY raw JSON in exactly this shape:
{ "cv": ${CV_JSON_SHAPE}, "coverLetter": "", "notes": "" }

Rules for the CV:
- ⚠ NEVER invent experience, qualifications, skills, dates or employers. You may only reorder, re-emphasise, reword and shorten what is already there. A tailored CV that claims something untrue is worse than no CV at all.
- Put the most relevant roles and bullets first, and rewrite bullets to use the language of the advert where that is honest.
- You may drop bullets that are irrelevant to this job, but never drop a whole role — a gap in the dates looks like something hidden.
- Keep every date, employer and qualification exactly as given.
- Rewrite the "summary" to speak to this job.

Rules for the covering letter:
- British English. Address it to the company, and name the role.
- Three or four short paragraphs: why this role, the most relevant evidence from the CV, and a close.
- Plain prose, no bullet points, no headings, no address block, no "Dear Sir/Madam" if a name is given in the advert.
- Do not repeat the CV wholesale — pick the two or three things that matter most for this job.
- Never claim anything the CV does not support.

"notes": one or two sentences saying what you emphasised and what you cut, so the choice can be checked later.`
}
