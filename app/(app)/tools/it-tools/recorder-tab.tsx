"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// ─── IT Tools → Screen Recorder ───────────────────────────────────────────────
//
// Press Record, pick a screen / window / tab in the browser's own picker, go and
// do whatever needs recording (the website, the trainers, BC — anything on the
// screen), come back and press Stop. The file uploads straight to R2 and joins
// the list below. Jordan (2026-09-04): "I just start the recording and its
// stored in the hub."
//
// ⚠ How it works, and the limits that follow from it:
//   - navigator.mediaDevices.getDisplayMedia + MediaRecorder. Desktop Chrome/Edge.
//     iOS Safari has no getDisplayMedia, so the iPads cannot do this — the page
//     says so rather than showing a Record button that does nothing.
//   - The recording lives in THIS tab's memory until it is saved. So: the page
//     keeps the component mounted while you switch IT Tools tabs (page.tsx), a
//     beforeunload guard covers closing/reloading while anything is unsaved, and
//     unmounting mid-recording stops and saves what was captured rather than
//     dropping it. In-Hub navigation still can't be blocked — the pop-out hides
//     the Hub bar so the recorder has nothing to click away to.
//   - A save can outlive its component (that unmount path). The guard and the
//     failure surface for an in-flight save therefore live at MODULE scope below,
//     not in state, and a save that fails after its component has gone is handed
//     to the next mount so retry / save-locally are still on offer.
//   - MediaRecorder only records the FIRST audio track. System audio (from the
//     picker's "share audio" tick) and the microphone are therefore mixed into
//     one track with an AudioContext, or a narration would be silently dropped.
//   - MP4 is preferred when the browser can produce it (Chrome 126+, Edge,
//     Safari) because Chrome's WebM carries no duration, which breaks the seek
//     bar. WebM is the fallback, with the standard seek-to-end trick on playback.
//   - The row is written only after the file is confirmed in R2. A retry after a
//     failed save re-uses the key already uploaded and just re-registers it — it
//     never re-uploads, so a failure can't leave a second copy in the bucket.
//   - An unsaved recording is never discarded until a NEW capture has actually
//     begun — and if its file had already reached storage, it is registered
//     (the POST is idempotent) so it lands in the list rather than sitting in
//     the bucket where nobody can see or delete it.

type Rec = {
  id: string; title: string; contentType: string
  sizeBytes: number; durationMs: number
  recordedByName: string; createdAt: string
}
type Phase = "idle" | "recording" | "uploading" | "saved" | "error"
type Held = { blob: Blob; durationMs: number }

// Best container first. Chrome only accepts video/mp4 with codecs on some versions.
const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
]
// Screen content compresses well; 2.5 Mbit/s is crisp at 1080p and ~1.1 GB an hour.
const VIDEO_BITRATE = 2_500_000
const POPOUT_URL = "/tools/it-tools?tab=recorder&popout=1"
const POPOUT_NAME = "vectis-recorder"

// ── Module scope: what has to outlive a component instance ───────────────────
// The unmount cleanup stops a live recorder and lets the save run on with no
// component behind it. Keep a reload guard up for exactly as long as any save is
// in flight, and keep hold of one that failed so the next mount can offer it back.
let pendingSaves = 0
const saveGuard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
function saveStarted() { if (pendingSaves++ === 0) window.addEventListener("beforeunload", saveGuard) }
function saveEnded()   { if (--pendingSaves <= 0) { pendingSaves = 0; window.removeEventListener("beforeunload", saveGuard) } }
let stranded: (Held & { key: string | null; title: string; error: string }) | null = null

const fmtDuration = (ms: number) => {
  const s = Math.round(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60)
  const mm = String(m % 60).padStart(2, "0"), ss = String(s % 60).padStart(2, "0")
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}
const fmtSize = (b: number) => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

