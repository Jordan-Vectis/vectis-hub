"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import CustomerForm from "../../_components/customer-form"
import { OkBox } from "../../_components/ui"

// The full customer form (details and usual terms). Once saved, the form is replaced by a
// confirmation straight away — so a second tap while the customer's page loads can't add them twice
// — and we go to the new customer's page.

export default function NewCustomer() {
  const router = useRouter()
  const [added, setAdded] = useState<{ name: string; vendorNo: string | null } | null>(null)

  if (added) {
    return (
      <OkBox>
        Added {added.name}{added.vendorNo ? ` with vendor number ${added.vendorNo}` : ""}. Opening their page…
      </OkBox>
    )
  }

  return (
    <CustomerForm
      initial={null}
      onCancel={() => router.push("/tools/warehouse/customers")}
      onSaved={c => {
        setAdded({ name: c.name, vendorNo: c.vendorNo })
        router.push(`/tools/warehouse/customers/${encodeURIComponent(c.id)}?added=1`)
      }}
    />
  )
}
