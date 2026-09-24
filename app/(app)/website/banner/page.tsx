import { getHeroSlides } from "@/lib/actions/hero-slides"
import { getSignedImageUrl } from "@/lib/r2"
import { parseSlideStyle } from "@/app/(site)/hero-style"
import BannerManager from "./banner-manager"

// The slides with a signed address for each picture (an hour's worth) — the public photo proxy
// never served banner keys, which is how uploads came back broken (2026-09-24) — and each one's
// look parsed from the JSON it is stored as.
export default async function BannerPage() {
  const slides = await getHeroSlides()
  const withPictures = await Promise.all(slides.map(async s => ({
    ...s,
    style: s.style ? parseSlideStyle(s.style) : null,
    imageUrl: s.imageKey ? await getSignedImageUrl(s.imageKey, 3600).catch(() => null) : null,
  })))
  return <BannerManager initialSlides={withPictures} />
}
