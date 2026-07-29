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
const MAX_GAIN     = 1.55  // ceiling on the exposure lift

// A backdrop only counts as "a white sweep that came out dim" if it is both
// bright enough and neutral enough to have been white in the first place.
//
// ⚠ Without this, a shot taken on a CONCRETE FLOOR (measured luma ~154) is read
// as a badly underexposed sweep and lifted by ~1.6x, blowing the whole photo
// out. Grey concrete, a wooden bench or a coloured mat are not white references
// and their exposure must be left alone.
const MIN_SWEEP_LUMA   = 170  // below this it is a different surface, not a dim sweep
const MAX_SWEEP_CHROMA = 26   // max spread between R/G/B before it is "coloured", not neutral

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

  // A shot on the floor against a wall has TWO backdrops in one frame, and a
  // single median splits the difference — so the wall reads as "product" and
  // gets included in the crop. Split the border by brightness and, when the two
  // halves are genuinely distinct and both well represented, keep BOTH as
  // background. One cluster covers the plain-sweep case unchanged.
  const bL = bR.map((_, k) => LR * bR[k] + LG * bG[k] + LB * bB[k])
  const lo = [], hi = []
  const midL = (Math.min(...bL) + Math.max(...bL)) / 2
  for (let k = 0; k < bL.length; k++) (bL[k] < midL ? lo : hi).push(k)

  const clusters = [{ r: mR, g: mG, b: mB }]
  const share = Math.min(lo.length, hi.length) / bL.length
  if (share >= 0.15) {
    const pick = (idx, arr) => median(idx.map(k => arr[k]))
    const c1 = { r: pick(lo, bR), g: pick(lo, bG), b: pick(lo, bB) }
    const c2 = { r: pick(hi, bR), g: pick(hi, bG), b: pick(hi, bB) }
    const apart = Math.abs(c1.r - c2.r) + Math.abs(c1.g - c2.g) + Math.abs(c1.b - c2.b)
    if (apart > 60) { clusters.length = 0; clusters.push(c1, c2) }
  }

  // Spread of the border tells us how busy the background is — measured against
  // the nearest cluster, so a legitimate two-tone background isn't called busy.
  const distToBackdrop = (r, g, b) => {
    let best = Infinity
    for (const c of clusters) {
      const d = Math.abs(r - c.r) + Math.abs(g - c.g) + Math.abs(b - c.b)
      if (d < best) best = d
    }
    return best
  }
  let dev = 0
  for (let k = 0; k < bR.length; k++) dev += distToBackdrop(bR[k], bG[k], bB[k])
  const mad = bR.length ? dev / bR.length : 0

  // 2. Threshold. sensitivity 0..100 -> tolerance; higher sensitivity = tighter
  //    crop (smaller tolerance, more pixels count as product). The range has to
  //    reach genuinely low: a white inner tray on a white sweep can sit only
  //    ~25 L1 units off the backdrop, and anything above that clips it away.
  //    Stray specks are handled by the projection threshold below, not here.
  const base = 75 - (sensitivity / 100) * 58        // 75 .. 17
  const tol  = Math.max(12, base + mad * 1.5)

  // 3. Foreground mask.
  const mask = new Uint8Array(aw * ah)
  let fg = 0, borderBg = 0, borderTotal = 0
  let lumaSum = 0, lumaN = 0

  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const i = at(x, y)
      const isFg = distToBackdrop(data[i], data[i + 1], data[i + 2]) > tol
      const onBorder = x < band || y < band || x >= aw - band || y >= ah - band
      if (onBorder) { borderTotal++; if (!isFg) borderBg++ }
      if (isFg) {
        mask[y * aw + x] = 1
        fg++
        lumaSum += LR * data[i] + LG * data[i + 1] + LB * data[i + 2]
        lumaN++
      }
    }
  }

  const total = aw * ah
  const fgFrac = fg / total
  const borderBgFrac = borderTotal ? borderBg / borderTotal : 0

  // 4. Connected components, so the crop can drop things that are separate from
  //    the lot — a wall behind the items, a price tag at the edge, a stray tool.
  //    A single global bounding box has to stretch around all of them.
  //    Components are found with an iterative flood fill (4-connected); the
  //    stack is explicit because recursion would blow up on a large blob.
  const labels = new Int32Array(aw * ah).fill(-1)
  const comps = []
  const stack = []

  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || labels[p] !== -1) continue
    const id = comps.length
    const c = { area: 0, x0: aw, y0: ah, x1: -1, y1: -1 }
    stack.push(p); labels[p] = id

    while (stack.length) {
      const q = stack.pop()
      const qx = q % aw, qy = (q / aw) | 0
      c.area++
      if (qx < c.x0) c.x0 = qx
      if (qy < c.y0) c.y0 = qy
      if (qx > c.x1) c.x1 = qx
      if (qy > c.y1) c.y1 = qy

      if (qx > 0      && mask[q - 1]  && labels[q - 1]  === -1) { labels[q - 1]  = id; stack.push(q - 1) }
      if (qx < aw - 1 && mask[q + 1]  && labels[q + 1]  === -1) { labels[q + 1]  = id; stack.push(q + 1) }
      if (qy > 0      && mask[q - aw] && labels[q - aw] === -1) { labels[q - aw] = id; stack.push(q - aw) }
      if (qy < ah - 1 && mask[q + aw] && labels[q + aw] === -1) { labels[q + aw] = id; stack.push(q + aw) }
    }
    comps.push(c)
  }

  // Keep the biggest blob plus anything of comparable size — several items in
  // one lot must all survive — while dropping specks and small strays.
  let x0 = -1, x1 = -1, y0 = -1, y1 = -1
  if (comps.length > 0) {
    const biggest = comps.reduce((m, c) => (c.area > m.area ? c : m), comps[0])
    const keepFrom = Math.max(total * 0.0015, biggest.area * 0.12)
    for (const c of comps) {
      if (c.area < keepFrom) continue
      if (x0 < 0) { x0 = c.x0; y0 = c.y0; x1 = c.x1; y1 = c.y1; continue }
      if (c.x0 < x0) x0 = c.x0
      if (c.y0 < y0) y0 = c.y0
      if (c.x1 > x1) x1 = c.x1
      if (c.y1 > y1) y1 = c.y1
    }
  }

  const found = x0 >= 0 && y0 >= 0 && x1 > x0 && y1 > y0

  // Is this a plain, near-white sweep at all? Drives BOTH the exposure decision
  // and confidence — a shot on a floor or bench is neither a white reference
  // nor a clean crop, and is better sent to the AI pass.
  const backdropLuma = LR * mR + LG * mG + LB * mB
  const chroma = Math.max(mR, mG, mB) - Math.min(mR, mG, mB)
  const sweepLike = chroma <= MAX_SWEEP_CHROMA && backdropLuma >= MIN_SWEEP_LUMA

  // 4. Confidence.
  let confidence = 0
  if (found) {
    confidence = 1
    // Busy / non-uniform border means the "backdrop" wasn't really a backdrop.
    confidence *= clamp01((borderBgFrac - 0.72) / 0.2)
    // Not shot on a sweep — cartons on a floor, items on a bench. The crop may
    // still be usable, but it is worth a second look.
    if (!sweepLike) confidence *= 0.55
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
    // THE exposure reference — but only when sweepLike says it really is a
    // white sweep. It should come out near-white, so if it renders grey the
    // shot is underexposed. Judging exposure by the PRODUCT instead is wrong:
    // a navy box is legitimately dark, and lifting it washes the colour out.
    backdropLuma,
    sweepLike,
    fgFrac,
    borderBgFrac,
  }
}

