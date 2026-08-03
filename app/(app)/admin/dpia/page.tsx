import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"

export const metadata = { title: "DPIA" }

// Data Protection Impact Assessment (DPIA) for the Vectis Hub, following the
// ICO's published DPIA template (UK GDPR Art. 35). This is a WORKING DRAFT to be
// reviewed and signed off with a data-protection adviser / the controller — the
// same standing as the Data & Compliance note it sits beside.
//
// ⚠ The data inventory here (stores / processors / monitoring) is deliberately
// the same as /admin/compliance. If a new integration, data store or monitoring
// feature is added, update BOTH pages.

// ── Step 2: the processing ───────────────────────────────────────────────────

const DATA_SUBJECTS: string[] = [
  "Customers — buyers and sellers (consignors) who deal with Vectis.",
  "Registered bidders for individual auctions.",
  "Website visitors (once the customer-facing site goes live to the public).",
  "Staff — every Hub user (cataloguers, warehouse, managers, admins).",
]

const DATA_CATEGORIES: { cat: string; detail: string }[] = [
  { cat: "Customer identity & contact", detail: "Names, postal addresses, email addresses, phone numbers, salutations." },
  { cat: "Customer dealings", detail: "Submissions, valuations, buyer/seller status, bidder registrations, uploaded documents and photos, commission/consignment records." },
  { cat: "Financial", detail: "Bank/card statement reconciliation records in the Accounts tool. ⚠ Full card numbers must never be stored (keeps Vectis out of PCI-DSS scope)." },
  { cat: "Staff account", detail: "Name, email, username, hashed password, role and app permissions." },
  { cat: "Staff monitoring", detail: "Cataloguing output and timings, activity/away logging, unaccounted-time gaps, device clock/timezone tamper detection, and a full lot change log (who changed what, when). See the monitoring section below." },
  { cat: "Website usage", detail: "Google Analytics visitor/usage data — applies once the public site launches; brings cookie-consent duties." },
]

const STORES: { name: string; what: string; location: string }[] = [
  { name: "Neon (PostgreSQL)", what: "The main database — customer contacts & submissions, bidder registrations, staff accounts, catalogue lots, activity/monitoring logs, accounting records, and a copy of the Business Central extension source code (vendor code — no personal data).", location: "Confirm the Neon region. If US/non-UK, an international-transfer safeguard is needed." },
  { name: "Cloudflare R2", what: "File storage — lot photos, uploaded documents, invoices, and the nightly database backups.", location: "Confirm the R2 bucket region / jurisdiction." },
  { name: "Railway", what: "Hosting — runs the app servers (production and staging). The database itself is on Neon, not Railway.", location: "Confirm the Railway deployment region." },
]

const PROCESSORS: { name: string; what: string; data: string; transfer: string }[] = [
  { name: "Google (Gemini AI API)", what: "Generates lot descriptions and marketing copy; reads uploaded photos; explains the Business Central source code (IT Tools → BC Source).", data: "Lot photos, cataloguer text, marketing content and the vendor's BC source code (no personal data).", transfer: "Confirm the paid API terms (generally no training on your data — verify) and whether any customer personal data can reach it." },
  { name: "Microsoft — Business Central", what: "Syncs warehouse, auction and receipt data.", data: "Item, location, receipt and sale data — includes consignor names/addresses.", transfer: "Governed by your existing Microsoft agreement." },
  { name: "Royal Mail — Click & Drop", what: "Dispatch and packing labels.", data: "Customer names and delivery addresses for parcels.", transfer: "UK-based; covered by Royal Mail's terms." },
  { name: "D-ID", what: "The AI Presenter avatar.", data: "Whatever script/likeness is sent to generate the avatar.", transfer: "Take extra care if a real person's likeness is used — likely needs its own basis/consent." },
  { name: "Google Analytics 4", what: "Website visitor analytics (for the customer site).", data: "Visitor/usage data.", transfer: "US processor — brings cookie-consent and transfer duties once the public site launches." },
  { name: "ntfy.sh", what: "Push notifications for live Auction Monitor alerts.", data: "Alert text only.", transfer: "Keep customer personal data out of alert bodies." },
]

