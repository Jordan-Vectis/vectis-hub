import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { isCronRequest } from "@/lib/cron-auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { parseModelJson } from "@/lib/model-json"
import { getToolModel } from "@/lib/ai-models"
import { resolveInstruction } from "@/lib/ai-instructions"
import { cleanBearsDescription, isBearsPreset } from "@/lib/description-cleanup"
import { MEASUREMENT_FLAG_RULE } from "@/lib/flag-rules"
import { safetyDetail, blockMeaning } from "@/lib/ai-provider"
import { GEMINI_SAFETY_SETTINGS } from "@/lib/ai-safety"

export const maxDuration = 300

// Vectis catalogues in British English. Model railway and similar lots often have
// German/French/other foreign-language packaging in the photos (Märklin, Fleischmann,
// Roco, etc.), and Gemini will otherwise mirror that language in its description.
// This is appended to every batch generation so output is always English.
const LANGUAGE_RULE =
  "IMPORTANT: Write the entire description in British English only, using UK spelling. " +
  "Ignore the language of any text, packaging, labelling or markings shown in the photos — " +
  "foreign-language items (e.g. German Märklin/Fleischmann/Roco, French or any other) must still " +
  "be described in British English. Never output any other language. Proper names and catalogue " +
  "numbers printed on the item may be quoted verbatim, but all surrounding description must be English."

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session && !isCronRequest(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

  const formData = await req.formData()
  // The instruction is resolved server-side from the database by its key, so a
  // run always uses exactly the saved version — never stale client-side text.
  const presetKey = (formData.get("presetKey") as string) ?? ""
  let systemInstruction = ""
  if (presetKey) {
    try {
      systemInstruction = await resolveInstruction(presetKey)
    } catch {
      return NextResponse.json({ error: `Instruction "${presetKey}" not found` }, { status: 400 })
    }
  }
  const modelId           = await getToolModel("catalogue_batch", formData.get("model") as string | null)
  const grounded          = formData.get("grounded") === "true"

  // Each lot is submitted as: lot_{name}_image_{i} files
  // We reconstruct the lots from the file field names
  const lotMap: Record<string, File[]> = {}
  for (const [key, value] of formData.entries()) {
    const m = key.match(/^lot_(.+)_image_\d+$/)
    if (m && value instanceof File) {
      const lot = m[1]
      if (!lotMap[lot]) lotMap[lot] = []
      lotMap[lot].push(value as File)
    }
  }

  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({
    safetySettings: GEMINI_SAFETY_SETTINGS,
    model: modelId,
    // Always include the English-language rule, even when the preset is empty/custom.
    systemInstruction: [systemInstruction, LANGUAGE_RULE].filter(Boolean).join("\n\n"),
    // Google Search grounding lets Gemini look up catalogue numbers and product details
    // in real time. Only enabled when the client requests it — strict presets are unaffected.
    // Note: not all models support grounding; errors surface in the client log.
    ...(grounded ? { tools: [{ googleSearch: {} } as any] } : {}),
  })

  // No retries here — throw immediately so the real Gemini error surfaces in the
  // client log and the client's own backoff loop handles retrying.
  // Rate-limit errors are prefixed with RATE_LIMITED: so the client can apply
  // a longer backoff before retrying.
  async function generateWithRetry(contents: any[]): Promise<{ text: string; searchQueries: string[]; finishReason: string }> {
    let result: any
    try {
      result = await model.generateContent(contents)
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      if (/429|resource.?exhausted|quota|rate.?limit/i.test(msg)) {
        throw new Error(`RATE_LIMITED: ${msg}`)
      }
      throw e
    }

    const response = result.response

    // ⚠ Carry WHICH filter objected, not just that one did. Gemini names the
    // category and strength in safetyRatings, and RECITATION means the reply was
    // reproducing copyrighted material — reporting the bare word left nobody able
    // to tell a violent cover from a famous comic (Jordan, 2026-08-28).
    const promptBlock = response.promptFeedback?.blockReason
    if (promptBlock) throw new Error(`Blocked (prompt): ${promptBlock}${blockMeaning(promptBlock)}${safetyDetail(response)}`)

    const candidate    = response.candidates?.[0]
    const finishReason = candidate?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      throw new Error(`Blocked (${finishReason}${blockMeaning(finishReason)}${safetyDetail(response)})`)
    }

    // Surface whether Google Search grounding actually fired
    const searchQueries: string[] = (candidate?.groundingMetadata as any)?.webSearchQueries ?? []

    return { text: response.text(), searchQueries, finishReason: String(finishReason ?? "") }
  }

  const results: { lot: string; description: string; estimate: string; status: string; error?: string; flag?: string; debug?: { prompt: string; response: string; imageCount: number; searchQueries?: string[] } }[] = []
  const lotEntries = Object.entries(lotMap)

  for (let idx = 0; idx < lotEntries.length; idx++) {
    const [lot, files] = lotEntries[idx]
    try {
      const imageParts = await Promise.all(
        files.slice(0, 24).map(async (file) => {
          const buffer = await file.arrayBuffer()
          const base64 = Buffer.from(buffer).toString("base64")
          return { inlineData: { data: base64, mimeType: file.type || "image/jpeg" } }
        })
      )

      const existingContext = formData.get(`lot_${lot}_context`) as string | null
      const contextType    = formData.get(`lot_${lot}_contextType`) as string | null  // "keyPoints" | "description"

      let userPrompt: string
      if (!existingContext) {
        userPrompt = "Please describe this auction lot."
      } else if (contextType === "keyPoints") {
        userPrompt = `The following key points were recorded about this lot. ALL of them must appear in your description — do not omit a single one.

CRITICAL: Only use the information in the key points and what you can directly observe in the photos. Do NOT add product history, specifications, piece counts, features, or any other details from your training data that are not explicitly stated in the key points. If a detail is not in the key points and cannot be seen in the photos, leave it out entirely.

EXCEPTION: If a key point contains a set or catalogue number (e.g. a LEGO set number like #42110, a Playmobil set number, etc.), you MUST resolve it to its full product name and include both the name and number in the description. This is the only permitted use of training knowledge.

PRESERVE EXACT MEANING — do not soften or paraphrase factual key points. Short condition, completeness or packaging notes (e.g. "Sealed Mint", "Sealed", "Mint", "Boxed", "Unboxed", "Complete", measurements like "55\\"x39\\"") carry a precise meaning and MUST appear with that meaning intact, using the cataloguer's own wording. For example: "Sealed Mint" means factory sealed AND mint condition — do NOT weaken it to "in original boxes" or "remains sealed". If you cannot fit the exact term naturally, state it plainly rather than dropping or rewording it. Losing or softening any such key point is a failure.

KEY POINTS ARE AUTHORITATIVE — the cataloguer had the item in hand. Any CLASS, model type, catalogue number, running number or livery stated in the key points (e.g. "Loadhaul Class 56", "Virgin Trains Class 47") MUST be used EXACTLY as given. NEVER replace it with a different class/number/livery you infer from the photos or recall from training — even if you believe the photo shows something else. If you are highly confident a stated value is wrong, KEEP the cataloguer's value in the description and raise it on the FLAG line below — never silently change it.

Write a single, concise catalogue description that naturally incorporates every key point. Do not list them separately and do not repeat the same information twice — but keep the precise factual wording of condition/completeness/measurement key points exactly as given.
${grounded ? `\nVERIFY NUMBERS: Before finalising, ALWAYS use Google Search to verify any catalogue number, set number, model number or product code in the key points — do not rely on memory for these. Confirm the number matches the named product.\n` : ""}
FLAG POSSIBLE MISTAKES: The key points are the cataloguer's record and the description must stay faithful to them — keep their numbers/wording in the description even if you doubt them. BUT if you are HIGHLY confident (ideally confirmed by search) that a catalogue/set/model number or other hard fact in the key points is WRONG, add ONE extra line at the very end in exactly this format:
FLAG: <which key point looks wrong, what you believe is correct, and why>
${MEASUREMENT_FLAG_RULE}
CRITICAL RULE FOR FLAGS: NEVER flag a set number, catalogue number, or product code simply because it is not in your training data. Your knowledge has a cutoff date — products released in 2024 or later may not be known to you, and their absence from your training data does NOT mean they do not exist. Only flag a number if you have strong positive evidence it is wrong (e.g. it belongs to a completely different product, the number format is impossible for that brand, or a search result directly contradicts it). If you are not certain, do NOT add a FLAG line.

Key points:
${existingContext}

After the description (and optional FLAG line), include the estimate on its own line exactly as your instructions specify.`
      } else {
        userPrompt = `Existing description: ${existingContext}\n\nImprove and enhance this description based on the photos. Only use information present in the existing description or directly visible in the photos — do not add details from training data. Keep the same output format. Do not repeat the same information twice.\n\nAfter the description, include the estimate on its own line exactly as your instructions specify.`
      }

      // Reinforce in the user turn too — foreign-language packaging in the photos is a
      // strong cue and the system instruction alone doesn't always win.
      userPrompt += "\n\n(Write the description in British English only — ignore any foreign-language text on the item or its packaging.)"

      const { text, searchQueries, finishReason } = await generateWithRetry([
        ...imageParts,
        { text: userPrompt },
      ])

      // Occasionally Gemini returns a JSON object instead of plain text — extract description if so
      // (parseModelJson also repairs the common invalid \' escape). Plain text → null → use as-is.
      let rawText = text.trim()
      const parsedBatch = parseModelJson(rawText)
      if (parsedBatch && typeof parsedBatch.description === "string") rawText = parsedBatch.description.trim()

      // Split description, estimate and any cataloguer-mistake FLAG line — preserve newlines
      const lines = rawText.split("\n")
      const estimateLine = lines.find((l) => l.toLowerCase().startsWith("estimate:")) ?? ""
      const flagLine     = lines.find((l) => l.toLowerCase().startsWith("flag:")) ?? ""
      const rawDescription = lines
        .filter((l) => !l.toLowerCase().startsWith("estimate:") && !l.toLowerCase().startsWith("flag:"))
        .join("\n").trim()
      // Deterministic clean-up of the mechanical mistakes the model keeps making
      // on Dolls/Bears lots (strip **, LE→limited edition, drop "plumo means…"
      // notes, de-dupe the repeated name, close "CB 114790" → "CB114790").
      const description = isBearsPreset(presetKey) ? cleanBearsDescription(rawDescription) : rawDescription
      const flag = flagLine.replace(/^flag:\s*/i, "").trim()

      // ⚠⚠ AN EMPTY ANSWER IS NOT AN "OK". This used to push status "OK" whatever came
      // back, so a reply with no description at all was reported as a clean generation —
      // and the overnight runner, which only checks the status, wrote the empty string
      // onto the lot and logged a tick. Measured on F113: 179 lots of 601 (30% of the
      // sale) had "generated OK", an empty batchDesc, and no description anywhere, which
      // then surfaced on screen as "content blocked by AI" at the double check because
      // there was nothing left to check. RULES: never let "nothing happened" look like
      // success.
      if (!description.trim()) {
        // ⚠ SAY WHAT DID COME BACK. On F113 this happened to 179 lots and the raw reply was
        // kept nowhere, so the cause was unknowable after the fact — a steady ~30% across
        // every hour of the night, with no difference in photos or key points between the
        // lots it happened to and the ones it didn't. The finish reason separates "it ran
        // out of room" from "it answered with only an estimate line" from "it said nothing
        // at all", which need completely different fixes.
        const sawNothing = !text.trim()
        const why = sawNothing
          ? (finishReason === "MAX_TOKENS"
              ? "it used its whole allowance before writing anything"
              : `it returned nothing at all${finishReason ? ` (finished: ${finishReason})` : ""}`)
          : `only this came back${finishReason && finishReason !== "STOP" ? ` (finished: ${finishReason})` : ""}: ${text.trim().slice(0, 120)}`
        results.push({ lot, description: "", estimate: "", status: "FAILED",
          error: `The model returned no description — ${why}`,
          debug: { prompt: userPrompt, response: text, imageCount: imageParts.length, searchQueries } })
      } else {
        results.push({ lot, description, estimate: estimateLine.replace(/^Estimate:\s*/i, "").trim(), status: "OK",
          ...(flag ? { flag } : {}),
          debug: { prompt: userPrompt, response: text, imageCount: imageParts.length, searchQueries } })
      }

      // 12-second delay between lots to stay well under Gemini rate limits
      if (idx < lotEntries.length - 1) {
        await new Promise((r) => setTimeout(r, 12000))
      }
    } catch (e: any) {
      results.push({ lot, description: "", estimate: "", status: "FAILED", error: e.message })
    }
  }

  return NextResponse.json({ results })
}
