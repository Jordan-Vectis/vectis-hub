// Minimal type declarations for bwip-js. The package ships its own typings
// inside the bundle but Next's TS resolution doesn't find them — this
// declaration covers only the surface we actually use.

declare module "bwip-js" {
  interface BwipOptions {
    bcid:              string         // barcode type, e.g. "code128"
    text:              string         // payload encoded into the barcode
    scale?:            number
    height?:           number         // bar height in mm
    width?:            number         // bar width in mm
    includetext?:      boolean
    textxalign?:       string
    backgroundcolor?:  string         // hex without #, e.g. "FFFFFF"
    [k: string]:       any            // bwip-js accepts many other opts
  }

  function toBuffer(opts: BwipOptions): Promise<Buffer>

  const bwipjs: {
    toBuffer: typeof toBuffer
  }
  export default bwipjs
  export { toBuffer }
}
