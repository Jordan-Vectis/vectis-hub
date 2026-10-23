import { prisma } from "@/lib/prisma"
import { bcApiUrl, bcPageWithNext } from "@/lib/bc"

// The nightly copy of Business Central's customers into the Hub's own Customer table.
//
// Five read-only Evo feeds (api/evo/base/v1.0, pages in the Evo-auction Base AL source):
//   contacts        75609 — the PERSON (name, address, email, phone)
//   vendors         75608 — as a seller (C…), filtered by Evo to auction vendors; carries contactNo
//   customers       75607 — as a buyer; carries contactNo and the buyer settings
//   webCustomers    75615 — the website's copy of an account; carries contactNo/customerNo/vendorNo
//   shipToAddresses 75627 — a buyer's delivery addresses
// One page per call, the caller drives the loop (RULES design rule 7b), in that order: people
// first, so sellers and buyers attach to the person BC links them to.
//
// ⚠ BC is in charge until switch day: columns that came from BC are overwritten on every copy.
// ⚠ Nothing is ever deleted except a seller/buyer-only stub that BC has since linked to a contact
//   (it is merged into that contact's row — see attachAccount).

import { CUSTOMER_PHASES, type CustomerPhase } from "@/lib/customer-sync-phases"
export { CUSTOMER_PHASES, type CustomerPhase }

const CARD_SERVICE: Partial<Record<CustomerPhase, string>> = {
  contactCards: "Contact_Card_Excel",
  vendorCards:  "Vendor_Card_Excel",
}

// ⚠ Bank details never come into the Hub (they go to Sage). Any field whose NAME mentions a bank is
// dropped before a card is stored, along with OData's own bookkeeping fields.
export function noBank(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !/bank/i.test(k) && !k.startsWith("@odata")))
}

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim()
  return s || null
}
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null)
const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null)
const date = (v: unknown): Date | null => {
  if (!v) return null
  const d = new Date(String(v))
  return isNaN(d.getTime()) || d.getFullYear() < 1900 ? null : d
}

// The person's details as one feed gives them. Contacts own these; sellers/buyers only fill gaps.
function sharedFrom(r: any) {
  return {
    name:         str(r.name),
    name2:        str(r.name2),
    email:        str(r.email),
    email2:       str(r.email2),
    phone:        str(r.phoneNo),
    mobile:       str(r.mobilePhoneNo),
    address:      str(r.address),
    address2:     str(r.address2),
    city:         str(r.city),
    county:       str(r.county),
    postCode:     str(r.postCode),
    countryCode:  str(r.countryRegionCode),
    vatRegNo:     str(r.vatRegistrationNo),
    currencyCode: str(r.currencyCode),
  }
}
type Shared = ReturnType<typeof sharedFrom>

function buyerFrom(r: any) {
  return {
    mobile2:                    str(r.mobilePhoneNo2),
    eoriNumber:                 str(r.eoriNumber),
    paddleNo:                   str(r.paddleNo),
    permanentPaddleNo:          str(r.permanentPaddleNo),
    permanentBuyer:             bool(r.permanentBuyer),
    trustedBuyer:               bool(r.trustedBuyer),
    preferentialTelephoneBuyer: bool(r.preferentialTelephoneBuyer),
    privateTrade:               str(r.privateTrade),
    buyerPremiumDiscPct:        num(r.buyerPremiumDiscPercent),
    doNotEmailResults:          bool(r.doNotEmailResults),
    doNotChargeStdDelivery:     bool(r.doNotChargeStdDelivery),
  }
}

// Only the fields the row doesn't already have — a seller or buyer feed never overwrites the
// person's own details from the contact.
function gapsOnly(existing: Record<string, any> | null, shared: Shared): Partial<Shared> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(shared)) if (v != null && (existing?.[k] ?? null) == null) out[k] = v
  return out
}

export type PageResult = {
  rows: number
  created: number
  updated: number
  merged: number
  unmatched: number
  failed: number
  firstError: string | null
  nextLink: string | null
  total: number | null      // BC's own count for this pass — only on a pass's first page
}

// The filter that asks BC only for rows changed since a moment. Each feed names its "last changed"
// field differently; the Vendor Card only keeps a DATE, so that one overlaps by up to a day.
export function changedSinceFilter(phase: CustomerPhase, since: Date): string {
  const iso = since.toISOString().replace(/\.\d{3}Z$/, "Z")
  if (phase === "contactCards") return `LastDateTimeModified gt ${iso}`
  if (phase === "vendorCards") return `Last_Date_Modified ge ${iso.slice(0, 10)}`
  return `systemModifiedAt gt ${iso}`
}

