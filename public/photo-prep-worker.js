/* Vectis Photo Prep — auto-crop to the product + brighten, off the main thread.
 *
 * CROP. Every product fills a different amount of the frame, so the crop is
 * worked out per photo rather than being a fixed trim:
 *   1. Downscale a copy to ~500px for analysis (fast, and averages out sensor noise).
 *   2. Read the backdrop colour from a ring of border pixels — each photo teaches
 *      us its own sweep colour, so white, grey and beige all work.
 *   3. Mark a pixel as product if it is far enough off that colour — OR if it
 *      sits on a crisp edge, which is the only clue white packaging on a white
 *      sweep gives. Pixels that are just the backdrop with the light taken away
 *      (a cast shadow: same colour, scaled down, soft-edged) are excluded even
 *      when they are the highest-contrast thing in the frame.
 *   4. Group what's left into connected blobs, keep the biggest plus anything of
 *      comparable size, and take their combined bounds. Blobs (not raw min/max)
 *      mean a stray speck or a price tag at the edge can't blow the box out.
 *   5. Creep that box outwards, up to a limit, while pale-but-not-backdrop
 *      pixels keep running along its edge — this is the rest of the white lid.
 *   6. Scale the box back to full resolution and add an even margin.
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

// ── Shadow suppression ──────────────────────────────────────────────────────
// A cast shadow is the backdrop with the light taken away: the SAME colour,
// scaled down, with a SOFT edge. A product is a different colour, or has a
// crisp outline, or both. All three tests must agree before a pixel is thrown
// away as shadow.
//
// ⚠ The edge test is the one doing the real work. A neutral grey PRODUCT also
// reads as "the backdrop, darker" — but its boundary is a one-or-two pixel
// step where a shadow's penumbra is spread over many. So a smooth grey face
// can be dropped from the MIDDLE of a product while its outline survives, and
// the outline is what sets the crop box. Losing the fill costs nothing.
const SHADOW_RESID    = 18   // max L1 away from a pure darkening of the backdrop
const SHADOW_MIN_K    = 0.28 // darker than this is an object, not a shadow
const SHADOW_MAX_K    = 0.97 // above this it is effectively the backdrop itself
const SHADOW_MAX_EDGE = 34   // soft-edged; a product edge is far crisper

// A silhouette counts as product even when its colour barely differs from the
// backdrop. This is what keeps WHITE PACKAGING on a white sweep: the lit face
// of a white box can sit under 10 L1 units off a white sweep — both are near
// blown out — which is far below any colour threshold that is safe to use
// globally. Its outline is still a hard 1–2px step, and Sobel sees that.
const EDGE_MIN_BASE = 70   // at sensitivity 0; the slider takes up to 24 off it

// After the box is found, creep outwards while the next row/column still holds
// a meaningful RUN of pixels differing from the backdrop by more than the
// backdrop's own variation. Recovers the pale lid of a box whose printing was
// the only part with enough contrast to seed the mask. Bounded, so a leak into
// the sweep costs a bit of margin rather than the whole frame.
const GROW_MAX_FRAC = 0.18  // per side, as a share of the short edge
// ⚠ The run must be CONTIGUOUS, and this is the whole safety of the step. The
// edge of a real box is a solid line of product; the grain on a wooden bench is
// scattered pixels that happen to be off-backdrop. Counting them the same way
// let the box wander out across the bench — measured, not theoretical.
const GROW_MIN_RUN  = 0.25  // longest unbroken run, as a share of the box's own side

const clamp01 = (v) => Math.max(0, Math.min(1, v))

function percentile(arr, p) {
  if (!arr.length) return 0
  const a = arr.slice().sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))]
}

/**
 * Sobel edge magnitude, then a 3x3 maximum.
 *
 * The max pass thickens an edge to ~3px, which is what lets both tests above
 * read the same map: a faint silhouette survives as a CONNECTED line rather
 * than a dashed one, and a shadow is only called soft when nothing crisp is
 * anywhere near it.
 */
