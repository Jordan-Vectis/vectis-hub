import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { getGoodsInUser } from "@/lib/goods-in/access"
import { HUB_OWNS_CUSTOMERS } from "@/lib/customers/ownership"
import { box, btn, ErrorBox, NotReady, PageHeader, isMissingTable } from "../../_components/ui"
import BcFirstPanel from "../../_components/bc-first-panel"
import NewCustomer from "./new-customer"

// Goods In → Customers → New customer. Until switch day (lib/customers/ownership.ts) a customer is
// made in Business Central first and fetched here, so this page is the "Not on the system?" panel;
// after it, the Hub's own form — the customer record and its Goods In half together.

export const dynamic = "force-dynamic"

export default async function NewCustomerPage() {
  const me = await getGoodsInUser()
  if (!me) {
    return <div className="p-4 sm:p-6 lg:p-8"><ErrorBox>Your account doesn&apos;t have Warehouse access. Ask a manager to add it.</ErrorBox></div>
  }
  let missing = false
  try {
    await prisma.goodsInCustomer.findFirst({ select: { customerId: true } })
  } catch (e) {
    if (isMissingTable(e)) missing = true
    else throw e
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <PageHeader
        title={HUB_OWNS_CUSTOMERS ? "New customer" : "Adding a customer"}
        back={{ href: "/tools/warehouse/customers", label: "Customers" }}
        intro={HUB_OWNS_CUSTOMERS
          ? "Their details go on their customer record; fees and the vendor terms are set on their page afterwards."
          : "New customers are made in Business Central first, then fetched into the Hub."}
      />
      {missing ? <NotReady /> : HUB_OWNS_CUSTOMERS ? (
        <div className={`${box} p-4 sm:p-6 max-w-3xl`}><NewCustomer /></div>
      ) : (
        <div className="max-w-3xl space-y-3">
          <BcFirstPanel />
          <Link href="/tools/warehouse/customers" className={btn}>Back to the customer search</Link>
        </div>
      )}
    </div>
  )
}
