import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"
import { isJordan } from "@/lib/jordan-auth"
import { withGeminiRetry, isTransientGeminiError } from "@/lib/gemini-retry"
import { parseLooseJson } from "@/lib/mcoc-ai"

export const maxDuration = 120

// POST /api/jordan/mcoc — "who should I use against this defender?" for Marvel
// Contest of Champions. FormData: defender (text, optional — an exact Champion
// DB name), context (text, optional — nodes/buffs, or the defender itself when
// nothing was picked), defenderImage + nodesImage (optional screenshots, kept
// separate so the model is told which is which), model, search ("1"/"0").
// Locked to jordan.orange.
//
// Web search grounding is used by default because the MCOC meta changes monthly
// (new champs, reworks) — training-data recall goes stale fast. Grounding can't
// be combined with JSON response-mime on some models, so the prompt asks for
// JSON and we parse it loosely; if the model can't ground we retry ungrounded.

const PROMPT = `You are an expert Marvel Contest of Champions (MCOC) strategist. The user will give you a DEFENDER (by name and/or a screenshot of the fight/champion) plus any node or buff context. Recommend the best ATTACKERS to counter it.

Images are labelled. A DEFENDER image shows the champion you are fighting — identify it. A NODES image shows that fight's node/buff list — read every node off it and factor each one into your advice, calling out the ones that actually change which attacker to bring. Never mistake a node name for the defender's name.

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

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const form = await req.formData()
    const defender = ((form.get("defender") as string) ?? "").trim().slice(0, 500)
    const context = ((form.get("context") as string) ?? "").trim().slice(0, 1000)
    // "image" is the pre-split field name — still accepted so a stale tab (an
    // old bundle cached on the iPad) doesn't silently drop its screenshot.
    const defFile = form.get("defenderImage") ?? form.get("image")
    const nodeFile = form.get("nodesImage")
    const wantSearch = (form.get("search") as string) !== "0"
    if (!defender && !context && !(defFile instanceof File)) {
      return NextResponse.json({ error: "Name a defender or upload a screenshot." }, { status: 400 })
    }

    async function imagePart(f: File) {
      const buffer = Buffer.from(await f.arrayBuffer())
      return { inlineData: { data: buffer.toString("base64"), mimeType: f.type || "image/jpeg" } }
    }

    const parts: any[] = []
    if (defFile instanceof File) {
      parts.push({ text: "IMAGE — THE DEFENDER (the champion being fought):" })
      parts.push(await imagePart(defFile))
    }
    if (nodeFile instanceof File) {
      parts.push({ text: "IMAGE — THE NODES / BUFFS for this fight (not the defender):" })
      parts.push(await imagePart(nodeFile))
    }

    // With no explicit pick, the free text carries the defender AND the context,
    // which is how this worked before the dropdown — keep that reading.
    const lines: string[] = []
    if (defender) {
      lines.push(`DEFENDER: ${defender}`)
      if (context) lines.push(`NODES / BUFFS / CONTEXT: ${context}`)
    } else if (context) {
      lines.push(`DEFENDER / CONTEXT FROM THE USER: ${context}`)
    } else {
      lines.push("DEFENDER / CONTEXT FROM THE USER: (see the screenshot)")
    }
    if (nodeFile instanceof File) lines.push("The nodes are in the NODES image — read them off it.")
    parts.push({ text: `${PROMPT}\n\n${lines.join("\n")}` })

    const modelId = await getToolModel("jordan_fun", form.get("model") as string | null)
    const genai = new GoogleGenerativeAI(apiKey)

    async function ask(useSearch: boolean) {
      const model = genai.getGenerativeModel({
        model: modelId,
        ...(useSearch ? { tools: [{ googleSearch: {} } as any] } : { generationConfig: { responseMimeType: "application/json" } }),
      })
      const resp = (await withGeminiRetry(() => model.generateContent(parts))).response
      const block = resp.promptFeedback?.blockReason
      if (block) throw Object.assign(new Error(`Blocked by Gemini: ${block}`), { http: 422 })
      const finish = resp.candidates?.[0]?.finishReason
      if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") throw Object.assign(new Error(`Blocked by Gemini (${finish})`), { http: 422 })
      return { resp, parsed: parseLooseJson(resp.text()) }
    }

    // Grounded first (live meta). Fall back to an ungrounded strict-JSON call if
    // the model can't ground OR the grounded reply won't parse — grounding can't
    // use JSON response-mime, so the model sometimes leaks prose into the JSON.
    let groundedFallback = false
    let out
    try {
      out = await ask(wantSearch)
    } catch (e: any) {
      if (e?.http === 422) return NextResponse.json({ error: e.message }, { status: 422 })
      const msg = String(e?.message ?? e).toLowerCase()
      const recoverable = msg.includes("tool") || msg.includes("grounding") || msg.includes("400") ||
        msg.includes("couldn't read") || msg.includes("not valid json") || msg.includes("unexpected token")
      if (!(wantSearch && recoverable)) throw e
      groundedFallback = true
      try {
        out = await ask(false)
      } catch (e2: any) {
        if (e2?.http === 422) return NextResponse.json({ error: e2.message }, { status: 422 })
        throw e2
      }
    }

    const response = out.resp
    const parsed = out.parsed
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
      defender:  typeof parsed?.defender === "string" ? parsed.defender : (defender || context || "Unknown defender"),
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
