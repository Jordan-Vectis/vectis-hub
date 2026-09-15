import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { isVideoKey, jpegCopyKey, mediaViewUrl, needsJpegCopy, videoCopyKey } from "@/lib/media"

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
})

export async function uploadToR2(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const key = `submissions/${Date.now()}-${filename}`

  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )

  return key
}

export async function uploadBufferToR2(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )
  return key
}

export async function deleteObjectsFromR2(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    await r2.send(new DeleteObjectsCommand({
      Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      Delete: { Objects: batch.map(k => ({ Key: k })), Quiet: true },
    }))
  }
}

export async function getSignedImageUrl(key: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
    Key: key,
  })
  return getSignedUrl(r2, command, { expiresIn })
}

/** A link a browser can SHOW or PLAY. An image it can't display by itself (iPhone HEIC, scanner TIFF,
 *  camera RAW) goes to its JPEG copy — or, when there isn't one yet, to /api/media/view, which makes
 *  it on first load; a video goes to its converted copy when one exists (lib/media-convert.ts,
 *  lib/video-convert.ts). For the original file itself — downloads, exports — use getSignedImageUrl. */
export async function getSignedViewUrl(key: string, expiresIn = 3600): Promise<string> {
  if (needsJpegCopy(key)) {
    const copy = jpegCopyKey(key)
    return (await objectExistsInR2(copy)) ? getSignedImageUrl(copy, expiresIn) : mediaViewUrl(key)
  }
  if (isVideoKey(key)) {
    const copy = videoCopyKey(key)
    if (await objectExistsInR2(copy)) return getSignedImageUrl(copy, expiresIn)
  }
  return getSignedImageUrl(key, expiresIn)
}

// Does an object exist in THIS environment's bucket? Used by the Accounts
// environment-transfer import to skip files that are already present (e.g.
// when staging and production share a bucket).
export async function objectExistsInR2(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: key }))
    return true
  } catch {
    return false
  }
}

/** The object as a Node stream — for files too big to hold in memory (the archive spreadsheet). */
export async function getObjectStream(key: string): Promise<import("node:stream").Readable> {
  const res = await r2.send(new GetObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET!, Key: key }))
  return res.Body as unknown as import("node:stream").Readable
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await r2.send(new GetObjectCommand({
    Bucket: process.env.CLOUDFLARE_R2_BUCKET!,
    Key: key,
  }))
  const bytes = await (res.Body as any).transformToByteArray()
  return Buffer.from(bytes)
}
