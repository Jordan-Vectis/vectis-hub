import { notFound } from "next/navigation"
import { isJordan } from "@/lib/jordan-auth"
import CvClient from "./cv-client"
import { JsysHeader } from "../jsys-style"

export const dynamic = "force-dynamic"
export const metadata = { title: "CV.SYS" }

export default async function JordanCvPage() {
  if (!(await isJordan())) notFound()

  return (
    <div className="min-h-full bg-(--j-bg) p-6 jsys-font" style={{ color: "var(--j-text)" }}>
      <div className="w-full">
        <div className="flex items-center justify-between gap-3 mb-4">
          <JsysHeader n="05" title="CV workshop" />
        </div>
        <CvClient />
      </div>
    </div>
  )
}
