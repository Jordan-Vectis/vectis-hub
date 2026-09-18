import { notFound } from "next/navigation"
import { isJordan } from "@/lib/jordan-auth"
import CookingClient from "./cooking-client"
import { JsysHeader } from "../jsys-style"

export const dynamic = "force-dynamic"
export const metadata = { title: "COOKING.SYS" }

export default async function JordanCookingPage() {
  if (!(await isJordan())) notFound()

  return (
    <div className="h-full bg-(--j-bg) p-6 jsys-font flex flex-col" style={{ color: "var(--j-text)" }}>
      <div className="w-full flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
          <JsysHeader n="03" title="Cooking" />
        </div>
        <CookingClient />
      </div>
    </div>
  )
}
