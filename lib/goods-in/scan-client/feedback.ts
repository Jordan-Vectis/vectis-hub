import { callPlugin, hasPlugin } from "./native"

// The handheld scanner — the beep and the buzz after every scan, so staff on a run of scans can keep
// their eyes on the shelf. Three tones, matching the banner's three colours:
//   ok    — one short high pip (green)
//   warn  — two middle pips (amber: nothing wrong, but read the screen)
//   error — a low buzz (red: that scan did NOT do what you wanted)
// and one more sound for a change of MODE that the ear must not mistake for a move:
//   set   — two rising pips (a location now stays set, or a check has begun: what comes next goes there)
// Web Audio for sound; the app's Haptics plugin when it has one, else navigator.vibrate. Silent
// wherever either is missing — no sound is never a reason to stop a scan.

export type Tone = "ok" | "warn" | "error"
/** What can be played: a banner's tone, or "set". */
export type Sound = Tone | "set"

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    if (typeof window === "undefined") return null
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx ??= new AC()
    if (ctx.state === "suspended") void ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

/** Browsers only let sound start after a tap or key — call this from one so the first scan's beep is heard. */
export function unlockSound() {
  audio()
}

/** Each pip's pitch in order, how long each lasts, and the gap between them. */
const TONES: Record<Sound, { freqs: number[]; type: OscillatorType; len: number; gap: number; vol: number }> = {
  ok: { freqs: [1320], type: "sine", len: 0.07, gap: 0, vol: 0.08 },
  warn: { freqs: [700, 700], type: "triangle", len: 0.09, gap: 0.06, vol: 0.12 },
  error: { freqs: [196], type: "square", len: 0.36, gap: 0, vol: 0.12 },
  set: { freqs: [880, 1320], type: "sine", len: 0.08, gap: 0.04, vol: 0.09 },
}

export function beep(tone: Sound) {
  try {
    const c = audio()
    if (!c) return
    const t0 = c.currentTime + 0.01
    const s = TONES[tone]
    for (let i = 0; i < s.freqs.length; i++) {
      const start = t0 + i * (s.len + s.gap)
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = s.type
      osc.frequency.value = s.freqs[i]
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(s.vol, start + 0.008)
      gain.gain.setValueAtTime(s.vol, start + s.len - 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + s.len)
      osc.connect(gain).connect(c.destination)
      osc.start(start)
      osc.stop(start + s.len + 0.01)
    }
  } catch {
    // Sound is a nicety.
  }
}

const BUZZ: Record<Sound, number[]> = { ok: [40], warn: [70, 60, 70], error: [220, 90, 220], set: [40, 40, 40] }

export function buzz(tone: Sound) {
  try {
    if (hasPlugin("Haptics")) {
      const pattern = BUZZ[tone]
      // The Haptics plugin vibrates once per call; a pattern is played as its pulses.
      let at = 0
      pattern.forEach((ms, i) => {
        if (i % 2 === 0) setTimeout(() => { void callPlugin("Haptics", "vibrate", { duration: ms }) }, at)
        at += ms
      })
      return
    }
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(BUZZ[tone])
  } catch {
    // Vibration is a nicety.
  }
}

/** Beep (when sound is on) and buzz (when vibrate is on — Settings → Sound & alerts). */
export function signal(tone: Sound, sound: boolean, vibrate = true) {
  if (sound) beep(tone)
  if (vibrate) buzz(tone)
}
