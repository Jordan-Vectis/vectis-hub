/**
 * AI extraction for condition-report emails.
 *
 * Given an email subject + body and a list of candidate auctions, ask Gemini to
 * pull out the lot number, the auction it relates to, and the sale date.
 * Best-effort: any failure (no API key, bad JSON, quota) returns empty fields so
 * the report still lands and staff can fill the details in by hand.
 */

import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"

export type AuctionCandidate = { id: string; code: string; name: string; date: string | null }

export type ExtractResult = {
  lotNumber:    string | null
  auctionId:    string | null
  auctionLabel: string | null
  auctionDate:  string | null   // YYYY-MM-DD or null
}

const EMPTY: ExtractResult = { lotNumber: null, auctionId: null, auctionLabel: null, auctionDate: null }

export async function extractConditionDetails(
  subject: string,
  body: string,
  candidates: AuctionCandidate[],
): Promise<ExtractResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return EMPTY

  try {
    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: process.env.CONDITION_AI_MODEL || (await getToolModel("condition_extract")),
    })

    const candidateList = candidates
      .map(c => `- code: ${c.code} | name: ${c.name}${c.date ? ` | date: ${c.date}` : ""}`)
      .join("\n")

    const prompt = `You are reading a customer email requesting a condition report on an auction lot.
Extract these fields and return STRICT JSON only — no markdown, no commentary:
{
  "lotNumber": string | null,     // the lot number requested, e.g. "245" (digits only where possible)
  "auctionCode": string | null,   // the code of the matching auction from the list below, or null
  "auctionLabel": string | null,  // the auction/sale name exactly as written in the email, or null
  "auctionDate": string | null    // sale date as YYYY-MM-DD if the email states one, else null
}

Rules:
- Only set "auctionCode" to a code that appears verbatim in the list below. If nothing clearly matches, set it null.
- Do not invent a lot number — if none is stated, use null.

Known auctions:
${candidateList || "(none provided)"}

Email subject: ${subject || "(none)"}
Email body:
${(body || "").slice(0, 4000)}`

    const result = await model.generateContent(prompt)
    let text = result.response.text().trim()
    // Strip ```json fences if the model wrapped the JSON
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()

    const parsed = JSON.parse(text) as {
      lotNumber?: unknown; auctionCode?: unknown; auctionLabel?: unknown; auctionDate?: unknown
    }

    const code  = typeof parsed.auctionCode === "string" ? parsed.auctionCode.trim() : null
    const match = code ? candidates.find(c => c.code.toLowerCase() === code.toLowerCase()) ?? null : null
    const date  = typeof parsed.auctionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.auctionDate)
      ? parsed.auctionDate
      : (match?.date ?? null)

    return {
      lotNumber:    parsed.lotNumber != null && String(parsed.lotNumber).trim() !== "" ? String(parsed.lotNumber).trim() : null,
      auctionId:    match?.id ?? null,
      auctionLabel: typeof parsed.auctionLabel === "string" && parsed.auctionLabel.trim() !== "" ? parsed.auctionLabel.trim() : null,
      auctionDate:  date,
    }
  } catch (e) {
    console.error("[condition-extract] failed:", e)
    return EMPTY
  }
}