function edgeMap(lum, w, h) {
  const g = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const gx = -lum[p - w - 1] - 2 * lum[p - 1] - lum[p + w - 1]
               +  lum[p - w + 1] + 2 * lum[p + 1] + lum[p + w + 1]
      const gy = -lum[p - w - 1] - 2 * lum[p - w] - lum[p - w + 1]
               +  lum[p + w - 1] + 2 * lum[p + w] + lum[p + w + 1]
      g[p] = Math.abs(gx) + Math.abs(gy)
    }
  }
  const t = new Float32Array(w * h)   // horizontal max
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      let m = g[p]
      if (x > 0     && g[p - 1] > m) m = g[p - 1]
      if (x < w - 1 && g[p + 1] > m) m = g[p + 1]
      t[p] = m
    }
  }
  const out = new Float32Array(w * h) // vertical max
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      let m = t[p]
      if (y > 0     && t[p - w] > m) m = t[p - w]
      if (y < h - 1 && t[p + w] > m) m = t[p + w]
      out[p] = m
    }
  }
  return out
}

/** Separable 3x3 mean. Sensor noise averages away; a real offset survives. */
function blur3(src, w, h) {
  const t = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const a = x > 0 ? src[p - 1] : src[p]
      const b = x < w - 1 ? src[p + 1] : src[p]
      t[p] = (a + src[p] + b) / 3
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const a = y > 0 ? t[p - w] : t[p]
      const b = y < h - 1 ? t[p + w] : t[p]
      out[p] = (a + t[p] + b) / 3
    }
  }
  return out
}

