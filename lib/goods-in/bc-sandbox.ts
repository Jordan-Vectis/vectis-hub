// Goods In → a receipt → "Send to a BC test environment" (Jack, 2026-11-10: "can we test making a receipt
// and tote on the hub and giving it back to BC"). SERVER ONLY.
//
// The FIRST time Goods In writes to Business Central, and NEVER to the live environment — a deliberate,
// test-only exception to "Goods In never touches BC" (RULES.md → Goods In). What it writes, and why it is
// shaped like this, comes from BC's own AL source (IT Tools → BC Source):
//
//   1. the receipt      → api/evo/mob/v2.0  receiptHeaders  (page 76300, table EVA_ReceiptHeader)
//   2. each tote/pallet → api/evo/mob/v2.0  totes           (page 76316, table EVA_Tote)
//   3. the link         → api/vectis/whse/v2.0 receiptTotes (page 58000 in Vectis's own "Webservices -
//                         PTE", table EVA_TOT_ReceiptTote — what the Hub's BC copy reads back)
//
//   • BC keeps a number it is SENT (EVA_ReceiptHeader / EVA_Tote OnInsert only take the next from BC's
//     own series when the number is blank), so the Hub's R… and T… numbers are sent as they are. Both
//     systems handing out the same series will clash one day — that is one of the things this test is
//     for, and a decision for after it.
//   • BC refuses a receipt-tote link whose receipt has no vendor number (EVA_TOT_ReceiptTote OnInsert:
//     TestField(EVA_VendorNo)), so a receipt with none is refused here before anything is sent.
//   • Every step LOOKS FIRST and only creates what BC doesn't already have, so pressing it again after a
//     failure carries on rather than tripping over what the first press made.
//   • ⚠ But a number BC already uses for something ELSE is a clash, not "already sent": a receipt with that
//     number for a different vendor stops everything, and a tote BC holds on another receipt is never
//     linked to this one. Silently attaching to someone else's record is the one outcome this must not have.
//
// ⚠⚠ The guard: nothing is sent unless BC_WRITE_ENVIRONMENT is set, and NEVER when it names the live
// environment (LIVE_ENVIRONMENTS, hard-coded here so no setting can lift it). It is a separate setting
// from BC_ENVIRONMENT (which every read in the Hub uses), so turning this on never moves the Hub's reads.
// It began as "the name must contain sandbox"; the first real press found Vectis's sandbox doesn't have
// Evosoft's EvoMobile pages at all, so Jack chose the copy of production (Production_Copy_20260622),
// which has every extension live has.
// ⚠ It signs in as the PERSON pressing it (their own BC sign-in, getBCToken) — BC records them as the
// one who made the records. Never the background sign-in (that is Jordan's, for reads).

const API_HOST = "https://api.businesscentral.dynamics.com/v2.0"
const EVO_MOB = "api/evo/mob/v2.0"
const VECTIS_WHSE = "api/vectis/whse/v2.0"
const TIMEOUT_MS = 30_000

/** BC's LIVE environment(s). BC environment names are case-insensitive. ⚠ Never take this list from a setting. */
const LIVE_ENVIRONMENTS = ["production"]

const isLive = (env: string) => LIVE_ENVIRONMENTS.includes(env.trim().toLowerCase())

// ⚠⚠ ONE live test, ONE receipt (Jack, 2026-11-10: "I need to do a test in BC production … keep it in the
// sandbox of the Hub but link it to production on BC just for one test" — "one test is all I need, I can
// delete the test receipt along with it"). Live BC is allowed only when ALL of these hold:
//   • this Hub is the SANDBOX site — RAILWAY_ENVIRONMENT_NAME exactly "sandbox" (an allowlist: staging,
//     production, a dev machine or a missing name can never write to live BC);
//   • BC_WRITE_LIVE_RECEIPT names the ONE receipt that may be sent, and it is that receipt;
//   • the person TYPES that receipt number into the confirm box (checked on the server too).
// Deleting BC_WRITE_LIVE_RECEIPT on Railway closes it again. Every other guard below still applies.
const LIVE_HUB_SITE = "sandbox"

const hubSite = () => (process.env.RAILWAY_ENVIRONMENT_NAME ?? "").trim().toLowerCase()

