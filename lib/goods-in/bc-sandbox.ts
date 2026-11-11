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

/** BC's LIVE environment(s). Test writes never go here, whatever BC_WRITE_ENVIRONMENT says.
 *  BC environment names are case-insensitive. ⚠ Never take this list from a setting. */
const LIVE_ENVIRONMENTS = ["production"]

const isLive = (env: string) => LIVE_ENVIRONMENTS.includes(env.trim().toLowerCase())

/** The BC environment test writes go to, or null when they are switched off / it names live BC. */
export function bcSandboxEnvironment(): string | null {
  const env = (process.env.BC_WRITE_ENVIRONMENT ?? "").trim()
  if (!env || isLive(env)) return null
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
  if (isLive(env)) return `Switched off: BC_WRITE_ENVIRONMENT is "${env}", the LIVE environment — test writes never go there. Set it to a copy or a sandbox.`
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

async function call(token: string, method: "GET" | "POST" | "PATCH", url: string, body?: Json, extraHeaders?: Record<string, string>): Promise<Json> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(extraHeaders ?? {}),
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

/** The ODataV4 (published web services) root for this environment — Receipt_Lines_Excel lives here. */
function odataRoot(environment: string): string {
  const company = (process.env.BC_COMPANY ?? "Vectis").replace(/'/g, "''")
  return `${API_HOST}/${process.env.BC_TENANT_ID ?? ""}/${encodeURIComponent(environment)}/ODataV4/Company('${encodeURIComponent(company)}')/`
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

// ── Lots → BC receipt lines (Jack, 2026-11-10: "we just want to get the auction lines / receipt lines back
// into BC; if we could assign them to the sale too that would be great, if not just onto the receipt") ──
//
// One lot = one EVA_ReceiptLine, read off BC's own AL source:
//   1. Look first — by INTERNAL BARCODE on the Receipt_Lines_Excel web service (page 75021 + Vectis's
//      PTE_InternalBarcode and the carriage-costs size): BC already holding the barcode means "there",
//      nothing sent. Then a line left over from an earlier press that made the line but couldn't set its
//      barcode (same receipt, same short description, no barcode) is picked up and finished, never doubled.
//   2. Create — POST api/evo/mob/v2.0 receiptLines (page 76301): receiptNo, shortDescription, estimates,
//      tote, and auctionNo = the SALE ("Sales Allocation" in BC). BC's InitLine gives the article number
//      and the UniqueID (R009081-3) and copies the vendor and contact from the receipt — but only when the
//      line is SAVED, after every field sent has been set. So the create carries nothing that needs the
//      line to exist first:
//        ⚠ NOT the category — EVA_ReceiptLine's category OnValidate does TestField(EVA_VendorNo), and the
//          vendor isn't on the line until it's saved. Sending it on the create is refused with "Vendor No.
//          must have a value in Receipt Line: … Article No.=0" (the first real press, 2026-11-11). Sending
//          vendorNo too doesn't help: an API page sets fields in PAGE order, and vendorNo comes after it.
//        ⚠ NOT the description — the page stores it (BinaryDataWrapper.SetData) under the line's SystemId
//          and UniqueID, both still blank before the line is saved.
//   3. Details — PATCH the same API page (keyed on systemId) with category, subcategory (in that order on
//      the page — a new category clears the subcategory, then it's set) and catalogueDescription (HTML —
//      BC keeps it as EVA_DescriptionHtml).
//   4. Finish — that API has no barcode or size, so they are PATCHed onto the same line through
//      Receipt_Lines_Excel (page 75021 allows edits, not inserts). BC refuses a barcode that is already on
//      another line (PTE_InternalBarcode's OnValidate inserts it into PTE_PrePrintedBarcode).
// Nothing is written back to the Hub: the UniqueID only shows on screen (BC Match is the one way a
// UniqueID reaches a Hub lot — RULES.md).

/** A Hub lot as it goes to BC. */
export type LotForBc = {
  barcode: string | null
  title: string
  description: string
  estimateLow: number | null
  estimateHigh: number | null
  /** Parcel size as the Hub keeps it (CatalogueLot.notes): Small / Medium / Large / Contact / Collection Only. */
  size: string | null
  category: string | null
  subCategory: string | null
  tote: string | null
  /** The sale's code (CatalogueAuction.code) — BC's Sales Allocation. */
  saleCode: string | null
}

/** BC's EVA_RecLineSizeClassification names (base enum + "Vectis - Carriage Costs"). Unknown → not sent. */
export function bcSizeFor(size: string | null): string | null {
  const s = (size ?? "").trim().toLowerCase()
  if (!s) return null
  if (s === "small") return "Small"
  if (s === "medium") return "Medium"
  if (s === "large") return "Large"
  if (s === "contact") return "Contact"
  if (s === "collect" || s.startsWith("collection")) return "Collect"
  return null
}

/** The Hub's plain-text description as the HTML BC keeps: a blank line starts a paragraph, a line break stays one. */
export function descriptionHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return text.replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/)
    .map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${p.split("\n").map(l => esc(l.trim())).join("<br>")}</p>`)
    .join("")
}

/** What one lot will put on its BC line, field by field — shown BEFORE anything is sent, from the same
 *  values sendLot sends, so what's on screen is what goes. */
export type LotPreview = {
  barcode: string | null
  shortDescription: string
  /** The description as typed in the Hub (plain text; BC is sent it as HTML). */
  description: string
  sale: string | null
  estimateLow: number | null
  estimateHigh: number | null
  category: string | null
  subCategory: string | null
  tote: string | null
  /** BC's size value, or null when the lot has none BC knows. */
  size: string | null
  /** The Hub's own size text when it isn't one BC knows (so it won't be sent). */
  sizeUnknown: string | null
}

export function lotPreview(lot: LotForBc): LotPreview {
  const size = bcSizeFor(lot.size)
  return {
    barcode: lot.barcode,
    shortDescription: lot.title.trim().slice(0, 250),
    description: lot.description.trim(),
    sale: lot.saleCode,
    estimateLow: lot.estimateLow,
    estimateHigh: lot.estimateHigh,
    category: lot.category,
    subCategory: lot.subCategory,
    tote: lot.tote,
    size,
    sizeUnknown: !size && lot.size?.trim() ? lot.size.trim() : null,
  }
}

/** BC's own Receipt Lines list (page 75021) in the test environment, filtered to one receipt — where the
 *  lines this sends can be seen in BC. */
export function bcReceiptLinesUrl(environment: string, receiptId: string): string | null {
  const tenant = process.env.BC_TENANT_ID
  if (!tenant) return null
  const company = encodeURIComponent(process.env.BC_COMPANY ?? "Vectis")
  const filter = encodeURIComponent(`'EVA_ReceiptNo' IS '${receiptId.replace(/'/g, "")}'`)
  return `https://businesscentral.dynamics.com/${tenant}/${encodeURIComponent(environment)}?company=${company}&page=75021&filter=${filter}`
}

