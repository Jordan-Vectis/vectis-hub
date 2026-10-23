"use server"

import { revalidatePath } from "next/cache"
import { getBCTokenAny } from "@/lib/bc"
import { copyCustomerPage, type CustomerPhase } from "@/lib/customer-sync"
import { getCustomersUser } from "@/lib/customers/access"
import { getGoodsInUser } from "@/lib/goods-in/access"

// "Fetch new customers from BC" — the small, same-minute copy for the counter: a person was just
// made in Business Central (BC first until switch day — lib/customers/ownership.ts), and Goods In
// needs them now, not after tonight's copy. Reads only what changed in BC in the last few days, so
// it is seconds, not the hours a full copy takes. Same code path as the nightly copy
// (lib/customer-sync.ts), so a person fetched here is exactly what the nightly copy would have made.
// Nothing is written to BC.

export type PullResult =
  | { ok: true; created: number; updated: number; pages: number; stoppedEarly: string | null }
  | { ok: false; error: string }

const PHASES: CustomerPhase[] = ["contacts", "vendors", "customers", "webCustomers"]
const MAX_PAGES = 20   // a changes-only read is a page or two; this is the backstop if BC ignores the filter
const DAYS = 3

export async function pullRecentCustomersFromBc(): Promise<PullResult> {
  try {
    const [cust, gi] = await Promise.all([getCustomersUser(), getGoodsInUser()])
    if (!cust && !gi) return { ok: false, error: "You need Customers or Goods In access to fetch customers from BC." }
    const g = globalThis as { _customersPull?: boolean }
    if (g._customersPull) return { ok: false, error: "A fetch is already running — wait a moment and search again." }
    g._customersPull = true
    try {
      const token = await getBCTokenAny()
      if (!token) return { ok: false, error: "The Hub's Business Central sign-in isn't available — the admin who holds it needs to press the BC button in the top bar." }
      const since = new Date(Date.now() - DAYS * 86_400_000)
      let created = 0, updated = 0, pages = 0
      let stoppedEarly: string | null = null
      for (const phase of PHASES) {
        let next: string | null = null
        let n = 0
        do {
          let r
          try {
            r = await copyCustomerPage(token, phase, next, since)
          } catch (e: any) {
            stoppedEarly = `BC wouldn't answer the ${phase} read (${String(e?.message ?? e).slice(0, 120)}) — an admin can run Copy changes on Customers → Copy from BC.`
            break
          }
          created += r.created; updated += r.updated + r.merged; pages++; n++
          next = r.nextLink
          if (n >= MAX_PAGES && next) { stoppedEarly = `BC kept sending ${phase} rows — stopped after ${MAX_PAGES} pages; an admin can run Copy changes for the rest.`; break }
        } while (next)
        if (stoppedEarly) break
      }
      revalidatePath("/tools/warehouse", "layout")
      revalidatePath("/tools/customers", "layout")
      return { ok: true, created, updated, pages, stoppedEarly }
    } finally {
      g._customersPull = false
    }
  } catch (e: any) {
    console.error("pullRecentCustomersFromBc error:", e)
    return { ok: false, error: e?.message ?? "Unknown error" }
  }
}