// The XHR is handed back through xhrRef so a stalled upload can be cancelled —
// otherwise a 1 GB PUT on a dropped connection leaves nothing to press.
function putWithProgress(url: string, blob: Blob, contentType: string, onPct: (p: number) => void, xhrRef: { current: XMLHttpRequest | null }) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    xhr.open("PUT", url)
    xhr.setRequestHeader("Content-Type", contentType)   // must match the presigned ContentType exactly
    xhr.upload.onprogress = e => { if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => (xhr.status === 200 || xhr.status === 204) ? resolve() : reject(new Error(`Upload failed (${xhr.status})`))
    xhr.onerror = () => reject(new Error("Upload failed — check the connection and try again"))
    xhr.onabort = () => reject(new Error("Upload cancelled — the recording is still here"))
    xhr.onloadend = () => { if (xhrRef.current === xhr) xhrRef.current = null }
    xhr.send(blob)
  })
}

// Register a file that is already in storage. Idempotent on key server-side.
async function registerRecording(key: string, held: Held, type: string, title: string) {
  const s = await fetch("/api/it-tools/recordings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title.trim(), key, contentType: type, sizeBytes: held.blob.size, durationMs: held.durationMs }),
  })
  const sj = await s.json().catch(() => ({}))
  if (!s.ok) { const err = new Error(sj?.error ?? "Uploaded, but couldn't save it to the list") as Error & { status?: number }; err.status = s.status; throw err }
}

