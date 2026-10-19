import { redirect } from "next/navigation"
import { getCustomerSession } from "@/lib/customer-auth"
import DetailsForm from "./details-form"

// The site layout's title template adds " | Vectis Auctions" itself.
export const metadata = { title: "My details" }

export default async function MyAccountPage() {
  const session = await getCustomerSession()
  if (!session) redirect("/portal/login")

  return (
    <div>
      <h1 className="vs-h2 vs-rule mb-8">My details</h1>
      <DetailsForm account={session} />
    </div>
  )
}
