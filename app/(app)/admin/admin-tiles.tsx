"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import RunMigrationsButton from "./run-migrations-button"

// The Admin page: every admin screen as a small tile, grouped by the job it's for, with a
// search box over names, short lines, descriptions and group names. ⓘ shows the full description.

type Tile = { href: string; label: string; short: string; description: string; icon: string }
type Group = { label: string; icon: string; colour: string; tiles: Tile[]; migrations?: boolean }

const GROUPS: Group[] = [
  {
    label: "Health & updates", icon: "🚦", colour: "#f59e0b", migrations: true,
    tiles: [
      { href: "/admin/status",  label: "Status Centre",     icon: "🚦", short: "Is it us or a supplier?", description: "Is every outside service the Hub relies on working right now? When staff say something's broken, this shows whether it's us or a supplier." },
      { href: "/admin/backup",  label: "Database Backup",   icon: "💾", short: "Backups, last run, make one now", description: "View stored database backups, check when the last backup ran, and trigger a manual backup." },
      { href: "/admin/refresh", label: "Force Refresh",     icon: "🔄", short: "Reload everyone onto the latest version", description: "Reload everyone's screen onto the latest version after an update. Warns before it interrupts anyone." },
      { href: "/admin/changes", label: "Patches & Changes", icon: "🆕", short: "What's changed, and manager reports", description: "Everything that has gone into the Hub, and AI-written progress reports for managers." },
    ],
  },
  {
    label: "People & access", icon: "👤", colour: "#3b82f6",
    tiles: [
      { href: "/admin/users",            label: "Users & Permissions", icon: "👤", short: "Add people, roles and app access", description: "Add and remove users, set roles and control which apps each person can access." },
      { href: "/admin/role-defaults",    label: "Roles & Defaults",    icon: "🔑", short: "Default access for each role", description: "Create custom roles, set their default app access, and push permissions to existing users." },
      { href: "/admin/departments",      label: "Departments",         icon: "🏢", short: "Which sales each cataloguer sees", description: "Manage cataloguer departments used across the app." },
      { href: "/admin/devices",          label: "Devices",             icon: "📱", short: "Tablets, serials and who has them", description: "Register and track tablets and other devices used by staff. Record serial numbers and assign to users." },
      { href: "/admin/terms",            label: "Terms & Signatures",  icon: "✍️", short: "Who has signed the iPad policy", description: "See who has signed the iPad Acceptable Use Policy — their signature and the date/time — and who is still outstanding." },
      { href: "/admin/training-records", label: "Training Records",    icon: "🎓", short: "Signed training acknowledgements", description: "Signed acknowledgements that somebody has been trained on a part of the Hub — who signed, for which course, when, and their signature." },
      { href: "/admin/access-log",       label: "Access Log",          icon: "🚧", short: "Who was turned away, and why", description: "Every time someone was turned away from a section they should have reached — what their session said and what the permission check actually read back." },
    ],
  },
  {
    label: "Cataloguer time", icon: "⏱️", colour: "#8b5cf6",
    tiles: [
      { href: "/admin/activity-timer",   label: "Activity Timer",   icon: "⏱️", short: "The activity popup's reasons and timings", description: "Configure the activity popup — add or remove reasons, change wording, set timing thresholds." },
      { href: "/admin/unaccounted-time", label: "Unaccounted Time", icon: "🕵️", short: "Gaps nobody gave a reason for", description: "Working-hours gaps between a cataloguer's lot saves that were never accounted for with an activity reason — the tamper-proof backstop to the popup." },
    ],
  },
  {
    label: "Cataloguing setup & records", icon: "🏷️", colour: "#10b981",
    tiles: [
      { href: "/admin/categories",         label: "Cataloguing Categories", icon: "🏷️", short: "Categories and subcategories", description: "Add, rename, reorder or remove the categories and subcategories cataloguers pick from when entering lots." },
      { href: "/admin/condition-wording",  label: "Condition Wording",      icon: "📦", short: "Box and packaging wording presets", description: "Manage the box/packaging wording presets (e.g. \"Box is\", \"Carded Back is\") used in the separate condition." },
      { href: "/admin/lot-log",            label: "Lot Change Log",         icon: "📋", short: "Every change to every lot", description: "Full audit trail of every field changed on every lot — who changed what, when, and what it was before." },
      { href: "/admin/saved-flagged-lots", label: "Saved Flagged Lots",     icon: "🚩", short: "Saved copies of AI-flagged lots", description: "Frozen copies of the Review tab's AI-flagged and flagged lots, photos and all. Take one before an AI run overwrites the flags — nothing else keeps a record of what they said." },
    ],
  },
  {
    label: "Talking to staff", icon: "📣", colour: "#ec4899",
    tiles: [
      { href: "/hub?edit=1",          label: "Home Page",     icon: "🏠", short: "Edit the home page for everyone", description: "Edit the home page for everyone: sections, colours, names, order and which apps show." },
      { href: "/admin/announcements", label: "Announcements", icon: "📣", short: "Banners and patch-note popups", description: "Show a banner to everyone using the app, or publish patch notes as a one-time popup." },
      { href: "/admin/feedback",      label: "Hub Feedback",  icon: "💬", short: "Surveys for the cataloguers", description: "Ask the cataloguers what they think of the Hub and what they'd like it to do — write or AI-draft the questions, send them as a popup, and read the answers." },
    ],
  },
  {
    label: "Files", icon: "🗂️", colour: "#64748b",
    tiles: [
      { href: "/admin/documents", label: "Document Storage", icon: "🗂️", short: "Shared folders of documents", description: "Upload and organise documents and images into folders. Accessible by all staff." },
      { href: "/admin/invoices",  label: "Invoices",         icon: "🧾", short: "Invoice file store", description: "Upload and access invoices. Accepts any file type." },
    ],
  },
  {
    label: "AI & reference", icon: "🤖", colour: "#06b6d4",
    tiles: [
      { href: "/admin/ai-models",  label: "AI Models",         icon: "🤖", short: "Which AI model each tool uses", description: "Choose which Gemini model each AI feature uses across the app. Fix a retired model in one place instead of in code." },
      { href: "/admin/memory",     label: "Claude Memory",     icon: "🧠", short: "What Claude remembers", description: "Browse what Claude remembers about you, this project, and how to work with you." },
      { href: "/admin/about",      label: "About",             icon: "📖", short: "How every part of the Hub works", description: "How every section of the app works, what it depends on, and the rules that govern it." },
      { href: "/admin/compliance", label: "Data & Compliance", icon: "⚖️", short: "What data we hold and where", description: "Plain-English note on what data the Hub holds, where it's stored, who it's shared with, and what to check with an adviser." },
      { href: "/admin/dpia",       label: "DPIA",              icon: "🛡️", short: "Data protection impact assessment", description: "Data Protection Impact Assessment draft (ICO template) — the formal risk assessment for the Hub's data processing and staff monitoring. Save-as-PDF for your adviser." },
    ],
  },
]

