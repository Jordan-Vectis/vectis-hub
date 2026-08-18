// Measurements in key points: what counts as a mistake, and what emphatically does not.
//
// ⚠⚠ WE MEASURE THE ITEM. Jordan, 2026-08-17: *"I need the cataloguer mistake checker to not do
// this in the bears auctions it creates loads of flags because the size is different to the
// manufacturer but we re-measure it in case the bear has been cut or modified. It only needs to
// flag it if they put like 10 inches is 100cm or something like that."*
//
// A size in the key points is the cataloguer's own measurement of THAT item, taken with it in
// hand. Bears in particular get re-measured precisely BECAUSE one may have been cut down,
// re-stuffed or restored — so a size differing from the manufacturer's published specification
// is expected, and flagging it is noise that buries the real mistakes.
//
// The one measurement error worth anyone's time is the entry that contradicts ITSELF: a pair of
// units that cannot both be true. That is arithmetic, not judgement, so it is done here in code
// rather than asked of a model — models are unreliable at exactly this kind of sum.

import { codeSet } from "@/lib/product-codes"

const CM_PER_INCH = 2.54

export type MeasurementPair = {
  raw:      string   // as written, e.g. `16"/41cm`
  inches:   number
  cm:       number
  expected: number   // cm the inches convert to
  offBy:    number   // |cm − expected|
}

// `16"/41cm` · `15.5" / 39 cm` · `19in/48cm` · `10 inches (25cm)` · `13'' - 33cm`
const PAIR = /(\d+(?:\.\d+)?)\s*(?:"|''|”|in\b|ins\b|inch\b|inches\b)\s*[\s/,()x×–—-]*\s*(\d+(?:\.\d+)?)\s*cm\b/gi

/** Every inches↔cm pair stated together in the text. */
export function findMeasurementPairs(text: string): MeasurementPair[] {
  const out: MeasurementPair[] = []
  for (const m of (text ?? "").matchAll(PAIR)) {
    const inches = parseFloat(m[1])
    const cm     = parseFloat(m[2])
    if (!isFinite(inches) || !isFinite(cm) || inches <= 0 || cm <= 0) continue
    const expected = inches * CM_PER_INCH
    out.push({ raw: m[0].trim(), inches, cm, expected, offBy: Math.abs(cm - expected) })
  }
  return out
}

// ⚠ DELIBERATELY GENEROUS. Cataloguers round to the nearest centimetre (16" → 41cm is 0.36 out)
// and sometimes to the nearest five. The tolerance has to swallow all of that and still catch
// the errors that actually happen: a unit slip (10" written as 100cm — four times out),
// transposed digits (41 → 14), or a number from the wrong item. 20% does both. Tightening this
// re-creates the flood of pointless flags this exists to stop.
export const TOLERANCE_FRACTION = 0.2
export const TOLERANCE_FLOOR_CM = 2

export function pairContradicts(p: MeasurementPair): boolean {
  return p.offBy > Math.max(TOLERANCE_FLOOR_CM, p.expected * TOLERANCE_FRACTION)
}

/** Pairs whose two units cannot both be true — the only measurement error worth flagging. */
export function contradictoryMeasurements(text: string): MeasurementPair[] {
  return findMeasurementPairs(text).filter(pairContradicts)
}

// Does this flag note amount to "the size doesn't match the published specification"?
// Needs BOTH a measurement and spec-comparison language, so a note that merely mentions a size
// while reporting something else (a wrong product code, say) is left alone.
const SIZE_WORD = /\b(size|sizes|measure|measures|measured|measurement|measurements|height|tall|length|long|width)\b/i
// ⚠ A UNIT MUST BE SPELLED OUT here — no bare `"`. Flags quote the values they are disputing,
// so a closing quotation mark right after digits (`it should be "2150"`) read as an inches mark
// and turned two genuine product-code typos into "measurements". Both were being dropped when
// this was measured over the 104 live flags. An inch mark only counts inside a real pair, which
// findMeasurementPairs already requires a cm value for.
const UNIT_NUM  = /\d+(?:\.\d+)?\s*(?:cm|mm|in|ins|inch|inches)\b/i
const SPEC_WORD = /\b(manufacturer|manufacturer's|maker|maker's|specification|specifications|spec|specs|published|official|standard size|listed as|listed at|should measure|actually measures|catalogue lists|product page|retail listing|according to)\b/i

export function looksLikeSizeVsSpecFlag(note: string): boolean {
  const n = note ?? ""
  const aboutSize = SIZE_WORD.test(n) || UNIT_NUM.test(n) || findMeasurementPairs(n).length > 0
  return aboutSize && SPEC_WORD.test(n)
}

/**
 * The gate every cataloguer-mistake flag passes through before it reaches a lot.
 *
 * Drops a flag ONLY when it is a size-versus-specification complaint AND the cataloguer's own
 * measurements are internally consistent. A genuine self-contradiction ("10 inches / 100cm")
 * still gets through, and so does every flag about anything other than size.
 *
 * ⚠⚠ THE TWO-CODE TEST IS LOAD-BEARING. Measured against the 104 flags live at the time: a
 * note comparing ONE code's size to the manufacturer's is the noise to remove, but a note
 * saying "code CBCB232301B is a typo for CB232301B" mentions a size too — and dropping THAT
 * would bin a real, useful catch. A code complaint names the wrong code AND the right one, so
 * two or more distinct codes in the note means it is about a code, not a size. Without this
 * test, two of the five drops were genuine code typos.
 */
export function shouldKeepFlag(note: string | null | undefined, keyPoints: string | null | undefined): boolean {
  const n = (note ?? "").trim()
  if (!n) return false
  if (!looksLikeSizeVsSpecFlag(n)) return true
  // A real contradiction anywhere in the notes — or quoted in the flag itself — keeps it.
  if (contradictoryMeasurements(keyPoints ?? "").length > 0 || contradictoryMeasurements(n).length > 0) return true
  // Naming two different product codes makes this a code complaint that merely mentions a size.
  if (codeSet(n).size >= 2) return true
  return false
}
