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
//
// ⚠ IT FOLDS INTO HEAD — it does NOT make a commit of its own (2026-09-04).
// Railway names a deployment after the HEAD commit of the push, and
// capture-changelog.mjs reads that same commit for the release headline. A seed
// commit pushed on top of the work therefore renamed EVERY deployment and every
// release row "Refresh changelog seed", burying what actually went out
// underneath it (Jordan: "How come all the pushes are just called this in
// railway?"). So the refresh now amends itself into the commit it describes.
//
// It only amends when that is unmistakably safe — HEAD unpushed, not a merge,
// nothing else staged, no rebase in progress. Any doubt and it writes the file,
// says why it stopped, and leaves committing to you. Pass --no-amend to force
// that. It never force-pushes and never touches a commit that is on the remote.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const SEED_REL = "lib/changelog-seed.ts"        // as git spells it — forward slashes on Windows too
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

// ── Should this fold into HEAD, or stand as its own commit? ──────────────────
// Amending rewrites a commit, so every one of these must hold. If any doesn't,
// we still write the file — we just leave the committing alone and say so.
function amendBlockedBy() {
  if (process.argv.includes("--no-amend")) return "--no-amend was passed"

  let head
  try { head = git("rev-parse", "HEAD") } catch { return "there are no commits here yet" }

  // Rewriting something already on the remote would need a force-push. Never.
  if (git("branch", "-r", "--contains", head)) return "HEAD is already pushed"

  // A merge commit has 2+ parents. Amending one is a different operation and is
  // almost never what was meant — the merge-to-main headline is worth keeping.
  if (git("rev-list", "--parents", "-n", "1", head).split(/\s+/).length > 2) return "HEAD is a merge commit"

  // --amend commits whatever is in the index, so anything else already staged
  // would be swept silently into a commit that was never meant to carry it.
  const staged = git("diff", "--cached", "--name-only").split("\n").map(s => s.trim()).filter(Boolean)
  const strays = staged.filter(f => f !== SEED_REL)
  if (strays.length) return `${strays[0]} is staged as well as the seed`

  try {
    const gitDir = git("rev-parse", "--absolute-git-dir")
    for (const m of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
      if (existsSync(path.join(gitDir, m))) return "a merge or rebase is in progress"
    }
  } catch { /* the checks above are the ones that matter */ }

  return null
}

const amendBlocked = amendBlockedBy()
const amending = !amendBlocked
const headSha = amending ? git("rev-parse", "HEAD") : null

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
  // ⚠ Leave HEAD out when we are about to amend it. Amending gives it a NEW sha,
  // so recording the old one would file a commit that no longer exists — and
  // the next refresh would add the new sha beside it. Ingest is keyed on sha, so
  // that is a permanent DUPLICATE row on Patches & Changes, not a correction.
  // Nothing is lost by dropping it: the deploy capture records HEAD under its
  // final sha, and the next refresh files it properly.
  .filter(c => !(amending && c.sha === headSha))

if (commits.length === 0) fail("git returned no commits")

// ── Guard 2: never shrink the record ─────────────────────────────────────────
// A wrong branch, a bad --since, or a partial fetch would all show up as fewer
// entries than are already committed. Refuse rather than lose them.
let existing = 0
try {
  const prev = readFileSync(OUT, "utf8")
  existing = (prev.match(/"sha":/g) ?? []).length
  // An earlier run (or --no-amend) may already have recorded HEAD. We drop it
  // above on purpose, so don't read that one entry as the record shrinking.
  if (amending && headSha && prev.includes(headSha)) existing -= 1
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
//
// The very newest commit is deliberately NOT in here. The refresh folds itself
// into that commit, which changes its sha, so it is recorded by the deploy
// capture instead and lands here on the next refresh. Between the two, nothing
// is missed and no commit is filed twice.

export type SeedCommit = { sha: string; author: string; date: string; subject: string }

export const CHANGELOG_SEED: SeedCommit[] = [
`

const body = commits.map(c => `  ${JSON.stringify(c)},`).join("\n")
writeFileSync(OUT, `${header}${body}\n]\n`, "utf8")

const added = commits.length - existing
console.log(`[changelog-seed] ${commits.length} commit(s) up to ${newest}${added > 0 ? ` (+${added} new)` : " (no change)"}`)

// ── Fold it into HEAD ────────────────────────────────────────────────────────
if (!amending) {
  console.log(`[changelog-seed] not folded into HEAD (${amendBlocked}) — commit ${SEED_REL} yourself before pushing`)
} else {
  try {
    git("add", "--", SEED_REL)
    // Nothing staged means the file was already identical. Amending anyway would
    // rewrite a commit for no reason, so leave it be.
    if (!git("diff", "--cached", "--name-only")) {
      console.log("[changelog-seed] HEAD already carries this — nothing to fold in")
    } else {
      git("commit", "--amend", "--no-edit")
      console.log(`[changelog-seed] folded into HEAD — "${git("log", "-1", "--format=%s")}"`)
    }
  } catch (e) {
    // Don't fail the run: the file is written and correct either way.
    console.error(`[changelog-seed] ⚠ could not fold into HEAD (${e?.message ?? e})`)
    console.error(`[changelog-seed]   commit ${SEED_REL} yourself before pushing`)
  }
}
