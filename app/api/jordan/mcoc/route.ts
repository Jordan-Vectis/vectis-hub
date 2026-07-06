import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { isJordan } from "@/lib/jordan-auth"
import { withGeminiRetry, isTransientGeminiError } from "@/lib/gemini-retry"

export const maxDuration = 120

// POST /api/jordan/mcoc — "who should I use against this defender?" for Marvel
// Contest of Champions. FormData: defender (text, optional), image (optional
// screenshot), model, search ("1"/"0"). Locked to jordan.orange.
//
// Web search grounding is used by default because the MCOC meta changes monthly
// (new champs, reworks) — training-data recall goes stale fast. Grounding can't
// be combined with JSON response-mime on some models, so the prompt asks for
// JSON and we parse it loosely; if the model can't ground we retry ungrounded.

const PROMPT = `You are an expert Marvel Contest of Champions (MCOC) strategist. The user will give you a DEFENDER (by name and/or a screenshot of the fight/champion) plus any node or buff context. Recommend the best ATTACKERS to counter it.

Think about class advantage (Cosmic>Tech>Mutant>Skill>Science>Mystic>Cosmic), the defender's abilities/immunities, common node hazards, and which attacker mechanics neutralise them (ability accuracy reduction, nullify, heal-block, unstoppable, incinerate immunity, evade counters, etc.). Prefer champions that are genuinely good into THIS defender, not just class-advantage picks. Use up-to-date info.

Return STRICT JSON only (no prose, no markdown fences):
{
  "defender": string,     // the defender you're advising on, with any node/context you understood (e.g. "Nick Fury on Aggression / Bane")
  "counters": [ {
    "champion": string,   // attacker name (be specific, e.g. "Hercules", "Kitty Pryde")
    "class": string,      // Cosmic | Tech | Mutant | Skill | Science | Mystic
    "why": string,        // WHY they beat this defender (the mechanic that matters)
    "how": string         // short playstyle tip for the fight
  } ],
  "strategy": string,     // overall approach to this fight
  "warnings": string,     // the defender's dangerous mechanics / what to avoid, or ""
  "confident": boolean    // false if you couldn't tell who the defender is
}

Give 3–6 counters, best first. If you can't identify the defender from the input, set confident false and put your best generic advice in strategy.`

function parseLooseJson(text: string): any {
  const clean = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim()
  try { return JSON.parse(clean) } catch {}
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}")
  if (s >= 0 && e > s) return JSON.parse(clean.slice(s, e + 1))
  throw new Error("Couldn't read the AI's answer — try again.")
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const form = await req.formData()
    const defender = ((form.get("defender") as string) ?? "").trim().slice(0, 500)
    const file = form.get("image")
    const wantSearch = (form.get("search") as string) !== "0"
    if (!defender && !(file instanceof File)) {
      return NextResponse.json({ error: "Name a defender or upload a screenshot." }, { status: 400 })
    }

    const parts: any[] = []
    if (file instanceof File) {
      const buffer = Buffer.from(await file.arrayBuffer())
      parts.push({ inlineData: { data: buffer.toString("base64"), mimeType: file.type || "image/jpeg" } })
    }
    parts.push({ text: `${PROMPT}\n\nDEFENDER / CONTEXT FROM THE USER: ${defender || "(see the screenshot)"}` })

    const modelId = await getToolModel("jordan_fun", form.get("model") as string | null)
    const genai = new GoogleGenerativeAI(apiKey)

    async function ask(useSearch: boolean) {
      const model = genai.getGenerativeModel({
        model: modelId,
        ...(useSearch ? { tools: [{ googleSearch: {} } as any] } : { generationConfig: { responseMimeType: "application/json" } }),
      })
      return withGeminiRetry(() => model.generateContent(parts))
    }

    let groundedFallback = false
    let result
    try {
      result = await ask(wantSearch)
    } catch (e: any) {
      const msg = String(e?.message ?? e).toLowerCase()
      // Model doesn't support grounding → retry once without it rather than failing.
      if (wantSearch && (msg.includes("tool") || msg.includes("grounding") || msg.includes("400"))) {
        groundedFallback = true
        result = await ask(false)
      } else {
        throw e
      }
    }

    const response = result.response
    const block = response.promptFeedback?.blockReason
    if (block) return NextResponse.json({ error: `Blocked by Gemini: ${block}` }, { status: 422 })
    const finish = response.candidates?.[0]?.finishReason
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Blocked by Gemini (${finish})` }, { status: 422 })
    }

    const parsed = parseLooseJson(response.text())
    const counters = Array.isArray(parsed?.counters)
      ? parsed.counters.slice(0, 8).map((c: any) => ({
          champion: typeof c?.champion === "string" ? c.champion : "?",
          class:    typeof c?.class === "string" ? c.class : "",
          why:      typeof c?.why === "string" ? c.why : "",
          how:      typeof c?.how === "string" ? c.how : "",
        }))
      : []
    const queries = (response.candidates?.[0]?.groundingMetadata as any)?.webSearchQueries ?? []

    return NextResponse.json({
      defender:  typeof parsed?.defender === "string" ? parsed.defender : (defender || "Unknown defender"),
      counters,
      strategy:  typeof parsed?.strategy === "string" ? parsed.strategy : "",
      warnings:  typeof parsed?.warnings === "string" ? parsed.warnings : "",
      confident: parsed?.confident !== false && counters.length > 0,
      queries,
      groundedFallback,
    })
  } catch (e: any) {
    console.error("jordan/mcoc error:", e)
    if (isTransientGeminiError(e)) {
      return NextResponse.json({ error: "That model is overloaded right now — try again in a minute, or switch model." }, { status: 503 })
    }
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
