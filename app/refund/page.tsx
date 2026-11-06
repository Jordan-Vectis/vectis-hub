import { redirect } from "next/navigation"
import { REFUND_MICROSOFT_FORM } from "@/lib/refunds"

// PUBLIC — no login ("/refund" is in publicExact in auth.config.ts, the exact path only). Customers use
// the Microsoft Form again (Jack, 2026-11-06: "i want to use my original microsoft form for safety"), so
// this address only forwards there, for anyone who kept the link. The Hub's own form and its public
// write route are gone: this page shows nothing, reads nothing and takes nothing in.
//
// Rendered per request, so the forward is a plain redirect rather than a page saved at build time.
export const dynamic = "force-dynamic"

export default function RefundPage() {
  redirect(REFUND_MICROSOFT_FORM)
}
