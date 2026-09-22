import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand,
  PutObjectCommand, S3Client, UploadPartCommand,
} from "@aws-sdk/client-s3"

// Writes one R2 object a piece at a time, so a file of any size can be built without ever
// holding it whole. Under one part it is a plain PutObject; over that it is a multipart upload.
//
// ⚠ R2 insists every part except the last is EXACTLY the same size (S3 only asks for ≥ 5 MB), so
// parts are cut at precisely `partSize` bytes and the remainder carried into the next one.
// ⚠ `write()` awaits the upload when a part is full — that is the backpressure. Call it in a
// plain loop and never fire several writes at once.
export class R2MultipartWriter {
  private chunks: Buffer[] = []
  private held = 0
  private uploadId: string | undefined
  private partNo = 0
  private parts: { ETag: string; PartNumber: number }[] = []
  private closed = false
  /** Bytes accepted so far. */
  bytes = 0

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    readonly key: string,
    private readonly contentType: string,
    private readonly partSize = 8 * 1024 * 1024,
  ) {}

  async write(chunk: string | Buffer): Promise<void> {
    if (this.closed) throw new Error("write after close")
    const b = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
    if (!b.length) return
    this.chunks.push(b)
    this.held += b.length
    this.bytes += b.length
    while (this.held >= this.partSize) {
      const all = Buffer.concat(this.chunks)
      const part = all.subarray(0, this.partSize)
      const rest = all.subarray(this.partSize)
      this.chunks = rest.length ? [Buffer.from(rest)] : []
      this.held = rest.length
      await this.uploadPart(Buffer.from(part))
    }
  }

  private async uploadPart(body: Buffer): Promise<void> {
    if (!this.uploadId) {
      const r = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: this.key, ContentType: this.contentType }))
      if (!r.UploadId) throw new Error("R2 gave no upload id")
      this.uploadId = r.UploadId
    }
    const PartNumber = ++this.partNo
    const r = await this.client.send(new UploadPartCommand({ Bucket: this.bucket, Key: this.key, UploadId: this.uploadId, PartNumber, Body: body }))
    if (!r.ETag) throw new Error(`R2 gave no ETag for part ${PartNumber}`)
    this.parts.push({ ETag: r.ETag, PartNumber })
  }

  /** Finishes the object and returns its size in bytes. */
  async close(): Promise<number> {
    if (this.closed) return this.bytes
    this.closed = true
    const tail = Buffer.concat(this.chunks)
    this.chunks = []
    this.held = 0
    if (!this.uploadId) {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key, Body: tail, ContentType: this.contentType }))
      return this.bytes
    }
    if (tail.length) await this.uploadPart(tail)
    await this.client.send(new CompleteMultipartUploadCommand({
      Bucket: this.bucket, Key: this.key, UploadId: this.uploadId, MultipartUpload: { Parts: this.parts },
    }))
    return this.bytes
  }

  /** Throws the object away — nothing of a half-written file is left behind. */
  async abort(): Promise<void> {
    this.closed = true
    this.chunks = []
    this.held = 0
    if (!this.uploadId) return
    try {
      await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: this.key, UploadId: this.uploadId }))
    } catch { /* an abandoned upload is tidied by the bucket's own lifecycle */ }
  }
}
