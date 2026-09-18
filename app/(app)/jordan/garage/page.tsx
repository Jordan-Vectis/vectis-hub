import { notFound } from "next/navigation"
import Link from "next/link"
import { isJordan } from "@/lib/jordan-auth"
import GarageClient from "./garage-client"
import { JsysStyleButton } from "../jsys-style"

export const dynamic = "force-dynamic"
export const metadata = { title: "GARAGE.SYS" }

export default async function JordanGaragePage() {
  if (!(await isJordan())) notFound()

  return (
    <div className="min-h-full bg-(--j-bg) p-6 jsys-font" style={{ color: "var(--j-acc)" }}>
      <div className="w-full">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-lg font-bold tracking-widest">06 · GARAGE</h1>
          <span className="flex items-center gap-3"><JsysStyleButton /><Link href="/jordan" prefetch={false} className="text-xs opacity-60 hover:opacity-100">&lt; JORDAN.SYS</Link></span>
        </div>
        <GarageClient />
      </div>
    </div>
  )
}