// One page of one stage. With no nextLink it starts a pass: asking BC for its count (so the screen can
// say "X of Y"), and — with `since` — only for the rows changed after that moment.
export async function copyCustomerPage(token: string, phase: CustomerPhase, nextLink: string | null, since?: Date | null): Promise<PageResult> {
  // The two cards are published ODataV4 web services (found with "What does BC publish?"); the rest
  // are Evo's API pages.
  const card = CARD_SERVICE[phase]
  let url = nextLink
  if (!url) {
    const q: string[] = ["$count=true"]
    if (since) q.push(`$filter=${encodeURIComponent(changedSinceFilter(phase, since))}`)
    const base = card ? `${card}` : await bcApiUrl(token, "api/evo/base/v1.0", phase)
    url = `${base}?${q.join("&")}`
  }
  const { rows, nextLink: nl, count } = await bcPageWithNext(token, url)
  const res: PageResult = { rows: rows.length, created: 0, updated: 0, merged: 0, unmatched: 0, failed: 0, firstError: null, nextLink: nl, total: nextLink ? null : (typeof count === "number" ? count : null) }
  const now = new Date()

  // One bad row never stops the page, but it is counted and named, never swallowed.
  const each = async (r: any, fn: () => Promise<void>) => {
    try { await fn() } catch (e: any) {
      res.failed++
      res.firstError ??= `${str(r.no) ?? str(r.systemId) ?? "?"}: ${e?.message ?? e}`
      console.warn(`[customer-sync] ${phase} row failed:`, res.firstError)
    }
  }

  if (phase === "contacts") {
    const nos = rows.map((r: any) => str(r.no)).filter(Boolean) as string[]
    const have = new Set((await prisma.customer.findMany({ where: { contactNo: { in: nos } }, select: { contactNo: true } })).map(c => c.contactNo))
    for (const r of rows) await each(r, async () => {
      const contactNo = str(r.no)
      if (!contactNo) return
      const data = { ...sharedFrom(r), blocked: str(r.blocked), bcContact: r, bcCreatedAt: date(r.systemCreatedAt), bcModifiedAt: date(r.systemModifiedAt), syncedAt: now }
      if (have.has(contactNo)) {
        await prisma.customer.update({ where: { contactNo }, data })
        res.updated++
        return
      }
      // A person BC has just got who is already here as a Hub prospect (a Submissions enquiry made
      // them — lib/customers/prospects.ts, source "hub", no contact number): BC's record is written
      // ONTO that row, so their submission and anything else hung on it follows them.
      const prospect = data.email
        ? await prisma.customer.findFirst({ where: { source: "hub", contactNo: null, email: { equals: data.email, mode: "insensitive" } }, orderBy: { createdAt: "asc" }, select: { id: true } })
        : null
      if (prospect) {
        await prisma.customer.update({ where: { id: prospect.id }, data: { contactNo, source: "bc", ...data } })
        res.merged++
      } else {
        await prisma.customer.create({ data: { contactNo, ...data } })
        res.created++
      }
    })
  } else if (phase === "vendors" || phase === "customers") {
    const kind = phase === "vendors" ? "vendorNo" : "buyerNo"
    for (const r of rows) await each(r, async () => {
      const no = str(r.no)
      if (!no) return
      const extra = phase === "customers"
        ? { ...buyerFrom(r), bcBuyer: r }
        : { eoriNumber: str(r.eoriNumber), bcVendor: r }
      const outcome = await attachAccount(kind, no, str(r.contactNo), sharedFrom(r), { ...extra, syncedAt: now })
      res[outcome]++
    })
  } else if (phase === "webCustomers") {
    for (const r of rows) await each(r, async () => {
      const keys: Record<string, string>[] = []
      if (str(r.contactNo)) keys.push({ contactNo: str(r.contactNo)! })
      if (str(r.customerNo)) keys.push({ buyerNo: str(r.customerNo)! })
      if (str(r.vendorNo)) keys.push({ vendorNo: str(r.vendorNo)! })
      const target = keys.length ? await prisma.customer.findFirst({ where: { OR: keys }, select: { id: true, websiteId: true } }) : null
      if (!target) { res.unmatched++; return }
      await prisma.customer.update({
        where: { id: target.id },
        data:  { bcWeb: r, websiteId: str(r.websiteID) ?? target.websiteId, syncedAt: now },
      })
      res.updated++
    })
  } else if (card) {
    // One card per person: the Contact Card by contact number, the Vendor Card by seller number.
    // A Vendor Card for a supplier who isn't an auction seller has no person here and is skipped.
    const isContact = phase === "contactCards"
    const nos = rows.map((r: any) => str(r.No)).filter(Boolean) as string[]
    const owners = new Map((await prisma.customer.findMany({
      where:  isContact ? { contactNo: { in: nos } } : { vendorNo: { in: nos } },
      select: { id: true, contactNo: true, vendorNo: true },
    })).map(c => [(isContact ? c.contactNo : c.vendorNo)!, c.id]))
    const field = isContact ? "contactCard" : "vendorCard"
    for (let i = 0; i < rows.length; i += 20) {
      await Promise.all(rows.slice(i, i + 20).map((r: any) => each(r, async () => {
        const customerId = owners.get(str(r.No) ?? "")
        if (!customerId) { res.unmatched++; return }
        const data = { [field]: noBank(r), syncedAt: now }
        await prisma.customerBcCard.upsert({ where: { customerId }, update: data, create: { customerId, ...data } })
        res.updated++
      })))
    }
  } else {
    const buyerNos = [...new Set(rows.map((r: any) => str(r.customerNo)).filter(Boolean))] as string[]
    const owners = new Map((await prisma.customer.findMany({ where: { buyerNo: { in: buyerNos } }, select: { id: true, buyerNo: true } })).map(c => [c.buyerNo!, c.id]))
    const existing = new Set((await prisma.customerShipTo.findMany({ where: { bcSystemId: { in: rows.map((r: any) => String(r.systemId ?? "")) } }, select: { bcSystemId: true } })).map(s => s.bcSystemId))
    for (const r of rows) await each(r, async () => {
      const bcSystemId = str(r.systemId)
      const buyerNo = str(r.customerNo)
      if (!bcSystemId || !buyerNo) return
      const customerId = owners.get(buyerNo) ?? null
      if (!customerId) res.unmatched++
      const data = {
        buyerNo, customerId,
        code: str(r.code), name: str(r.name), name2: str(r.name2), address: str(r.address), address2: str(r.address2),
        city: str(r.city), county: str(r.county), postCode: str(r.postCode), countryCode: str(r.countryRegionCode),
        email: str(r.email), phone: str(r.phoneNo), bc: r, syncedAt: now,
      }
      await prisma.customerShipTo.upsert({ where: { bcSystemId }, update: data, create: { bcSystemId, ...data } })
      existing.has(bcSystemId) ? res.updated++ : res.created++
    })
  }
  return res
}

