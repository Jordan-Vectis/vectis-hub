import { Barlow } from "next/font/google"

// vectis.co.uk is set in Barlow (Google Fonts, weights 400–800). Loaded the way the Hub loads Geist
// (next/font/google — fetched at build time and served from the Hub itself, so the site never
// depends on Google at run time). ONE font object, so every place that draws site markup outside
// the site layout (the editor canvas, /site-block, the Banner Manager preview) can carry the same
// --font-barlow variable that site.css reads.
export const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-barlow",
  display: "swap",
})
