import { auth } from "@/auth"
import { redirect } from "next/navigation"
import ReportsTabNav from "./tab-nav"

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  return (
    <div className="min-h-full bg-[#141416]">
      <ReportsTabNav />
      {children}
    </div>
  )
}
