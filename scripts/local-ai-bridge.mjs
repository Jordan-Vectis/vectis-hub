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
//   PHOTO_MAX_PX          the Hub shrinks each photo to this longest edge before handing it over
//                         (default 1024). ⚠ An open model reads a 3 MB camera photo at FULL size,
//                         about 4,000 tokens each, so originals make a 24-photo lot a ~100,000-token
//                         prompt. 0 = send the originals anyway (a big card, or to measure the gap).
//   NUM_CTX               context window asked of Ollama (default 32768 — 24 photos need room)
//   THINK                 "true" or "false" to force a thinking model's mode; unset = model default
//   IMAGES_PER_MESSAGE    0 = all photos in one message (default); N = split N per message, for a
//                         model that only takes a few images per turn
//   --once                do one job (or none) and exit — for checking the set-up

import os from "node:os"
import http from "node:http"
import https from "node:https"

const HUB      = (process.env.HUB_URL ?? "").replace(/\/+$/, "")
const TOKEN    = process.env.LOCAL_AI_TOKEN ?? ""
const MODEL    = process.env.MODEL ?? ""
const OLLAMA   = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "")
const WORKER   = process.env.WORKER_NAME ?? os.hostname()
const MAX_PX   = Number(process.env.PHOTO_MAX_PX ?? 1024)
const NUM_CTX  = Number(process.env.NUM_CTX ?? 32768)
// ⚠ A ceiling on what the model may write. Measured 2026-10-01 on a CPU: with thinking off the
// 4B model still ran to 3,000+ tokens on one lot at 1 token a second and never stopped. A
// description is a few hundred tokens; past this the answer is a runaway, and the lot fails.
const MAX_OUT  = Number(process.env.MAX_OUTPUT_TOKENS ?? 1500)
const THINK    = process.env.THINK
const PER_MSG  = Number(process.env.IMAGES_PER_MESSAGE ?? 0)
const ONCE     = process.argv.includes("--once")
const VERSION  = "1.1 (2026-10-01)"

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

// Shrunk from the Hub when PHOTO_MAX_PX is set (the Hub does the shrinking, so nothing to
// install here); the original straight from storage otherwise.
async function download(img) {
  const shrunk = MAX_PX > 0 && img.photoPath
  const res = shrunk
    ? await fetch(`${HUB}${img.photoPath}&maxPx=${MAX_PX}`, { headers: { authorization: `Bearer ${TOKEN}` } })
    : await fetch(img.url)
  if (!res.ok) throw new Error(`photo download ${res.status}${shrunk ? " from the Hub" : ""}`)
  return Buffer.from(await res.arrayBuffer()).toString("base64")
}

// ⚠ NOT fetch(). Node's fetch gives up after five minutes of silence from the server, and a
// CPU reading two full-size photos was still silent at five minutes (measured 2026-10-01:
// "fetch failed" with nothing wrong). A plain HTTP request has no such clock.
function postJsonNoTimeout(urlString, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(urlString)
    const lib  = url.protocol === "https:" ? https : http
    const data = Buffer.from(JSON.stringify(body))
    const req  = lib.request(url, { method: "POST", headers: { "content-type": "application/json", "content-length": data.length } }, res => {
      const chunks = []
      res.on("data", c => chunks.push(c))
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8")
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Ollama ${res.statusCode}: ${text.slice(0, 300)}`))
        try { resolve(JSON.parse(text)) }
        catch { reject(new Error(`Ollama answered with something that is not JSON: ${text.slice(0, 200)}`)) }
      })
    })
    req.setTimeout(0)
    req.on("error", reject)
    req.write(data)
    req.end()
  })
}

async function describe(job) {
  const images = []
  for (const img of job.images ?? []) {
    try { images.push(await download(img)) }
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

  const body = { model: MODEL, messages, stream: false, options: { num_ctx: NUM_CTX, num_predict: MAX_OUT } }
  // ⚠ Thinking OFF unless asked for. Measured 2026-10-01: Qwen3-VL "thinks" before it answers,
  // and on a CPU that was 2,249 tokens of private reasoning at 1.6 tokens a second — 23 minutes —
  // before a word of description. A model that cannot think rejects the field; that is retried
  // without it below.
  body.think = THINK === "true"

  const t0 = Date.now()
  let j
  try {
    j = await postJsonNoTimeout(OLLAMA + "/api/chat", body)
  } catch (e) {
    if (!/think/i.test(e.message)) throw e
    delete body.think
    j = await postJsonNoTimeout(OLLAMA + "/api/chat", body)
  }
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
  log(`Vectis Hub office PC bridge ${VERSION} · ${WORKER} · ${HUB} · model ${MODEL} · photos ${MAX_PX > 0 ? `shrunk to ${MAX_PX} px` : "at full size"}`)
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
