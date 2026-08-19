import { notFound } from "next/navigation"
import Link from "next/link"
import { isJordan } from "@/lib/jordan-auth"
import DocsClient from "./docs-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "DOCS.SYS" }

export default async function JordanDocsPage() {
  if (!(await isJordan())) notFound()

  return (
    <div className="min-h-full bg-black p-6 font-mono" style={{ color: "#33ff66" }}>
      <div className="w-full">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h1 className="text-lg font-bold tracking-widest">07 · DOCUMENTS</h1>
          <Link href="/jordan" prefetch={false} className="text-xs opacity-60 hover:opacity-100">&lt; JORDAN.SYS</Link>
        </div>
        <DocsClient />
      </div>
    </div>
  )
}