/** Is the receipt in BC? Checked once before any lot is sent. */
export async function receiptInBc(token: string, environment: string, receiptId: string): Promise<BcStep> {
  const what = `Receipt ${receiptId}`
  try {
    const base = await companyRoot(token, EVO_MOB, environment)
    const there = await findFirst(token, base, "receiptHeaders", `no eq ${quote(receiptId)}`)
    return there
      ? { what, outcome: "there", detail: `In BC (vendor ${String(there.vendorNo ?? "?")}) — lots go onto it.` }
      : { what, outcome: "failed", detail: `Business Central has no receipt ${receiptId}, so its lots have nowhere to go.` }
  } catch (e) {
    return failedWithRoute(token, environment, EVO_MOB, "receiptHeaders", what, e)
  }
}

/** Sends one lot as a receipt line on receiptId (and its sale). */
export async function sendLot(token: string, environment: string, receiptId: string, lot: LotForBc): Promise<BcStep[]> {
  const label = lot.barcode ? `Lot ${lot.barcode}` : `Lot "${lot.title.slice(0, 40)}"`
  const steps: BcStep[] = []
  const odata = odataRoot(environment)
  const lines = `${odata}Receipt_Lines_Excel`
  const size = bcSizeFor(lot.size)
  const shortDescription = lot.title.trim().slice(0, 250)

  // 1. Look first.
  let receiptNo = receiptId
  let articleNo: number | null = null
  let uniqueId = ""
  try {
    if (lot.barcode) {
      const json = await call(token, "GET", `${lines}?$filter=${encodeURIComponent(`PTE_InternalBarcode eq ${quote(lot.barcode)}`)}&$select=EVA_ReceiptNo,EVA_ArticleNo,EVA_UniqueID&$top=1`)
      const hit = ((json.value as Json[] | undefined) ?? [])[0]
      if (hit) {
        const where = String(hit.EVA_ReceiptNo ?? "")
        steps.push(where.toUpperCase() === receiptId.toUpperCase()
          ? { what: label, outcome: "there", detail: `BC already has it as ${String(hit.EVA_UniqueID ?? "?")} — nothing sent.` }
          : { what: label, outcome: "failed", detail: `BC already has barcode ${lot.barcode} on ${String(hit.EVA_UniqueID ?? "?")} (receipt ${where}) — a different receipt, so it wasn't sent.` })
        return steps
      }
    }
    // A line an earlier press made but couldn't finish (no barcode yet) — finish it rather than make another.
    if (lot.barcode && shortDescription) {
      const json = await call(token, "GET", `${lines}?$filter=${encodeURIComponent(`EVA_ReceiptNo eq ${quote(receiptId)} and EVA_ShortDescription eq ${quote(shortDescription)} and PTE_InternalBarcode eq ''`)}&$select=EVA_ReceiptNo,EVA_ArticleNo,EVA_UniqueID&$top=1`)
      const left = ((json.value as Json[] | undefined) ?? [])[0]
      if (left) {
        receiptNo = String(left.EVA_ReceiptNo ?? receiptId)
        articleNo = Number(left.EVA_ArticleNo) || null
        uniqueId = String(left.EVA_UniqueID ?? "")
        steps.push({ what: label, outcome: "there", detail: `Found ${uniqueId}, made earlier without its barcode — finishing it.` })
      }
    }
  } catch (e) {
    steps.push(failed(label, e))
    return steps
  }

  // 2. Create the line on the receipt (and its sale) — only fields that don't need the line saved first.
  let systemId = ""
  try {
    const mob = await companyRoot(token, EVO_MOB, environment)
    if (articleNo == null) {
      const body: Json = { receiptNo: receiptId, shortDescription }
      if (lot.estimateLow != null) body.lowEstimate = lot.estimateLow
      if (lot.estimateHigh != null) body.highEstimate = lot.estimateHigh
      if (lot.tote) body.articleToteNo = lot.tote
      if (lot.saleCode) body.auctionNo = lot.saleCode
      const made = await call(token, "POST", `${mob}receiptLines`, body)
      receiptNo = String(made.receiptNo ?? receiptId)
      articleNo = Number(made.articleNo) || null
      uniqueId = String(made.uniqueID ?? "")
      systemId = String(made.systemId ?? "")
      steps.push({ what: label, outcome: "made", detail: `Made as ${uniqueId || "a new line"}${lot.saleCode ? ` on sale ${String(made.auctionNo || lot.saleCode)}` : " (no sale on the lot)"}.` })
    } else if (uniqueId) {
      // A line left from an earlier press: the API page is keyed on systemId, so find it by its UniqueID.
      const row = await findFirst(token, mob, "receiptLines", `uniqueID eq ${quote(uniqueId)}`)
      systemId = String(row?.systemId ?? "")
    }
  } catch (e) {
    steps.push(await failedWithRoute(token, environment, EVO_MOB, "receiptLines", label, e))
    return steps
  }

  // 3. Category, subcategory and description, now the line exists (it has its vendor, SystemId and UniqueID).
  // A failure stops here, BEFORE the barcode: a line with no barcode is what the next press picks up and finishes.
  const details: Json = {}
  if (lot.category) details.articleCategoryCode = lot.category
  if (lot.subCategory) details.articleSubcategoryCode = lot.subCategory
  if (lot.description.trim()) details.catalogueDescription = descriptionHtml(lot.description)
  if (Object.keys(details).length) {
    const detailsWhat = `Details ${uniqueId || label}`
    if (!systemId) {
      steps.push({ what: detailsWhat, outcome: "failed", detail: `BC didn't say which line it made, so the category and description couldn't be set — the line ${uniqueId || ""} is in BC without them; pressing again finishes it.` })
      return steps
    }
    try {
      const mob = await companyRoot(token, EVO_MOB, environment)
      await call(token, "PATCH", `${mob}receiptLines(${systemId})`, details, { "If-Match": "*" })
      const bits = [
        lot.category ? `category ${lot.category}${lot.subCategory ? ` / ${lot.subCategory}` : ""}` : "no category on the lot",
        lot.description.trim() ? "the description" : "no description on the lot",
      ]
      steps.push({ what: detailsWhat, outcome: "made", detail: `Set ${bits.join(", ")}.` })
    } catch (e) {
      steps.push({ what: detailsWhat, outcome: "failed", detail: `${failed("", e).detail} — the line ${uniqueId} is in BC without them; pressing again finishes it.` })
      return steps
    }
  }

  // 4. Barcode and size, on the same line.
  const patch: Json = {}
  if (lot.barcode) patch.PTE_InternalBarcode = lot.barcode
  if (size) patch.EVA_SHIP_EVA_SizeClassification = size
  const finishWhat = `Barcode & size ${uniqueId || label}`
  if (!Object.keys(patch).length) {
    steps.push({ what: finishWhat, outcome: "failed", detail: "The lot has no barcode and no size the Hub recognises, so neither was set." })
    return steps
  }
  if (articleNo == null) {
    steps.push({ what: finishWhat, outcome: "failed", detail: "BC didn't say which line it made, so the barcode and size couldn't be set." })
    return steps
  }
  try {
    await call(token, "PATCH", `${lines}(EVA_ReceiptNo=${quote(receiptNo)},EVA_ArticleNo=${articleNo})`, patch, { "If-Match": "*" })
    const bits = [lot.barcode ? `barcode ${lot.barcode}` : "no barcode on the lot", size ? `size ${size}` : `no size${lot.size ? ` (the Hub's "${lot.size}" isn't one BC has)` : ""}`]
    steps.push({ what: finishWhat, outcome: "made", detail: `Set ${bits.join(", ")}.` })
  } catch (e) {
    steps.push({ what: finishWhat, outcome: "failed", detail: `${failed("", e).detail} — the line ${uniqueId} is in BC without it; pressing again finishes it.` })
  }
  return steps
}
