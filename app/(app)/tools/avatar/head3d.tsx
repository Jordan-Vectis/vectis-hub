"use client"

// 3D presenter for the AI Presenter page — a lip-synced TalkingHead avatar
// (vendored, see lib/talkinghead/README.md) voiced by Gemini TTS via
// /api/avatar/tts. Free to run, near-instant, no per-minute streaming cost —
// this is the replacement for the paid D-ID mode.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import { TalkingHead } from "@/lib/talkinghead/talkinghead.mjs"
import { LipsyncEn } from "@/lib/talkinghead/lipsync-en.mjs"

export type Head3DHandle = {
  /** Construct the engine and load the avatar. Call from a click so the AudioContext starts unlocked. */
  load: () => Promise<void>
  /** Speak a phrase; resolves when playback has finished. */
  speak: (text: string) => Promise<void>
  dispose: () => void
  isLoaded: () => boolean
}

type Props = {
  voice: string
  style: string
}

// Bundled CC0 avatar (see lib/talkinghead/README.md — the licence matters,
// and readyplayer.me is DNS-blocked on the company network, so never hot-load)
const AVATAR_URL = "/avatars/auctioneer.glb"

// Full teardown. The library's dispose() releases the WebGL context, renderer,
// ResizeObserver and audio nodes — stop() alone merely pauses, and browsers
// hard-cap live WebGL contexts, so reconnect/engine-switch would leak
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function teardown(h: any) {
  if (!h) return
  try { h.dispose() } catch { try { h.stop() } catch {} }
}

// The TTS route caps a request at 500 chars — split longer scripts on sentence
// boundaries so a pasted Manual Script speaks in full instead of erroring
function splitSpeakChunks(text: string, max = 450): string[] {
  const t = text.trim()
  if (!t) return []
  if (t.length <= max) return [t]
  const chunks: string[] = []
  let rest = t
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let cut = -1
    const re = /[.!?…]["')\]]?\s/g
    let m: RegExpExecArray | null
    while ((m = re.exec(window)) !== null) cut = m.index + m[0].length
    if (cut < 40) cut = window.lastIndexOf(", ") + 2
    if (cut < 40) cut = window.lastIndexOf(" ") + 1
    if (cut < 1)  cut = max
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

// Proportional word timing across the known audio duration. Digit-heavy tokens
// ("£1,250") are one token but many spoken words, so they get extra weight.
function timeWords(text: string, durationMs: number) {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return { words: [], wtimes: [], wdurations: [] }
  const weights = words.map((x) => (x.replace(/[^A-Za-z0-9]/g, "").length || 1) + (/\d/.test(x) ? 8 : 0))
  const total = weights.reduce((a, b) => a + b, 0)
  const lead = 80
  const tail = 150
  const span = Math.max(0, durationMs - lead - tail)
  let cum = 0
  const wtimes: number[] = []
  const wdurations: number[] = []
  for (const w of weights) {
    wtimes.push(Math.round(lead + (cum / total) * span))
    wdurations.push(Math.round((w / total) * span))
    cum += w
  }
  return { words, wtimes, wdurations }
}

const Head3D = forwardRef<Head3DHandle, Props>(function Head3D({ voice, style }, ref) {
  const nodeRef  = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headRef  = useRef<any>(null)
  const voiceRef = useRef(voice)
  const styleRef = useRef(style)
  useEffect(() => { voiceRef.current = voice }, [voice])
  useEffect(() => { styleRef.current = style }, [style])

  useEffect(() => () => {
    teardown(headRef.current)
    headRef.current = null
  }, [])

  useImperativeHandle(ref, () => ({
    isLoaded: () => !!headRef.current,

    async load() {
      if (headRef.current || !nodeRef.current) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const head: any = new TalkingHead(nodeRef.current, {
        ttsEndpoint:    "none",  // never used — speech arrives via speakAudio below
        lipsyncModules: [],      // its computed dynamic import breaks bundling — injected statically instead
        lipsyncLang:    "en",
        cameraView:     "upper",
        avatarMood:     "happy",
        modelFPS:       30,
      })
      head.lipsync["en"] = new LipsyncEn()
      headRef.current = head
      try {
        await head.showAvatar({ url: AVATAR_URL, body: "F", avatarMood: "happy", lipsyncLang: "en" })
      } catch (err) {
        teardown(head)
        if (headRef.current === head) headRef.current = null
        throw err
      }
      // dispose() ran while the avatar was downloading — free the orphan
      if (headRef.current !== head) teardown(head)
    },

    async speak(text: string) {
      const head = headRef.current
      if (!head) throw new Error("3D presenter is not loaded")

      for (const chunk of splitSpeakChunks(text)) {
        // The presenter may have been disconnected while an earlier chunk (or
        // the TTS fetch) was in flight — never speak through a dead head
        if (headRef.current !== head) return

        const res = await fetch("/api/avatar/tts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunk, voice: voiceRef.current, style: styleRef.current }),
          signal: AbortSignal.timeout(20_000),
        })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: `TTS HTTP ${res.status}` }))
          throw new Error(error ?? "TTS failed")
        }
        const { audio, sampleRate } = await res.json()
        if (headRef.current !== head) return

        // base64 → 16-bit LE PCM → AudioBuffer at the server-reported rate
        const bin   = atob(audio)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const pcm  = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2))
        const rate = Number(sampleRate) || 24_000
        if (!pcm.length) throw new Error("TTS returned empty audio")
        const buffer = head.audioCtx.createBuffer(1, pcm.length, rate)
        const ch = buffer.getChannelData(0)
        for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768
        const durationMs = Math.round((pcm.length / rate) * 1000)

        const { words, wtimes, wdurations } = timeWords(chunk, durationMs)

        await new Promise<void>((resolve) => {
          let done = false
          const finish = () => { if (!done) { done = true; resolve() } }
          // The end-marker fires exactly at playback end but runs on
          // requestAnimationFrame, which stalls when the window is hidden — the
          // duration timer guarantees a minimised window can never wedge the queue
          setTimeout(finish, durationMs + 700)
          head.speakAudio(
            { audio: buffer, words, wtimes, wdurations, markers: [finish], mtimes: [Math.max(0, durationMs - 10)] },
            { lipsyncLang: "en" },
          )
        })
      }
    },

    dispose() {
      teardown(headRef.current)
      headRef.current = null
      if (nodeRef.current) nodeRef.current.innerHTML = ""
    },
  }), [])

  return <div ref={nodeRef} className="absolute inset-0 w-full h-full" />
})

export default Head3D
