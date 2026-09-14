import { BACKGROUND_BC_USERNAME, bcODataUrl, getBCTokenForStatus, type BCRenewFailure, type BCStatusToken } from "@/lib/bc"
import type { CheckContext, CheckResult, Fact, StatusCheckDef } from "../types"

// 🚦 Business Central — can the Hub's BACKGROUND work read BC right now?
//
// ⚠ There is NO company-wide BC account. Every background BC job (the timed BC copy, the reconcile,
// the report caches) signs in as ONE person through getBCTokenAny() — the Hub user named by
// BACKGROUND_BC_USERNAME in lib/bc.ts, Jordan's since 2026-09-14 (most staff's BC permissions don't
// cover everything the copy reads). This check tests that same sign-in and names whose it is. The
// page says so in words, not just a colour.
//
// ⚠ Production only. Staging and sandbox hold COPIES of production's BCToken rows, taken when their
// databases were branched (reference_sandbox_environment); renewing a copied key from a second
// place is untested with Microsoft, and the local .env IS the production database. So every other
// environment is "off" before a token is touched.
//
// ⚠ Never writes. The token comes from getBCTokenForStatus() in lib/bc.ts — that person's still-valid
// key, else a renewal held in memory — see why there.
//
// ⚠ One tiny read with its OWN 15 s timeout, not bcPage (45 s). Totes_Excel is small and already
// read by the tote sync with EVA_No; no filter, because complex filters time out in BC. With no
// filter an empty answer can only mean the wrong company/environment or lost permission.
//
// No retry inside the check: the engine only rings after two bad results in a row, and a second
// 15 s attempt would double the load on BC just when it's throttling (the 05:00 full run's top-up
// asks for five sales at once).
//
// Green means "BC answers the Hub's background key right now" — never "the copy is up to date".
// That is bc-sync's job. Nor does green prove the sign-in may read EVERY table: a permission refused
// on one table (the change log, 2026-09-11) shows only as bc-sync's failed passes.
//
// Whose side (types.ts `cause`): "hub" whenever the fix is ours — our BC settings, our app key, the
// person's sign-in to redo, or BC saying the Hub asked for something it hasn't got (400/404). Left
// out when Microsoft's sign-in service or BC itself is down, slow, erroring or throttling, or when an
// odd answer can't be placed on either side.

const PROBE_TIMEOUT_MS = 15_000
const RENEW_TIMEOUT_MS = 6_000
/** One row should come back in well under a second; this slow and the sync's 30 s pages start failing. */
const SLOW_MS = 8_000

const DB_UNREADABLE = "Couldn't read the stored BC sign-in from the database, so Business Central wasn't tested."

const FAILURE_WORDS: Record<BCRenewFailure["kind"], string> = {
  "refused":      "sign-in has expired or been withdrawn — they need to sign in to BC again",
  "app-key":      "Microsoft refused the Hub's own app key",
  "unreachable":  "Microsoft's sign-in service didn't answer",
  "rate-limited": "Microsoft asked the Hub to slow down",
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** The one fix for a lapsed sign-in, in words: the person, and the button. */
function signInAgain(name: string): string {
  return `${name} needs to press the BC button in the top bar and sign in to Business Central again.`
}

/** BC's own short error code ("BadRequest_ResourceNotFound"), never its message text. */
async function bcErrorCode(res: Response): Promise<string | null> {
  try {
    const parsed = JSON.parse(await res.text()) as { error?: { code?: unknown } }
    const code = parsed?.error?.code
    return typeof code === "string" && /^[\w.-]{1,80}$/.test(code) ? code : null
  } catch {
    return null
  }
}

function networkFailure(e: unknown): string {
  const err = e as { name?: string; cause?: { code?: string } } | null
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return `Business Central didn't answer within ${PROBE_TIMEOUT_MS / 1000} seconds.`
  }
  const code = err?.cause?.code
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "Business Central's address couldn't be looked up, so the Hub couldn't reach it."
  }
  return "The Hub couldn't connect to Business Central — the connection failed before BC answered."
}

