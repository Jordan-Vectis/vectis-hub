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
}

export async function copyCustomerPage(token: string, phase: CustomerPhase, nextLink: string | null): Promise<PageResult> {
  const url = nextLink ?? await bcApiUrl(token, "api/evo/base/v1.0", phase)
  const { rows, nextLink: nl } = await bcPageWithNext(token, url)
  const res: PageResult = { rows: rows.length, created: 0, updated: 0, merged: 0, unmatched: 0, failed: 0, firstError: null, nextLink: nl }
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
      await prisma.customer.upsert({ where: { contactNo }, update: data, create: { contactNo, ...data } })
      have.has(contactNo) ? res.updated++ : res.created++
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
