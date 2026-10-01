import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { isCronRequest } from "@/lib/cron-auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { parseModelJson } from "@/lib/model-json"
import { getToolModel } from "@/lib/ai-models"
import { resolveInstruction } from "@/lib/ai-instructions"
import { cleanBearsDescription, isBearsPreset, stripToolCallLeak } from "@/lib/description-cleanup"
import { safetyDetail, blockMeaning } from "@/lib/ai-provider"
import { GEMINI_SAFETY_SETTINGS } from "@/lib/ai-safety"
import { parsePhotoDetail, mediaResolutionConfig, parsePhotoMaxPx, shrinkPhoto, usageFromResponse } from "@/lib/ai-photo-options"
// The prompt text lives in lib/batch-prompt.ts (moved 2026-10-01, unchanged) so the office PC
// trial can hand its model exactly what Gemini gets.
import { buildBatchSystemInstruction, buildBatchUserPrompt } from "@/lib/batch-prompt"
import { parseAssumed } from "@/lib/lot-ai-check"

export const maxDuration = 300

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
  // Photo options — both OPTIONAL and absent from every real run (the Auction AI tab, the
  // overnight runner). Added 2026-10-01 for the Instructions Testing measurement. Gemini 3
  // charges a FIXED number of tokens per photo set by its detail level (1,120 default · 560
  // medium · 280 low) whatever the pixel size, so photoDetail is the only thing that moves the
  // bill; photoMaxPx only shrinks what is carried to Google (bytes and time). See lib/ai-photo-options.ts.
  const photoDetail       = parsePhotoDetail(formData.get("photoDetail"))
  const photoMaxPx        = parsePhotoMaxPx(formData.get("photoMaxPx"))

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
    // ⚠ The house rules ride on every preset — English only, no counts the cataloguer didn't
    // give, names keep their capitals (lib/description-rules.ts). A preset is data and cannot
    // switch them off.
    systemInstruction: buildBatchSystemInstruction(systemInstruction),
    // Google Search grounding lets Gemini look up catalogue numbers and product details
    // in real time. Only enabled when the client requests it — strict presets are unaffected.
    // Note: not all models support grounding; errors surface in the client log.
    ...(grounded ? { tools: [{ googleSearch: {} } as any] } : {}),
    // Only ever present when a detail level was asked for — the SDK is older than the field,
    // but it passes generationConfig through to the request body untouched.
    ...(photoDetail ? { generationConfig: mediaResolutionConfig(photoDetail) as any } : {}),
  })

  // No retries here — throw immediately so the real Gemini error surfaces in the
  // client log and the client's own backoff loop handles retrying.
  // Rate-limit errors are prefixed with RATE_LIMITED: so the client can apply
  // a longer backoff before retrying.
  async function generateWithRetry(contents: any[]): Promise<{ text: string; searchQueries: string[]; finishReason: string; usage: ReturnType<typeof usageFromResponse> }> {
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
    // ⚠⚠ MALFORMED_FUNCTION_CALL IS NOT A REFUSAL — the model fumbled a tool call, the same
    // family as the leaked `tool_code` text. Calling it "Blocked" made the runner skip the lot
    // instantly and report "content blocked", losing it (F116, 2026-09-02). Its own wording, so
    // every retry loop can tell the two apart.
    if (finishReason === "MALFORMED_FUNCTION_CALL") {
      throw new Error("MALFORMED_FUNCTION_CALL — the model fumbled a tool call instead of answering")
    }
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      throw new Error(`Blocked (${finishReason}${blockMeaning(finishReason)}${safetyDetail(response)})`)
    }

    // Surface whether Google Search grounding actually fired
    const searchQueries: string[] = (candidate?.groundingMetadata as any)?.webSearchQueries ?? []

    return { text: response.text(), searchQueries, finishReason: String(finishReason ?? ""), usage: usageFromResponse(response) }
  }

  const results: { lot: string; description: string; estimate: string; status: string; error?: string; flag?: string; assumed?: string[]; usage?: Record<string, unknown>; debug?: { prompt: string; response: string; imageCount: number; searchQueries?: string[] } }[] = []
  const lotEntries = Object.entries(lotMap)

  for (let idx = 0; idx < lotEntries.length; idx++) {
    const [lot, files] = lotEntries[idx]
    try {
      // Bytes in and bytes sent are counted so the test tab can show what shrinking actually
      // saves (upload size and time) next to what it doesn't (tokens).
      let bytesOriginal = 0
      let bytesSent     = 0
      const imageParts = await Promise.all(
        files.slice(0, 24).map(async (file) => {
          const original = Buffer.from(await file.arrayBuffer())
          bytesOriginal += original.length
          const mimeIn   = file.type || "image/jpeg"
          const prepared = photoMaxPx ? await shrinkPhoto(original, mimeIn, photoMaxPx) : { buffer: original, mimeType: mimeIn }
          bytesSent += prepared.buffer.length
          return { inlineData: { data: prepared.buffer.toString("base64"), mimeType: prepared.mimeType } }
        })
      )

      const existingContext = formData.get(`lot_${lot}_context`) as string | null
      const contextType    = formData.get(`lot_${lot}_contextType`) as string | null  // "keyPoints" | "description"

      // The user turn — key points authoritative, flag rules, the British English reinforcement
      // (lib/batch-prompt.ts, shared with the office PC trial so both models get the same words).
      const userPrompt = buildBatchUserPrompt({ existingContext, contextType, grounded })

      const startedAt = Date.now()
      const { text, searchQueries, finishReason, usage: tokenUsage } = await generateWithRetry([
        ...imageParts,
        { text: userPrompt },
      ])
      // What this lot really cost, from Google's own count — never an estimate. Travels on
      // every outcome below so a failed lot still shows what it burned.
      const usage = {
        ...tokenUsage,
        ms:          Date.now() - startedAt,
        imageCount:  imageParts.length,
        bytesOriginal,
        bytesSent,
        photoDetail: photoDetail ?? "default",
        photoMaxPx,
        model:       modelId,
      }

      // Occasionally Gemini returns a JSON object instead of plain text — extract description if so
      // (parseModelJson also repairs the common invalid \' escape). Plain text → null → use as-is.
      let rawText = text.trim()
      const parsedBatch = parseModelJson(rawText)
      if (parsedBatch && typeof parsedBatch.description === "string") rawText = parsedBatch.description.trim()

      // Split description, estimate, any cataloguer-mistake FLAG line and the ASSUMED line
      // (what the model says came from its own knowledge — lib/lot-ai-check.ts) — preserve newlines
      const lines = rawText.split("\n")
      const estimateLine = lines.find((l) => l.toLowerCase().startsWith("estimate:")) ?? ""
      const flagLine     = lines.find((l) => l.toLowerCase().startsWith("flag:")) ?? ""
      const assumedLine  = lines.find((l) => l.toLowerCase().startsWith("assumed:")) ?? ""
      const assumed      = parseAssumed(assumedLine)
      const rawDescription = lines
        .filter((l) => { const k = l.toLowerCase(); return !k.startsWith("estimate:") && !k.startsWith("flag:") && !k.startsWith("assumed:") })
        .join("\n").trim()
      // ⚠⚠ THE MODEL SOMETIMES WRITES OUT ITS SEARCH INSTEAD OF RUNNING IT — a bare
      // "tool_code" followed by print(google_search.search(…)). This is not a
      // description in any language and it reached a live catalogue on 2026-09-01,
      // because only the "Estimate:" and "FLAG:" lines were ever removed. It is
      // stripped here and the lot is then FAILED below rather than saved: the text
      // always stops dead where the model went to search, so what is left is a
      // half-written description, and a failure sends it back through the retry loop
      // on the other model. See lib/description-cleanup.ts.
      const { text: strippedDescription, leaked } = stripToolCallLeak(rawDescription)
      // Deterministic clean-up of the mechanical mistakes the model keeps making
      // on Dolls/Bears lots (strip **, LE→limited edition, drop "plumo means…"
      // notes, de-dupe the repeated name, close "CB 114790" → "CB114790").
      const description = isBearsPreset(presetKey) ? cleanBearsDescription(strippedDescription) : strippedDescription
      const flag = flagLine.replace(/^flag:\s*/i, "").trim()

      // ⚠⚠ AN EMPTY ANSWER IS NOT AN "OK". This used to push status "OK" whatever came
      // back, so a reply with no description at all was reported as a clean generation —
      // and the overnight runner, which only checks the status, wrote the empty string
      // onto the lot and logged a tick. Measured on F113: 179 lots of 601 (30% of the
      // sale) had "generated OK", an empty batchDesc, and no description anywhere, which
      // then surfaced on screen as "content blocked by AI" at the double check because
      // there was nothing left to check. RULES: never let "nothing happened" look like
      // success.
      if (leaked) {
        // Its own message, not "returned no description" — the difference matters when
        // reading the morning log. Both classifiers (the runner and the Batch tab) treat
        // it as the same KIND of failure: retry on the other model, bounded, never silent.
        results.push({ lot, description: "", estimate: "", status: "FAILED",
          error: `The model wrote out a search instead of a description (leaked tool call)`
               + `${finishReason && finishReason !== "STOP" ? ` (finished: ${finishReason})` : ""}: `
               + `${text.trim().slice(0, 120)}`,
          usage,
          debug: { prompt: userPrompt, response: text, imageCount: imageParts.length, searchQueries } })
      } else if (!description.trim()) {
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
          usage,
          debug: { prompt: userPrompt, response: text, imageCount: imageParts.length, searchQueries } })
      } else {
        results.push({ lot, description, estimate: estimateLine.replace(/^Estimate:\s*/i, "").trim(), status: "OK",
          ...(flag ? { flag } : {}),
          assumed,
          usage,
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
