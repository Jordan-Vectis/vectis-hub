// Goods In → a receipt → "Send to BC sandbox (test)" (Jack, 2026-11-10: "can we test making a receipt
// and tote on the hub and giving it back to BC"). SERVER ONLY.
//
// The FIRST time Goods In writes to Business Central, and ONLY to a sandbox — a deliberate, test-only
// exception to "Goods In never touches BC" (RULES.md → Goods In). What it writes, and why it is shaped
// like this, comes from BC's own AL source (IT Tools → BC Source):
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
//
// ⚠⚠ The sandbox guard: nothing is sent unless BC_WRITE_ENVIRONMENT is set AND names a sandbox. It is a
// separate setting from BC_ENVIRONMENT (which every read in the Hub uses), so turning this on can never
// point the Hub's reads somewhere else, and no setting can point these writes at live BC.
// ⚠ It signs in as the PERSON pressing it (their own BC sign-in, getBCToken) — BC records them as the
// one who made the records. Never the background sign-in (that is Jordan's, for reads).

const API_HOST = "https://api.businesscentral.dynamics.com/v2.0"
const EVO_MOB = "api/evo/mob/v2.0"
const VECTIS_WHSE = "api/vectis/whse/v2.0"
const TIMEOUT_MS = 30_000

/** The BC environment test writes go to, or null when they are switched off / not a sandbox. */
export function bcSandboxEnvironment(): string | null {
  const env = (process.env.BC_WRITE_ENVIRONMENT ?? "").trim()
  if (!env || !/sandbox/i.test(env)) return null
  return env
}

/** Whether this server has the test set up at all. Unset (production) → the panel isn't shown. */
export function bcSandboxConfigured(): boolean {
  return !!(process.env.BC_WRITE_ENVIRONMENT ?? "").trim()
}

/** Why the test can't run here, in words for the screen — or null when it can. */
export function bcSandboxOffReason(): string | null {
  const env = (process.env.BC_WRITE_ENVIRONMENT ?? "").trim()
  if (!env) return "Switched off: BC_WRITE_ENVIRONMENT isn't set on this server."
  if (!/sandbox/i.test(env)) return `Switched off: BC_WRITE_ENVIRONMENT is "${env}", which isn't a sandbox — test writes only ever go to a sandbox.`
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

/** Step 1: the receipt itself. BC fills in the vendor's name and contact details from the vendor number. */
export async function sendReceiptHeader(token: string, environment: string, receipt: { id: string; vendorNo: string }): Promise<BcStep> {
  const what = `Receipt ${receipt.id}`
  try {
    const base = await companyRoot(token, EVO_MOB, environment)
    const there = await findFirst(token, base, "receiptHeaders", `no eq ${quote(receipt.id)}`)
    if (there) {
      const vendor = String(there.vendorNo ?? "")
      return { what, outcome: "there", detail: vendor && vendor !== receipt.vendorNo ? `BC already has it — under vendor ${vendor}, not ${receipt.vendorNo}.` : "BC already has it." }
    }
    const made = await call(token, "POST", `${base}receiptHeaders`, { no: receipt.id, vendorNo: receipt.vendorNo })
    const no = String(made.no ?? receipt.id)
    return { what, outcome: "made", detail: no === receipt.id ? `Made in BC for vendor ${receipt.vendorNo}.` : `BC made it as ${no}.` }
  } catch (e) {
    return failed(what, e)
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
      steps.push({ what: toteWhat, outcome: "there", detail: "BC already has this tote." })
    } else {
      // EVA_Tote.EVA_Description is Text[80].
      const description = (contents || container.category || container.id).slice(0, 80)
      await call(token, "POST", `${mob}totes`, { no: container.id, description })
      steps.push({ what: toteWhat, outcome: "made", detail: "Made in BC." })
    }
  } catch (e) {
    steps.push(failed(toteWhat, e))
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
    steps.push(failed(linkWhat, e))
  }
  return steps
}