/** The one receipt that may be sent to LIVE BC, or null. */
function liveReceipt(): string | null {
  const r = (process.env.BC_WRITE_LIVE_RECEIPT ?? "").trim().toUpperCase()
  return r || null
}

/** Whether test writes from this server go to LIVE BC, and which single receipt may go. */
export function bcLiveTest(): { live: boolean; receipt: string | null } {
  const env = (process.env.BC_WRITE_ENVIRONMENT ?? "").trim()
  if (!env || !isLive(env)) return { live: false, receipt: null }
  return { live: true, receipt: hubSite() === LIVE_HUB_SITE ? liveReceipt() : null }
}

/** The BC environment test writes go to, or null when they are switched off (or live BC isn't allowed here). */
export function bcSandboxEnvironment(): string | null {
  const env = (process.env.BC_WRITE_ENVIRONMENT ?? "").trim()
  if (!env) return null
  if (isLive(env) && !(hubSite() === LIVE_HUB_SITE && liveReceipt())) return null
  return env
}

/** For LIVE BC only: may THIS receipt go, with THIS typed confirmation? A reason when not; null when it may.
 *  Always null for a test environment (no extra gate there). */
export function bcLiveRefusal(receiptId: string, typed: string | undefined): string | null {
  const env = (process.env.BC_WRITE_ENVIRONMENT ?? "").trim()
  if (!isLive(env)) return null
  if (hubSite() !== LIVE_HUB_SITE) return "Live Business Central can only be written to from the Hub sandbox."
  const only = liveReceipt()
  if (!only) return "Live Business Central is switched off: BC_WRITE_LIVE_RECEIPT isn't set."
  if (receiptId.trim().toUpperCase() !== only) return `Only receipt ${only} may be sent to live Business Central (BC_WRITE_LIVE_RECEIPT).`
  if ((typed ?? "").trim().toUpperCase() !== only) return `Type ${only} in the box to confirm sending it to LIVE Business Central.`
  return null
}

/** Whether this server has the test set up at all. Unset (production) → the panel isn't shown. */
export function bcSandboxConfigured(): boolean {
  return !!(process.env.BC_WRITE_ENVIRONMENT ?? "").trim()
}

/** Why the test can't run here, in words for the screen — or null when it can. */
export function bcSandboxOffReason(): string | null {
  const env = (process.env.BC_WRITE_ENVIRONMENT ?? "").trim()
  if (!env) return "Switched off: BC_WRITE_ENVIRONMENT isn't set on this server."
  if (isLive(env) && hubSite() !== LIVE_HUB_SITE) return `Switched off: BC_WRITE_ENVIRONMENT is "${env}", the LIVE environment — that is only ever allowed from the Hub sandbox, for one named receipt.`
  if (isLive(env) && !liveReceipt()) return `Switched off: BC_WRITE_ENVIRONMENT is "${env}", the LIVE environment — set BC_WRITE_LIVE_RECEIPT to the one receipt allowed.`
  if (!process.env.BC_TENANT_ID) return "Switched off: BC_TENANT_ID isn't set on this server."
  return null
}

/** One line of what happened, for the screen. */
export type BcStep = {
  /** e.g. "Receipt R010627", "Tote T028414", "Link T028414 → R010627". */
  what: string
  /** "made" = created in BC now · "there" = BC already had it, nothing sent · "failed". */
  outcome: "made" | "there" | "failed"
  /** BC's own words on a failure; otherwise a short note (e.g. the number BC holds it under). */
  detail: string
}

type Json = Record<string, unknown>

class BcCallError extends Error {}

function rootFor(apiPath: string, environment: string): string {
  return `${API_HOST}/${process.env.BC_TENANT_ID ?? ""}/${encodeURIComponent(environment)}/${apiPath}/`
}

const quote = (v: string) => `'${v.replace(/'/g, "''")}'`

/** BC's own error message out of an error body ({ error: { code, message } }), else the raw text. */
function bcMessage(status: number, text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { code?: string; message?: string } }
    const m = j?.error?.message?.trim()
    if (m) return m.slice(0, 600)
  } catch { /* not JSON */ }
  return `Business Central answered ${status}${text ? `: ${text.slice(0, 300)}` : ""}`
}

