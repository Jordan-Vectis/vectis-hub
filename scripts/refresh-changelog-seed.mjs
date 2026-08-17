// Regenerates lib/changelog-seed.ts from the FULL local git history.
//
// ⚠ WHY THIS EXISTS — read before assuming the capture script covers it.
// Railway's build has no .git directory at all. scripts/capture-changelog.mjs
// therefore falls back to RAILWAY_GIT_COMMIT_SHA / _MESSAGE and records exactly
// ONE commit per deploy — the headline one — which is precisely what the amber
// banner on Admin → Patches & Changes reports. Everything that went out
// alongside it is invisible to the running app, because the app has no git and
// no GitHub token (a deliberate decision).
//
// So the only complete history the Hub can ever see is the history COMMITTED
// into the repo: lib/changelog-seed.ts. It has to be refreshed from a machine
// that actually has the commits — which means running this before pushing.
//
//   npm run changelog:seed
//
// It is safe to run at any time: it only ever grows the file, and it refuses to
// write at all if this clone can't see the full history.

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const OUT   = path.join(process.cwd(), "lib", "changelog-seed.ts")
// ⚠ Keep the explicit T00:00:00. A bare "2026-07-01" is an APPROXIMATE date to git: it
// resolves using the CURRENT TIME OF DAY, so the cutoff slides forward as the day goes on
// and an afternoon run silently drops that morning's commits from the far end. Measured
// 2026-08-17: the bare form returned 462 commits at 15:05 where midnight returns 482. The
// "never shrink" guard below caught it, which is precisely what that guard is for.
const SINCE = "2026-07-01T00:00:00"     // where the record starts — see the file's own header
const SEP   = ""
const REC   = ""

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

function fail(msg) {
  console.error(`[changelog-seed] NOT written — ${msg}`)
  process.exit(1)
}

// ── Guard 1: this clone must actually have the history ───────────────────────
// Writing a seed from a shallow clone would DELETE the committed history and
// leave the page emptier than before. That is far worse than not refreshing.
let shallow = "false"
try {
  shallow = git("rev-parse", "--is-shallow-repository")
} catch (e) {
  fail(`git is not available here (${e?.message ?? e})`)
}
if (shallow !== "false") fail("this is a shallow clone, so most of the history is missing here")

const raw = git("log", `--since=${SINCE}`, "--max-count=2000", `--format=%H${SEP}%an${SEP}%aI${SEP}%s${REC}`)
const commits = raw
  .split(REC)
  .map(r => r.trim())
  .filter(Boolean)
  .map(r => {
    const [sha, author, date, subject] = r.split(SEP)
    return { sha, author, date, subject }
  })
  .filter(c => c.sha && c.subject)

if (commits.length === 0) fail("git returned no commits")

// ── Guard 2: never shrink the record ─────────────────────────────────────────
// A wrong branch, a bad --since, or a partial fetch would all show up as fewer
// entries than are already committed. Refuse rather than lose them.
let existing = 0
try {
  existing = (readFileSync(OUT, "utf8").match(/"sha":/g) ?? []).length
} catch { /* first run — nothing to protect */ }
if (commits.length < existing) {
  fail(`this would drop the record from ${existing} to ${commits.length} entries`)
}

const newest = commits[0].date.slice(0, 10)
const header = `// The commit history from 1 July 2026 up to ${newest}, committed into the repo.
//
// ⚠ THIS IS THE ONLY COMPLETE HISTORY THE RUNNING APP CAN SEE. Railway's build
// has no .git, so scripts/capture-changelog.mjs falls back to the deploy
// environment and records just ONE commit per release — the amber banner on
// Admin → Patches & Changes is reporting exactly that. Everything between
// deploys reaches the page through this file and no other route.
//
// ⚠ Regenerate it BEFORE pushing, or the work you just did will not appear:
//     npm run changelog:seed
// Never edit it by hand. Ingest is keyed on sha, so re-seeding only ever adds
// what is missing — it can't duplicate or overwrite anything.

export type SeedCommit = { sha: string; author: string; date: string; subject: string }

export const CHANGELOG_SEED: SeedCommit[] = [
`

const body = commits.map(c => `  ${JSON.stringify(c)},`).join("\n")
writeFileSync(OUT, `${header}${body}\n]\n`, "utf8")

const added = commits.length - existing
console.log(`[changelog-seed] ${commits.length} commit(s) up to ${newest}${added > 0 ? ` (+${added} new)` : " (no change)"}`)
