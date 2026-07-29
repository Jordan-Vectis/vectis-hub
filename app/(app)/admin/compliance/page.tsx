import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"

export const metadata = { title: "Data & Compliance" }

// Internal, plain-English overview of what the Hub holds, where it lives, who it
// shares data with, and the compliance points to raise with a professional.
// ⚠ NOT legal advice — a working note to make those conversations quicker.

const STORES: { name: string; what: string }[] = [
  { name: "Neon (PostgreSQL)", what: "The main database — customer contacts & submissions, bidder registrations, staff accounts, catalogue lots, activity/monitoring logs, and the accounting/reconciliation records." },
  { name: "Cloudflare R2", what: "File storage — lot photos, uploaded documents, invoices, and the nightly database backups." },
  { name: "Railway", what: "Hosting — runs the app servers (production and staging). The database itself is on Neon, not Railway." },
]

const PROCESSORS: { name: string; what: string; data: string }[] = [
  { name: "Google (Gemini AI API)", what: "Generates lot descriptions and marketing copy, and reads uploaded photos.", data: "Lot photos, cataloguer text, and marketing content are sent to Google. Confirm whether any customer personal data can reach it, and that your account's terms cover it (the paid API generally does not train on your data — verify)." },
  { name: "Microsoft — Business Central", what: "Syncs warehouse, auction and receipt data (BC Warehouse / Reports / Marketing).", data: "Item, location and sale data. Governed by your existing Microsoft agreement." },
  { name: "Royal Mail — Click & Drop", what: "Dispatch and packing labels.", data: "Customer names and delivery addresses for parcels." },
  { name: "D-ID", what: "The AI Presenter avatar.", data: "Whatever script/likeness is sent to generate the avatar — take extra care if a real person's likeness is used." },
  { name: "Google Analytics 4", what: "Website visitor analytics (for the customer site when it goes live).", data: "Visitor/usage data. Brings cookie-consent duties once the public site launches." },
  { name: "ntfy.sh", what: "Push notifications for the live Auction Monitor alerts.", data: "Alert text only — keep customer personal data out of alert bodies." },
]

const MONITORING: string[] = [
  "Cataloguing Activity reports — how long each cataloguer spends and their output.",
  "The activity / away popup and its timing thresholds.",
  "Unaccounted Time — working-hours gaps between a cataloguer's saved lots.",
  "Device clock / timezone tamper detection (records what a device's clock claimed vs the real time).",
  "The Lot Change Log — who changed what on every lot, and when.",
]

const FLAGS: { title: string; body: string; level: "high" | "med" }[] = [
  {
    title: "Employee monitoring — the priority item",
    level: "high",
    body: "The Hub does substantial staff monitoring (see the list above), especially the clock/timezone tamper detection. UK GDPR and the ICO's guidance on monitoring workers treat this as sensitive. Typically this means: staff must be clearly told they are monitored, what is collected and why (ideally in the staff handbook / employment terms, not just implied); a Data Protection Impact Assessment (DPIA) is normally expected for systematic monitoring; and it must be proportionate to a genuine aim. Covert or undisclosed monitoring is heavily restricted. Get advice on this before relying on the monitoring features in any disciplinary context.",
  },
  {
    title: "ICO data-protection fee (registration)",
    level: "med",
    body: "There is no “software registration” in the UK, but most organisations that process personal data must pay the ICO an annual data-protection fee (roughly £40–£2,900 by size). Vectis very likely already pays this as a business — just confirm it covers this processing.",
  },
  {
    title: "Privacy notice & lawful basis",
    level: "med",
    body: "The Hub holds personal data on customers and staff. Confirm there is a privacy notice covering what is collected and the lawful basis for it, and that staff monitoring is covered in staff-facing terms.",
  },
  {
    title: "Retention & breach plan",
    level: "med",
    body: "Have retention rules (how long customer, staff and financial records are kept — HMRC generally wants financial records for ~6 years) and a breach plan. UK GDPR requires notifying the ICO within 72 hours of a qualifying personal-data breach.",
  },
  {
    title: "Financial data (Accounts tool)",
    level: "med",
    body: "The Accounts tool reconciles bank/card statements. Make sure full card numbers are never stored anywhere — that keeps Vectis out of PCI-DSS scope.",
  },
  {
    title: "Third-party terms & open-source licences",
    level: "med",
    body: "Each integration above carries its own terms of service you are bound by commercially. The open-source libraries the app is built on are almost all permissive (MIT etc.) — a non-issue while the software stays internal; it would only matter if it were ever distributed outside Vectis.",
  },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">{title}</h2>
      {children}
    </section>
  )
}

