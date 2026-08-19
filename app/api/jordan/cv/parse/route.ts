import { NextRequest, NextResponse } from "next/server"
import { isJordan } from "@/lib/jordan-auth"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { parseModelJson } from "@/lib/model-json"
import { normaliseCv, cvToText, PARSE_PROMPT } from "@/lib/jordan-cv"

export const maxDuration = 120

// POST /api/jordan/cv/parse — an uploaded CV in, structured JSON out.
// FormData: file (one), model (optional).
//
// ⚠ WHY THERE IS NO PDF-PARSING LIBRARY HERE. The Hub has pdf-lib, which WRITES
// PDFs and cannot read text out of one, and nothing else that reads documents.
// Rather than add a dependency, the file is handed to the model as inlineData —
// Gemini reads a PDF natively, and a photo or screenshot of a CV just as well.
// That also copes with the two-column layouts that defeat text extraction.
//
// ⚠ .docx is NOT readable this way (it is a zip, not a document format the model
// accepts) and is rejected with a clear message rather than a confusing failure.
const ACCEPTED = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]
const MAX_BYTES = 15 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const form = await req.formData()
    const file = form.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

    const type = (file.type || "").toLowerCase()
    const name = file.name || "CV"
    if (/\.docx?$/i.test(name) || type.includes("officedocument") || type === "application/msword") {
      return NextResponse.json({
        error: "Word files can't be read directly. In Word choose File → Save As → PDF and upload that.",
      }, { status: 415 })
    }
    if (!ACCEPTED.includes(type)) {
      return NextResponse.json({ error: `Upload a PDF or a photo of the CV — ${type || "that file type"} isn't supported.` }, { status: 415 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That file is over 15MB — try exporting it again at a smaller size." }, { status: 413 })
    }

    const data = Buffer.from(await file.arrayBuffer()).toString("base64")
    const model = await getToolModel("jordan_cv", String(form.get("model") ?? ""))

    const raw = await generateAiText({
      model,
      system: PARSE_PROMPT,
      prompt: "Here is the CV. Transcribe it into the JSON shape exactly as instructed.",
      images: [{ mimeType: type, data }],
      json: true,
      // A CV plus its JSON scaffolding runs long; a truncated reply here would come
      // back as unreadable JSON and lose the whole upload.
      maxOutputTokens: 8192,
    })

    const parsed = parseModelJson(raw)
    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json({
        error: raw.trim() && !raw.trim().endsWith("}")
          ? "The CV was too long to read in one go — try a shorter file, or paste the text in by hand."
          : "Couldn't read that CV — try again, or paste the text in by hand.",
      }, { status: 502 })
    }

    const cv = normaliseCv(parsed)
    if (!cv.name && !cv.experience.length && !cv.education.length && !cv.summary) {
      return NextResponse.json({ error: "Nothing recognisable as a CV came out of that file." }, { status: 422 })
    }

    // rawText is kept so a re-parse or a tailoring run never needs the original
    // file again, and so the wording actually written stays available.
    return NextResponse.json({ model, cv, rawText: cvToText(cv), sourceName: name })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    const msg: string = e?.message ?? "Unknown error"
    if (/429|resource.?exhausted|quota|rate.?limit/i.test(msg)) {
      return NextResponse.json({ error: `RATE_LIMITED: ${msg}` }, { status: 429 })
    }
    console.error("jordan/cv/parse:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