export default function RecorderTab({ popout = false, active = true }: { popout?: boolean; active?: boolean }) {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [phase, setPhase]         = useState<Phase>("idle")
  const [starting, setStarting]   = useState(false)    // picker / mic prompt is up — Record must not fire again
  const [registering, setRegistering] = useState(false) // PUT done, row being written — nothing left to cancel
  const [pendingDiscard, setPendingDiscard] = useState(false)
  const [title, setTitle]         = useState("")
  const [withMic, setWithMic]     = useState(false)
  const [elapsed, setElapsed]     = useState(0)
  const [bytes, setBytes]         = useState(0)
  const [uploadPct, setUploadPct] = useState(0)
  const [error, setError]         = useState<string | null>(null)
  const [notice, setNotice]       = useState<string | null>(null)   // amber: something to know, not a failure
  const [format, setFormat]       = useState("")
  const [hasUnsaved, setHasUnsaved] = useState(false)               // drives this instance's beforeunload guard
  const [list, setList]           = useState<Rec[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)   // the LIST failed to load
  const [actionError, setActionError] = useState<string | null>(null) // one row's Play/Delete failed — the list stays
  const [playing, setPlaying]     = useState<{ id: string; url: string } | null>(null)
  const [busyId, setBusyId]       = useState<string | null>(null)

  const recorderRef    = useRef<MediaRecorder | null>(null)
  const displayRef     = useRef<MediaStream | null>(null)
  const micRef         = useRef<MediaStream | null>(null)
  const audioCtxRef    = useRef<AudioContext | null>(null)
  const chunksRef      = useRef<Blob[]>([])
  const startedAtRef   = useRef(0)
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastBlobRef    = useRef<Held | null>(null)
  const uploadedKeyRef = useRef<string | null>(null)   // set once the PUT succeeds; a retry re-registers, never re-uploads
  const xhrRef         = useRef<XMLHttpRequest | null>(null)
  const popRef         = useRef<Window | null>(null)
  const startingRef    = useRef(false)                 // synchronous twin of `starting` — state lags a double-click
  const discardOnCaptureRef = useRef(false)            // "discard and record" was chosen; act on it only once capture begins
  const mountedRef     = useRef(true)
  // finish() runs from the closure of whichever render handled the click, so it
  // would post the title as it was THEN. Read the live value through a ref instead.
  const titleRef       = useRef("")
  titleRef.current = title

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined")
  }, [])

  const load = useCallback(async () => {
    setListError(null); setActionError(null)
    try {
      const r = await fetch("/api/it-tools/recordings")
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error ?? `Couldn't load the recordings (${r.status})`)
      setList(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setList(null)
      const msg = e?.message ?? "Couldn't load the recordings"
      setListError(/does not exist|relation|ScreenRecording/i.test(msg)
        ? `${msg} — has Run Migrations been done on this environment?`
        : msg)
    }
  }, [])
  useEffect(() => { load() }, [load])

  // Anything unsaved in THIS instance — recording, or a failed save held in memory.
  // (An in-flight save is guarded at module scope, because it may outlive us.)
  useEffect(() => {
    if (!hasUnsaved) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", h)
    return () => window.removeEventListener("beforeunload", h)
  }, [hasUnsaved])

  // The page keeps this mounted (hidden) while another tab shows, and display:none
  // does not pause a <video>. Close the player so narration doesn't carry on unseen.
  useEffect(() => { if (!active) setPlaying(null) }, [active])

  // Mount: pick up a save that failed after its component had gone. Unmount
  // mid-recording (a link elsewhere in the Hub): stop and let the save run — the
  // fetches complete even though this component is gone. Better than dropping it.
  useEffect(() => {
    mountedRef.current = true
    if (stranded) {
      const s = stranded; stranded = null
      lastBlobRef.current = { blob: s.blob, durationMs: s.durationMs }
      uploadedKeyRef.current = s.key
      setTitle(s.title); setHasUnsaved(true); setPhase("error")
      setError(`Your last recording wasn't saved: ${s.error}`)
    }
    return () => {
      mountedRef.current = false
      const rec = recorderRef.current
      if (rec && rec.state !== "inactive") rec.stop()
      else releaseStreams()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function releaseStreams() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    displayRef.current?.getTracks().forEach(t => t.stop()); displayRef.current = null
    micRef.current?.getTracks().forEach(t => t.stop());     micRef.current = null
    audioCtxRef.current?.close().catch(() => {});           audioCtxRef.current = null
  }

  // The Record button. With a failed save still in memory it asks first — INLINE,
  // not confirm(): a modal can outlive the click's transient activation (~5 s in
  // Chromium) and getDisplayMedia then refuses to open at all.
  function onRecordClick() {
    if (startingRef.current || phase === "recording" || phase === "uploading") return
    if (lastBlobRef.current) { setPendingDiscard(true); return }
    start()
  }
  function discardAndRecord() {
    setPendingDiscard(false)
    discardOnCaptureRef.current = true   // acted on only once a new capture has begun
    start()
  }

  async function start() {
    if (startingRef.current) return      // double-click, or a click while the mic prompt is up
    startingRef.current = true; setStarting(true)
    setNotice(null)
    try {
      let display: MediaStream
      try {
        // audio: true makes the picker offer "Share audio" (tab / system sound).
        display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true })
      } catch (e: any) {
        // Closing the picker and a system/policy block both arrive as NotAllowedError.
        // Say something either way — a Record button that does nothing reads as broken.
        if (e?.name === "NotAllowedError" || e?.name === "AbortError") {
          setNotice("Nothing was captured — the picker was closed, or screen capture is blocked on this computer (on a Mac, check System Settings → Privacy → Screen Recording).")
        } else if (e?.name === "InvalidStateError") {
          setNotice("Press Record again — the browser needs the picker opened straight after the click.")
        } else {
          setError(e?.message ?? "Couldn't start capturing the screen")
        }
        discardOnCaptureRef.current = false
        return
      }
      let mic: MediaStream | null = null
      if (withMic) {
        try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }) }
        catch { setNotice("Microphone not available — recording without it.") }
      }
      // The person may have pressed the browser's "Stop sharing" while the mic prompt was up.
      const video = display.getVideoTracks()[0]
      if (!video || video.readyState === "ended") {
        display.getTracks().forEach(t => t.stop()); mic?.getTracks().forEach(t => t.stop())
        setNotice("Screen sharing was stopped before recording began.")
        discardOnCaptureRef.current = false
        return
      }

      // One video track + at most ONE audio track (MediaRecorder ignores the rest).
      const tracks: MediaStreamTrack[] = [video]
      const audible = [display, mic].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0)
      let ctx: AudioContext | null = null
      if (audible.length === 1) tracks.push(audible[0].getAudioTracks()[0])
      else if (audible.length > 1) {
        ctx = new AudioContext()
        const dest = ctx.createMediaStreamDestination()
        for (const s of audible) ctx.createMediaStreamSource(s).connect(dest)
        tracks.push(dest.stream.getAudioTracks()[0])
      }

      const mimeType = MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported(t)) ?? ""
      let rec: MediaRecorder
      try {
        rec = new MediaRecorder(new MediaStream(tracks), { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: VIDEO_BITRATE })
        displayRef.current = display; micRef.current = mic; audioCtxRef.current = ctx; recorderRef.current = rec
        chunksRef.current = []
        setFormat((rec.mimeType || mimeType || "video/webm").split(";")[0])

        rec.ondataavailable = e => { if (e.data && e.data.size) { chunksRef.current.push(e.data); setBytes(b => b + e.data.size) } }
        // A notice, not the error: the recorder still emits its last chunk and stops,
        // and upload() clears `error` on its way in — the message would vanish and a
        // truncated file would be announced as "✓ Saved".
        rec.onerror = () => setNotice("The recorder stopped unexpectedly — saving what was captured so far.")
        rec.onstop = () => finish()
        // The browser's own "Stop sharing" bar ends the video track — treat it as Stop.
        video.addEventListener("ended", () => stop())

        rec.start(1000)
      } catch (e: any) {
        display.getTracks().forEach(t => t.stop()); mic?.getTracks().forEach(t => t.stop()); ctx?.close().catch(() => {})
        displayRef.current = null; micRef.current = null; audioCtxRef.current = null; recorderRef.current = null
        setError(e?.message ?? "This browser couldn't start a recorder")
        discardOnCaptureRef.current = false
        return
      }

      // Capture has begun — NOW the previous recording can go. If its file had
      // already reached storage, register it first (idempotent) so it lands in the
      // list where it can be seen and deleted, rather than sitting in the bucket
      // as an object nothing points at.
      const old = lastBlobRef.current, oldKey = uploadedKeyRef.current
      if (discardOnCaptureRef.current && old && oldKey) {
        registerRecording(oldKey, old, old.blob.type, titleRef.current || "Unsaved recording").then(() => load()).catch(() => {})
      }
      discardOnCaptureRef.current = false
      lastBlobRef.current = null; uploadedKeyRef.current = null
      setError(null); setBytes(0); setElapsed(0)
      startedAtRef.current = Date.now()
      timerRef.current = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 500)
      setHasUnsaved(true)
      setPhase("recording")
    } finally {
      startingRef.current = false; setStarting(false)
    }
  }

  function stop() {
    const rec = recorderRef.current
    if (rec && rec.state !== "inactive") rec.stop()   // → onstop → finish()
  }

  async function finish() {
    releaseStreams()
    const durationMs = Date.now() - startedAtRef.current
    const type = (recorderRef.current?.mimeType || format || "video/webm")
    const blob = new Blob(chunksRef.current, { type })
    chunksRef.current = []
    recorderRef.current = null
    if (!blob.size) { setPhase("error"); setError("Nothing was recorded."); setHasUnsaved(false); return }
    lastBlobRef.current = { blob, durationMs }
    await upload(blob, durationMs, type)
  }

  async function upload(blob: Blob, durationMs: number, type: string) {
    setPhase("uploading"); setUploadPct(0); setError(null); setRegistering(false)
    saveStarted()   // module-level reload guard — this may be running after unmount
    try {
      // Only PUT once. If the file already went up and it was the SAVE that
      // failed, skip straight to registering it again under the same key.
      let key = uploadedKeyRef.current
      if (!key) {
        const r = await fetch("/api/it-tools/recordings/upload-url", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: type, size: blob.size }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j?.error ?? "Couldn't get an upload link")
        await putWithProgress(j.url, blob, type, setUploadPct, xhrRef)
        key = j.key as string
        uploadedKeyRef.current = key
      } else {
        setUploadPct(100)
      }
      setRegistering(true)   // past the point where Cancel could do anything
      try {
        await registerRecording(key, { blob, durationMs }, type, titleRef.current)
      } catch (e: any) {
        // 409 = storage definitely hasn't got it, so re-registering the same key can
        // only ever 409 again. Forget the key so the retry uploads afresh.
        if (e?.status === 409) uploadedKeyRef.current = null
        throw e
      }
      lastBlobRef.current = null; uploadedKeyRef.current = null
      setHasUnsaved(false)
      setTitle("")
      setPhase("saved")
      await load()
    } catch (e: any) {
      // Keep the blob (and the key if the PUT succeeded): retry, or save it locally.
      const msg = e?.message ?? "Upload failed"
      setPhase("error"); setError(msg)
      // No component to show it on — hand it to the next one that mounts.
      if (!mountedRef.current) stranded = { blob, durationMs, key: uploadedKeyRef.current, title: titleRef.current, error: msg }
    } finally {
      setRegistering(false)
      saveEnded()
    }
  }

  function cancelUpload() { xhrRef.current?.abort() }   // → onabort → the catch above, blob kept

  function saveLocally() {
    const last = lastBlobRef.current
    if (!last) return
    const ext = last.blob.type.startsWith("video/mp4") ? "mp4" : "webm"
    const a = document.createElement("a")
    a.href = URL.createObjectURL(last.blob)
    a.download = `${(titleRef.current.trim() || "recording").replace(/[^\w.-]+/g, "_")}.${ext}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
  }

  async function play(rec: Rec) {
    if (playing?.id === rec.id) { setPlaying(null); return }
    setBusyId(rec.id); setActionError(null)
    try {
      const r = await fetch(`/api/it-tools/recordings/${rec.id}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error ?? "Couldn't open that recording")
      setPlaying({ id: rec.id, url: j.url })
    } catch (e: any) { setActionError(`${rec.title}: ${e?.message ?? "couldn't open it"}`) }
    setBusyId(null)
  }

  async function remove(rec: Rec) {
    if (!confirm(`Delete "${rec.title}"? This removes the file too and can't be undone.`)) return
    setBusyId(rec.id); setActionError(null)
    try {
      const r = await fetch(`/api/it-tools/recordings/${rec.id}`, { method: "DELETE" })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error ?? "Couldn't delete that recording")
      if (playing?.id === rec.id) setPlaying(null)
      await load()
    } catch (e: any) { setActionError(`${rec.title}: ${e?.message ?? "couldn't delete it"}`) }
    setBusyId(null)
  }

  function popOut() {
    if (popRef.current && !popRef.current.closed) { popRef.current.focus(); return }
    // popRef is per component instance, so after a RELOAD of this window it knows
    // nothing. Probe by NAME with an empty URL: an existing window in the same
    // browsing-context group is returned WITHOUT being navigated (which would
    // reload one mid-recording); a brand-new one opens on about:blank and is sent
    // to the recorder. ⚠ A separately opened Hub tab is a different group and
    // cannot see the pop-out — it will open a second one. No data is at risk.
    const w = window.open("", POPOUT_NAME, "popup,width=520,height=720")
    if (!w) { setError("Your browser blocked the pop-out window — allow pop-ups for the Hub and try again."); return }
    try { if (w.location.href === "about:blank") w.location.href = POPOUT_URL } catch { /* same-origin, so shouldn't throw */ }
    w.focus()
    popRef.current = w
  }

  // Chrome's WebM has no duration: force the browser to work it out so the seek bar works.
  function onMeta(e: React.SyntheticEvent<HTMLVideoElement>) {
    const v = e.currentTarget
    if (v.duration === Infinity || Number.isNaN(v.duration)) {
      v.currentTime = 1e101
      const back = () => { v.currentTime = 0; v.removeEventListener("timeupdate", back) }
      v.addEventListener("timeupdate", back)
    }
  }

  const busy = phase === "recording" || phase === "uploading" || starting
  const btn = "rounded-lg text-base font-semibold px-5 min-h-[48px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  const small = "min-h-[44px] px-3 rounded transition-colors disabled:opacity-40"

  return (
    <div className="space-y-6">

      {/* ── Recorder ── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-5">
        {!popout && (
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">🎥 Screen Recorder</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Record any screen, window or tab and keep it in the Hub. Press Record, pick what to capture, go and do the thing, come back and press Stop.
              </p>
            </div>
            <button onClick={popOut} disabled={busy || !supported} title="Open the recorder in a small window you can leave in the corner while you work"
              className={`${small} flex-shrink-0 text-sm border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-cyan-500 hover:text-cyan-600 dark:hover:text-cyan-400`}>
              ↗ Pop out
            </button>
          </div>
        )}

        {supported === false && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            This browser can't record the screen. Use <strong>Chrome or Edge on a computer</strong> — the iPads can't do this, it's a limit of iOS rather than the Hub. You can still play recordings below.
          </div>
        )}

        {supported && (
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-3">
              <label className="block">
                <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Title <span className="normal-case font-normal">(optional — the date and time is used otherwise)</span></span>
                <input value={title} onChange={e => setTitle(e.target.value)} disabled={busy} maxLength={120}
                  placeholder="e.g. Auto Clerk test, Scenario 1"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 py-3 text-base text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-cyan-500 disabled:opacity-60" />
              </label>
              <label className="inline-flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none min-h-[44px]">
                <input type="checkbox" checked={withMic} onChange={e => setWithMic(e.target.checked)} disabled={busy} className="w-6 h-6 accent-cyan-600" />
                <span>Include my microphone <span className="text-gray-500 dark:text-gray-400">(to talk over it — tick "Share audio" in the picker for the computer's own sound)</span></span>
              </label>
            </div>

            <div className="flex flex-col items-stretch gap-2 min-w-[220px]">
              {phase !== "recording" ? (
                <button onClick={onRecordClick} disabled={busy || pendingDiscard}
                  className={`${btn} bg-cyan-600 hover:bg-cyan-500 text-white`}>
                  {starting ? "Opening the picker…" : "⏺ Record"}
                </button>
              ) : (
                <button onClick={stop}
                  className={`${btn} border-2 border-red-500 text-red-600 dark:text-red-400 hover:bg-red-500/10`}>
                  ⏹ Stop &amp; save
                </button>
              )}
              {phase === "recording" && (
                <div className="flex items-center justify-center gap-2 text-sm font-mono text-gray-700 dark:text-gray-300" aria-live="polite">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" aria-hidden />
                  Recording {fmtDuration(elapsed)} · {fmtSize(bytes)}
                </div>
              )}
              {phase === "uploading" && (
                <div className="text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
                  <div className="flex justify-between mb-1"><span>{registering ? "Adding it to the list…" : "Saving to the Hub…"}</span><span className="font-mono">{uploadPct}%</span></div>
                  <div className="h-2 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden">
                    <div className="h-full bg-cyan-500 transition-all" style={{ width: `${uploadPct}%` }} />
                  </div>
                  {!registering && (
                    <button onClick={cancelUpload} className={`${small} mt-2 w-full text-xs border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-red-400 hover:text-red-600 dark:hover:text-red-400`}>
                      Cancel upload (keeps the recording)
                    </button>
                  )}
                </div>
              )}
              {phase === "saved" && (
                <p className="text-sm text-green-700 dark:text-green-400 text-center" aria-live="polite">✓ Saved — it's in the list below.</p>
              )}
              {format && phase !== "idle" && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 text-center">{format === "video/mp4" ? "MP4" : "WebM"}</p>
              )}
            </div>
          </div>
        )}

        {pendingDiscard && (
          <div className="mt-4 rounded-lg border border-amber-300 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-[200px]">The last recording hasn't been saved to the Hub. Start a new one?{uploadedKeyRef.current ? " Its file did reach storage, so it will be added to the list first." : " It will be discarded."}</span>
            <button onClick={discardAndRecord} className={`${small} border border-amber-500 font-semibold hover:bg-amber-500/10`}>⏺ Yes, record</button>
            <button onClick={() => setPendingDiscard(false)} className={`${small} border border-gray-400 dark:border-gray-600 hover:border-cyan-500`}>Keep it</button>
          </div>
        )}

        {notice && (
          <div className="mt-4 rounded-lg border border-amber-300 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            {notice}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-300 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-[200px]">⚠ {error}</span>
            {phase === "error" && lastBlobRef.current && (
              <>
                <button onClick={() => { const l = lastBlobRef.current!; upload(l.blob, l.durationMs, l.blob.type) }} disabled={starting}
                  className={`${small} border border-red-400 hover:bg-red-500/10`}>
                  {uploadedKeyRef.current ? "Try saving it again" : "Try the upload again"}
                </button>
                <button onClick={saveLocally} disabled={starting}
                  className={`${small} border border-gray-400 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:border-cyan-500`}>⬇ Save to this computer instead</button>
              </>
            )}
          </div>
        )}

        {phase === "recording" && (
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Keep this {popout ? "window" : "tab"} open while you record — clicking elsewhere in the Hub stops it and saves what it has. Pressing the browser's own "Stop sharing" also stops and saves.
          </p>
        )}
      </div>

      {/* ── Recordings ── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-2 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">Recordings{list ? ` (${list.length})` : ""}</h3>
          <button onClick={load} className={`${small} text-xs text-gray-500 hover:text-cyan-600 dark:hover:text-cyan-400`}>⟳ Refresh</button>
        </div>
        {actionError && (
          <p className="px-5 py-3 text-sm text-red-700 dark:text-red-300 border-b border-red-200 dark:border-red-900/50">⚠ {actionError}</p>
        )}
        {listError ? (
          <p className="px-5 py-4 text-sm text-red-700 dark:text-red-300">⚠ {listError}</p>
        ) : list === null ? (
          <p className="px-5 py-6 text-sm text-gray-500">Loading…</p>
        ) : list.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-500 dark:text-gray-400">No recordings yet. The first one you make will appear here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="px-5 py-2 font-semibold">Title</th>
                  <th className="px-3 py-2 font-semibold">By</th>
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold text-right">Length</th>
                  <th className="px-3 py-2 font-semibold text-right">Size</th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {list.map(rec => (
                  <RecordingRow key={rec.id} rec={rec} busy={busyId === rec.id}
                    playing={playing?.id === rec.id ? playing.url : null}
                    onPlay={() => play(rec)} onDelete={() => remove(rec)} onMeta={onMeta} small={small} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function RecordingRow({ rec, busy, playing, onPlay, onDelete, onMeta, small }: {
  rec: Rec; busy: boolean; playing: string | null
  onPlay: () => void; onDelete: () => void
  onMeta: (e: React.SyntheticEvent<HTMLVideoElement>) => void
  small: string
}) {
  return (
    <>
      <tr className="border-b border-gray-100 dark:border-gray-800/70 text-gray-800 dark:text-gray-200">
        <td className="px-5 py-3 font-medium">{rec.title}</td>
        <td className="px-3 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{rec.recordedByName}</td>
        <td className="px-3 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{fmtWhen(rec.createdAt)}</td>
        <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{fmtDuration(rec.durationMs)}</td>
        <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{fmtSize(rec.sizeBytes)}</td>
        <td className="px-3 py-1 whitespace-nowrap text-right">
          <button onClick={onPlay} disabled={busy}
            className={`${small} mr-2 border border-gray-300 dark:border-gray-700 hover:border-cyan-500 hover:text-cyan-600 dark:hover:text-cyan-400`}>
            {playing ? "✕ Close" : "▶ Play"}
          </button>
          <button onClick={onDelete} disabled={busy}
            className={`${small} border border-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-500/10`}>
            Delete
          </button>
        </td>
      </tr>
      {playing && (
        <tr className="border-b border-gray-100 dark:border-gray-800/70">
          <td colSpan={6} className="px-5 py-4 bg-gray-50 dark:bg-black/30">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={playing} controls autoPlay onLoadedMetadata={onMeta}
              className="w-full max-h-[70vh] rounded-lg bg-black" />
          </td>
        </tr>
      )}
    </>
  )
}
