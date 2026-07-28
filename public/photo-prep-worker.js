/* Vectis Photo Prep — auto-crop to the product + brighten, off the main thread.
 *
 * CROP. Every product fills a different amount of the frame, so the crop is
 * worked out per photo rather than being a fixed trim:
 *   1. Downscale a copy to ~500px for analysis (fast, and averages out sensor noise).
 *   2. Read the backdrop colour from a ring of border pixels — each photo teaches
 *      us its own sweep colour, so white, grey and beige all work.
 *   3. Mark every pixel far enough from that colour as product.
 *   4. Take row/column projections and find the first/last line carrying a
 *      meaningful amount of product. Projections (not raw min/max) mean a few
 *      stray dark specks or a bit of dust can't blow the box out to the full frame.
 *   5. Scale the box back to full resolution and add an even margin.
 *
 * CONFIDENCE. The same pass scores how much it trusts the result — how uniform
 * the border was, how much of the frame the product covers, and how many edges
 * the box runs off. The page sends anything low-confidence to Gemini for a
 * proper look and re-runs it with mode "box".
 *
 * BRIGHTEN. Exposure is measured over the PRODUCT pixels only. Measuring the
 * whole frame reads the backdrop instead — a dark item on a white sweep averages
 * out bright and never gets lifted, which is exactly the bug this replaces.
 *
 * Message in:  { id, name, buffer, type, settings, forcedBox? }
 * Message out: { id, name, ok, buffer?, width?, height?, box?, confidence?,
 *                subjectLuma?, brightened?, error? }
 */

const LR = 0.2126, LG = 0.7152, LB = 0.0722

const ANALYSIS_MAX = 500   // long edge of the analysis copy, px
const MAX_GAIN     = 2.2   // ceiling on the exposure lift — beyond this a shot is too far gone to rescue

const clamp01 = (v) => Math.max(0, Math.min(1, v))

// ── Work out where the product is ───────────────────────────────────────────
function detect(bmp, sensitivity) {
  const scale = Math.min(1, ANALYSIS_MAX / Math.max(bmp.width, bmp.height))
  const aw = Math.max(8, Math.round(bmp.width  * scale))
  const ah = Math.max(8, Math.round(bmp.height * scale))

  const c  = new OffscreenCanvas(aw, ah)
  const cx = c.getContext("2d", { willReadFrequently: true })
  cx.drawImage(bmp, 0, 0, aw, ah)
  const data = cx.getImageData(0, 0, aw, ah).data

  const at = (x, y) => (y * aw + x) * 4

  // 1. Learn the backdrop from a border ring.
  const band = Math.max(2, Math.round(Math.min(aw, ah) * 0.04))
  const bR = [], bG = [], bB = []
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      if (x >= band && x < aw - band && y >= band && y < ah - band) continue
      const i = at(x, y)
      bR.push(data[i]); bG.push(data[i + 1]); bB.push(data[i + 2])
    }
  }
  const median = (arr) => { const a = arr.slice().sort((p, q) => p - q); return a[a.length >> 1] || 0 }
  const mR = median(bR), mG = median(bG), mB = median(bB)

  // Spread of the border tells us how busy the background is.
  let dev = 0
  for (let k = 0; k < bR.length; k++) {
    dev += Math.abs(bR[k] - mR) + Math.abs(bG[k] - mG) + Math.abs(bB[k] - mB)
  }
  const mad = bR.length ? dev / bR.length : 0

  // 2. Threshold. sensitivity 0..100 -> tolerance; higher sensitivity = tighter
  //    crop (smaller tolerance, more pixels count as product). The range has to
  //    reach genuinely low: a white inner tray on a white sweep can sit only
  //    ~25 L1 units off the backdrop, and anything above that clips it away.
  //    Stray specks are handled by the projection threshold below, not here.
  const base = 75 - (sensitivity / 100) * 58        // 75 .. 17
  const tol  = Math.max(12, base + mad * 1.5)

  // 3. Foreground mask + projections.
  const colCount = new Uint32Array(aw)
  const rowCount = new Uint32Array(ah)
  let fg = 0, borderBg = 0, borderTotal = 0
  let lumaSum = 0, lumaN = 0

  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const i = at(x, y)
      const d = Math.abs(data[i] - mR) + Math.abs(data[i + 1] - mG) + Math.abs(data[i + 2] - mB)
      const isFg = d > tol
      const onBorder = x < band || y < band || x >= aw - band || y >= ah - band
      if (onBorder) { borderTotal++; if (!isFg) borderBg++ }
      if (isFg) {
        fg++
        colCount[x]++
        rowCount[y]++
        lumaSum += LR * data[i] + LG * data[i + 1] + LB * data[i + 2]
        lumaN++
      }
    }
  }

  const total   = aw * ah
  const fgFrac  = fg / total
  const borderBgFrac = borderTotal ? borderBg / borderTotal : 0

  // A line only counts if it carries a real amount of product — kills specks.
  const colMin = Math.max(1, Math.round(ah * 0.012))
  const rowMin = Math.max(1, Math.round(aw * 0.012))
  let x0 = -1, x1 = -1, y0 = -1, y1 = -1
  for (let x = 0; x < aw; x++)  if (colCount[x] >= colMin) { if (x0 < 0) x0 = x; x1 = x }
  for (let y = 0; y < ah; y++)  if (rowCount[y] >= rowMin) { if (y0 < 0) y0 = y; y1 = y }

  const found = x0 >= 0 && y0 >= 0 && x1 > x0 && y1 > y0

  // 4. Confidence.
  let confidence = 0
  if (found) {
    confidence = 1
    // Busy / non-uniform border means the "backdrop" wasn't really a backdrop.
    confidence *= clamp01((borderBgFrac - 0.72) / 0.2)
    // Product filling almost everything usually means detection failed.
    if (fgFrac > 0.6)   confidence *= clamp01((0.9 - fgFrac) / 0.3)
    if (fgFrac < 0.008) confidence = 0
    const touched = (x0 <= 1) + (y0 <= 1) + (x1 >= aw - 2) + (y1 >= ah - 2)
    if (touched >= 3)      confidence *= 0.25
    else if (touched === 2) confidence *= 0.7
    confidence = clamp01(confidence)
  }

  return {
    found,
    confidence,
    // Normalised 0..1 so it survives the rescale to full resolution, and maps
    // straight onto Gemini's 0–1000 box convention.
    box: found ? { x0: x0 / aw, y0: y0 / ah, x1: (x1 + 1) / aw, y1: (y1 + 1) / ah } : null,
    subjectLuma: lumaN > 0 ? lumaSum / lumaN : null,
    // THE exposure reference. On a white sweep the backdrop is a known target —
    // it should come out near-white, so if it renders grey the shot is
    // underexposed. Judging exposure by the PRODUCT instead is wrong: a navy
    // box is legitimately dark, and lifting it washes the colour out.
    backdropLuma: LR * mR + LG * mG + LB * mB,
    fgFrac,
    borderBgFrac,
  }
}

