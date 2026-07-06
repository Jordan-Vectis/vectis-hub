import { notFound } from "next/navigation"
import Link from "next/link"
import { isJordan } from "@/lib/jordan-auth"
import CookingClient from "./cooking-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "COOKING.SYS" }

export default async function JordanCookingPage() {
  if (!(await isJordan())) notFound()

  return (
    <div className="h-full bg-black p-6 font-mono flex flex-col" style={{ color: "#33ff66" }}>
      <div className="w-full flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
          <h1 className="text-lg font-bold tracking-widest">03 · COOKING</h1>
          <Link href="/jordan" prefetch={false} className="text-xs opacity-60 hover:opacity-100">&lt; JORDAN.SYS</Link>
        </div>
        <CookingClient />
      </div>
    </div>
  )
}
