import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { getGoodsInUser } from "@/lib/goods-in/access"
import { box, ErrorBox, NotReady, PageHeader, isMissingTable } from "../../_components/ui"
import NewCustomer from "./new-customer"

// Goods In → Customers → New customer. The full form (details and their usual terms); saving makes
// the CRM contact and its Goods In half together and opens the new customer's page. No bank
// details are asked for — the printed receipt's bank form is filled in by the customer by hand.

export const dynamic = "force-dynamic"

export default async function NewCustomerPage() {
  const me = await getGoodsInUser()
  if (!me) {
    return <div className="p-4 sm:p-6 lg:p-8"><ErrorBox>Your account doesn&apos;t have Warehouse access. Ask a manager to add it.</ErrorBox></div>
  }

  // The form saves into Goods In's own table as well as the CRM's — check it exists before
  // letting someone type out a whole customer only to be told it can't be saved.
  let missing = false
  let failed = false
  try {
    await prisma.goodsInCustomer.findFirst({ select: { contactId: true } })
  } catch (e) {
    if (isMissingTable(e)) missing = true
    else { console.error("goods-in new customer page:", e); failed = true }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="New customer"
        back={{ href: "/tools/warehouse/customers", label: "Customers" }}
        intro={
          <>
            Check they aren&apos;t already on the system first —{" "}
            <Link href="/tools/warehouse/customers" className="text-indigo-700 dark:text-indigo-300 underline">search Customers</Link>{" "}
            by name, postcode or email. Everyone in the CRM can be found there, not just people who have booked goods in.
          </>
        }
      />
      {missing ? <NotReady /> : failed ? (
        <ErrorBox>The customer form couldn&apos;t be opened just now. Try again in a moment — if it keeps happening, tell Jack.</ErrorBox>
      ) : (
        <div className={`${box} p-4 sm:p-6 max-w-3xl`}>
          <NewCustomer />
        </div>
      )}
    </div>
  )
}
