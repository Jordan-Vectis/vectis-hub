import { notFound } from "next/navigation"
import { isJordan } from "@/lib/jordan-auth"
import AskAi from "./ask-ai"

export const dynamic = "force-dynamic"
export const metadata = { title: "ASK.AI" }

export default async function JordanChatPage() {
  if (!(await isJordan())) notFound()
  return <AskAi />
}
