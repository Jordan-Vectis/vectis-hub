-- Databases → Departments: the department page's side box (video, text, prices-achieved picture)
-- and the pictures inside its copy.
ALTER TABLE "SiteDepartment" ADD COLUMN IF NOT EXISTS "sideHtml" TEXT;
ALTER TABLE "SiteDepartment" ADD COLUMN IF NOT EXISTS "extraImages" JSONB;
ALTER TABLE "SiteDepartment" ADD COLUMN IF NOT EXISTS "extraImageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