const MIGRATIONS_WORDS = "run migrations database update apply waiting"

export default function AdminTiles() {
  const router = useRouter()
  const [q, setQ] = useState("")
  const [info, setInfo] = useState<string | null>(null)

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hits = (text: string) => words.every(w => text.toLowerCase().includes(w))
  const shown = GROUPS.map(g => ({
    ...g,
    tiles: g.tiles.filter(t => hits(`${t.label} ${t.short} ${t.description} ${g.label}`)),
    migrations: g.migrations && hits(`${MIGRATIONS_WORDS} ${g.label}`),
  })).filter(g => g.tiles.length || g.migrations)
  const first = shown.flatMap(g => g.tiles)[0]

  return (
    <>
      <div className="mb-8 max-w-xl">
        <input
          type="search" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && first && words.length) router.push(first.href) }}
          placeholder="🔎 Search admin — e.g. backup, users, log"
          aria-label="Search admin"
          className="w-full min-h-[48px] px-4 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {words.length > 0 && first && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">Press Enter to open {first.label}.</p>}
      </div>

      {shown.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Nothing matches &ldquo;{q}&rdquo;.</p>
      )}

      <div className="space-y-7">
        {shown.map(g => (
          <section key={g.label}>
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-3">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.colour }} />
              {g.label}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3">
              {g.tiles.map(t => (
                <div key={t.href} className="relative">
                  <Link href={t.href}
                    className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 border-l-4 rounded-xl p-3 pr-12 min-h-[76px] h-full flex items-center gap-3 hover:shadow-md hover:-translate-y-0.5 transition-all"
                    style={{ borderLeftColor: g.colour }}>
                    <span className="text-2xl shrink-0">{t.icon}</span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-sm text-gray-900 dark:text-gray-100">{t.label}</span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">{t.short}</span>
                    </span>
                  </Link>
                  <button
                    onClick={() => setInfo(info === t.href ? null : t.href)}
                    aria-label={`About ${t.label}`} aria-expanded={info === t.href}
                    className="absolute top-1/2 -translate-y-1/2 right-1 w-11 h-11 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5">
                    ⓘ
                  </button>
                  {info === t.href && (
                    <div className="absolute z-20 left-0 right-0 top-full mt-1 p-3 rounded-lg shadow-xl bg-gray-900 text-gray-100 dark:bg-gray-100 dark:text-gray-900 text-xs leading-relaxed">
                      {t.description}
                    </div>
                  )}
                </div>
              ))}
              {g.migrations && <RunMigrationsButton colour={g.colour} />}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
