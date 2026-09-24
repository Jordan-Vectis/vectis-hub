-- Which part of a banner picture stays when it is cropped to the frame (top / center / bottom).
ALTER TABLE "HeroSlide" ADD COLUMN IF NOT EXISTS "imageFocus" TEXT;