const MONITORING: string[] = [
  "Cataloguing Activity reports — how long each cataloguer spends and their output.",
  "The activity / away popup and its timing thresholds.",
  "Unaccounted Time — working-hours gaps between a cataloguer's saved lots.",
  "Device clock / timezone tamper detection (records what a device's clock claimed vs the real time).",
  "The Lot Change Log — who changed what on every lot, and when.",
]

const PURPOSES: string[] = [
  "Run the auction business — catalogue lots, manage consignments and bidders, dispatch sold items, reconcile accounts.",
  "Produce lot descriptions and marketing content (with AI assistance).",
  "Understand and manage cataloguing productivity and working time (the staff-monitoring purpose — the most sensitive, and the primary trigger for this DPIA).",
  "Keep an audit trail of changes for accuracy and accountability.",
]

// ── Step 4: lawful basis (working view — confirm with adviser) ────────────────

const LAWFUL_BASIS: { cat: string; basis: string; note: string }[] = [
  { cat: "Customers & consignors", basis: "Contract / Legitimate interests", note: "Needed to provide the auction service the customer has engaged. Confirm the split and that a privacy notice covers it." },
  { cat: "Bidders", basis: "Contract / Legitimate interests", note: "Registration to bid. Confirm auction T&Cs act as the notice." },
  { cat: "Financial records", basis: "Legal obligation / Legitimate interests", note: "HMRC generally expects financial records kept ~6 years." },
  { cat: "Staff accounts", basis: "Contract (employment)", note: "Needed to give staff access to do their jobs." },
  { cat: "Staff monitoring", basis: "Legitimate interests — with a balancing test", note: "⚠ The key one. Requires a documented legitimate-interests assessment, staff being clearly told, and proportionality. Do NOT rely on consent for employee monitoring (the ICO treats employee consent as rarely freely given)." },
  { cat: "Website analytics", basis: "Consent", note: "Cookie consent required before non-essential analytics run — applies when the public site launches." },
]

// ── Step 5: risk register (likelihood × severity → overall) ───────────────────

type Level = "Low" | "Medium" | "High"
const RISKS: {
  ref: string
  risk: string
  affects: string
  likelihood: Level
  severity: Level
  overall: Level
}[] = [
  {
    ref: "R1",
    risk: "Staff monitoring is intrusive or perceived as covert — used beyond a proportionate aim, or without staff being clearly and specifically told what is collected and why.",
    affects: "Staff",
    likelihood: "Medium", severity: "High", overall: "High",
  },
  {
    ref: "R2",
    risk: "Customer personal data is sent to the Gemini AI API within photos or text, beyond what is necessary, or under terms that don't cover it.",
    affects: "Customers", likelihood: "Medium", severity: "Medium", overall: "Medium",
  },
  {
    ref: "R3",
    risk: "Personal data stored or backed up outside the UK/EEA (Neon / R2 / Google / D-ID) without an appropriate international-transfer safeguard.",
    affects: "Customers, staff", likelihood: "Medium", severity: "Medium", overall: "Medium",
  },
  {
    ref: "R4",
    risk: "Financial data mishandled — full card numbers stored, pulling Vectis into PCI-DSS scope, or statement data over-retained.",
    affects: "Customers", likelihood: "Low", severity: "High", overall: "Medium",
  },
  {
    ref: "R5",
    risk: "A personal-data breach (credential compromise, misconfigured storage, lost device) exposes customer or staff data.",
    affects: "Customers, staff", likelihood: "Low", severity: "High", overall: "Medium",
  },
  {
    ref: "R6",
    risk: "Data kept longer than needed — no retention rules, so customer, staff-monitoring and financial records accumulate indefinitely.",
    affects: "Customers, staff", likelihood: "Medium", severity: "Medium", overall: "Medium",
  },
  {
    ref: "R7",
    risk: "Individuals can't easily exercise their rights (access, erasure, objection) because there's no defined process.",
    affects: "Customers, staff", likelihood: "Medium", severity: "Low", overall: "Low",
  },
  {
    ref: "R8",
    risk: "A real person's likeness/voice used in the AI Presenter (D-ID) without a clear basis or consent.",
    affects: "Individuals depicted", likelihood: "Low", severity: "Medium", overall: "Low",
  },
]

