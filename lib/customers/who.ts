// Who a submission is from. A submission belongs to a Customer (the Hub's customer database) since
// 2026-10-23; older ones still point at the old test Contact. One include and one reader, so every
// Submissions screen says the same name whichever it has.

export const WHO_INCLUDE = {
  customer: { select: { id: true, name: true, name2: true, email: true, phone: true, mobile: true, contactNo: true } },
  contact: { select: { id: true, name: true, email: true, phone: true } },
} as const

export type Who = { name: string; email: string | null; phone: string | null; customerId: string | null; customerNo: string | null }

type HasWho = {
  customer: { id: string; name: string | null; name2: string | null; email: string | null; phone: string | null; mobile: string | null; contactNo: string | null } | null
  contact: { id: string; name: string; email: string | null; phone: string | null } | null
}

export function whoFor(s: HasWho): Who {
  if (s.customer) {
    const c = s.customer
    return { name: c.name || c.name2 || "(no name)", email: c.email, phone: c.phone ?? c.mobile, customerId: c.id, customerNo: c.contactNo }
  }
  if (s.contact) return { name: s.contact.name, email: s.contact.email, phone: s.contact.phone, customerId: null, customerNo: null }
  return { name: "(customer not on record)", email: null, phone: null, customerId: null, customerNo: null }
}