/** One step of 4-connected dilation — reconnects an outline broken by noise. */
function dilate1(mask, w, h) {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (mask[p]
        || (x > 0     && mask[p - 1])
        || (x < w - 1 && mask[p + 1])
        || (y > 0     && mask[p - w])
        || (y < h - 1 && mask[p + w])) out[p] = 1
    }
  }
  return out
}

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
  // nearIdx is left pointing at whichever cluster won, so the shadow test below
  // can compare a pixel against the backdrop it actually sits on.
  let nearIdx = 0
  const distToBackdrop = (r, g, b) => {
    let best = Infinity, bi = 0
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i]
      const d = Math.abs(r - c.r) + Math.abs(g - c.g) + Math.abs(b - c.b)
      if (d < best) { best = d; bi = i }
    }
    nearIdx = bi
    return best
  }
  const clusterLum = clusters.map(c => LR * c.r + LG * c.g + LB * c.b)

  let dev = 0
  const borderDist = []
  for (let k = 0; k < bR.length; k++) {
    const d = distToBackdrop(bR[k], bG[k], bB[k])
    borderDist.push(d)
    dev += d
  }
  const mad = bR.length ? dev / bR.length : 0
  // The mean is dragged up by the product where it touches the border, so the
  // "how much does this backdrop wobble on its own" figure — which sets how far
  // off-backdrop a pale pixel must be before the box will creep onto it — comes
  // from a percentile instead.
  const madP = percentile(borderDist, 0.75)

  // 2. Threshold. sensitivity 0..100 -> tolerance; higher sensitivity = tighter
  //    crop (smaller tolerance, more pixels count as product). The range has to
  //    reach genuinely low: a white inner tray on a white sweep can sit only
  //    ~25 L1 units off the backdrop, and anything above that clips it away.
  //    Stray specks are handled by the projection threshold below, not here.
  const base = 75 - (sensitivity / 100) * 58        // 75 .. 17
  const tol  = Math.max(12, base + mad * 1.5)

  // Is this a plain, near-white sweep at all? Drives the exposure decision,
  // confidence, and whether the box is allowed to creep — a shot on a floor or
  // bench is neither a white reference nor a clean crop, and is better sent to
  // the AI pass than nudged about locally.
  const backdropLuma = LR * mR + LG * mG + LB * mB
  const chroma = Math.max(mR, mG, mB) - Math.min(mR, mG, mB)
  const sweepLike = chroma <= MAX_SWEEP_CHROMA && backdropLuma >= MIN_SWEEP_LUMA

  // The bar a pixel has to clear for the box to CREEP onto it once the product
  // has already been found next to it. Tied to the backdrop's own variation, so
  // a clean sweep lets the box reach much further into pale packaging than a
  // noisy or uneven one does.
  const weakTol = Math.max(8, Math.min(tol * 0.6, madP * 1.8 + 5))

  // Luma and edge maps. Both the shadow test and the silhouette test read them.
  const lum = new Float32Array(aw * ah)
  for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
    lum[p] = LR * data[i] + LG * data[i + 1] + LB * data[i + 2]
  }
  const edge = edgeMap(lum, aw, ah)

  // ⚠ The bar an edge has to clear is set by the BACKDROP'S OWN edge energy,
  // the same way the colour tolerance is set by its colour spread. Without
  // this, a shot on a WOODEN BENCH is a frame full of grain, every bit of it a
  // crisp edge, so the whole photo reads as product and nothing gets cropped —
  // measured, not theoretical. A clean sweep has almost no edge energy, so the
  // bar drops to the base and a faint white-on-white silhouette still counts.
  // A percentile (not the max) so the product where it crosses the ring can't
  // push the bar up on its own.
  const borderEdge = []
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      if (x >= band && x < aw - band && y >= band && y < ah - band) continue
      borderEdge.push(edge[y * aw + x])
    }
  }
  const edgeMin = Math.max(
    EDGE_MIN_BASE - (sensitivity / 100) * 24,        // 70 .. 46 on a clean sweep
    percentile(borderEdge, 0.90) * 1.6 + 8,
  )

  // 3. Foreground mask.
  //    Three ways a pixel is judged, not one:
  //      - far enough off the backdrop in COLOUR (the original test), or
  //      - sitting on a crisp EDGE, which is the only thing that gives away
  //        white packaging on a white sweep;
  //      - unless it is a SHADOW, which is neither, whatever its contrast.
  const mask     = new Uint8Array(aw * ah)     // product
  const isShad   = new Uint8Array(aw * ah)
  const distArr  = new Float32Array(aw * ah)
  let fg = 0, edgeOnly = 0, shadow = 0, borderBg = 0, borderTotal = 0
  let lumaSum = 0, lumaN = 0

  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const p = y * aw + x
      const i = p * 4
      const r = data[i], g = data[i + 1], b = data[i + 2]

      const dist = distToBackdrop(r, g, b)   // leaves nearIdx on the winning cluster
      const bc   = clusters[nearIdx]
      const bl   = clusterLum[nearIdx]

      // Shadow: this backdrop, scaled down, with nothing crisp nearby.
      let isShadow = false
      const k = bl > 1 ? lum[p] / bl : 1
      if (k >= SHADOW_MIN_K && k <= SHADOW_MAX_K && edge[p] < SHADOW_MAX_EDGE) {
        isShadow = Math.abs(r - bc.r * k) + Math.abs(g - bc.g * k) + Math.abs(b - bc.b * k) <= SHADOW_RESID
      }

      const byColour = dist > tol
      // Outlines only count on a sweep. That is where they are needed — pale
      // product against a pale backdrop — and on a bench or a floor the
      // backdrop supplies edges of its own, which drag the box outwards. The
      // colour test has plenty to work with on those shots.
      const byEdge   = sweepLike && edge[p] >= edgeMin
      const isFg     = !isShadow && (byColour || byEdge)

      const onBorder = x < band || y < band || x >= aw - band || y >= ah - band
      if (onBorder) { borderTotal++; if (!isFg) borderBg++ }
      if (isShadow) { shadow++; isShad[p] = 1 }
      distArr[p] = dist
      if (isFg) {
        mask[p] = 1
        fg++
        if (!byColour) edgeOnly++
        lumaSum += lum[p]
        lumaN++
      }
    }
  }

  const total = aw * ah
  const fgFrac = fg / total
  const borderBgFrac = borderTotal ? borderBg / borderTotal : 0

  // "Might be product" — only ever used to creep the box outwards, never to
  // find it. Measured on a SMOOTHED distance: a white lid can sit barely over
  // the bar, and per-pixel sensor noise dips enough of it back under to break
  // the unbroken run the creep asks for. Averaging first keeps the lid solid
  // without letting isolated noise count.
  const distSm = blur3(distArr, aw, ah)
  const weak = new Uint8Array(aw * ah)
  for (let p = 0; p < weak.length; p++) {
    if (mask[p] || (!isShad[p] && distSm[p] > weakTol)) weak[p] = 1
  }

  // Dropping shadow out of the middle of a smooth, neutral product can leave
  // its outline in pieces. One dilation step puts them back together before
  // they are measured as components, so no part of the lot is thrown away for
  // being "too small".
  //
  // Only when shadow was actually removed, though. On a busy backdrop — a
  // wooden bench — dilating merges specks of grain into the product and walks
  // the box outwards, and there is nothing there to repair.
  const solid = shadow > total * 0.002 ? dilate1(mask, aw, ah) : mask

  // 4. Connected components, so the crop can drop things that are separate from
  //    the lot — a wall behind the items, a price tag at the edge, a stray tool.
  //    A single global bounding box has to stretch around all of them.
  //    Components are found with an iterative flood fill (4-connected); the
  //    stack is explicit because recursion would blow up on a large blob.
  const labels = new Int32Array(aw * ah).fill(-1)
  const comps = []
  const stack = []

  for (let p = 0; p < solid.length; p++) {
    if (!solid[p] || labels[p] !== -1) continue
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

      if (qx > 0      && solid[q - 1]  && labels[q - 1]  === -1) { labels[q - 1]  = id; stack.push(q - 1) }
      if (qx < aw - 1 && solid[q + 1]  && labels[q + 1]  === -1) { labels[q + 1]  = id; stack.push(q + 1) }
      if (qy > 0      && solid[q - aw] && labels[q - aw] === -1) { labels[q - aw] = id; stack.push(q - aw) }
      if (qy < ah - 1 && solid[q + aw] && labels[q + aw] === -1) { labels[q + aw] = id; stack.push(q + aw) }
    }
    comps.push(c)
  }

  // A hairline running the whole way across the frame is a seam in the sweep,
  // the front edge of the bench, or the join between floor and wall — never a
  // lot. It only shows up now that crisp edges count as product, and left in it
  // would stretch the box to the full width of the shot.
  const isSeam = (c) => {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1
    return (w >= aw * 0.85 && h <= ah * 0.02) || (h >= ah * 0.85 && w <= aw * 0.02)
  }

  // Keep the biggest blob plus anything of comparable size — several items in
  // one lot must all survive — while dropping specks and small strays.
  //
  // ⚠ The size bar is still measured against the biggest blob INCLUDING any
  // seam. Measuring it against the biggest survivor instead lowers the bar the
  // moment a seam is dropped, which lets in specks that were previously too
  // small and widens the box — the opposite of what dropping it was for.
  let x0 = -1, x1 = -1, y0 = -1, y1 = -1
  if (comps.length > 0) {
    const biggest = comps.reduce((m, c) => (c.area > m.area ? c : m), comps[0])
    const keepFrom = Math.max(total * 0.0015, biggest.area * 0.12)
    for (const c of comps) {
      if (isSeam(c) || c.area < keepFrom) continue
      if (x0 < 0) { x0 = c.x0; y0 = c.y0; x1 = c.x1; y1 = c.y1; continue }
      if (c.x0 < x0) x0 = c.x0
      if (c.y0 < y0) y0 = c.y0
      if (c.x1 > x1) x1 = c.x1
      if (c.y1 > y1) y1 = c.y1
    }
  }

  const found = x0 >= 0 && y0 >= 0 && x1 > x0 && y1 > y0

  // 5. Creep outwards onto pale product the mask couldn't seed.
  //    The printing on a white box clears the colour threshold easily; the lid
  //    it is printed on does not, so the box used to stop at the artwork and
  //    slice the packaging off. Growing only where a real RUN of off-backdrop
  //    pixels sits against the edge of an already-found product — and only so
  //    far — recovers the lid without letting a single noisy pixel drag the
  //    crop out. Shadows are excluded from `weak`, so this never grows onto one.
  //    Only on a sweep. On a bench or a floor the backdrop has texture of its
  //    own for the creep to walk out across, and the shot is going to the AI
  //    pass anyway — this step exists for pale product on a plain sweep.
  let grew = 0
  if (found && sweepLike) {
    // Longest unbroken stretch of product down a column / along a row.
    const runCol = (x, a, b) => {
      let best = 0, run = 0
      for (let y = a; y <= b; y++) { run = weak[y * aw + x] ? run + 1 : 0; if (run > best) best = run }
      return best
    }
    const runRow = (y, a, b) => {
      let best = 0, run = 0
      for (let x = a; x <= b; x++) { run = weak[y * aw + x] ? run + 1 : 0; if (run > best) best = run }
      return best
    }

    const limit = Math.round(Math.min(aw, ah) * GROW_MAX_FRAC)
    for (let step = 0; step < limit; step++) {
      const needY = Math.max(3, Math.round((y1 - y0 + 1) * GROW_MIN_RUN))
      const needX = Math.max(3, Math.round((x1 - x0 + 1) * GROW_MIN_RUN))
      let moved = false

      if (x0 > 0        && runCol(x0 - 1, y0, y1) >= needY) { x0--; moved = true }
      if (x1 < aw - 1   && runCol(x1 + 1, y0, y1) >= needY) { x1++; moved = true }
      if (y0 > 0        && runRow(y0 - 1, x0, x1) >= needX) { y0--; moved = true }
      if (y1 < ah - 1   && runRow(y1 + 1, x0, x1) >= needX) { y1++; moved = true }

      if (!moved) break
      grew++
    }
  }

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
    // Found mostly by its outline — a pale item on a pale sweep. The crop is
    // usually right now, but this is precisely where it goes wrong, so it is
    // worth a second look in assist mode.
    if (fg > 0 && edgeOnly / fg > 0.55) confidence *= 0.6
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
    // Reported so a bad batch can be diagnosed from the results table rather
    // than by guessing which of the two passes misfired.
    shadowFrac:   total ? shadow / total : 0,
    edgeOnlyFrac: fg ? edgeOnly / fg : 0,
    grew,
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
    // ⚠ let, not const — the catastrophic-crop guard below zeroes this. As a
    // const the guard threw "Assignment to constant variable", so instead of
    // keeping the whole photo the photo failed outright.
    let confidence = forcedBox ? 1 : d.confidence

    // Nothing found — keep the whole frame rather than guessing.
    if (!box) box = { x0: 0, y0: 0, x1: 1, y1: 1 }

    // ⚠ Catastrophic-crop guard. A real batch produced an output containing
    // nothing but a stray orange fragment at the frame edge: on a white tag
    // against a white wall the fragment was the only thing with any contrast,
    // so it won the crop and the tag was discarded. Whatever the cause, a crop
    // this small is never right, and keeping the whole photo is recoverable
    // where a destroyed one is not.
    const boxArea = Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0)
    let cropRejected = false
    if (!forcedBox && boxArea < 0.05) {
      box = { x0: 0, y0: 0, x1: 1, y1: 1 }
      confidence = 0
      cropRejected = true
    }

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

    // rotateDeg is supplied for barcode tags, measured from the barcode itself.
    // Rotating about the CROP's centre and drawing the source offset by the same
    // amount means the tag ends up square inside the crop — and because the crop
    // is tight, the triangular gaps rotation normally leaves at the corners fall
    // outside it and never appear in the output.
    const rot = Number(settings.rotateDeg) || 0
    if (rot !== 0) {
      ctx.save()
      ctx.translate(sw / 2, sh / 2)
      ctx.rotate((rot * Math.PI) / 180)
      ctx.translate(-sw / 2, -sh / 2)
      ctx.drawImage(bmp, left, top, sw, sh, 0, 0, sw, sh)
      ctx.restore()
    } else {
      ctx.drawImage(bmp, left, top, sw, sh, 0, 0, sw, sh)
    }
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
        subjectLuma, backdropLuma, sweepLike, brightened, cropRejected, rotated: rot,
        shadowFrac: d.shadowFrac, edgeOnlyFrac: d.edgeOnlyFrac, grew: d.grew },
      [outBuf],
    )
  } catch (err) {
    self.postMessage({ rid, id, name, ok: false, error: String((err && err.message) || err) })
  }
}
