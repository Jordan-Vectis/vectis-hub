import { prisma } from "@/lib/prisma"

// A Submissions enquiry comes from someone BC may never have heard of. Until switch day nobody adds a
// customer in the Hub (BC first — lib/customers/ownership.ts), with this one exception: an enquiry
// is matched to the Customer by EMAIL, and failing that makes a Hub "prospect" — a Customer row with
// source "hub" and no C-number. The nightly copy ADOPTS a prospect the day BC gets them: a new BC
// contact whose email matches a prospect is written onto that row (lib/customer-sync.ts), so the
// submission, and anything else hung on it, follows them with no retyping. SERVER ONLY.

const clean = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null)

export async function findOrCreateCustomer(input: { name: string; email: string | null; phone: string | null }): Promise<{ id: string; created: boolean }> {
  const email = clean(input.email)?.toLowerCase() ?? null
  const name = clean(input.name) ?? "(no name)"
  const phone = clean(input.phone)
  if (email) {
    // BC's record first (a C-number), then any prospect already made for this email.
    const found = await prisma.customer.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      orderBy: [{ contactNo: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
      select: { id: true, phone: true, mobile: true },
    })
    if (found) {
      // Fill a gap, never write over what BC or the person already gave.
      if (phone && !found.phone && !found.mobile) await prisma.customer.update({ where: { id: found.id }, data: { phone } }).catch(() => {})
      return { id: found.id, created: false }
    }
  }
  const made = await prisma.customer.create({ data: { name, email, phone, source: "hub" }, select: { id: true } })
  return { id: made.id, created: true }
}
