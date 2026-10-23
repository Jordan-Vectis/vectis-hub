import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { WHO_INCLUDE } from "@/lib/customers/who"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  // ?customer_id= is the Hub's customer database; ?contact_id= still answers for the old test contacts.
  const customerId = searchParams.get("customer_id")
  const contactId = searchParams.get("contact_id")

  const submissions = await prisma.submission.findMany({
    where: customerId ? { customerId } : contactId ? { contactId } : undefined,
    include: {
      ...WHO_INCLUDE,
      items: true,
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(submissions)
}
