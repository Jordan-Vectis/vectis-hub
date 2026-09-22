import type { CheckResult, Fact, StatusCheckDef, StatusState } from "@/lib/status/types"
import { KEEP, backupProgress, listBackups, type BackupEntry } from "@/lib/backup-engine"
import { R2_CREDENTIAL_VARS, backupFolder, describeR2Error, fmtBytes, fmtWhen, missingSettings, probeClient } from "./storage"

// 💾 Last night's backup — the nightly copy of EVERY table in the R2 backup bucket.
//
// server.js calls /api/cron/db-backup at midnight UTC (then every 24 h); lib/backup-engine.ts
// writes `${env}/backup-YYYY-MM-DD-HHMMSS/` — one `tables/<Name>.jsonl` per table plus a
// manifest.json saying what was copied and what failed — and keeps the newest 30.
//
// ⚠ The manifest is the evidence. Since 2026-09-22 a table that fails to copy is NAMED there
// (before that, a failed table was saved as null and the run still said ok — green could not
// mean "every table was saved"). So this light goes amber on a failed table, not just on a
// missing night. The older single-file copies (`backup-<ts>.json`) still count as full copies.
//
// ⚠ NEVER "test" it by calling /api/cron/db-backup or POST /api/admin/backup: that writes a
// new copy and can prune a real one out of the 30. Reading the list and the small manifests is
// all this does.
//
// ⚠ Freshness comes from the manifest's own finishedAt (or LastModified for an old file), never
// the folder name — the name is only there to sort by.
//
// ⚠ The schedule is a setTimeout-to-midnight from boot with no catch-up: a crash or deploy
// across 00:00 UTC silently skips that night. That is what the 26-hour red is for.

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** A full copy of every table takes minutes now (the ABC archive alone is ~1 GB), so give it
 *  until 02:00 UTC before expecting tonight's; until then last night's still counts. */
const GRACE_UTC_HOUR = 2
const DOWN_AFTER_MS = 26 * HOUR_MS
/** Amber below this share of the usual size. */
const SMALL_RATIO = 0.7
/** "Usual size" = the middle of up to this many full copies before the newest. */
const SIZE_SAMPLE = 7
const CALL_TIMEOUT_MS = 10_000

// ── Wording ───────────────────────────────────────────────────────────────────────

const londonYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
const londonTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })
const londonDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" })

/** "today at 01:00", "yesterday at 01:00", "on Tue 8 Sept at 01:00" — London time. */
function whenSaid(ms: number, nowMs: number): string {
  const day = londonYmd.format(ms)
  const time = londonTime.format(ms)
  if (day === londonYmd.format(nowMs)) return `today at ${time}`
  if (day === londonYmd.format(nowMs - DAY_MS)) return `yesterday at ${time}`
  return `on ${londonDate.format(ms)} at ${time}`
}