self.onmessage = async (e) => {
  const { rid, id, buffer, type, name, settings, forcedBox } = e.data

  try {
    const bmp = await createImageBitmap(new Blob([buffer], { type }))
    const W = bmp.width, H = bmp.height

    // ── Decide the crop box ────────────────────────────────────────────────
    // Always run detection: even when Gemini supplies the box we still want its
    // backdrop reading to judge exposure.
    const d = detect(bmp, settings.sensitivity)
    const subjectLuma  = d.subjectLuma
    const backdropLuma = d.backdropLuma

    // forcedBox is supplied by Gemini for a photo detection wasn't sure about.
    let box = forcedBox || d.box
    const confidence = forcedBox ? 1 : d.confidence

    // Nothing found — keep the whole frame rather than guessing.
    if (!box) box = { x0: 0, y0: 0, x1: 1, y1: 1 }

    // ── Apply the margin, in pixels, equal on all sides ────────────────────
    const m = Math.max(0, Math.min(50, settings.marginPct)) / 100
    let left   = box.x0 * W
    let top    = box.y0 * H
    let right  = box.x1 * W
    let bottom = box.y1 * H

    // Margin is a share of the product's own size, so a small item and a large
    // one both get proportionate breathing space.
    const padX = (right - left) * m
    const padY = (bottom - top) * m
    left   = Math.max(0, Math.floor(left   - padX))
    top    = Math.max(0, Math.floor(top    - padY))
    right  = Math.min(W, Math.ceil (right  + padX))
    bottom = Math.min(H, Math.ceil (bottom + padY))

    const sw = Math.max(1, right - left)
    const sh = Math.max(1, bottom - top)

    const canvas = new OffscreenCanvas(sw, sh)
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    ctx.drawImage(bmp, left, top, sw, sh, 0, 0, sw, sh)
    bmp.close()

    // ── Brighten, judged on how white the BACKDROP came out ────────────────
    // A dim sweep means the shot is underexposed; a dark product on a properly
    // white sweep does not. Lifting the backdrop back to white is the same move
    // as setting the white point by hand.
    //
    // ⚠ LINEAR GAIN, not gamma. Gamma lifts shadows disproportionately: bringing
    // a 205 backdrop to 245 needs gamma ~0.18, which drags a navy box at luma 40
    // up to ~133 — navy turns mid-blue and the colour is wrong. A linear gain of
    // 245/205 = 1.20 takes that same navy to 48: visibly lifted, still navy.
    // Auction photos are sold on colour accuracy, so proportion matters more
    // than punchiness. Do not "improve" this back into a gamma curve.
    let brightened = false
    if (settings.brighten) {
      const mean = backdropLuma

      if (mean != null && mean < settings.backdropThreshold && mean > 0.5) {
        const target = Math.max(mean + 1, settings.targetBackdrop)
        const gain = Math.min(MAX_GAIN, target / mean)

        if (gain > 1.01) {
          const lut = new Uint8ClampedArray(256)
          for (let v = 0; v < 256; v++) lut[v] = Math.round(v * gain)  // Uint8ClampedArray caps at 255
          const img = ctx.getImageData(0, 0, sw, sh)
          const d = img.data
          for (let i = 0; i < d.length; i += 4) {
            d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]
          }
          ctx.putImageData(img, 0, 0)
          brightened = true
        }
      }
    }

    // Same format in as out, so the filename and extension stay identical.
    const outType = settings.outType || "image/jpeg"
    const blob = await canvas.convertToBlob(
      outType === "image/png" ? { type: outType } : { type: outType, quality: settings.quality },
    )
    const outBuf = await blob.arrayBuffer()

    // rid is echoed so the page can match a reply to its request — several
    // previews can be in flight on one worker, and without it an older result
    // gets delivered to the newer request's handler.
    self.postMessage(
      { rid, id, name, ok: true, buffer: outBuf, width: sw, height: sh, box, confidence,
        subjectLuma, backdropLuma, brightened },
      [outBuf],
    )
  } catch (err) {
    self.postMessage({ rid, id, name, ok: false, error: String((err && err.message) || err) })
  }
}