async function call(token: string, method: "GET" | "POST", url: string, body?: Json): Promise<Json> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as { name?: string })?.name
    throw new BcCallError(name === "TimeoutError" || name === "AbortError"
      ? `Business Central didn't answer within ${TIMEOUT_MS / 1000} seconds.`
      : "Couldn't reach Business Central.")
  }
  const text = await res.text()
  if (!res.ok) throw new BcCallError(bcMessage(res.status, text))
  try { return text ? (JSON.parse(text) as Json) : {} } catch { return {} }
}

// Company ids are per API root and per environment.
const companyIds = new Map<string, string>()

async function companyRoot(token: string, apiPath: string, environment: string): Promise<string> {
  const root = rootFor(apiPath, environment)
  let id = companyIds.get(root)
  if (!id) {
    const json = await call(token, "GET", `${root}companies`)
    const companies = (json.value as { id: string; name: string }[] | undefined) ?? []
    const wanted = (process.env.BC_COMPANY ?? "Vectis").trim().toLowerCase()
    const company = companies.find(c => c.name?.trim().toLowerCase() === wanted)
    if (!company) {
      throw new BcCallError(`The company "${process.env.BC_COMPANY ?? "Vectis"}" isn't in the ${environment} environment (it has: ${companies.map(c => c.name).join(", ") || "none"}).`)
    }
    id = company.id
    companyIds.set(root, id)
  }
  return `${root}companies(${id})/`
}

async function findFirst(token: string, base: string, entitySet: string, filter: string): Promise<Json | null> {
  const json = await call(token, "GET", `${base}${entitySet}?$filter=${encodeURIComponent(filter)}&$top=1`)
  const rows = (json.value as Json[] | undefined) ?? []
  return rows[0] ?? null
}

const failed = (what: string, e: unknown): BcStep => ({
  what,
  outcome: "failed",
  detail: e instanceof BcCallError ? e.message : String((e as { message?: string })?.message ?? e).slice(0, 300),
})

/**
 * BC answers "No HTTP resource was found" when an API page isn't in that environment at all — the
 * extension isn't installed there, or is an older version than the source in IT Tools → BC Source.
 * Then the most useful thing to show is what the address DOES have: its service document lists every
 * entity set on that publisher/group/version.
 */
async function failedWithRoute(token: string, environment: string, apiPath: string, entitySet: string, what: string, e: unknown): Promise<BcStep> {
  const step = failed(what, e)
  if (!/no http resource was found/i.test(step.detail)) return step
  let have = ""
  try {
    const json = await call(token, "GET", rootFor(apiPath, environment))
    const names = ((json.value as { name?: string }[] | undefined) ?? []).map(v => v.name).filter(Boolean) as string[]
    have = names.length ? `It has: ${names.sort().join(", ")}.` : "It lists nothing there."
  } catch (e2) {
    have = `Couldn't list what it has there (${failed("", e2).detail}).`
  }
  return {
    what,
    outcome: "failed",
    detail: `The ${environment} environment has no "${entitySet}" at ${apiPath} — the extension that provides it isn't installed there, or is an older version. ${have}`,
  }
}

/** Step 1: the receipt itself. BC fills in the vendor's name and contact details from the vendor number. */
export async function sendReceiptHeader(token: string, environment: string, receipt: { id: string; vendorNo: string }): Promise<BcStep> {
  const what = `Receipt ${receipt.id}`
  try {
    const base = await companyRoot(token, EVO_MOB, environment)
    const there = await findFirst(token, base, "receiptHeaders", `no eq ${quote(receipt.id)}`)
    if (there) {
      const vendor = String(there.vendorNo ?? "").trim()
      // The same number for a DIFFERENT customer is a numbering clash, not "already sent": attaching this
      // receipt's totes to it would put them on someone else's receipt. Stop and say so.
      if (vendor && vendor !== receipt.vendorNo) {
        return { what, outcome: "failed", detail: `BC already has a receipt ${receipt.id} for a different vendor (${vendor}, not ${receipt.vendorNo}) — the Hub's and BC's receipt numbers clash, so nothing more was sent.` }
      }
      return { what, outcome: "there", detail: "BC already has it (same vendor) — nothing sent." }
    }
    const made = await call(token, "POST", `${base}receiptHeaders`, { no: receipt.id, vendorNo: receipt.vendorNo })
    const no = String(made.no ?? receipt.id)
    return { what, outcome: "made", detail: no === receipt.id ? `Made in BC for vendor ${receipt.vendorNo}.` : `BC made it as ${no}.` }
  } catch (e) {
    return failedWithRoute(token, environment, EVO_MOB, "receiptHeaders", what, e)
  }
}