// Existing controls the Hub already has, and the measures recommended per risk.
const MEASURES: { ref: string; existing: string[]; recommended: string[] }[] = [
  {
    ref: "R1",
    existing: [
      "Monitoring is confined to work activity (cataloguing output, timings, working-hours gaps) — not private content.",
      "The iPad Acceptable Use Policy sign-gate records that staff have accepted the terms.",
      "Server-authoritative time is used so monitoring doesn't rely on a device the user controls.",
    ],
    recommended: [
      "Document a legitimate-interests / proportionality assessment specifically for the monitoring.",
      "Tell staff explicitly, in the staff handbook or employment terms, what is monitored and why (not just the AUP).",
      "Confirm monitoring outputs are only used for legitimate management, and get advice before using them in any disciplinary process.",
    ],
  },
  { ref: "R2", existing: ["AI output is reviewed by staff before use.", "BC codes are kept out of AI output."], recommended: ["Confirm the paid Gemini API terms (no training on your data).", "Minimise customer personal data in anything sent to the AI; document what can reach it."] },
  { ref: "R3", existing: ["Data is concentrated in a small number of named processors."], recommended: ["Confirm the region of Neon, R2 and Railway.", "Where processing is outside the UK/EEA, put an appropriate safeguard in place (e.g. the ICO's International Data Transfer Agreement/Addendum)."] },
  { ref: "R4", existing: ["The Accounts tool reconciles statements rather than taking payments."], recommended: ["Verify no full card numbers (PANs) are stored anywhere.", "Set a retention period for reconciliation records aligned to HMRC (~6 years)."] },
  { ref: "R5", existing: ["Passwords are hashed (bcrypt).", "Access is gated per-app / per-role.", "Nightly database backups to R2.", "An Access Log records access denials."], recommended: ["Confirm a documented breach-response plan (ICO notification within 72 hours of a qualifying breach).", "Review access reviews and consider MFA for admin accounts."] },
  { ref: "R6", existing: ["Report-only exclusions let odd records be hidden without deletion (data untouched)."], recommended: ["Define retention rules per data type (customer, staff-monitoring, financial) and a routine to delete/anonymise past them."] },
  { ref: "R7", existing: ["Data is centralised, so locating a person's records is feasible."], recommended: ["Write a simple procedure for handling access / erasure / objection requests, with an owner and a one-month deadline."] },
  { ref: "R8", existing: ["The AI Presenter is a discrete, optional feature."], recommended: ["If a real person's likeness/voice is used, capture a clear basis/consent and record it."] },
]

// ── UI helpers ────────────────────────────────────────────────────────────────

function levelClasses(l: Level): string {
  if (l === "High")   return "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-300 dark:border-red-800/60"
  if (l === "Medium") return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300 dark:border-amber-800/60"
  return "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300 border-green-300 dark:border-green-800/60"
}