// Puts a seller (vendorNo) or buyer (buyerNo) account on the right person:
//   • the row of the contact BC links it to, if that row exists;
//   • else the row already holding this account number;
//   • else a new row.
// If the account sits on a different row from its contact's — a stub made before BC linked them,
// or BC has moved it to another person — it is taken off the old row (and a stub that held
// nothing else is deleted) so the person has ONE row.
async function attachAccount(
  kind: "vendorNo" | "buyerNo",
  no: string,
  contactNo: string | null,
  shared: Shared,
  extra: Record<string, any>,
): Promise<"created" | "updated" | "merged"> {
  const byNo = await prisma.customer.findFirst({ where: { [kind]: no } })
  const byContact = contactNo ? await prisma.customer.findUnique({ where: { contactNo } }) : null

  if (byContact && byNo && byContact.id !== byNo.id) {
    const other = kind === "vendorNo" ? "buyerNo" : "vendorNo"
    const isStub = !byNo.contactNo && !byNo[other]
    if (isStub) await prisma.customer.delete({ where: { id: byNo.id } })
    else await prisma.customer.update({ where: { id: byNo.id }, data: { [kind]: null } })
    await prisma.customer.update({ where: { id: byContact.id }, data: { [kind]: no, ...gapsOnly(byContact, shared), ...extra } })
    return "merged"
  }
  const target = byContact ?? byNo
  if (target) {
    await prisma.customer.update({ where: { id: target.id }, data: { [kind]: no, ...gapsOnly(target, shared), ...extra } })
    return "updated"
  }
  await prisma.customer.create({ data: { [kind]: no, contactNo, ...shared, ...extra } })
  return "created"
}
