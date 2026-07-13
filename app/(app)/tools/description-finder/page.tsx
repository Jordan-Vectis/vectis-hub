import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasAppAccess } from "@/lib/apps"
import DescriptionFinderClient from "./description-finder-client"

export const dynamic = "force-dynamic"

export const metadata = { title: "Description Finder" }

export default async function DescriptionFinderPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, allowedApps: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "DESCRIPTION_FINDER")) redirect("/hub")

  return <DescriptionFinderClient />
}
