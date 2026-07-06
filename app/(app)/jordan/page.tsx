import { auth } from "@/auth"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import JordanMenu from "./jordan-menu"

export const dynamic = "force-dynamic"
export const metadata = { title: "JORDAN.SYS" }

// 🤫 The secret menu. Locked to the username jordan.orange — everyone else
// gets a plain 404, exactly as if the page didn't exist.
export default async function JordanPage() {
  const session = await auth()
  if (!session) notFound()

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { username: true },
  })
  if ((user?.username ?? "").toLowerCase() !== "jordan.orange") notFound()

  return <JordanMenu />
}
