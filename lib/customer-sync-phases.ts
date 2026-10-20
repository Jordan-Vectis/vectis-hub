// The stages of the BC → Hub customer copy, in the order they run. Client-safe (no database), so
// the Customers page's button can show them; the copy itself is lib/customer-sync.ts.
export const CUSTOMER_PHASES = ["contacts", "vendors", "customers", "webCustomers", "shipToAddresses", "contactCards", "vendorCards"] as const
export type CustomerPhase = typeof CUSTOMER_PHASES[number]

export const PHASE_LABEL: Record<CustomerPhase, string> = {
  contacts:        "People (BC contacts)",
  vendors:         "Sellers (BC vendors)",
  customers:       "Buyers (BC customers)",
  webCustomers:    "Website accounts",
  shipToAddresses: "Delivery addresses",
  contactCards:    "ID checks & approvals",
  vendorCards:     "Seller terms",
}
