import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { parseModelJson, extractJsonField } from "@/lib/model-json"
import { normaliseCv, cvToText, tailorPrompt } from "@/lib/jordan-cv"

export const maxDuration = 180

// POST /api/jordan/cv/tailor — master CV + a job advert in, a tailored CV and a
// covering letter out, saved as an application against the profile.
// Body: { profileId, jobText, jobTitle?, company?, model? }
export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const { profileId, jobText, jobTitle = "", company = "", model: modelId = "" } = await req.json()
    if (!profileId) return NextResponse.json({ error: "Pick a profile first" }, { status: 400 })
    if (!String(jobText ?? "").trim()) return NextResponse.json({ error: "Paste the job advert first" }, { status: 400 })

    const profile = await prisma.jordanCvProfile.findUnique({
      where: { id: profileId },
      select: { id: true, data: true },
    })
    if (!profile) return NextResponse.json({ error: "That profile no longer exists" }, { status: 404 })

    const master = normaliseCv(profile.data)
    if (!master.experience.length && !master.summary && !master.education.length) {
      return NextResponse.json({ error: "That profile's CV is empty — upload or fill one in first." }, { status: 400 })
    }

    const model = await getToolModel("jordan_cv", modelId)
    const raw = await generateAiText({
      model,
      system: tailorPrompt(),
      // ⚠ The MASTER CV is the stable half and the advert is what varies, so the CV
      // goes in cachePrefix — on Claude that becomes a cached block, which matters
      // when several jobs are run against one CV in a sitting.
      cachePrefix: `MASTER CV (JSON):\n${JSON.stringify(master)}\n\nMASTER CV (as text, for reference):\n${cvToText(master)}`,
      prompt: `JOB ADVERT:\n${String(jobText).trim().slice(0, 20_000)}`,
      json: true,
      maxOutputTokens: 8192,
    })

    const parsed = parseModelJson(raw)
    const obj = parsed && typeof parsed === "object" ? parsed : null
    // Salvage the letter even when the JSON came back malformed — losing a good
    // covering letter to a stray character would be maddening.
    const coverLetter = (obj ? String(obj.coverLetter ?? "") : extractJsonField(raw, "coverLetter") ?? "").trim()
    if (!obj && !coverLetter) {
      return NextResponse.json({
        error: raw.trim() && !raw.trim().endsWith("}")
          ? "The reply was cut off — try a shorter job advert."
          : "Couldn't read the AI's answer — try again.",
      }, { status: 502 })
    }

    // ⚠ If the tailored CV is unusable, fall back to the MASTER rather than saving
    // an empty one: an application whose CV silently came out blank is the worst
    // possible outcome here.
    const tailored = obj?.cv ? normaliseCv(obj.cv) : master
    const notes = (obj ? String(obj.notes ?? "") : extractJsonField(raw, "notes") ?? "").trim().slice(0, 1000)

    const app = await prisma.jordanCvApplication.create({
      data: {
        profileId,
        jobTitle: String(jobTitle ?? "").trim().slice(0, 200),
        company:  String(company ?? "").trim().slice(0, 200),
        jobText:  String(jobText).trim().slice(0, 50_000),
        coverLetter,
        tailoredCv: tailored as any,
        notes,
      },
    })

    return NextResponse.json({ id: app.id, model, cv: tailored, coverLetter, notes })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    const msg: string = e?.message ?? "Unknown error"
    if (/429|resource.?exhausted|quota|rate.?limit/i.test(msg)) {
      return NextResponse.json({ error: `RATE_LIMITED: ${msg}` }, { status: 429 })
    }
    console.error("jordan/cv/tailor:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
