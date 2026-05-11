// Loads the Vectis logo from /public/vectis-logo.svg and embeds it into a
// pdf-lib document. The SVG → PNG conversion runs once per process and is
// cached in memory.
//
// Used by the packer barcode sheet and the Collections Due PDF so both
// printouts share an identical branded header.

import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import type { PDFDocument, PDFImage } from "pdf-lib"

// At what raster resolution do we generate the PNG? Higher is sharper at
// large sizes but takes more memory. 1200px wide is plenty for an A4 header.
const RASTER_WIDTH = 1200

let cachedPngBuffer: Buffer | null = null

async function getLogoPngBuffer(): Promise<Buffer> {
  if (cachedPngBuffer) return cachedPngBuffer
  const svgPath = path.join(process.cwd(), "public", "vectis-logo.svg")
  const svg     = await fs.readFile(svgPath)
  // density=300 gives sharp text edges at the target render size
  const png = await sharp(svg, { density: 300 })
    .resize({ width: RASTER_WIDTH })
    .png({ compressionLevel: 9 })
    .toBuffer()
  cachedPngBuffer = png
  return png
}

// Embeds the logo into the given PDFDocument and returns a PDFImage handle.
// Cached per-doc inside a WeakMap so multiple draws on the same doc reuse
// the same embedded image stream (smaller files).
const docCache = new WeakMap<PDFDocument, PDFImage>()

export async function embedVectisLogo(doc: PDFDocument): Promise<PDFImage> {
  const cached = docCache.get(doc)
  if (cached) return cached
  const png    = await getLogoPngBuffer()
  const image  = await doc.embedPng(png)
  docCache.set(doc, image)
  return image
}
