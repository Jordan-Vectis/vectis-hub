import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { parseCsv, rowsToObjects } from "@/lib/csv-parse"
import { groupThreads } from "@/lib/ticket-import"

// Body trim — keep it short to avoid Gemini timeouts / partial JSON.
function trimBody(body: string, max = 3000): string {
  if (body.length <= max) return body
  // Take the start (problem report) + a tail (resolution if any).
  return body.slice(0, max - 500) + "\n…(truncated)\n" + body.slice(-500)
}

export const maxDuration = 300
export const runtime    = "nodejs"

// POST /api/tickets/import/parse
//
// Body: { csv: string, categoryKeys: string[] }
// Returns: { tickets: ParsedTicket[], skipped: number }
//
// Parses the AM Tickets Outlook CSV, dedupes noise, groups emails into
// threads by normalised subject, then asks Gemini to structure each thread
// into a ticket. Admin-only — the result is shown to the user for review
// before any DB writes happen (that's the /commit endpoint).

type ParsedTicket = {
  threadKey:      string
  title:          string
  description:    string
  resolutionNote: string
  category:       string
  originalDate:   string   // ISO yyyy-mm-dd or empty
  raisedBy:       string
}

const BATCH_SIZE = 2   // threads per Gemini call — keep prompts tight & reliable

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin only" }, { status: 401 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { csv, categoryKeys } = await req.json() as {
      csv?:          string
      categoryKeys?: string[]
    }
    if (!csv?.trim()) return NextResponse.json({ error: "CSV body required" }, { status: 400 })

    const cats = (categoryKeys ?? []).map(k => String(k).toUpperCase())
    if (cats.length === 0) cats.push("OTHER")

    // Parse + dedupe
    const rows     = parseCsv(csv)
    const records  = rowsToObjects(rows)
    const emails   = records.map(r => ({
      subject: r["Subject"] ?? "",
      body:    r["Body"]    ?? "",
      from:    r["From: (Name)"] ?? r["From: (Address)"] ?? "",
    })).filter(e => e.subject.trim())

    const threads = groupThreads(emails)
    const skipped = emails.length - Array.from(threads.values()).reduce((a, b) => a + b.length, 0)

    if (threads.size === 0) {
      return NextResponse.json({ tickets: [], skipped, note: "No ticket threads found after filtering noise." })
    }

    // Process in batches, in parallel-but-bounded chunks of 3 (concurrency 3).
    const threadList = Array.from(threads.entries())
    const batches: [string, typeof emails][][] = []
    for (let i = 0; i < threadList.length; i += BATCH_SIZE) {
      batches.push(threadList.slice(i, i + BATCH_SIZE))
    }

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: "gemini-2.5-flash-preview-04-17",
      generationConfig: { maxOutputTokens: 4096 },
    })

    const errors: string[] = []

    async function processBatch(batch: typeof batches[0], attempt = 1): Promise<ParsedTicket[]> {
      const threadsBlock = batch.map(([key, mails], i) => {
        const joined = mails.map((m, j) =>
          `--- Email ${j + 1} (from: ${m.from}) ---\nSubject: ${m.subject}\n\n${trimBody(m.body)}`
        ).join("\n\n")
        return `═══ THREAD ${i + 1} (key: ${key}) ═══\n${joined}`
      }).join("\n\n")

      const prompt = `You are processing exported support tickets from Outlook for the Vectis auction house IT log. The threads are Zendesk replies between Vectis staff (Jordan Orange) and "Auction Marketer Support" (the auction website vendor).

For EACH thread below, extract:
- "threadKey":    the thread key shown in the header (copy exactly)
- "title":         a short clear title (under 70 chars) describing the problem
- "description":   what the original problem was, in Jordan's words where possible — strip email signatures, footers, "kind regards", attachment links, "to add additional comments..." Zendesk boilerplate
- "resolutionNote": what was done to fix it (extract from later replies in the thread; if no clear resolution, leave empty string)
- "category":      pick ONE from this list: ${cats.join(", ")}. Use the closest match. Use OTHER only if nothing fits.
- "originalDate":  ISO date (yyyy-mm-dd) of the first/original email in the thread. Extract from date strings like "13 Nov 2025, 09:45 GMT". If no date is found, empty string.
- "raisedBy":      who raised it. If Jordan reported the problem use "Jordan Orange". If Auction Marketer raised it (e.g. a notification or notice), use "Auction Marketer Support". Default "Jordan Orange".

Return STRICT JSON: an object with key "tickets" whose value is an array of these ticket objects, one per thread. No markdown, no commentary.

THREADS:
${threadsBlock}`

      try {
        const result = await model.generateContent(prompt)
        const response = result.response
        if (response.promptFeedback?.blockReason) {
          errors.push(`Batch blocked: ${response.promptFeedback.blockReason}`)
          return []
        }
        let txt = response.text().trim()
        // Gemini sometimes wraps JSON in ```json ... ``` despite instructions.
        txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
        // Find the outermost { ... } if there's any preamble.
        const firstBrace = txt.indexOf("{")
        const firstBrack = txt.indexOf("[")
        let start = firstBrace
        if (firstBrack !== -1 && (firstBrace === -1 || firstBrack < firstBrace)) start = firstBrack
        if (start > 0) txt = txt.slice(start)

        const parsed = JSON.parse(txt)
        const arr   = Array.isArray(parsed?.tickets) ? parsed.tickets : Array.isArray(parsed) ? parsed : []
        if (arr.length === 0) {
          errors.push(`Batch returned 0 tickets (attempt ${attempt})`)
          if (attempt < 2) return processBatch(batch, attempt + 1)
        }
        return arr.map((t: any) => ({
          threadKey:      String(t.threadKey      ?? ""),
          title:          String(t.title          ?? "").slice(0, 200),
          description:    String(t.description    ?? ""),
          resolutionNote: String(t.resolutionNote ?? ""),
          category:       cats.includes(String(t.category).toUpperCase()) ? String(t.category).toUpperCase() : "OTHER",
          originalDate:   String(t.originalDate   ?? ""),
          raisedBy:       String(t.raisedBy       ?? "Jordan Orange"),
        }))
      } catch (e: any) {
        const msg = e?.message ?? String(e)
        errors.push(`Batch error (attempt ${attempt}): ${msg.slice(0, 200)}`)
        if (attempt < 2) {
          // brief backoff then retry
          await new Promise(res => setTimeout(res, 2000))
          return processBatch(batch, attempt + 1)
        }
        return []
      }
    }

    // Sequential — safer than concurrent for big imports (no quota bursts).
    const results: ParsedTicket[] = []
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const out   = await processBatch(batch)
      results.push(...out)
    }

    return NextResponse.json({
      tickets:  results,
      skipped,
      threadCount: threads.size,
      errors:   errors.length > 0 ? errors.slice(0, 20) : undefined,
    })
  } catch (e: any) {
    console.error("tickets/import/parse error:", e)
    return NextResponse.json({ error: e?.message ?? "Import parse failed" }, { status: 500 })
  }
}
