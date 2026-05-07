"use client"

import { useState } from "react"

// ─── Static memory content ────────────────────────────────────────────────────
// This file is updated by Claude whenever memory files change.
// Last synced: 2026-05-07

type Entry = { filename: string; content: string }

const ENTRIES: Entry[] = [
  {
    filename: "user_profile.md",
    content: `---
name: User Profile
description: Jordan Orange, works at Vectis toy auction house, non-technical, Windows 11
type: user
---

- Name: Jordan Orange (jordan.orange@hambletongroup.com)
- Works at Vectis, a toy and collectables auction house
- Non-technical — happy to defer to recommendations on stack, hosting, tooling
- Prefers questions one at a time and concise responses
- Uses Windows 11, PowerShell, VS Code
- GitHub username: Jordan-Vectis`,
  },
  {
    filename: "project_vectis_crm.md",
    content: `---
name: Vectis Hub Project
description: Full spec, tech stack, and deployment details for the Vectis Hub app
type: project
---
# Vectis Hub

**Production URL:** https://vectis-crm-production.up.railway.app
**Staging URL:** https://vectis-staging.up.railway.app
**GitHub repo:** https://github.com/Jordan-Vectis/vectis-hub
**Local path:** C:\\Dev apps\\vectis-hub

## Stack
- Next.js (App Router), TypeScript, Tailwind CSS
- Prisma 7 with \`@prisma/adapter-pg\` (requires adapter — no direct URL in client)
- PostgreSQL on Neon
- NextAuth v5 beta (JWT sessions, Credentials provider)
- Hosted on Railway (auto-deploys: push to \`main\` → production, push to \`staging\` → staging)
- Socket.IO for live auction real-time events
- Google Gemini API (lot description generation, BC Marketing articles)
- Royal Mail Click & Drop API (packing/dispatch)
- Business Central OData API (BC Reports, BC Warehouse, BC Marketing)

## Key config notes
- \`prisma generate\` runs as part of \`npm run build\`
- \`trustHost: true\` in \`auth.config.ts\` — required for Railway domain
- \`proxy.ts\` (not middleware.ts) — Next.js renamed middleware to proxy
- Auth split: \`auth.config.ts\` (Edge-safe) + \`auth.ts\` (full, uses Prisma)
- Prisma client generated at \`app/generated/prisma/\`
- \`DATABASE_URL\`, \`AUTH_SECRET\`, \`NEXTAUTH_URL\` set in Railway Variables
- \`prisma migrate deploy\` runs on startup via server.js (DATABASE_URL not available at build time)

## Roles
- **ADMIN** — full access, hardcoded for it@vectis.co.uk
- **COLLECTIONS** — CRM, submissions, follow-ups
- **CATALOGUER** — cataloguing tools

## Git discipline
- Default branch for all work: \`staging\`
- Never push to \`main\` unless Jordan explicitly says "push to main"
- Always pull from remote staging before pushing (another developer works on the same branch)
- Merge to production: \`git fetch origin main && git checkout main && git merge origin/staging --no-edit && git push origin main && git checkout staging\``,
  },
  {
    filename: "feedback_vectis.md",
    content: `---
name: Vectis CRM Feedback
description: Preferences and patterns learned while building the Vectis app
type: feedback
---

Keep responses short — one paragraph max unless explaining something technical.

**Why:** User explicitly asked for concise answers early in the session.

**How to apply:** Lead with the action or answer, skip preamble. Use bullet points or tables only when they genuinely help.`,
  },
  {
    filename: "feedback_file_saving.md",
    content: `---
name: Always ask before saving files
description: Ask the user where to save files before saving them
type: feedback
---

Always ask the user where they want files saved before saving them. Do not assume Desktop or any other default location.

**Why:** User was annoyed when a Word document was saved to their Desktop without being asked.

**How to apply:** Any time a file is being created/saved (documents, exports, downloads), ask "Where would you like me to save this?" before proceeding.`,
  },
  {
    filename: "feedback_naming.md",
    content: `---
name: App naming
description: Don't call it a CRM — it's just one section of the whole app
type: feedback
---

Don't refer to the Vectis app as "the CRM". It is just "the app". CRM is only one section of it and using that label causes confusion.

**Why:** User corrected this explicitly — calling it a CRM is inaccurate and could cause misunderstanding about what's being worked on.

**How to apply:** Always say "the app" when referring to the overall Vectis Next.js application.`,
  },
  {
    filename: "feedback_migrations.md",
    content: `---
name: Migration pattern for Vectis Hub
description: Always back new migrations with a run-migrations endpoint entry; prisma migrate deploy is unreliable on Railway
type: feedback
---

Database migration errors are a recurring problem on Railway staging/production. \`prisma migrate deploy\` can fail silently on startup.

**Rule:** Whenever a new Prisma migration is added, also add the equivalent \`CREATE TABLE IF NOT EXISTS\` or \`ALTER TABLE ... ADD COLUMN IF NOT EXISTS\` SQL to the \`MIGRATIONS\` array in \`app/api/admin/run-migrations/route.ts\`.

**Why:** The Run Migrations button on /admin gives Jordan a one-click fix without needing console commands or redeployment.

**How to apply:** Any time a schema change is made, update both the migration file AND the run-migrations endpoint in the same commit.`,
  },
  {
    filename: "feedback_git_workflow.md",
    content: `---
name: Git push workflow for Vectis Hub
description: Always pull from remote staging before pushing — another developer also pushes to staging
type: feedback
---

Another developer works on the same staging branch. Always pull before pushing, not after, so our commits go on top cleanly.

**Rule:** Before pushing to staging, run \`git pull origin staging\` first, then push.

**Why:** Git rejects pushes when the remote is ahead of local. Pulling first avoids force-pushing which would overwrite the other developer's work.

**How to apply:** Every time I'm about to push to staging, pull first. At the start of a session is ideal.`,
  },
  {
    filename: "MEMORY.md",
    content: `---
name: Memory Index
description: Index of all memory files
type: reference
---

# Memory Index

- [User Profile](user_profile.md) — Jordan Orange, Vectis auction house, non-technical, Windows 11, GitHub: Jordan-Vectis
- [Vectis Hub Project](project_vectis_crm.md) — Full spec, stack, deployment details and live URL for Vectis Hub
- [Feedback](feedback_vectis.md) — Keep responses short, one paragraph max
- [File Saving Preference](feedback_file_saving.md) — Always ask where to save files before saving them
- [App Naming](feedback_naming.md) — Don't call it a CRM; it's "the app"
- [Migration Pattern](feedback_migrations.md) — Always add new migrations to run-migrations endpoint; prisma migrate deploy unreliable on Railway
- [Git Workflow](feedback_git_workflow.md) — Pull from remote staging before every push; another dev works on the same branch`,
  },
]

