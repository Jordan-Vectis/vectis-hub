// The office PC's half of the open-model trial (lib/local-ai.ts in the Hub).
//
// What it does: asks the Hub for a lot, downloads its photos, hands the Hub's EXACT prompt and
// the photos to the model running on this PC (Ollama), and posts the answer back. The Hub shows
// it beside Gemini's on Auction AI → Instructions Testing. Nothing is ever written to a lot.
//
// The PC PULLS from the Hub, so nothing needs opening on the office firewall. Ctrl+C stops it;
// a lot it was in the middle of is re-offered by the Hub after 15 minutes.
//
// SET-UP (Windows, once):
//   1. Install Node 18 or newer (nodejs.org) and Ollama (ollama.com), then in a terminal:
//        ollama pull <model>          e.g.  ollama pull qwen3-vl:8b
//   2. Get a token: Hub → Auction AI → Instructions Testing → Office PC → Make a token.
//   3. In the folder holding this file:
//        set HUB_URL=https://vectis-hub-sandbox.up.railway.app
//        set LOCAL_AI_TOKEN=vhub_…
//        set MODEL=qwen3-vl:8b
//        node local-ai-bridge.mjs
//
// OPTIONAL:
//   OLLAMA_URL            where Ollama listens (default http://127.0.0.1:11434)
//   WORKER_NAME           what the Hub shows (default this PC's name)
//   NUM_CTX               context window asked of Ollama (default 32768 — 24 photos need room)
//   THINK                 "true" or "false" to force a thinking model's mode; unset = model default
//   IMAGES_PER_MESSAGE    0 = all photos in one message (default); N = split N per message, for a
//                         model that only takes a few images per turn
//   --once                do one job (or none) and exit — for checking the set-up

import os from "node:os"

const HUB      = (process.env.HUB_URL ?? "").replace(/\/+$/, "")
const TOKEN    = process.env.LOCAL_AI_TOKEN ?? ""
const MODEL    = process.env.MODEL ?? ""
const OLLAMA   = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "")
const WORKER   = process.env.WORKER_NAME ?? os.hostname()
const NUM_CTX  = Number(process.env.NUM_CTX ?? 32768)
const THINK    = process.env.THINK
const PER_MSG  = Number(process.env.IMAGES_PER_MESSAGE ?? 0)
const ONCE     = process.argv.includes("--once")
const VERSION  = "1.0 (2026-10-01)"

const stamp = () => new Date().toLocaleTimeString("en-GB", { hour12: false })
const log   = (msg) => console.log(`[${stamp()}] ${msg}`)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function checkConfig() {
  const missing = []
  if (!HUB)   missing.push("HUB_URL")
  if (!TOKEN) missing.push("LOCAL_AI_TOKEN")
  if (!MODEL) missing.push("MODEL")
  if (missing.length) {
    console.error(`Missing: ${missing.join(", ")}. See the SET-UP notes at the top of this file.`)
    process.exit(1)
  }
}

async function hub(path, body) {
  const res = await fetch(HUB + path, {
    method:  "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body:    JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON — fall through */ }
  if (!res.ok) throw new Error(`Hub ${res.status} on ${path}: ${json?.error ?? text.slice(0, 200)}`)
  if (!json) throw new Error(`Hub answered ${path} with something that is not JSON: ${text.slice(0, 200)}`)
  return json
}

async function checkOllama() {
  try {
    const res  = await fetch(OLLAMA + "/api/tags")
    const json = await res.json()
    const names = (json.models ?? []).map(m => m.name)
    if (!names.includes(MODEL) && !names.includes(MODEL + ":latest")) {
      log(`⚠ Ollama is running but has no model called "${MODEL}". It has: ${names.join(", ") || "nothing"}. Run: ollama pull ${MODEL}`)
    } else {
      log(`Ollama is up with ${MODEL}`)
    }
  } catch (e) {
    log(`⚠ Cannot reach Ollama at ${OLLAMA} (${e.message}). Start Ollama, then run this again.`)
    process.exit(1)
  }
}

async function download(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`photo download ${res.status}`)
  return Buffer.from(await res.arrayBuffer()).toString("base64")
}

async function describe(job) {
  const images = []
  for (const img of job.images ?? []) {
    try { images.push(await download(img.url)) }
    catch (e) { log(`  ⚠ ${job.lotLabel}: skipped a photo (${img.name}): ${e.message}`) }
  }
  if (!images.length) throw new Error("No photos could be downloaded")

  const messages = [{ role: "system", content: job.systemInstruction }]
  if (PER_MSG > 0 && images.length > PER_MSG) {
    for (let i = 0; i < images.length; i += PER_MSG) {
      const chunk = images.slice(i, i + PER_MSG)
      messages.push({ role: "user", content: `Photos ${i + 1}–${i + chunk.length} of ${images.length} of this lot.`, images: chunk })
    }
    messages.push({ role: "user", content: job.userPrompt })
  } else {
    messages.push({ role: "user", content: job.userPrompt, images })
  }

  const body = { model: MODEL, messages, stream: false, options: { num_ctx: NUM_CTX } }
  if (THINK === "true" || THINK === "false") body.think = THINK === "true"

  const t0  = Date.now()
  const res = await fetch(OLLAMA + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = await res.json()
  return {
    text:         j?.message?.content ?? "",
    model:        j?.model ?? MODEL,
    promptTokens: typeof j?.prompt_eval_count === "number" ? j.prompt_eval_count : null,
    outputTokens: typeof j?.eval_count === "number" ? j.eval_count : null,
    ms:           Date.now() - t0,
    imageCount:   images.length,
  }
}

async function main() {
  checkConfig()
  log(`Vectis Hub office PC bridge ${VERSION} · ${WORKER} · ${HUB} · model ${MODEL}`)
  await checkOllama()

  let hubFailures = 0
  for (;;) {
    let next
    try {
      next = await hub("/api/local-ai/worker/next", { worker: WORKER, model: MODEL, info: `bridge ${VERSION} · node ${process.version} · ${os.platform()} ${os.release()}` })
      hubFailures = 0
    } catch (e) {
      hubFailures++
      const wait = Math.min(5000 * hubFailures, 60000)
      log(`⚠ ${e.message} — trying again in ${wait / 1000}s`)
      await sleep(wait)
      continue
    }

    if (!next.job) {
      if (ONCE) { log("Nothing queued. (--once, so stopping.)"); return }
      await sleep(next.waitMs ?? 3000)
      continue
    }

    const job = next.job
    log(`▶ ${job.lotLabel} (${job.auctionCode}) — ${job.images?.length ?? 0} photos`)
    try {
      const out = await describe(job)
      await hub("/api/local-ai/worker/result", { jobId: job.id, ...out })
      log(`✓ ${job.lotLabel} — ${out.promptTokens ?? "?"} in · ${out.outputTokens ?? "?"} out · ${(out.ms / 1000).toFixed(0)} s`)
    } catch (e) {
      log(`✗ ${job.lotLabel} — ${e.message}`)
      try { await hub("/api/local-ai/worker/result", { jobId: job.id, error: e.message, model: MODEL }) }
      catch (e2) { log(`  ⚠ and could not tell the Hub: ${e2.message}`) }
    }
    if (ONCE) return
  }
}

main().catch(e => { console.error(e); process.exit(1) })