function median(ns: number[]): number {
  const s = [...ns].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const at = (e: BackupEntry) => Date.parse(e.at ?? "") || 0

const SCHEDULE_FACT: Fact = { label: "When it runs", value: "Every night at midnight UTC (1 am UK time in summer) — every table, one file each" }
const PROVES_FACT: Fact = {
  label: "What green proves",
  value: "A copy of every table arrived since midnight, its own manifest says no table failed, and it is about its usual size.",
}
const NOT_COVERED_FACT: Fact = {
  label: "Not in the backup",
  value: "Photos and files — they already live in R2 — and Prisma's migration bookkeeping. Neon's own restore history covers the whole database as well.",
}

/** The facts that describe what's in the folder, used whether or not backups run here. */
function folderFacts(entries: BackupEntry[], nowMs: number, newestTone?: Fact["tone"]): Fact[] {
  const full = entries.filter(e => !e.partial && !e.inProgress)
  const partial = entries.filter(e => e.partial && !e.inProgress)
  const newest = full[0]
  const facts: Fact[] = [{
    label: "Newest full copy",
    value: newest
      ? `${fmtWhen(at(newest), nowMs)} · ${fmtBytes(newest.bytes)}${newest.kind === "folder" ? ` · ${newest.tables} tables, ${newest.rows.toLocaleString("en-GB")} rows` : " · old single-file style"}`
      : "None in this environment's folder",
    ...(newestTone ? { tone: newestTone } : {}),
  }]
  if (newest?.failed) facts.push({ label: "Tables not copied", value: `${newest.failed} — named on Admin → Database Backup`, tone: "bad" })
  if (newest?.stopped) facts.push({ label: "Stopped", value: "Someone pressed Stop part-way, so it isn't a complete copy", tone: "warn" })
  const before = full.slice(1, 1 + SIZE_SAMPLE)
  if (before.length) {
    facts.push({
      label: "Usual size",
      value: `About ${fmtBytes(median(before.map(f => f.bytes)))} (the middle of the ${before.length} full cop${before.length === 1 ? "y" : "ies"} before it)`,
    })
  }
  if (partial[0]) {
    const newer = !newest || at(partial[0]) > at(newest)
    facts.push({
      label: "Newest partial copy",
      value: `${fmtWhen(at(partial[0]), nowMs)} · ${fmtBytes(partial[0].bytes)} — only some tables${newer ? ", so it doesn't count as a full backup" : ""}`,
    })
  }
  const dead = entries.filter(e => e.inProgress).length - (backupProgress().running ? 1 : 0)
  if (dead > 0) facts.push({ label: "Unfinished", value: `${dead} folder${dead === 1 ? "" : "s"} with no manifest — a run that died before it finished. Delete ${dead === 1 ? "it" : "them"} on Admin → Database Backup.`, tone: "warn" })
  facts.push({
    label: "Copies kept",
    value: `${entries.length} of ${KEEP} (${full.length} full, ${partial.length} partial)`,
    // ⚠ Partial copies count towards the 30 the job keeps, so a burst of them pushes real
    // nightly copies out early (the prune sorts by name, not by kind).
    ...(partial.length >= 5 ? { tone: "warn" as const } : {}),
  })
  if (partial.length >= 5) {
    facts.push({ label: "Partial copies", value: "They count towards the 30 kept, so they push full nightly copies out sooner.", tone: "warn" })
  }
  return facts
}

const backup: StatusCheckDef = {
  key: "backup",
  name: "Last night's backup",
  group: "hub",
  what: "The nightly copy of every table in the database, kept in R2 (the last 30).",
  whenDown: "If data were lost, the newest in-app copy would be older than it should be.",
  intervalMin: 60,

  async run(ctx): Promise<CheckResult> {
    const nowMs = ctx.now.getTime()
    const folder = backupFolder()
    const folderFact: Fact = { label: "Folder", value: `${folder} in the backup store` }
    const missing = missingSettings([...R2_CREDENTIAL_VARS, "CLOUDFLARE_R2_BACKUP_BUCKET"])

    // ⚠ FIRST: backups only run where server.js runs its background jobs (production build +
    // CRON_SECRET). Sandbox has no CRON_SECRET by design — never add one — and its folder
    // stays empty unless someone presses Run backup there. Grey, never red.
    if (!ctx.backgroundJobsExpected) {
      const facts: Fact[] = [{
        label: "Why it's off",
        value: "The nightly backup runs only where the Hub's background jobs do. Anything here was made by pressing Run backup on Admin → Database Backup.",
      }]
      if (missing.length) {
        facts.push({ label: "Backup store", value: "Not set up on this environment" })
      } else {
        try {
          facts.push(...folderFacts(await listBackups(probeClient()), nowMs))
        } catch (e) {
          const f = describeR2Error(e, CALL_TIMEOUT_MS)
          facts.push({ label: "Backup list", value: `Couldn't be read — Cloudflare storage ${f.text}`, tone: "warn" })
        }
      }
      facts.push(folderFact)
      return { state: "off", summary: "Backups don't run on this environment.", facts }
    }

    // Jobs run here, but the job has nowhere to write: every night's run throws.
    if (missing.length) {
      return {
        state: "down",
        summary: "No backups can be made here because the backup store isn't set up on this environment.",
        facts: [{ label: "Missing settings", value: missing.join(", "), tone: "bad" }, SCHEDULE_FACT],
      }
    }

    let entries: BackupEntry[]
    const started = Date.now()
    try {
      entries = await listBackups(probeClient())
    } catch (e) {
      const f = describeR2Error(e, CALL_TIMEOUT_MS)
      return {
        state: f.state,
        summary: `Couldn't read the list of backups: Cloudflare storage ${f.text}.`,
        facts: [{ label: "Backup list", value: `Failed — ${f.detail}`, tone: f.state === "unknown" ? "warn" : "bad" }, folderFact, SCHEDULE_FACT],
      }
    }
    const latencyMs = Date.now() - started

    const full = entries.filter(e => !e.partial && !e.inProgress)
    const partial = entries.filter(e => e.partial && !e.inProgress)
    const newest = full[0]

    // Before 02:00 UTC, last night means the night before.
    const todayUtc = Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), ctx.now.getUTCDate())
    const cutoff = ctx.now.getUTCHours() < GRACE_UTC_HOUR ? todayUtc - DAY_MS : todayUtc

    let state: StatusState
    let summary: string
    let tone: Fact["tone"]
    const extra: Fact[] = []

    // ⚠ Judged on the newest FULL copy only. A partial one is someone pressing Run backup
    // for a few tables: it doesn't make up for a missed night, and one taken after a good
    // nightly copy is not a problem.
    if (!newest) {
      state = "down"; tone = "bad"
      summary = "There's no full backup for this environment in the backup store."
    } else if (nowMs - at(newest) > DOWN_AFTER_MS) {
      state = "down"; tone = "bad"
      summary = `No full backup has been saved for ${Math.floor((nowMs - at(newest)) / HOUR_MS)} hours — the newest was ${whenSaid(at(newest), nowMs)}.`
    } else if (at(newest) < cutoff) {
      state = "degraded"; tone = "warn"
      summary = `Last night's backup hasn't arrived yet — the newest full copy was saved ${whenSaid(at(newest), nowMs)}.`
    } else if (newest.stopped) {
      state = "degraded"; tone = "warn"
      summary = `The newest backup (${whenSaid(at(newest), nowMs)}) was stopped part-way, so it isn't a complete copy.`
    } else if (newest.failed > 0) {
      state = "degraded"; tone = "warn"
      summary = `Last night's backup arrived ${whenSaid(at(newest), nowMs)} but ${newest.failed} table${newest.failed === 1 ? "" : "s"} couldn't be copied — see Admin → Database Backup for which.`
    } else {
      const before = full.slice(1, 1 + SIZE_SAMPLE).map(f => f.bytes)
      const usual = before.length ? median(before) : 0
      if (usual > 0 && newest.bytes < SMALL_RATIO * usual) {
        state = "degraded"; tone = "warn"
        summary = `The newest backup was saved ${whenSaid(at(newest), nowMs)} but is much smaller than usual (${fmtBytes(newest.bytes)} against about ${fmtBytes(usual)}), so it is worth a look.`
      } else {
        state = "ok"; tone = "good"
        summary = `The newest full backup was saved ${whenSaid(at(newest), nowMs)}${newest.kind === "folder" ? ` — ${newest.tables} tables, ${fmtBytes(newest.bytes)}` : ` (${fmtBytes(newest.bytes)})`}.`
        if (!before.length) extra.push({ label: "Size check", value: "Not done — there's no earlier full copy to compare with" })
      }
    }

    if (state !== "ok" && partial[0] && (!newest || at(partial[0]) > at(newest))) {
      extra.push({ label: "Since then", value: `Only a partial copy (some tables) was saved, ${whenSaid(at(partial[0]), nowMs)} — it doesn't count as a full backup.`, tone: "warn" })
    }

    return {
      state,
      summary,
      facts: [...folderFacts(entries, nowMs, tone), ...extra, SCHEDULE_FACT, folderFact, PROVES_FACT, NOT_COVERED_FACT],
      latencyMs,
    }
  },
}

export default backup
