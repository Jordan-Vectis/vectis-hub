// heic-decode ships no types. It decodes HEIC/HEIF with libheif compiled to WebAssembly — used by
// lib/heic.ts, because the prebuilt sharp cannot decode an iPhone's HEVC-compressed HEIC.
declare module "heic-decode" {
  interface DecodedImage {
    width: number
    height: number
    /** RGBA, 4 bytes per pixel */
    data: Uint8ClampedArray
  }
  function decode(options: { buffer: ArrayBuffer | ArrayBufferView }): Promise<DecodedImage>
  export = decode
}
