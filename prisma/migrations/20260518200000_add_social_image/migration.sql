-- CreateTable
CREATE TABLE "SocialImage" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "label" TEXT,
    "tags" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialImage_key_key" ON "SocialImage"("key");

-- CreateIndex
CREATE INDEX "SocialImage_createdAt_idx" ON "SocialImage"("createdAt");
