-- Databases → News: the website's department pages (the Departments menu), collected on an office
-- machine alongside the news; the test website's /departments pages read it.
CREATE TABLE IF NOT EXISTS "SiteDepartment" (
  "slug"          TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "order"         INTEGER NOT NULL DEFAULT 0,
  "siteLink"      TEXT,
  "pageTitle"     TEXT,
  "heading"       TEXT,
  "heroPath"      TEXT,
  "heroKey"       TEXT,
  "tilePath"      TEXT,
  "tileKey"       TEXT,
  "copyHtml"      TEXT,
  "highlights"    JSONB,
  "highlightKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "newsAliases"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "newsCategory"  TEXT,
  "saleKeywords"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "siteSaleIds"   INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "pulledAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteDepartment_pkey" PRIMARY KEY ("slug")
);
