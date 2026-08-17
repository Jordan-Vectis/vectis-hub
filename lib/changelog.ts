// Admin → Patches & Changes — reading the development record.
//
// Where the data comes from, in order of preference:
//   1. changelog-capture.json — written at BUILD time by
//      scripts/capture-changelog.mjs, when Railway still has a clone.
//   2. lib/changelog-seed.ts — the history up to the day this was built,
//      committed so the page is never empty even on a shallow clone.
//   3. RAILWAY_GIT_COMMIT_* — the current deploy, so a deploy always records
//      itself even if both of the above fail.
//
// The running app has no git and no GitHub token (a deliberate decision — see
// app/api/patch-notes/draft/route.ts). Nothing here reaches out anywhere.
//
// ⚠ Server-only: it reads the filesystem. Never import from a "use client" file.

import fs from "node:fs"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { CHANGELOG_SEED } from "@/lib/changelog-seed"

export type RawCommit = { sha: string; author: string; date: string; subject: string }
export type CaptureSource = "git" | "git-shallow" | "deploy-env" | "seed" | "none"

export type CaptureInfo = {
  source: CaptureSource
  capturedAt: string | null
  count: number
  /** The newest commit the COMMITTED seed carries — the record is complete up to here.
   *  Past it, a deploy can only vouch for its own headline change. Read from the seed
   *  rather than hardcoded, so refreshing the seed moves the date on its own. */
  completeTo: string | null
}

/** Seed is newest-first (git log order), so entry 0 is how far the record is complete. */
export const SEED_COMPLETE_TO: string | null = CHANGELOG_SEED[0]?.date ?? null

function readCaptureFile(): { source: CaptureSource; capturedAt: string | null; commits: RawCommit[] } | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "changelog-capture.json"), "utf8")
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.commits)) return null
    return {
      source: (parsed.source ?? "none") as CaptureSource,
      capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : null,
      commits: parsed.commits.filter((c: any) => c?.sha && c?.subject),
    }
  } catch {
    return null   // no build-time capture on this deploy — the seed covers it
  }
}

function currentDeployCommit(): RawCommit | null {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA
  const subject = process.env.RAILWAY_GIT_COMMIT_MESSAGE
  if (!sha || !subject) return null
  return {
    sha,
    author: process.env.RAILWAY_GIT_AUTHOR ?? "",
    date: new Date().toISOString(),
    subject: String(subject).split("\n")[0],
  }
}

/** Changes that are internal plumbing rather than anything that went out.
 *  Kept in the record (the history should be complete) but flagged so the
 *  manager report isn't padded with them. */
const HOUSEKEEPING = /^(memory|rules|docs?|chore|typo|lint|wip|merge |revert )/i
export function isHousekeeping(subject: string): boolean {
  return HOUSEKEEPING.test(subject.trim())
}

/**
 * Bring the database up to date with whatever this deploy knows.
 * Idempotent — keyed on sha, so it can run on every page load.
 */
export async function ingestChanges(): Promise<CaptureInfo> {
  const capture = readCaptureFile()
  const rows: { commit: RawCommit; source: CaptureSource }[] = []

  for (const c of CHANGELOG_SEED) rows.push({ commit: c, source: "seed" })
  if (capture) for (const c of capture.commits) rows.push({ commit: c, source: capture.source })
  const now = currentDeployCommit()
  if (now) rows.push({ commit: now, source: "deploy-env" })

  if (rows.length === 0) return { source: "none", capturedAt: null, count: 0, completeTo: SEED_COMPLETE_TO }

  // Only insert what's missing. createMany + skipDuplicates leans on the unique
  // sha, so a re-ingest costs one insert attempt and changes nothing.
  const known = new Set(
    (await prisma.deployChange.findMany({ select: { sha: true } })).map(r => r.sha),
  )
  const fresh = rows.filter(r => !known.has(r.commit.sha))
  // A later source shouldn't duplicate an earlier one within the same batch.
  const seen = new Set<string>()
  const toCreate = fresh.filter(r => !seen.has(r.commit.sha) && (seen.add(r.commit.sha), true))

  if (toCreate.length > 0) {
    await prisma.deployChange.createMany({
      data: toCreate.map(r => ({
        sha:         r.commit.sha,
        subject:     r.commit.subject.slice(0, 2000),
        author:      r.commit.author?.slice(0, 120) || null,
        committedAt: new Date(r.commit.date),
        source:      r.source,
        environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
      })),
      skipDuplicates: true,
    })
  }

  return {
    source: capture?.source ?? (now ? "deploy-env" : "seed"),
    capturedAt: capture?.capturedAt ?? null,
    count: await prisma.deployChange.count(),
    completeTo: SEED_COMPLETE_TO,
  }
}

export type ChangeRow = {
  id: string
  sha: string
  subject: string
  author: string | null
  committedAt: string
  housekeeping: boolean
}

/** The changes in a window, newest first. */
export async function listChanges(from: Date, to: Date): Promise<ChangeRow[]> {
  const rows = await prisma.deployChange.findMany({
    where: { committedAt: { gte: from, lte: to } },
    orderBy: { committedAt: "desc" },
    take: 1000,
  })
  return rows.map(r => ({
    id: r.id,
    sha: r.sha.slice(0, 8),
    subject: r.subject,
    author: r.author,
    committedAt: r.committedAt.toISOString(),
    housekeeping: isHousekeeping(r.subject),
  }))
}

/** Turn a window of changes into the block the AI summarises. Housekeeping is
 *  marked rather than dropped, so the model can weigh it instead of guessing.
 *
 *  ⚠ NO AUTHOR NAMES (Jordan, 2026-08-14: "I dont need the name of who did what
 *  on the actual manager report"). They are deliberately withheld from the model
 *  rather than merely discouraged in the prompt — a name that never reaches the
 *  AI cannot end up in the report. The on-screen list still shows them. */
export function changesToText(rows: ChangeRow[]): string {
  return rows
    .map(r => `- ${r.committedAt.slice(0, 10)}${r.housekeeping ? " [internal]" : ""}: ${r.subject}`)
    .join("\n")
}
