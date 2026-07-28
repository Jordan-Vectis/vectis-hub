/* Vectis Photo Prep — batch crop + brighten worker.
 *
 * Runs off the main thread so a 1000-photo batch keeps the UI responsive.
 * One image in, one image out; the page runs several of these in parallel
 * (one per CPU core, capped) and only ever has a few images in flight, so
 * memory stays flat no matter how big the batch is.
 *
 * Lives in /public rather than being bundled so it can be created with a
 * plain `new Worker("/photo-prep-worker.js")` — no bundler/worker plugin
 * config needed.
 *
 * Message in:  { id, buffer (ArrayBuffer), type, name, settings }
 * Message out: { id, name, ok, buffer?, width?, height?, brightened?, meanBefore?, error? }
 *
 * Buffers are transferred (not copied) in both directions.
 */

// Luma coefficients (Rec. 709) — how bright a pixel looks to the eye.
const LR = 0.2126, LG = 0.7152, LB = 0.0722

// Never sample more than this many pixels when measuring exposure. Sampling
// is uniform across the image, so accuracy barely moves above ~50k while the
// cost of a full 24MP scan is very real.
const MAX_SAMPLES = 50_000

// Gamma floor. Anything stronger than this on a very dark frame produces a
// grey, noisy mess rather than a usable photo — better to under-correct and
// let the photographer see it than to silently wreck the shot.
const MIN_GAMMA = 0.35

self.onmessage = async (e) => {
  const { id, buffer, type, name, settings } = e.data

  try {
    const bmp = await createImageBitmap(new Blob([buffer], { type }))

    // ── Crop: take an equal percentage off all four edges ──────────────────
    const trim = Math.max(0, Math.min(45, settings.trimPct)) / 100
    const sx = Math.round(bmp.width  * trim)
    const sy = Math.round(bmp.height * trim)
    const sw = Math.max(1, bmp.width  - sx * 2)
    const sh = Math.max(1, bmp.height - sy * 2)

    const canvas = new OffscreenCanvas(sw, sh)
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh)
    bmp.close()

    // ── Brighten, but only the under-exposed ones ──────────────────────────
    let brightened = false
    let meanBefore = null

    if (settings.brighten) {
      const img  = ctx.getImageData(0, 0, sw, sh)
      const data = img.data
      const px   = data.length / 4

      // Step in whole pixels, then convert to a byte offset, so we always
      // land on a channel boundary.
      const stride = Math.max(1, Math.floor(px / MAX_SAMPLES)) * 4

      let sum = 0, n = 0
      for (let i = 0; i < data.length; i += stride) {
        sum += LR * data[i] + LG * data[i + 1] + LB * data[i + 2]
        n++
      }
      meanBefore = n > 0 ? sum / n : 0

      if (meanBefore < settings.darkThreshold && meanBefore > 0.5) {
        // Solve pow(mean/255, g) = target/255 for g. Because mean < target,
        // g lands below 1, which lifts shadows and midtones while leaving
        // pure white at 255 — so a white sweep stays white instead of going grey.
        const target = Math.max(meanBefore + 1, settings.targetLuma)
        let gamma = Math.log(target / 255) / Math.log(meanBefore / 255)
        gamma = Math.min(1, Math.max(MIN_GAMMA, gamma))

        if (gamma < 0.999) {
          // 256-entry lookup table — one pow() per level instead of per pixel.
          const lut = new Uint8ClampedArray(256)
          for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, gamma))

          for (let i = 0; i < data.length; i += 4) {
            data[i]     = lut[data[i]]
            data[i + 1] = lut[data[i + 1]]
            data[i + 2] = lut[data[i + 2]]
            // alpha untouched
          }
          ctx.putImageData(img, 0, 0)
          brightened = true
        }
      }
    }

    // Re-encode in the SAME format as the input so the filename — extension
    // included — stays byte-for-byte identical to what came in.
    const outType = settings.outType || "image/jpeg"
    const blob = await canvas.convertToBlob(
      outType === "image/png" ? { type: outType } : { type: outType, quality: settings.quality },
    )
    const outBuf = await blob.arrayBuffer()

    self.postMessage(
      { id, name, ok: true, buffer: outBuf, width: sw, height: sh, brightened, meanBefore },
      [outBuf],
    )
  } catch (err) {
    self.postMessage({ id, name, ok: false, error: String((err && err.message) || err) })
  }
}
