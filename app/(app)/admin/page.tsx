import Link from "next/link"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import RunMigrationsButton from "./run-migrations-button"

type Card = { href: string; label: string; description: string; icon: string }

const GROUPS: { label: string; cards: Card[] }[] = [
  {
    label: "People & Access",
    cards: [
      { href: "/admin/users",         label: "Users & Permissions", description: "Add and remove users, set roles and control which apps each person can access.", icon: "👤" },
      { href: "/admin/role-defaults", label: "Roles & Defaults",    description: "Create custom roles, set their default app access, and push permissions to existing users.", icon: "🔑" },
      { href: "/admin/departments",   label: "Departments",         description: "Manage cataloguer departments used across the app.", icon: "🏢" },
      { href: "/admin/devices",       label: "Devices",             description: "Register and track tablets and other devices used by staff. Record serial numbers and assign to users.", icon: "📱" },
      { href: "/admin/terms",         label: "Terms & Signatures",  description: "See who has signed the iPad Acceptable Use Policy — their signature and the date/time — and who is still outstanding.", icon: "✍️" },
      { href: "/admin/access-log",    label: "Access Log",          description: "Every time someone was turned away from a section they should have reached — what their session said and what the permission check actually read back.", icon: "🚧" },
    ],
  },
  {
    label: "Cataloguing",
    cards: [
      { href: "/admin/categories",        label: "Cataloguing Categories", description: "Add, rename, reorder or remove the categories and subcategories cataloguers pick from when entering lots.", icon: "🏷️" },
      { href: "/admin/condition-wording", label: "Condition Wording",      description: "Manage the box/packaging wording presets (e.g. \"Box is\", \"Carded Back is\") used in the separate condition.", icon: "📦" },
      { href: "/admin/lot-log",           label: "Lot Change Log",         description: "Full audit trail of every field changed on every lot — who changed what, when, and what it was before.", icon: "📋" },
      { href: "/admin/training-records",  label: "Training Records",      description: "Signed acknowledgements that somebody has been trained on a part of the Hub — who signed, for which course, when, and their signature.", icon: "✍️" },
      { href: "/admin/saved-flagged-lots", label: "Saved Flagged Lots",    description: "Frozen copies of the Review tab's AI-flagged and flagged lots, photos and all. Take one before an AI run overwrites the flags — nothing else keeps a record of what they said.", icon: "🗂️" },
      { href: "/admin/activity-timer",    label: "Cataloguer Activity Timer", description: "Configure the activity popup — add or remove reasons, change wording, set timing thresholds.", icon: "⏱️" },
      { href: "/admin/unaccounted-time",  label: "Unaccounted Time",       description: "Working-hours gaps between a cataloguer's lot saves that were never accounted for with an activity reason — the tamper-proof backstop to the popup.", icon: "🕵️" },
    ],
  },
  {
    label: "Content & Communication",
    cards: [
      { href: "/admin/home-cards",     label: "Home Page",       description: "Reorder app cards, hide unused ones, feature favourites and customise labels.", icon: "🏠" },
      { href: "/admin/announcements",  label: "Announcements",   description: "Show a banner to everyone using the app, or publish patch notes as a one-time popup.", icon: "📣" },
      { href: "/admin/changes",        label: "Patches & Changes", description: "Everything that has gone into the Hub, and AI-written progress reports for managers.", icon: "📝" },
      { href: "/admin/documents",      label: "Document Storage", description: "Upload and organise documents and images into folders. Accessible by all staff.", icon: "🗂️" },
      { href: "/admin/invoices",       label: "Invoices",        description: "Upload and access invoices. Accepts any file type.", icon: "🧾" },
    ],
  },
  {
    label: "System & AI",
    cards: [
      { href: "/admin/about",      label: "About",            description: "How every section of the app works, what it depends on, and the rules that govern it.", icon: "📖" },
      { href: "/admin/compliance", label: "Data & Compliance", description: "Plain-English note on what data the Hub holds, where it's stored, who it's shared with, and what to check with an adviser.", icon: "⚖️" },
      { href: "/admin/dpia",       label: "DPIA",             description: "Data Protection Impact Assessment draft (ICO template) — the formal risk assessment for the Hub's data processing and staff monitoring. Save-as-PDF for your adviser.", icon: "🛡️" },
      { href: "/admin/ai-models",  label: "AI Models",        description: "Choose which Gemini model each AI feature uses across the app. Fix a retired model in one place instead of in code.", icon: "🤖" },
      { href: "/admin/backup",     label: "Database Backup",  description: "View stored database backups, check when the last backup ran, and trigger a manual backup.", icon: "💾" },
      { href: "/admin/memory",     label: "Claude Memory",    description: "Browse what Claude remembers about you, this project, and how to work with you.", icon: "🧠" },
      { href: "/admin/refresh",    label: "Force Refresh",    description: "Reload everyone's screen onto the latest version after an update. Warns before it interrupts anyone.", icon: "🔄" },
    ],
  },
]

export default async function AdminOverviewPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">System-wide settings and management</p>
      </div>

      <div className="space-y-8">
        {GROUPS.map(g => (
          <section key={g.label}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500 mb-3">{g.label}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
              {g.cards.map(s => (
                <Link key={s.href} href={s.href}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5 hover:border-slate-400 hover:shadow-sm transition-all group">
                  <div className="text-3xl mb-3">{s.icon}</div>
                  <h3 className="font-semibold text-gray-800 dark:text-gray-200 group-hover:text-slate-700 mb-1">{s.label}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{s.description}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <RunMigrationsButton />
    </div>
  )
}
