import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { CHECKS } from "./registry"
import type {
  Bucket, CheckContext, CheckResult, Fact, NotificationView, RunResponse, ServiceView,
  StatusCheckDef, StatusResponse, StatusState,
} from "./types"

// 🚦 Status Centre engine — runs the checks in lib/status/checks, keeps the
// current state of each service, the uptime history, and rings the admin bell.
//
// Called every 5 minutes on production (30 elsewhere) by the loop in server.js,
// and by "Check now" on /admin/status.
//
// ⚠ The bell rings only after NOTIFY_AFTER bad results in a row — one blip is
// not an outage — and once more when the service recovers. Grey states
// (unknown / off) never ring it.
//
// ⚠ The database is one of the things being checked, so every write here is in a
// try/catch and the latest results are ALSO held in memory: while the database is
// refusing saves, /admin/status still shows the truth, and the bad spell is filed
// as an alert the moment the database can record it again.
//
// ⚠ A check can be SWITCHED OFF (Jordan, 2026-09-22: "I don't use the it emails thing
// anymore can I have options in the status centre to disable things"). StatusService
// .disabledAt/.disabledBy — NULL = on. Off means: never run (the loop AND "Check now"),
// left out of the banner's answer and of "Check everything", never rings the bell. The
// tile stays on the page, greyed, saying who switched it off and when, so it can be
// switched back on. The two columns arrive with Run Migrations, so every read of them
// is tiered: with them, then without — the page must not lose its history over a
// column that isn't there yet.

const NOTIFY_AFTER = 2
const DEFAULT_INTERVAL_MIN = 5
const DEFAULT_TIMEOUT_MS = 25_000
const KEEP_CHECK_DAYS = 30
const KEEP_ALERT_DAYS = 90

type Snapshot = { state: StatusState; summary: string; facts: Fact[]; latencyMs: number | null; checkedAt: number; cause?: "hub" | "supplier" }
type Unrecorded = { firstBadAt: number; lastBadAt: number; count: number; summary: string }
type Mem = {
  latest: Map<string, Snapshot>
  lastRun: Map<string, number>
  running: Set<string>
  /** Bad results the database couldn't record (usually because it was the thing that was down). */
  unrecorded: Map<string, Unrecorded>
  lastPrune: number
}

function mem(): Mem {
  const g = globalThis as unknown as { _statusEngine?: Mem }
  return (g._statusEngine ??= { latest: new Map(), lastRun: new Map(), running: new Set(), unrecorded: new Map(), lastPrune: 0 })
}

const isBad = (s: StatusState | null | undefined) => s === "down" || s === "degraded"

// ── The switch ─────────────────────────────────────────────────────────────────

const SERVICE_COLS = {
  service: true, state: true, summary: true, detail: true, latencyMs: true, since: true,
  lastCheckedAt: true, lastOkAt: true, badSince: true, failStreak: true, notifiedState: true,
} as const
type ServiceRow = { [K in keyof typeof SERVICE_COLS]: Awaited<ReturnType<typeof prisma.statusService.findMany>>[number][K] }
  & { disabledAt: Date | null; disabledBy: string | null }

/** Prisma says "column does not exist" as P2022; a raw error says it in words. */
const isMissingColumn = (e: unknown) =>
  (e as { code?: string })?.code === "P2022" || /column .* does not exist/i.test(String((e as Error)?.message ?? ""))

/** Every service's row — with the switch columns where they exist, without them where they don't yet.
 *  ⚠ Each tier drops exactly one thing (RULES.md): the second tier is the page as it was before the switch. */
async function readServiceRows(): Promise<ServiceRow[]> {
  try {
    return await prisma.statusService.findMany({ select: { ...SERVICE_COLS, disabledAt: true, disabledBy: true } })
  } catch (e) {
    if (!isMissingColumn(e)) throw e
    const rows = await prisma.statusService.findMany({ select: SERVICE_COLS })
    return rows.map(r => ({ ...r, disabledAt: null, disabledBy: null }))
  }
}

/** The keys switched off right now. ⚠ Empty, never an error, when the columns aren't there yet or the
 *  database can't be read — a check must not stop running because the switch can't be read. */
async function disabledKeys(): Promise<Set<string>> {
  try {
    const rows = await prisma.statusService.findMany({ where: { disabledAt: { not: null } }, select: { service: true } })
    return new Set(rows.map(r => r.service))
  } catch {
    return new Set()
  }
}

export async function isServiceDisabled(key: string): Promise<boolean> {
  return (await disabledKeys()).has(key)
}

/** Switches a check off (never run, never counted, never rings the bell) or back on. Throws with a
 *  plain sentence the page can show — including "press Run Migrations" while the columns are missing. */
