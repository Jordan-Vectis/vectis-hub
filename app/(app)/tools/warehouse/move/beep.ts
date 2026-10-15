// A short low "uh-oh" from the device's speaker when a scan goes wrong. Most hand scanners beep on
// every good read, so the screen only sounds on a PROBLEM — staff on a run of scans are looking at
// the totes, not the iPad, and need to know to look up. Silent wherever audio isn't available.

let ctx: AudioContext | null = null

export function errorBeep() {
  try {
    if (typeof window === "undefined") return
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx ??= new AC()
    if (ctx.state === "suspended") void ctx.resume()
    const t = ctx.currentTime
    ;[330, 220].forEach((freq, i) => {
      const start = t + i * 0.18
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.type = "square"
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(start)
      osc.stop(start + 0.17)
    })
  } catch {
    // No sound is never a reason to stop the scan.
  }
}
