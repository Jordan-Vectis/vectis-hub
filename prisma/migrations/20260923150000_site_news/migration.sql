-- Databases → News: every News & Stories article on vectis.co.uk — text and cover picture —
-- collected on an office machine (scripts/collect-news.mjs) and loaded on the page; the test
-- website's news pages read it.
CREATE TABLE IF NOT EXISTS "SiteNewsArticle" (
  "id"          INTEGER NOT NULL,
  "alias"       TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "sefLink"     TEXT,
  "categoryId"  INTEGER,
  "category"    TEXT,
  "tags"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "featured"    BOOLEAN NOT NULL DEFAULT false,
  "hits"        INTEGER NOT NULL DEFAULT 0,
  "introText"   TEXT,
  "fullText"    TEXT,
  "publishedAt" TIMESTAMP(3),
  "modifiedAt"  TIMESTAMP(3),
  "imagePath"   TEXT,
  "imageAlt"    TEXT,
  "imageKey"    TEXT,
  "imageAt"     TIMESTAMP(3),
  "pulledAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteNewsArticle_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SiteNewsArticle_publishedAt_idx" ON "SiteNewsArticle"("publishedAt");
CREATE INDEX IF NOT EXISTS "SiteNewsArticle_categoryId_idx" ON "SiteNewsArticle"("categoryId");
CREATE INDEX IF NOT EXISTS "SiteNewsArticle_alias_idx" ON "SiteNewsArticle"("alias");