export default async function CompliancePage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-3 inline-block">← Admin</Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Data &amp; Compliance</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
        A plain-English overview of what the Vectis Hub holds, where it lives, and what to check with an adviser.
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
        See also: <Link href="/admin/dpia" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">Data Protection Impact Assessment (DPIA)</Link> — the formal risk assessment, which the staff monitoring below makes advisable.
      </p>

      {/* Disclaimer */}
      <div className="mt-5 mb-8 rounded-xl border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          <strong>This is an internal working note, not legal advice.</strong> It is meant to make the conversation with
          a solicitor or data-protection adviser quicker. Anything below marked as a &ldquo;point to raise&rdquo; should be
          confirmed with a professional before you rely on it.
        </p>
      </div>

      <Section title="What the Hub is">
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          An internal tool for Vectis Auctions staff. It is not sold to anyone, and the customer-facing website is
          currently behind the same staff login — so today the Hub is an internal system, which keeps the compliance
          picture simpler. The considerations below are about the <strong>data it handles</strong>, not the software itself:
          in the UK there is nothing to &ldquo;register&rdquo; to build it or give it to staff.
        </p>
      </Section>

      <Section title="What personal data it holds">
        <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
          <li><strong>Customers:</strong> contacts (names, addresses, phone, email), submissions, buyer/seller details, and uploaded documents.</li>
          <li><strong>Bidders:</strong> registration details tied to auctions.</li>
          <li><strong>Staff:</strong> accounts (name, email, username, hashed password, role) <em>and</em> monitoring data (see the next section).</li>
          <li><strong>Financial:</strong> bank/card statement reconciliation records in the Accounts tool.</li>
        </ul>
      </Section>

      <Section title="Staff monitoring the Hub performs">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">This is the most sensitive area — see the point to raise below.</p>
        <ul className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300 list-disc pl-5">
          {MONITORING.map((m) => <li key={m}>{m}</li>)}
        </ul>
      </Section>

      <Section title="Where the data lives">
        <div className="space-y-2">
          {STORES.map((s) => (
            <div key={s.name} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{s.name}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{s.what}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Who data is shared with (third parties)">
        <div className="space-y-2">
          {PROCESSORS.map((p) => (
            <div key={p.name} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{p.name}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{p.what}</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1"><span className="uppercase tracking-wide">Data:</span> {p.data}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Points to raise with an adviser">
        <div className="space-y-3">
          {FLAGS.map((f) => (
            <div key={f.title} className={`rounded-lg border px-4 py-3 ${f.level === "high" ? "border-red-300 dark:border-red-800/60 bg-red-50 dark:bg-red-950/20" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"}`}>
              <p className={`text-sm font-semibold ${f.level === "high" ? "text-red-700 dark:text-red-300" : "text-gray-800 dark:text-gray-200"}`}>
                {f.level === "high" && "⚠ "}{f.title}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <p className="text-xs text-gray-400 dark:text-gray-500 border-t border-gray-200 dark:border-gray-800 pt-4">
        Use your browser&apos;s Print / Save-as-PDF to hand this to an adviser. Keep it updated as the Hub gains new
        integrations or data — the third-party list and the monitoring list are the parts most likely to change.
      </p>
    </div>
  )
}
