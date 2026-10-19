import { redirect } from "next/navigation"
import Link from "next/link"
import { getCustomerSession } from "@/lib/customer-auth"
import { AccountMenu } from "./details-form"

// The account area as vectis.co.uk lays it out: "‹ BACK TO HOME", then the side menu (the
// customer's name, My details / My sales / My bids, Log out) beside the page, which draws itself
// in white vs-card-flat panels. Nobody gets in without a customer session — each page under here
// checks again before it reads anything of its own.
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await getCustomerSession()
  if (!session) redirect("/portal/login")

  return (
    <div className="vs-container vs-page">
      <p className="mb-6"><Link href="/" className="vs-link vs-link-back vs-link-sm">Back to home</Link></p>
      <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14">
        <AccountMenu name={`${session.firstName} ${session.lastName}`} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
