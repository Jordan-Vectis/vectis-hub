"use server"

import { prisma } from "@/lib/prisma"
import { findOrCreateCustomer } from "@/lib/customers/prospects"

// The public web form (the fake test website's "sell with us" form). A submission belongs to a
// Customer — the Hub's customer database — found by email, else made as a Hub prospect that the
// nightly BC copy adopts the day BC gets them (lib/customers/prospects.ts).
export async function submitPublicForm(formData: FormData) {
  const title = formData.get("title") as string
  const firstName = formData.get("firstName") as string
  const lastName = formData.get("lastName") as string
  const email = formData.get("email") as string
  const phone = formData.get("phone") as string | null
  const description = formData.get("description") as string
  const uploadedKeys = formData.getAll("photoKey") as string[]

  const name = `${title} ${firstName} ${lastName}`.trim()
  const customer = await findOrCreateCustomer({ name, email: email || null, phone: phone || null })

  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } })
  if (!adminUser) throw new Error("No admin user found")

  await prisma.submission.create({
    data: {
      channel: "WEB_FORM",
      customerId: customer.id,
      createdById: adminUser.id,
      items: {
        create: {
          name: "Web form submission",
          description,
          imageUrls: uploadedKeys,
        },
      },
    },
  })
}