export async function setServiceSwitch(key: string, enabled: boolean, by: string): Promise<void> {
  const def = CHECKS.find(c => c.key === key)
  if (!def) throw new Error(`No such check: ${key}`)
  const m = mem()
  const now = new Date()
  try {
    if (enabled) {
      // updateMany: a check switched off before it was ever checked has a row; one never switched off
      // may not, and "switch on" on a row that doesn't exist is simply already on.
      await prisma.statusService.updateMany({ where: { service: key }, data: { disabledAt: null, disabledBy: null } })
      m.lastRun.delete(key) // checked at the loop's next tick rather than after a full interval
    } else {
      // ⚠ The bell's bookkeeping is reset with it: a service switched off mid-outage must not ring
      // "working again" the day it is switched back on, and its streak starts from nothing then.
      await prisma.statusService.upsert({
        where: { service: key },
        create: { service: key, state: "unknown", summary: "Switched off before it was ever checked here.", disabledAt: now, disabledBy: by, failStreak: 0 },
        update: { disabledAt: now, disabledBy: by, failStreak: 0, badSince: null, notifiedState: null },
        select: { service: true },
      })
      m.latest.delete(key)
      m.unrecorded.delete(key)
    }
  } catch (e) {
    if (isMissingColumn(e)) throw new Error("The database doesn't have this switch yet — press Run Migrations at the bottom of the Admin page, then try again.")
    throw e
  }
  ;(globalThis as { _io?: { emit: (event: string) => void } })._io?.emit("status:changed")
}

export function checkContext(): CheckContext {
  const prodBuild = process.env.NODE_ENV === "production"
  const env = process.env.RAILWAY_ENVIRONMENT_NAME || (prodBuild ? "unknown" : "development")
  return {
    env,
    isProduction: env === "production",
    backgroundJobsExpected: prodBuild && !!process.env.CRON_SECRET,
    now: new Date(),
  }
}

