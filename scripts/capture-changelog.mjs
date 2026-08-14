// Captures the commit history into changelog-capture.json at BUILD time, so
// Admin → Patches & Changes has the real list of what went out.
//
// Why here and not at runtime: the running app has no git and no GitHub token
// (a deliberate decision — see the note in app/api/patch-notes/draft/route.ts).
// Railway DOES have a clone while it builds, so this is the one moment the full
// history is available without giving the app credentials to anything.
//
// ⚠ It must never break the build. Railway may shallow-clone (in which case git
// returns only the tip) or drop .git entirely (in which case there is no git at
// all). Both are handled: the file is ALWAYS written, `source` says which
// happened, and the page tells the reader rather than quietly showing less.

import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import path from "node:path"

const OUT = path.join(process.cwd(), "changelog-capture.json")
const MAX = 500              // plenty of history without bloating the file
const SEP = ""          // unit separator — safe inside commit messages
const REC = ""          // record separator

function fromGit() {
  const raw = execFileSync(
    "git",
    ["log", `--max-count=${MAX}`, `--format=%H${SEP}%an${SEP}%aI${SEP}%s${REC}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  )
  return raw
    .split(REC)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha, author, date, subject] = r.split(SEP)
      return { sha, author, date, subject }
    })
    .filter((c) => c.sha && c.subject)
}

/** Railway always sets these, so even with no git at all a deploy records itself. */
function fromEnv() {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA
  const subject = process.env.RAILWAY_GIT_COMMIT_MESSAGE
  if (!sha || !subject) return []
  return [{
    sha,
    author: process.env.RAILWAY_GIT_AUTHOR ?? "",
    date: new Date().toISOString(),
    subject: subject.split("\n")[0],
  }]
}

// ⚠ This runs inside `npm run build`, so it must NEVER fail the build. A missing
// changelog is a small annoyance; a deploy that won't build is not. Everything
// below is inside one catch and the process always exits 0.
try {
  let commits = []
  let source = "none"
  try {
    commits = fromGit()
    source = commits.length > 1 ? "git" : "git-shallow"
  } catch {
    commits = []
  }
  // No git, or a shallow clone that yielded nothing — fall back to the single
  // commit Railway hands the build, and label it honestly so the page can say
  // the history for this release is partial.
  if (commits.length === 0) {
    commits = fromEnv()
    source = commits.length ? "deploy-env" : "none"
  }

  writeFileSync(OUT, JSON.stringify({
    capturedAt: new Date().toISOString(),
    source,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
    commits,
  }, null, 0))

  console.log(`[changelog] captured ${commits.length} commit(s) via ${source}`)
} catch (e) {
  console.warn(`[changelog] skipped: ${e?.message ?? e}`)
}
process.exit(0)
