-- Databases → News: the article's own page — the real text (the feed's copy is flattened: tags
-- stripped, paragraphs collapsed, emojis dropped) and the pictures inside it.
ALTER TABLE "SiteNewsArticle" ADD COLUMN IF NOT EXISTS "bodyHtml" TEXT;
ALTER TABLE "SiteNewsArticle" ADD COLUMN IF NOT EXISTS "bodyImages" JSONB;
ALTER TABLE "SiteNewsArticle" ADD COLUMN IF NOT EXISTS "bodyImageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
