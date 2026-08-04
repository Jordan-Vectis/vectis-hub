-- CreateTable
CREATE TABLE IF NOT EXISTS "BcSourceFile" (
    "id"         TEXT NOT NULL,
    "extension"  TEXT NOT NULL,
    "path"       TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "kind"       TEXT NOT NULL,
    "content"    TEXT NOT NULL,
    "size"       INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BcSourceFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BcSourceFile_path_key" ON "BcSourceFile"("path");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BcSourceFile_extension_idx" ON "BcSourceFile"("extension");

-- CreateTable
CREATE TABLE IF NOT EXISTS "BcSourceGuide" (
    "extension"   TEXT NOT NULL,
    "content"     TEXT NOT NULL,
    "model"       TEXT,
    "generatedBy" TEXT,
    "edited"      BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BcSourceGuide_pkey" PRIMARY KEY ("extension")
);
