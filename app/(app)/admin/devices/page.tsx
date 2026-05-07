import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import DevicesClient from "./devices-client"

export default async function DevicesPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const [devices, users] = await Promise.all([
    prisma.device.findMany({
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  ])

  return <DevicesClient devices={devices} users={users} />
}
