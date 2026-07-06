import { notFound } from "next/navigation"
import Link from "next/link"
import { isJordan } from "@/lib/jordan-auth"
import ChatPanel from "../chat-panel"

export const dynamic = "force-dynamic"
export const metadata = { title: "ASK.AI" }

export default async function JordanChatPage() {
  if (!(await isJordan())) notFound()

  return (
    <div className="h-full bg-black p-6 font-mono flex flex-col" style={{ color: "#33ff66" }}>
      <div className="max-w-3xl mx-auto w-full flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
          <h1 className="text-lg font-bold tracking-widest">02 · ASK AI</h1>
          <Link href="/jordan" prefetch={false} className="text-xs opacity-60 hover:opacity-100">&lt; JORDAN.SYS</Link>
        </div>
        <div className="flex-1 min-h-0 border border-[#1f5c33] rounded-xl p-4">
          <ChatPanel
            mode="chat"
            storageKey="jordan_chat_history"
            placeholder="Ask anything…"
            intro={"Day-to-day questions, silly hypotheticals, settling arguments, random curiosity.\nNo judgement. Type below."}
          />
        </div>
      </div>
    </div>
  )
}