/** Takes anything that looks like a credential out of text we store or show. */
export function scrub(text: unknown): string {
  return String(text ?? "")
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "postgres://…")
    .replace(/\b(key|token|secret|password|sig|signature|code)=([^&\s'"]+)/gi, "$1=…")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer …")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-…")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "AIza…")
    .slice(0, 600)
}

function fmtDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`
  return `${Math.round(h / 24)} days`
}

function fmtLondon(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ms))
}

function fmtLondonDate(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ms))
}

async function runOne(def: StatusCheckDef, ctx: CheckContext): Promise<CheckResult> {
  const cap = def.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const abandoned = new Promise<CheckResult>(resolve => {
      timer = setTimeout(() => resolve({
        state: "unknown",
        summary: `The check took longer than ${Math.round(cap / 1000)} seconds and was abandoned, so this couldn't be confirmed.`,
      }), cap)
    })
    const r = await Promise.race([def.run(ctx), abandoned])
    return {
      state: r.state,
      summary: scrub(r.summary),
      facts: (r.facts ?? []).map(f => ({ ...f, label: scrub(f.label), value: scrub(f.value) })),
      latencyMs: typeof r.latencyMs === "number" ? Math.round(r.latencyMs) : undefined,
      cause: r.cause === "hub" || r.cause === "supplier" ? r.cause : undefined,
    }
  } catch (e) {
    return {
      state: "unknown",
      summary: scrub(`The check itself failed, so this couldn't be confirmed: ${(e as Error)?.message ?? e}`),
      facts: [],
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Stores one result, works out whether the bell should ring, and returns whether the state changed. */
async function record(def: StatusCheckDef, r: CheckResult): Promise<boolean> {
  const m = mem()
  const now = new Date()
  const prevSnap = m.latest.get(def.key)
  m.latest.set(def.key, { state: r.state, summary: r.summary, facts: r.facts ?? [], latencyMs: r.latencyMs ?? null, checkedAt: now.getTime(), cause: r.cause })
  // A supplier's light whose fault is the Hub's own (a setting, key, sign-in or job) says so in the alert too.
  const ours = def.group !== "hub" && r.cause === "hub" ? " — the fix is on the Hub's side" : ""
  const changedInMemory = !prevSnap || prevSnap.state !== r.state

  try {
    // ⚠ Explicit select — a bare findUnique reads every column, including the switch columns, which
    // arrive with Run Migrations; without this, no result could be recorded until that was pressed.
    const prev = await prisma.statusService.findUnique({
      where: { service: def.key },
      select: { state: true, failStreak: true, badSince: true, notifiedState: true, since: true, lastOkAt: true },
    })
    const prevState = (prev?.state ?? null) as StatusState | null
    const un = m.unrecorded.get(def.key)

    let failStreak = prev?.failStreak ?? 0
    if (isBad(r.state)) failStreak = Math.max((isBad(prevState) ? failStreak : 0) + 1, un ? un.count + 1 : 0)
    else if (r.state !== "unknown") failStreak = 0

    let badSince: Date | null = prev?.badSince ?? null
    if (isBad(r.state)) {
      if (!badSince || prevState === "ok" || prevState === "off") badSince = un ? new Date(un.firstBadAt) : now
    } else if (r.state !== "unknown") badSince = null

    let notifiedState = prev?.notifiedState ?? null
    let alert: { level: NotificationView["level"]; title: string; body: string | null } | null = null
    if (isBad(r.state) && failStreak >= NOTIFY_AFTER && notifiedState !== r.state) {
      alert = r.state === "down"
        ? { level: "error",   title: `🔴 ${def.name} is down${ours}`,              body: r.summary }
        : { level: "warning", title: `🟠 ${def.name} is having problems${ours}`, body: r.summary }
      notifiedState = r.state
    } else if (r.state === "ok" && notifiedState && notifiedState !== "ok") {
      const from = prev?.badSince?.getTime()
      alert = { level: "success", title: `🟢 ${def.name} is working again`, body: from ? `It had problems for ${fmtDuration(now.getTime() - from)}.` : null }
      notifiedState = null
    } else if (r.state === "off") {
      notifiedState = null
    }
    // A bad spell nobody could record at the time (usually the database's own outage).
    if (!alert && un && r.state === "ok" && un.count >= NOTIFY_AFTER) {
      alert = {
        level: "warning",
        title: `🟠 ${def.name} had problems the Hub couldn't record at the time`,
        body: `From ${fmtLondon(un.firstBadAt)} to ${fmtLondon(un.lastBadAt)} (${un.count} checks in a row): ${un.summary} It is working again now.`,
      }
    }

    const data = {
      state: r.state,
      summary: r.summary,
      detail: JSON.parse(JSON.stringify({ facts: r.facts ?? [], cause: r.cause ?? null })),
      latencyMs: r.latencyMs ?? null,
      since: prev && prevState === r.state ? prev.since : now,
      lastCheckedAt: now,
      lastOkAt: r.state === "ok" ? now : (prev?.lastOkAt ?? null),
      badSince,
      failStreak,
      notifiedState,
    }
    // ⚠ Minimal selects: prisma reads the whole row back otherwise (RULES.md).
    await prisma.statusService.upsert({ where: { service: def.key }, create: { service: def.key, ...data }, update: data, select: { service: true } })
    await prisma.statusCheck.create({ data: { service: def.key, state: r.state, summary: r.summary, latencyMs: r.latencyMs ?? null, checkedAt: now }, select: { id: true } })
    m.unrecorded.delete(def.key)

    if (alert) await createNotification({ kind: "status", level: alert.level, title: alert.title, body: alert.body, href: `/admin/status#${def.key}` })
    return prevState !== r.state
  } catch {
    // Couldn't write (tables not created yet, or the database is refusing saves). Keep the bad spell
    // in memory so it is still reported once the database can record it.
    if (isBad(r.state)) {
      const u = m.unrecorded.get(def.key)
      m.unrecorded.set(def.key, u
        ? { ...u, lastBadAt: now.getTime(), count: u.count + 1, summary: r.summary }
        : { firstBadAt: now.getTime(), lastBadAt: now.getTime(), count: 1, summary: r.summary })
    }
    return changedInMemory
  }
}

async function pruneIfDue(): Promise<void> {
  const m = mem()
  if (Date.now() - m.lastPrune < 60 * 60 * 1000) return
  m.lastPrune = Date.now()
  try {
    await prisma.statusCheck.deleteMany({ where: { checkedAt: { lt: new Date(Date.now() - KEEP_CHECK_DAYS * 86_400_000) } } })
    await prisma.notification.deleteMany({ where: { kind: "status", createdAt: { lt: new Date(Date.now() - KEEP_ALERT_DAYS * 86_400_000) } } })
  } catch { /* tables not there yet — nothing to prune */ }
}

/** Runs the checks that are due (or the named ones, forced) and records the results. */
export async function runChecks(opts: { only?: string[]; force?: boolean } = {}): Promise<RunResponse> {
  const ctx = checkContext()
  const m = mem()
  const nowMs = Date.now()
  const disabled = await disabledKeys()
  const due = CHECKS
    .filter(d => !opts.only || opts.only.includes(d.key))
    .filter(d => !disabled.has(d.key)) // switched off on the page — never run, not even by "Check now"
    .filter(d => opts.force || nowMs - (m.lastRun.get(d.key) ?? 0) >= (d.intervalMin ?? DEFAULT_INTERVAL_MIN) * 60_000 - 30_000)
    .filter(d => !m.running.has(d.key)) // a slow check still in flight is never started twice
  for (const d of due) { m.running.add(d.key); m.lastRun.set(d.key, nowMs) }

  const out = await Promise.all(due.map(async d => {
    try {
      const r = await runOne(d, ctx)
      const changed = await record(d, r)
      return { key: d.key, r, changed }
    } finally {
      m.running.delete(d.key)
    }
  }))

  void pruneIfDue()
  if (out.length) (globalThis as { _io?: { emit: (event: string) => void } })._io?.emit("status:changed")

  return {
    ran: out.map(o => o.key),
    changed: out.filter(o => o.changed).map(o => o.key),
    results: out.map(o => ({ key: o.key, state: o.r.state, summary: o.r.summary })),
  }
}

// ── The view /api/status returns ─────────────────────────────────────────────────

const RANK: Record<string, number> = { off: 0, unknown: 1, ok: 2, degraded: 3, down: 4 }
const BY_RANK: StatusState[] = ["off", "unknown", "ok", "degraded", "down"]

function londonDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms))
}

