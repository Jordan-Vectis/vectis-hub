// Code 39 — the symbology of Vectis's Lot ID labels (the old Word mail merge set the barcode in the
// "Libre Barcode 39" font: *X160001*). PURE and client-safe: the label PDF draws these bars as
// vectors (lib/barcode-labels-pdf.ts) and the Barcodes page draws the same ones as a preview.
//
// Each character is 9 elements — bar, space, bar … bar — 3 of them wide; characters are joined by one
// narrow space, and the symbol starts and ends with "*". Wide = 3 × narrow, as in Libre Barcode 39
// (measured 2026-10-28: its "*" is 1 3 1 1 3 1 3 1 1 narrow units).

/** 1 = wide, in bar-space-bar… order. */
const PATTERNS: Record<string, string> = {
  "0": "000110100", "1": "100100001", "2": "001100001", "3": "101100000", "4": "000110001",
  "5": "100110000", "6": "001110000", "7": "000100101", "8": "100100100", "9": "001100100",
  A: "100001001", B: "001001001", C: "101001000", D: "000011001", E: "100011000", F: "001011000",
  G: "000001101", H: "100001100", I: "001001100", J: "000011100", K: "100000011", L: "001000011",
  M: "101000010", N: "000010011", O: "100010010", P: "001010010", Q: "000000111", R: "100000110",
  S: "001000110", T: "000010110", U: "110000001", V: "011000001", W: "111000000", X: "010010001",
  Y: "110010000", Z: "011010000", "-": "010000101", ".": "110000100", " ": "011000100",
  "$": "010101000", "/": "010100010", "+": "010001010", "%": "000101010", "*": "010010100",
}

/** Wide elements are this many narrow units. */
export const CODE39_RATIO = 3

/** Narrow units per character, with the narrow gap after it: 6 narrow + 3 wide + 1. */
export const CODE39_UNITS_PER_CHAR = 6 + 3 * CODE39_RATIO + 1

/** Text Code 39 can carry (upper case, digits, - . space $ / + %) — never "*", its start/stop. */
export const isCode39Text = (s: string): boolean => s.length > 0 && [...s].every((c) => c !== "*" && c in PATTERNS)

/**
 * The symbol for `text` (start/stop "*" added) as runs of narrow units, starting with a bar:
 * [bar, space, bar, …, bar]. Throws for text Code 39 can't carry.
 */
export function code39Runs(text: string): number[] {
  if (!isCode39Text(text)) throw new Error(`"${text}" can't be a Code 39 barcode.`)
  const runs: number[] = []
  const chars = [..."*" + text + "*"]
  chars.forEach((c, i) => {
    for (const bit of PATTERNS[c]) runs.push(bit === "1" ? CODE39_RATIO : 1)
    if (i < chars.length - 1) runs.push(1)   // the narrow gap between characters
  })
  return runs
}

/** The symbol's width in narrow units (no quiet zone). */
export const code39Units = (text: string): number => (text.length + 2) * CODE39_UNITS_PER_CHAR - 1
