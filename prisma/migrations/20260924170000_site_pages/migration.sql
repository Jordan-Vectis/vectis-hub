-- The test website's page editor (Website → Pages): each page's blocks as JSON, and every publish kept.
CREATE TABLE IF NOT EXISTS "SitePage" (
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "draft" JSONB,
    "published" JSONB,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    CONSTRAINT "SitePage_pkey" PRIMARY KEY ("slug")
);

CREATE TABLE IF NOT EXISTS "SitePageVersion" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedBy" TEXT,
    CONSTRAINT "SitePageVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SitePageVersion_slug_publishedAt_idx" ON "SitePageVersion"("slug", "publishedAt");

DO $$ BEGIN
  ALTER TABLE "SitePageVersion" ADD CONSTRAINT "SitePageVersion_slug_fkey" FOREIGN KEY ("slug") REFERENCES "SitePage"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
