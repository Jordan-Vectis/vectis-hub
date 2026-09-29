import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import sharp from "sharp"
import { getToolModel } from "@/lib/ai-models"
import { IMAGE_ENDPOINT, extractImage, extractText } from "@/lib/gemini-image"

export const maxDuration = 120
export const runtime = "nodejs"

// POST /api/photo-prep/create — Photo Prep → 💬 Image chat (2026-09-29, Jordan: "a nano banana
// chat bot where I can ask it to make me posters etc"). One turn per call.
// FormData: prompt, shape?, current? (the picture being changed), attach* (up to 4 pictures).
// Returns { image?: <base64>, mimeType?, text? }.
//
// ⚠ STATELESS ON PURPOSE. Each follow-up sends the CURRENT picture back with the new request
// ("make the title bigger") instead of relying on the interactions API's previous_interaction_id,
// which has never been tested here. The browser holds the conversation; nothing is stored.
//
// ⚠ This is for MARKETING pictures — posters, banners, social posts. It is not for lot photos:
// the model redraws everything it is given, so a lot photo put through it is no longer evidence of
// the item's condition (see Photo Prep → AI edit and CONDITION_RULE). The tab says so.

const MAX_EDGE = 2048
const MAX_ATTACH = 4

// Only facts from the Vectis company-facts record — the model must not invent any.
const HOUSE = [
  "You are the in-house graphic designer for Vectis Auctions, a UK auction house for toys, trains, collectables and memorabilia, founded in 1988, based in Thornaby, Teesside.",
  "Make exactly the picture asked for — a poster, banner, flyer or social post — clean, professional and easy to read.",
  "Spell every word of text exactly as given, in British English. Never invent dates, prices, phone numbers, addresses, web addresses, names or claims that were not given in the request. If a detail is missing, leave it out rather than make one up.",
  "Only put the Vectis name or logo on the picture if the request asks for it or a logo image is attached.",
].join(" ")

const SHAPES: Record<string, string> = {
  square:    "Make it square (1:1).",
  portrait:  "Make it portrait, the shape of an A4 page (about 1:1.41).",
  landscape: "Make it landscape, widescreen (16:9).",
  story:     "Make it tall, phone-screen shaped (9:16), for a story or reel.",
}

async function shrink(file: File): Promise<string> {
  const buf = await sharp(Buffer.from(await file.arrayBuffer())).rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .png().toBuffer()
  return buf.toString("base64")
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const dbUser = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { role: true, allowedApps: true },
    })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "PHOTO_PREP")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const form    = await req.formData()
    const prompt  = String(form.get("prompt") ?? "").trim()
    const shape   = String(form.get("shape") ?? "").trim()
    const current = form.get("current")
    const attach  = form.getAll("attach").filter((f): f is File => f instanceof File).slice(0, MAX_ATTACH)
    if (!prompt) return NextResponse.json({ error: "Say what you'd like made" }, { status: 400 })

    const input: any[] = []
    const text = [HOUSE]
    if (current instanceof File) {
      text.push("The FIRST picture below is the current design. Change it exactly as asked and keep everything else about it the same.")
    } else {
      text.push("Create a new picture.")
      if (SHAPES[shape]) text.push(SHAPES[shape])
    }
    if (attach.length) text.push(`${attach.length === 1 ? "The attached picture is" : "The attached pictures are"} for you to use in the design as asked (a photo, a logo, or a style to follow).`)
    text.push(`Request: ${prompt}`)
    input.push({ type: "text", text: text.join("\n\n") })
    if (current instanceof File) input.push({ type: "image", mime_type: "image/png", data: await shrink(current) })
    for (const f of attach) input.push({ type: "image", mime_type: "image/png", data: await shrink(f) })

    const model = await getToolModel("photo_prep_create")
    const res = await fetch(IMAGE_ENDPOINT, {
      method:  "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body:    JSON.stringify({ model, input }),
      signal:  AbortSignal.timeout(110_000),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = json?.error?.message ?? `Image model returned ${res.status}`
      return NextResponse.json({ error: msg }, { status: res.status === 429 ? 429 : 502 })
    }

    const found = extractImage(json)
    const said  = extractText(json)
    if (!found) {
      // Words and no picture is a real answer (a question back, or a refusal) — show it.
      if (said) return NextResponse.json({ text: said })
      return NextResponse.json({ error: `The model didn't send a picture back. The reply contained: ${Object.keys(json ?? {}).join(", ") || "nothing"}.` }, { status: 502 })
    }
    return NextResponse.json({ image: found.data, mimeType: found.mimeType, text: said || undefined })
  } catch (e: any) {
    console.error("photo-prep/create error:", e)
    const msg = e?.name === "TimeoutError" ? "The image model took too long to answer — try again." : (e?.message ?? "Couldn't make the picture")
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