function Badge({ level }: { level: Level }) {
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded border ${levelClasses(level)}`}>{level}</span>
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-9">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{n}. {title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-sm font-medium text-gray-500 dark:text-gray-400 sm:w-52 shrink-0">{label}</span>
      <span className="text-sm text-gray-800 dark:text-gray-200">{value}</span>
    </div>
  )
}

export default async function DpiaPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const p = "text-sm text-gray-700 dark:text-gray-300 leading-relaxed"

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <Link href="/admin/compliance" className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-3 inline-block">← Data &amp; Compliance</Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Data Protection Impact Assessment (DPIA)</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
        For the Vectis Hub. Follows the ICO&apos;s DPIA template (UK GDPR Article 35).
      </p>

      {/* Disclaimer */}
      <div className="mt-5 mb-8 rounded-xl border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          <strong>This is a working draft, not a completed or legally-reviewed DPIA.</strong> It sets out the processing
          honestly and flags the risks so a data-protection adviser or your controller can validate the lawful bases,
          risk ratings and measures, and formally sign it off. Fields marked <em>to complete</em> need a person to fill
          them in. Save-as-PDF (browser Print) to hand it to an adviser.
        </p>
      </div>

      {/* Document control */}
      <Step n="0" title="Document control">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
          <Field label="Organisation (controller)" value="Vectis Auctions Ltd, Fleck Way, Teesside Industrial Estate, Thornaby, TS17 9JZ" />
          <Field label="System assessed" value="The Vectis Hub — internal staff tool (auction, cataloguing, warehouse, accounts, monitoring)." />
          <Field label="DPO / responsible person" value="To complete" />
          <Field label="Prepared by" value="To complete" />
          <Field label="Draft prepared" value="2026 — update on review" />
          <Field label="Status" value="Draft — awaiting review & sign-off" />
          <Field label="Next review date" value="To complete (review at least annually and on any material change)" />
        </div>
      </Step>

      {/* Step 1 */}
      <Step n="1" title="Identify the need for a DPIA">
        <p className={p}>
          A DPIA is required under UK GDPR where processing is likely to result in a high risk to individuals — including
          <strong> systematic monitoring</strong> and large-scale processing of personal data. The Hub carries out
          systematic monitoring of staff (see §2), processes personal data on customers and staff at scale, and uses
          AI to process uploaded content. This assessment is therefore appropriate, and the <strong>staff monitoring is
          its primary trigger</strong>. (The existing Data &amp; Compliance note already flags that a DPIA is normally
          expected for this monitoring.)
        </p>
      </Step>

      {/* Step 2 */}
      <Step n="2" title="Describe the processing">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Whose data (data subjects)</h3>
        <ul className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300 list-disc pl-5 mb-5">
          {DATA_SUBJECTS.map(s => <li key={s}>{s}</li>)}
        </ul>

        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">What data (categories)</h3>
        <div className="space-y-2 mb-5">
          {DATA_CATEGORIES.map(d => (
            <div key={d.cat} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{d.cat}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{d.detail}</p>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Purposes (why)</h3>
        <ul className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300 list-disc pl-5 mb-5">
          {PURPOSES.map(pp => <li key={pp}>{pp}</li>)}
        </ul>

        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">The staff monitoring, specifically</h3>
        <ul className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300 list-disc pl-5 mb-5">
          {MONITORING.map(m => <li key={m}>{m}</li>)}
        </ul>

        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Where the data lives (storage)</h3>
        <div className="space-y-2 mb-5">
          {STORES.map(s => (
            <div key={s.name} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{s.name}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{s.what}</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1"><span className="uppercase tracking-wide">Location:</span> {s.location}</p>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Who it is shared with (processors / recipients)</h3>
        <div className="space-y-2">
          {PROCESSORS.map(pr => (
            <div key={pr.name} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{pr.name}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{pr.what}</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1"><span className="uppercase tracking-wide">Data:</span> {pr.data}</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5"><span className="uppercase tracking-wide">Transfer / terms:</span> {pr.transfer}</p>
            </div>
          ))}
        </div>
      </Step>

      {/* Step 3 */}
      <Step n="3" title="Consultation">
        <p className={p}>
          Record who was consulted and their views. As a minimum this should cover: <strong>staff</strong> (whose
          monitoring is the sensitive processing — their views on it should be sought and recorded); a
          <strong> data-protection adviser / DPO</strong>; and the key <strong>processors&apos;</strong> published terms.
          Consultation status: <em>to complete</em>.
        </p>
      </Step>

      {/* Step 4 */}
      <Step n="4" title="Assess necessity and proportionality">
        <p className={`${p} mb-4`}>
          The processing is necessary to run the auction business and to manage cataloguing productivity. Proportionality
          rests mainly on the monitoring being confined to work activity and staff being properly informed. Working view
          of the lawful basis per data category (confirm with an adviser):
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-3 font-medium">Data</th>
                <th className="py-2 pr-3 font-medium">Working lawful basis</th>
                <th className="py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {LAWFUL_BASIS.map(l => (
                <tr key={l.cat} className="border-b border-gray-100 dark:border-gray-800 align-top">
                  <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">{l.cat}</td>
                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{l.basis}</td>
                  <td className="py-2 text-gray-600 dark:text-gray-400">{l.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300 list-disc pl-5 mt-4">
          <li><strong>Data minimisation:</strong> monitoring is limited to work activity, not private content; keep AI inputs to what's needed.</li>
          <li><strong>Purpose limitation:</strong> monitoring outputs should be used only for legitimate management, not repurposed.</li>
          <li><strong>Individuals&apos; rights:</strong> a defined process for access / erasure / objection requests is needed (see R7).</li>
          <li><strong>Processor contracts:</strong> confirm UK GDPR Article 28 terms are in place with each processor above.</li>
          <li><strong>International transfers:</strong> confirm regions and put safeguards in place where data leaves the UK/EEA (see R3).</li>
        </ul>
      </Step>

      {/* Step 5 */}
      <Step n="5" title="Identify and assess risks">
        <p className={`${p} mb-4`}>
          Working risk register — likelihood and severity are the assessor&apos;s view, to be validated. Overall rating
          combines the two.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-2 font-medium">Ref</th>
                <th className="py-2 pr-3 font-medium">Risk to individuals</th>
                <th className="py-2 pr-3 font-medium">Affects</th>
                <th className="py-2 pr-2 font-medium">Likelihood</th>
                <th className="py-2 pr-2 font-medium">Severity</th>
                <th className="py-2 font-medium">Overall</th>
              </tr>
            </thead>
            <tbody>
              {RISKS.map(r => (
                <tr key={r.ref} className="border-b border-gray-100 dark:border-gray-800 align-top">
                  <td className="py-2.5 pr-2 font-mono font-semibold text-gray-800 dark:text-gray-200">{r.ref}</td>
                  <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-300">{r.risk}</td>
                  <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{r.affects}</td>
                  <td className="py-2.5 pr-2"><Badge level={r.likelihood} /></td>
                  <td className="py-2.5 pr-2"><Badge level={r.severity} /></td>
                  <td className="py-2.5"><Badge level={r.overall} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Step>

      {/* Step 6 */}
      <Step n="6" title="Identify measures to reduce risk">
        <div className="space-y-3">
          {MEASURES.map(m => {
            const risk = RISKS.find(r => r.ref === m.ref)
            return (
              <div key={m.ref} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
                  <span className="font-mono">{m.ref}</span> — {risk?.risk}
                </p>
                <p className="text-xs font-semibold uppercase tracking-wide text-green-600 dark:text-green-400 mb-1">Already in place</p>
                <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300 list-disc pl-5 mb-3">
                  {m.existing.map(e => <li key={e}>{e}</li>)}
                </ul>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1">Recommended</p>
                <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300 list-disc pl-5">
                  {m.recommended.map(e => <li key={e}>{e}</li>)}
                </ul>
              </div>
            )
          })}
        </div>
      </Step>

      {/* Step 7 */}
      <Step n="7" title="Sign off and record outcomes">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
          <Field label="Measures approved by" value="To complete" />
          <Field label="Residual risk (after measures)" value="To complete — the aim is to bring each risk to Low/Medium" />
          <Field label="DPO / adviser advice" value="To complete" />
          <Field label="ICO consultation needed?" value="Only if a high residual risk remains that measures can't reduce. Aim: no." />
          <Field label="Approved / adopted by" value="To complete" />
          <Field label="Date of sign-off" value="To complete" />
        </div>
      </Step>

      <p className="text-xs text-gray-400 dark:text-gray-500 border-t border-gray-200 dark:border-gray-800 pt-4">
        Keep this in step with the Data &amp; Compliance note — the data-store, processor and monitoring lists are the
        parts most likely to change as the Hub gains new integrations. Review at least annually and whenever a new data
        source, integration or monitoring feature is added.
      </p>
    </div>
  )
}
