import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { prisma } from "@/lib/prisma"
import { getToolModel } from "@/lib/ai-models"
import { IMAGE_ENDPOINT, extractImage, extractText } from "@/lib/gemini-image"
import { uploadBufferToR2, getObjectBuffer } from "@/lib/r2"
import { photoPrepUser, ownChat, keyPrefix, showTurns, type StoredTurn } from "@/lib/image-chat"

export const maxDuration = 120
export const runtime = "nodejs"

// POST /api/photo-prep/create — Photo Prep → 💬 Image chat (2026-09-29, Jordan: "a nano banana
// chat bot where I can ask it to make me posters etc"). One turn per call.
// FormData: prompt, shape?, chatId? (carry on a saved chat), edit? ("1" = change the chat's latest
// picture), attach* (up to 4 pictures).
// Returns { chatId, title, added: ShownTurn[] } — the two turns this call appended.
//
// ⚠ EVERY CHAT SAVES ITSELF (Jordan: "Can we save chats?"). The row is made on the first turn and
// each call appends the request and the answer, pictures stored in R2 under image-chat/<id>/.
// Private to the person — see lib/image-chat.ts.
//
// ⚠ STATELESS towards Google. A follow-up sends the chat's latest picture back with the new request
// ("make the title bigger") rather than relying on the interactions API's previous_interaction_id,
// which has never been tested here. The picture is read from R2, so the browser never uploads it.
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

async function shrink(buf: Buffer): Promise<Buffer> {
  return sharp(buf).rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .png().toBuffer()
}

export async function POST(req: NextRequest) {
  try {
    const me = await photoPrepUser()
    if ("error" in me) return NextResponse.json({ error: me.error }, { status: me.status })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const form   = await req.formData()
    const prompt = String(form.get("prompt") ?? "").trim()
    const shape  = String(form.get("shape") ?? "").trim()
    const edit   = String(form.get("edit") ?? "") === "1"
    const chatIn = String(form.get("chatId") ?? "").trim()
    const files  = form.getAll("attach").filter((f): f is File => f instanceof File).slice(0, MAX_ATTACH)
    if (!prompt) return NextResponse.json({ error: "Say what you'd like made" }, { status: 400 })

    // The chat — carried on, or made now so its pictures have somewhere to live.
    let chat = chatIn ? await ownChat(chatIn, me.id) : null
    if (chatIn && !chat) return NextResponse.json({ error: "That chat isn't there any more — start a new one." }, { status: 404 })
    if (!chat) {
      chat = await prisma.imageChat.create({
        data: { userId: me.id, title: prompt.replace(/\s+/g, " ").slice(0, 80), turns: [] },
      })
    }
    const turns = (chat.turns as unknown as StoredTurn[]) ?? []
    const prefix = keyPrefix(chat.id)

    // The picture being changed: the chat's latest one, read back from R2.
    let lastImageKey: string | null = null
    for (const t of turns) if (t.who === "ai" && t.image) lastImageKey = t.image
    const current = edit && lastImageKey ? await getObjectBuffer(lastImageKey) : null

    // Keep what they attached, shrunk, so the saved chat shows it.
    const attach: { key: string; png: Buffer }[] = []
    for (const f of files) {
      const png = await shrink(Buffer.from(await f.arrayBuffer()))
      const key = `${prefix}${randomUUID()}.png`
      await uploadBufferToR2(png, key, "image/png")
      attach.push({ key, png })
    }
    const you: StoredTurn = { who: "you", text: prompt, attach: attach.map(a => a.key), at: new Date().toISOString() }

    const text = [HOUSE]
    if (current) {
      text.push("The FIRST picture below is the current design. Change it exactly as asked and keep everything else about it the same.")
    } else {
      text.push("Create a new picture.")
      if (SHAPES[shape]) text.push(SHAPES[shape])
    }
    if (attach.length) text.push(`${attach.length === 1 ? "The attached picture is" : "The attached pictures are"} for you to use in the design as asked (a photo, a logo, or a style to follow).`)
    text.push(`Request: ${prompt}`)
    const input: any[] = [{ type: "text", text: text.join("\n\n") }]
    if (current) input.push({ type: "image", mime_type: "image/png", data: (await shrink(current)).toString("base64") })
    for (const a of attach) input.push({ type: "image", mime_type: "image/png", data: a.png.toString("base64") })

    // Ask. A failure is SAVED as a turn too, so the chat shows what happened.
    let ai: StoredTurn
    try {
      const model = await getToolModel("photo_prep_create")
      const res = await fetch(IMAGE_ENDPOINT, {
        method:  "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body:    JSON.stringify({ model, input }),
        signal:  AbortSignal.timeout(110_000),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error?.message ?? `Image model returned ${res.status}`)
      const found = extractImage(json)
      const said  = extractText(json)
      if (found) {
        const ext = found.mimeType.includes("jpeg") ? "jpg" : "png"
        const key = `${prefix}${randomUUID()}.${ext}`
        await uploadBufferToR2(Buffer.from(found.data, "base64"), key, found.mimeType)
        ai = { who: "ai", image: key, text: said || undefined, at: new Date().toISOString() }
      } else if (said) {
        // Words and no picture is a real answer (a question back, or a refusal) — keep it.
        ai = { who: "ai", text: said, at: new Date().toISOString() }
      } else {
        throw new Error(`The model didn't send a picture back. The reply contained: ${Object.keys(json ?? {}).join(", ") || "nothing"}.`)
      }
    } catch (e: any) {
      const msg = e?.name === "TimeoutError" ? "The image model took too long to answer — try again." : (e?.message ?? "Couldn't make the picture")
      console.error("photo-prep/create model error:", msg)
      ai = { who: "ai", error: msg, at: new Date().toISOString() }
    }

    const added = [you, ai]
    await prisma.imageChat.update({
      where:  { id: chat.id },
      data:   { turns: [...turns, ...added] as any },
      select: { id: true },
    })
    return NextResponse.json({ chatId: chat.id, title: chat.title, added: showTurns(chat.id, added) })
  } catch (e: any) {
    console.error("photo-prep/create error:", e)
    return NextResponse.json({ error: e?.message ?? "Couldn't make the picture" }, { status: 500 })
  }
}