/** Steps 2 and 3 for one tote or pallet: the tote record, then its line on the receipt. */
export async function sendContainer(
  token: string,
  environment: string,
  receiptId: string,
  container: { id: string; category: string | null; description: string | null },
): Promise<BcStep[]> {
  const steps: BcStep[] = []
  const toteWhat = `Tote ${container.id}`
  const linkWhat = `Link ${container.id} → ${receiptId}`
  // The Hub keeps "CATEGORY / SUBCATEGORY" in one field (lib/goods-in/bc-mirror.ts joins BC's two the same way).
  const [category, subCategory, subCategory2] = (container.category ?? "").split(" / ").map(s => s.trim()).filter(Boolean)
  const contents = (container.description ?? "").trim()

  try {
    const mob = await companyRoot(token, EVO_MOB, environment)
    const there = await findFirst(token, mob, "totes", `no eq ${quote(container.id)}`)
    if (there) {
      // A tote BC already holds on ANOTHER receipt is a numbering clash — never link it to this one too.
      const whse = await companyRoot(token, VECTIS_WHSE, environment)
      const elsewhere = await findFirst(token, whse, "receiptTotes", `evaTOTToteNo eq ${quote(container.id)} and evaTOTReceiptNo ne ${quote(receiptId)}`)
      if (elsewhere) {
        steps.push({ what: toteWhat, outcome: "failed", detail: `BC already has tote ${container.id} on receipt ${String(elsewhere.evaTOTReceiptNo ?? "?")} — the Hub's and BC's tote numbers clash, so it wasn't linked here.` })
        return steps
      }
      steps.push({ what: toteWhat, outcome: "there", detail: "BC already has this tote — nothing sent." })
    } else {
      // EVA_Tote.EVA_Description is Text[80].
      const description = (contents || container.category || container.id).slice(0, 80)
      await call(token, "POST", `${mob}totes`, { no: container.id, description })
      steps.push({ what: toteWhat, outcome: "made", detail: "Made in BC." })
    }
  } catch (e) {
    steps.push(await failedWithRoute(token, environment, EVO_MOB, "totes", toteWhat, e))
    return steps // no tote, no link
  }

  try {
    const whse = await companyRoot(token, VECTIS_WHSE, environment)
    const link = await findFirst(token, whse, "receiptTotes", `evaTOTReceiptNo eq ${quote(receiptId)} and evaTOTToteNo eq ${quote(container.id)}`)
    if (link) {
      steps.push({ what: linkWhat, outcome: "there", detail: `BC already has it as line ${String(link.evaTOTLineNo ?? "?")}.` })
      return steps
    }
    // Next line number on this receipt, BC's usual steps of 10000.
    const json = await call(token, "GET", `${whse}receiptTotes?$filter=${encodeURIComponent(`evaTOTReceiptNo eq ${quote(receiptId)}`)}&$select=evaTOTLineNo`)
    const lines = ((json.value as { evaTOTLineNo?: number }[] | undefined) ?? []).map(r => Number(r.evaTOTLineNo) || 0)
    const lineNo = (lines.length ? Math.max(...lines) : 0) + 10000
    const body: Json = { evaTOTReceiptNo: receiptId, evaTOTLineNo: lineNo, evaTOTToteNo: container.id }
    if (category) body.evaTOTArticleCategory = category
    if (subCategory) body.evaTOTArticleSubcategory = subCategory
    if (subCategory2) body.evaTOTArticleSubcategory2 = subCategory2
    if (contents) body.evaTOTContentsDescription = contents
    await call(token, "POST", `${whse}receiptTotes`, body)
    steps.push({ what: linkWhat, outcome: "made", detail: `Line ${lineNo} on the receipt.` })
  } catch (e) {
    steps.push(await failedWithRoute(token, environment, VECTIS_WHSE, "receiptTotes", linkWhat, e))
  }
  return steps
}
