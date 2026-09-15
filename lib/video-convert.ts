import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { setPriority, tmpdir } from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { getObjectStream, objectExistsInR2, uploadBufferToR2 } from "@/lib/r2"
import { videoCopyKey } from "@/lib/media"

// ⚠⚠ Customers' phones record video the office PCs may not play — iPhones and Samsungs default to
// HEVC (H.265), which Chrome and Edge on Windows only play on some machines — plus the odd AVI, WMV or
// 3GP from an old camera (2026-09-15). Each video is checked ONCE, in the background: anything that
// isn't already H.264 in an MP4/MOV (or a WebM) gets an H.264 MP4 copy kept in R2 BESIDE the original
// (the same key plus ".mp4"); one that plays as it is gets a tiny "<key>.playable" marker instead, so
// it is never checked again. The original is never changed or deleted.
//
// ⚠ Converting video is heavy, and this server also runs the live sales. So: ONE video at a time,
// ffmpeg on two threads at the LOWEST CPU priority, the longer side capped at 1920, and given up after
// 30 minutes. ffmpeg comes from ffmpeg-static, which downloads the binary when npm installs it.

export type VideoState = "ready" | "original" | "failed" | "pending"

const playableMarker = (key: string) => `${key}.playable`
const failedMarker   = (key: string) => `${key}.failed`

const MAX_EDGE   = 1920
const TIMEOUT_MS = 30 * 60_000

/** What is known about this video: "ready" (a playable copy exists), "original" (it plays as it is),
 *  "failed" (it couldn't be converted — the original is still there to download) or "pending" (not
 *  checked yet). */
export async function videoState(key: string): Promise<VideoState> {
  const [copy, playable, failed] = await Promise.all([
    objectExistsInR2(videoCopyKey(key)),
    objectExistsInR2(playableMarker(key)),
    objectExistsInR2(failedMarker(key)),
  ])
  return copy ? "ready" : playable ? "original" : failed ? "failed" : "pending"
}

let queue: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.then(() => undefined, () => undefined)
  return run
}

const inFlight = new Map<string, Promise<VideoState>>()

/** Is this video being checked or converted on this server right now? */
export function isVideoBusy(key: string): boolean {
  return inFlight.has(key)
}

/** Check a video once and, if browsers won't play it, make the H.264 copy. Returns where it ended up. */
export function ensureVideoCopy(key: string): Promise<VideoState> {
  const pending = inFlight.get(key)
  if (pending) return pending
  const job = (async () => {
    const known = await videoState(key)
    if (known !== "pending") return known
    return oneAtATime(() => checkAndConvert(key))
  })().finally(() => inFlight.delete(key))
  inFlight.set(key, job)
  return job
}

/** The ffmpeg binary. Exported for testing. */
export async function ffmpegPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as unknown as { default?: unknown }
  const found = mod.default ?? mod
  if (typeof found !== "string" || !found) throw new Error("ffmpeg isn't available on this server")
  return found
}

/** ffmpeg couldn't read or convert the file itself — as opposed to storage or setup trouble, which is
 *  tried again next time. */
class ConvertError extends Error {}