// ─── Rendering ────────────────────────────────────────────────────────────────

const TYPE_COLOURS: Record<string, string> = {
  user:      "bg-blue-100 text-blue-700",
  feedback:  "bg-amber-100 text-amber-700",
  project:   "bg-green-100 text-green-700",
  reference: "bg-purple-100 text-purple-700",
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: content.trim() }
  const meta: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":")
    if (colon === -1) continue
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return { meta, body: match[2].trim() }
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
      : part
  )
}

function renderBody(body: string) {
  return body.split("\n").map((line, i) => {
    if (line.startsWith("# "))   return <h2 key={i} className="text-base font-bold text-gray-900 mt-4 mb-1">{line.slice(2)}</h2>
    if (line.startsWith("## "))  return <h3 key={i} className="text-sm font-semibold text-gray-800 mt-3 mb-1">{line.slice(3)}</h3>
    if (line.startsWith("### ")) return <h4 key={i} className="text-sm font-medium text-gray-700 mt-2 mb-0.5">{line.slice(4)}</h4>
    if (line.startsWith("- "))   return <p key={i} className="text-sm text-gray-700 leading-relaxed pl-3 before:content-['–'] before:mr-2 before:text-gray-400">{renderInline(line.slice(2))}</p>
    if (line.trim() === "")      return <div key={i} className="h-2" />
    return <p key={i} className="text-sm text-gray-700 leading-relaxed">{renderInline(line)}</p>
  })
}

export default function MemoryPage() {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Claude Memory</h1>
        <p className="text-sm text-gray-500 mt-1">
          What Claude remembers about you, this project, and how to work with you.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {ENTRIES.map(entry => {
          const { meta, body } = parseFrontmatter(entry.content)
          const isOpen    = open === entry.filename
          const typeClass = TYPE_COLOURS[meta.type ?? ""] ?? "bg-gray-100 text-gray-600"

          return (
            <div key={entry.filename} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : entry.filename)}
                className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 text-sm">{meta.name ?? entry.filename}</span>
                    {meta.type && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeClass}`}>
                        {meta.type}
                      </span>
                    )}
                    <span className="text-xs text-gray-400 font-mono">{entry.filename}</span>
                  </div>
                  {meta.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
                  )}
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 mt-0.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isOpen && (
                <div className="border-t border-gray-100 px-5 py-4 space-y-1">
                  {renderBody(body)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
