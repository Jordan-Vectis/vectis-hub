-- The look of a banner slide — colours, placement, size, shade, extras — chosen in the Banner Manager.
ALTER TABLE "HeroSlide" ADD COLUMN IF NOT EXISTS "style" JSONB;