async function checkAndConvert(key: string): Promise<VideoState> {
  const known = await videoState(key) // finished elsewhere while this one queued
  if (known !== "pending") return known

  const ffmpeg = await ffmpegPath()
  const dir = await mkdtemp(path.join(tmpdir(), "hub-video-"))
  const input = path.join(dir, `in${path.extname(key).toLowerCase() || ".bin"}`)
  const output = path.join(dir, "out.mp4")
  try {
    await pipeline(await getObjectStream(key), createWriteStream(input))
    const result = await prepareVideoFile(ffmpeg, input, output, key)
    if (result === "original") {
      await uploadBufferToR2(Buffer.from("plays as it is"), playableMarker(key), "text/plain")
      return "original"
    }
    await uploadBufferToR2(await readFile(output), videoCopyKey(key), "video/mp4")
    return "ready"
  } catch (e) {
    if (!(e instanceof ConvertError)) throw e
    console.error("[video] can't convert", key, e.message)
    await uploadBufferToR2(Buffer.from(e.message.slice(0, 2000)), failedMarker(key), "text/plain").catch(() => {})
    return "failed"
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Decide what a video file needs and, if browsers can't play it, write an H.264 copy to `output`.
 *  `name` supplies the extension. Returns "original" or "converted"; throws ConvertError when ffmpeg
 *  can't read or convert it. Exported for testing — local files only, no storage involved. */
export async function prepareVideoFile(ffmpeg: string, input: string, output: string, name: string): Promise<"original" | "converted"> {
  const info = await probe(ffmpeg, input)
  if (!info.video) throw new ConvertError("No video found in the file")
  if (playsAsIs(info, name)) return "original"
  try {
    await run(ffmpeg, transcodeArgs(input, output, info.hdr))
  } catch (e) {
    if (!info.hdr) throw e
    await run(ffmpeg, transcodeArgs(input, output, false)) // this ffmpeg can't tone-map — a plain copy instead
  }
  return "converted"
}

type Probe = { video: string | null; audio: string | null; videoLine: string; hdr: boolean }

/** Given no output, ffmpeg lists what the file holds and exits with an error — that is expected. */
async function probe(ffmpeg: string, input: string): Promise<Probe> {
  const { stderr } = await exec(ffmpeg, ["-hide_banner", "-nostdin", "-i", input], 60_000, true)
  const videoLine = /Stream #\S+.*?: Video: .*/.exec(stderr)?.[0] ?? ""
  return {
    video: /Video: (\w+)/.exec(videoLine)?.[1] ?? null,
    audio: /Stream #\S+.*?: Audio: (\w+)/.exec(stderr)?.[1] ?? null,
    videoLine,
    hdr: /arib-std-b67|smpte2084/i.test(videoLine), // HLG (iPhone HDR) or PQ
  }
}

/** Chrome, Edge and Safari all play 8-bit 4:2:0 H.264 with AAC or MP3 in an MP4/MOV, and VP8/VP9/AV1
 *  in a WebM. */
function playsAsIs(p: Probe, name: string): boolean {
  const ext = path.extname(name).slice(1).toLowerCase()
  if (ext === "webm") return ["vp8", "vp9", "av1"].includes(p.video ?? "")
  if (!["mp4", "m4v", "mov"].includes(ext)) return false
  if (p.video !== "h264" || /10le|12le|422|444/.test(p.videoLine)) return false
  return !p.audio || ["aac", "mp3"].includes(p.audio)
}

function transcodeArgs(input: string, output: string, toneMap: boolean): string[] {
  // The longer side at most MAX_EDGE, the other scaled to match (-2 keeps it even, as H.264 needs).
  const scale = `scale=w='if(gte(iw,ih),min(${MAX_EDGE},iw),-2)':h='if(gte(iw,ih),-2,min(${MAX_EDGE},ih))'`
  // iPhone "HDR" video (HLG) looks washed out if simply squashed into ordinary video — tone-map it.
  const hdr = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv"
  return [
    "-hide_banner", "-nostdin", "-y", "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", `${toneMap ? `${hdr},` : ""}${scale},format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    "-movflags", "+faststart", "-threads", "2",
    output,
  ]
}

const run = (ffmpeg: string, args: string[]) => exec(ffmpeg, args, TIMEOUT_MS)

/** Run ffmpeg at the lowest CPU priority, keeping the end of what it prints for the error message. */
function exec(ffmpeg: string, args: string[], timeoutMs: number, allowFail = false): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] })
    try {
      if (child.pid) setPriority(child.pid, 19)
    } catch {
      /* not allowed here — it runs at normal priority */
    }
    let stderr = ""
    child.stderr?.on("data", (d: Buffer) => { stderr = (stderr + d.toString()).slice(-20_000) })
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs)
    child.on("error", err => { clearTimeout(timer); reject(err) })
    child.on("close", code => {
      clearTimeout(timer)
      if (code === 0 || allowFail) return resolve({ stderr })
      const tail = stderr.split("\n").map(l => l.trim()).filter(Boolean).slice(-3).join(" · ")
      reject(new ConvertError(`ffmpeg stopped (${code ?? "timed out"}): ${tail}`))
    })
  })
}
