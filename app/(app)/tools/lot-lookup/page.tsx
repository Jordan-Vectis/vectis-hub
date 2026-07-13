import { redirect } from "next/navigation"
import { auth } from "@/auth"
import LookupClient from "./lookup-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lot Lookup" }

// Vectis Admin → Lot Lookup. Admin-only (financial/operational cross-system view).
export default async function LotLookupPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")
  return <LookupClient />
}