async function run(ctx: CheckContext): Promise<CheckResult> {
  if (!ctx.isProduction) {
    return { state: "off", summary: "Checked on production only — it uses a person's BC sign-in." }
  }
  if (!process.env.BC_TENANT_ID) {
    return { state: "down", summary: "The Hub's Business Central settings are missing on this server, so nothing can reach BC.", cause: "hub" }
  }

  let pick: BCStatusToken
  try {
    pick = await getBCTokenForStatus({ timeoutMs: RENEW_TIMEOUT_MS })
  } catch {
    return { state: "unknown", summary: DB_UNREADABLE }
  }

  const name = pick.name?.trim() || BACKGROUND_BC_USERNAME
  const who = `${name}'s sign-in`
  const facts: Fact[] = []
  const background: Fact = {
    label: "Background BC work",
    value: `Uses ${name}'s BC sign-in and nobody else's (Hub login ${BACKGROUND_BC_USERNAME}) — there is no company BC account`,
  }

  // ── No key to try ─────────────────────────────────────────────────────────────────────────────
  if (!pick.ok) {
    const f = pick.failure
    if (f) {
      facts.push({ label: "Couldn't renew", value: `${name}: ${FAILURE_WORDS[f.kind]} (${f.code})`, tone: f.kind === "rate-limited" ? "warn" : "bad" })
    }
    facts.push(background)
    if (pick.reason === "no-user") {
      return {
        state: "down",
        summary: `Background BC work is set to use the Hub login "${BACKGROUND_BC_USERNAME}", and there's no such user here — so nothing can reach BC in the background.`,
        facts,
        cause: "hub",
      }
    }
    if (pick.reason === "not-configured") {
      return { state: "down", summary: "The Hub's Business Central app settings are missing on this server, so no sign-in can be renewed.", facts, cause: "hub" }
    }
    if (pick.reason === "no-sign-in") {
      return {
        state: "down",
        summary: `Background BC work uses only ${name}'s BC sign-in, and none is stored. ${name} needs to press the BC button in the top bar while logged into the Hub as ${BACKGROUND_BC_USERNAME}, and sign in.`,
        facts,
        cause: "hub",
      }
    }
    if (pick.reason === "none-renewable") {
      return { state: "down", summary: `${name}'s BC sign-in has run out and can't be renewed, so background BC work has stopped. ${signInAgain(name)}`, facts, cause: "hub" }
    }
    // "renewal-failed" — what Microsoft said decides whose fix it is.
    if (f?.kind === "app-key") {
      // Our app registration's secret, not Microsoft failing — Microsoft is answering, and saying no.
      return { state: "down", summary: "Microsoft refused the Hub's own app key, so the BC sign-in can't be renewed — it has probably expired and needs renewing in Microsoft Entra.", facts, cause: "hub" }
    }
    if (f?.kind === "unreachable") {
      return { state: "down", summary: "Microsoft's sign-in service didn't answer, so the Hub couldn't get into Business Central.", facts }
    }
    if (f?.kind === "rate-limited") {
      return { state: "degraded", summary: "Microsoft is limiting how often the Hub can renew its BC sign-in — it should clear on its own.", facts }
    }
    return { state: "down", summary: `${name}'s BC sign-in has expired or been withdrawn, so background BC work has stopped. ${signInAgain(name)}`, facts, cause: "hub" }
  }

  facts.push({ label: "Sign-in used", value: `${name} — ${pick.renewed ? "renewed for this check" : "still valid"}` })

  // ── One tiny read ─────────────────────────────────────────────────────────────────────────────
  const started = Date.now()
  let res: Response
  try {
    res = await fetch(`${bcODataUrl("Totes_Excel")}?$top=1&$select=EVA_No`, {
      headers: {
        Accept:             "application/json",
        "OData-MaxVersion": "4.0",
        Authorization:      `Bearer ${pick.token}`,
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch (e) {
    facts.push(background)
    return { state: "down", summary: networkFailure(e), facts }
  }
  const ms = Date.now() - started
  facts.push({ label: "Answer time", value: fmtMs(ms), tone: ms > SLOW_MS ? "warn" : undefined })

  if (!res.ok) {
    const code = await bcErrorCode(res)
    facts.push({ label: "BC answered", value: `Error ${res.status}${code ? ` (${code})` : ""}`, tone: res.status === 429 ? "warn" : "bad" })
    facts.push(background)
    const s = res.status
    if (s === 429) {
      return { state: "degraded", summary: "Business Central is limiting how often the Hub can ask (too many requests) — it should clear on its own.", facts, latencyMs: ms }
    }
    const summary =
      s === 401 ? `Business Central refused ${who}. ${signInAgain(name)}`
      : s === 403 ? `Business Central won't let ${who} read the tote list — the BC permissions on that account may have changed.`
      : s === 404 ? "Business Central couldn't find the tote list — the Hub's environment or company setting, or BC's published web services, have changed."
      : s === 400 ? "Business Central rejected the Hub's request — its settings or the tote list's layout may have changed."
      : s >= 500 ? `Business Central is having problems at Microsoft's end (error ${s}).`
      : `Business Central answered with an unexpected error (${s}).`
    // ⚠ BC ANSWERED, so none of these four is Microsoft failing: 401/403 are the background sign-in
    // refused, 400/404 the Hub asking for something BC hasn't got (BC_ENVIRONMENT / BC_COMPANY, or a
    // layout the Hub no longer matches). Only a 5xx, or a code nobody can place, stays on BC's side.
    const hubSide = s === 401 || s === 403 || s === 404 || s === 400
    return { state: "down", summary, facts, latencyMs: ms, ...(hubSide ? { cause: "hub" as const } : {}) }
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch (e) {
    // ⚠ The 15 s timer also covers reading the body. A read cut off by it is BC not answering in
    // time, not "the wrong answer" — say so rather than blame the tote list's layout.
    const errName = (e as { name?: string } | null)?.name
    if (errName === "TimeoutError" || errName === "AbortError") {
      facts.push(background)
      return { state: "down", summary: networkFailure(e), facts, latencyMs: ms }
    }
    body = null
  }
  const rows = (body as { value?: unknown } | null)?.value
  if (!Array.isArray(rows)) {
    facts.push(background)
    return { state: "down", summary: "Business Central answered, but not with the tote list the Hub asked for.", facts, latencyMs: ms }
  }
  if (rows.length === 0) {
    facts.push(background)
    return {
      state: "down",
      summary: `Business Central answered but sent no totes — the Hub's company or environment setting may be wrong, or ${who} may have lost access.`,
      facts,
      latencyMs: ms,
      cause: "hub", // unfiltered, so empty can only be our settings or the background sign-in's access
    }
  }
  const toteNo = String((rows[0] as { EVA_No?: unknown } | null)?.EVA_No ?? "").trim()
  if (!toteNo) {
    facts.push(background)
    return { state: "down", summary: "Business Central sent a tote with no number — the tote list's layout may have changed.", facts, latencyMs: ms }
  }
  facts.push(background)

  // ── BC answered properly — anything still worth an amber? ─────────────────────────────────────
  if (ms > SLOW_MS) {
    return { state: "degraded", summary: `Business Central is answering, but slowly — ${fmtMs(ms)} for a single tote.`, facts, latencyMs: ms }
  }
  if (!pick.renewable) {
    // Working on a key used in the last hour, which nothing can renew once it runs out.
    return {
      state: "degraded",
      summary: `Business Central is answering, but ${name}'s BC sign-in can't be renewed — background BC work stops when the current key runs out, within the hour. ${signInAgain(name)}`,
      facts,
      latencyMs: ms,
      cause: "hub", // BC is fine; the sign-in needs redoing
    }
  }
  return { state: "ok", summary: `Business Central answered in ${fmtMs(ms)} using ${who}.`, facts, latencyMs: ms }
}

const bcApi: StatusCheckDef = {
  key: "bc-api",
  name: "Business Central",
  group: "business-central",
  what: "Vectis's main business system — receipts, lots, totes and customers.",
  whenDown: "Live BC figures, tote lookups and the overnight BC copy stop working.",
  statusPage: "https://status.cloud.microsoft",
  intervalMin: 15,
  // One 6 s renewal at most (only when the key has lapsed) plus the 15 s read; the rest is headroom.
  timeoutMs: 40_000,
  run,
}

export default bcApi