export async function getStatusView(): Promise<StatusResponse> {
  const ctx = checkContext()
  const m = mem()
  let historyAvailable = true
  let rows = new Map<string, ServiceRow>()
  const uptime = new Map<string, ServiceView["uptime"]>()
  const hourMap = new Map<string, Map<string, StatusState>>()
  const dayMap = new Map<string, Map<string, StatusState>>()
  let alerts: NotificationView[] = []

  try {
    rows = new Map((await readServiceRows()).map(s => [s.service, s]))
  } catch {
    historyAvailable = false
  }

  if (historyAvailable) {
    try {
      // ⚠ checkedAt is stored as naive UTC, so compare against now() AT TIME ZONE 'UTC'.
      const up = await prisma.$queryRaw<{ service: string; n24: number; u24: number; n7: number; u7: number; n30: number; u30: number }[]>`
        SELECT "service",
          COUNT(*) FILTER (WHERE "state" IN ('ok','degraded','down') AND "checkedAt" > (now() AT TIME ZONE 'UTC') - interval '24 hours')::int AS n24,
          COUNT(*) FILTER (WHERE "state" IN ('ok','degraded')        AND "checkedAt" > (now() AT TIME ZONE 'UTC') - interval '24 hours')::int AS u24,
          COUNT(*) FILTER (WHERE "state" IN ('ok','degraded','down') AND "checkedAt" > (now() AT TIME ZONE 'UTC') - interval '7 days')::int AS n7,
          COUNT(*) FILTER (WHERE "state" IN ('ok','degraded')        AND "checkedAt" > (now() AT TIME ZONE 'UTC') - interval '7 days')::int AS u7,
          COUNT(*) FILTER (WHERE "state" IN ('ok','degraded','down'))::int AS n30,
          COUNT(*) FILTER (WHERE "state" IN ('ok','degraded'))::int AS u30
        FROM "StatusCheck"
        WHERE "checkedAt" > (now() AT TIME ZONE 'UTC') - interval '30 days'
        GROUP BY "service"`
      const pct = (u: number, n: number) => (n > 0 ? Math.round((u / n) * 1000) / 10 : null)
      for (const r of up) uptime.set(r.service, { h24: pct(r.u24, r.n24), d7: pct(r.u7, r.n7), d30: pct(r.u30, r.n30) })

      const rankSql = `MAX(CASE "state" WHEN 'down' THEN 4 WHEN 'degraded' THEN 3 WHEN 'ok' THEN 2 WHEN 'unknown' THEN 1 ELSE 0 END)::int`
      const hours = await prisma.$queryRawUnsafe<{ service: string; at: string; worst: number }[]>(
        `SELECT "service", to_char(date_trunc('hour', "checkedAt"), 'YYYY-MM-DD"T"HH24":00:00Z"') AS at, ${rankSql} AS worst
         FROM "StatusCheck" WHERE "checkedAt" > (now() AT TIME ZONE 'UTC') - interval '24 hours' GROUP BY 1, 2`)
      for (const h of hours) {
        if (!hourMap.has(h.service)) hourMap.set(h.service, new Map())
        hourMap.get(h.service)!.set(h.at, BY_RANK[h.worst] ?? "unknown")
      }
      const days = await prisma.$queryRawUnsafe<{ service: string; at: string; worst: number }[]>(
        `SELECT "service", to_char(date_trunc('day', ("checkedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London'), 'YYYY-MM-DD') AS at, ${rankSql} AS worst
         FROM "StatusCheck" WHERE "checkedAt" > (now() AT TIME ZONE 'UTC') - interval '31 days' GROUP BY 1, 2`)
      for (const d of days) {
        if (!dayMap.has(d.service)) dayMap.set(d.service, new Map())
        dayMap.get(d.service)!.set(d.at, BY_RANK[d.worst] ?? "unknown")
      }

      alerts = (await prisma.notification.findMany({
        where: { kind: "status" },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: { id: true, level: true, title: true, body: true, href: true, createdAt: true },
      })).map(a => ({ ...a, level: a.level as NotificationView["level"], createdAt: a.createdAt.toISOString() }))
    } catch {
      /* history reads failing shouldn't hide the live states */
    }
  }

  // The last 24 hours (UTC hour starts, oldest first) and the last 30 London days.
  const nowMs = Date.now()
  const hourStart = Math.floor(nowMs / 3_600_000) * 3_600_000
  const hourKeys = Array.from({ length: 24 }, (_, i) => new Date(hourStart - (23 - i) * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"))
  const dayKeys = Array.from({ length: 30 }, (_, i) => londonDay(nowMs - (29 - i) * 86_400_000))

  const services: ServiceView[] = CHECKS.map(def => {
    const row = rows.get(def.key)
    const hm = hourMap.get(def.key)
    const dm = dayMap.get(def.key)
    const history = {
      uptime: uptime.get(def.key) ?? { h24: null, d7: null, d30: null },
      hours: hourKeys.map((at): Bucket => ({ at, state: hm?.get(at) ?? null })),
      days: dayKeys.map((at): Bucket => ({ at, state: dm?.get(at) ?? null })),
    }
    // Switched off: the row's last real result is kept but not shown — the tile says who and when.
    if (row?.disabledAt) {
      const who = row.disabledBy || "an admin"
      return {
        key: def.key, name: def.name, group: def.group, what: def.what, whenDown: def.whenDown,
        statusPage: def.statusPage ?? null,
        state: "disabled",
        cause: def.group === "hub" ? "hub" : "supplier",
        summary: `Switched off by ${who} on ${fmtLondonDate(row.disabledAt.getTime())} — not checked, not counted in the answer at the top, and never rings the bell.`,
        facts: [],
        latencyMs: null,
        since: row.disabledAt.toISOString(),
        lastCheckedAt: row.lastCheckedAt.toISOString(),
        lastOkAt: row.lastOkAt?.toISOString() ?? null,
        disabledBy: row.disabledBy,
        disabledAt: row.disabledAt.toISOString(),
        ...history,
      }
    }
    const snap = m.latest.get(def.key)
    // Prefer the in-memory result when it is newer than what the database holds (e.g. saves refused).
    const useSnap = snap && (!row || snap.checkedAt > row.lastCheckedAt.getTime() + 1000)
    const facts = useSnap ? snap!.facts : (((row?.detail as { facts?: Fact[] } | null)?.facts) ?? [])
    const state: ServiceView["state"] = useSnap ? snap!.state : ((row?.state as StatusState | undefined) ?? "pending")
    const storedCause = useSnap ? snap!.cause : (row?.detail as { cause?: string } | null)?.cause
    return {
      key: def.key,
      name: def.name,
      group: def.group,
      what: def.what,
      whenDown: def.whenDown,
      statusPage: def.statusPage ?? null,
      state,
      cause: def.group === "hub" || storedCause === "hub" ? "hub" : "supplier",
      summary: useSnap ? snap!.summary : (row?.summary ?? "Not checked yet on this environment."),
      facts,
      latencyMs: useSnap ? snap!.latencyMs : (row?.latencyMs ?? null),
      since: useSnap ? (row && row.state === snap!.state ? row.since.toISOString() : null) : (row?.since.toISOString() ?? null),
      lastCheckedAt: useSnap ? new Date(snap!.checkedAt).toISOString() : (row?.lastCheckedAt.toISOString() ?? null),
      lastOkAt: row?.lastOkAt?.toISOString() ?? (snap?.state === "ok" ? new Date(snap.checkedAt).toISOString() : null),
      disabledBy: null,
      disabledAt: null,
      ...history,
    }
  })

  return { env: ctx.env, generatedAt: new Date().toISOString(), historyAvailable, services, alerts }
}

/** For "Check now": every check key, in page order. */
export function checkKeys(): string[] {
  return CHECKS.map(c => c.key)
}

export { RANK as STATE_RANK }