self.onmessage = async (e) => {
  const { rid, id, buffer, type, name, settings, forcedBox } = e.data

  try {
    // ⚠ imageOrientation MUST be explicit. Cameras store the pixels unrotated
    // and record an EXIF orientation tag for viewers to honour — but re-encoding
    // through a canvas DROPS that tag. Decode without applying it and an upright
    // photo is written back sideways, because the tag is gone and the pixels
    // were never turned. The spec default for this option has changed across
    // browser versions, so it is pinned rather than assumed.
    const bmp = await createImageBitmap(new Blob([buffer], { type }), { imageOrientation: "from-image" })
    const W = bmp.width, H = bmp.height

    // ── Decide the crop box ────────────────────────────────────────────────
    // Always run detection: even when Gemini supplies the box we still want its
    // backdrop reading to judge exposure.
    const d = detect(bmp, settings.sensitivity)
    const subjectLuma  = d.subjectLuma
    const backdropLuma = d.backdropLuma
    const sweepLike    = d.sweepLike

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
    // sweepLike gate: without it, a shot on a concrete floor (~154) reads as a
    // dim sweep and gets lifted ~1.6x, blowing the photo out.
    let brightened = false
    if (settings.brighten && sweepLike) {
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
        subjectLuma, backdropLuma, sweepLike, brightened },
      [outBuf],
    )
  } catch (err) {
    self.postMessage({ rid, id, name, ok: false, error: String((err && err.message) || err) })
  }
}
