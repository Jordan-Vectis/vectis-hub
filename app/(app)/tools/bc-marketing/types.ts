export type Lot = {
  uniqueId:     string
  lotNo:        string | null
  currentLotNo: string | null
  description:  string | null      // BC short description (EVA_ShortDescription)
  category:     string | null
  subcategory:  string | null      // BC sub-category (EVA_ArticleSubcategoryCode)
  hammerPrice:  number | null
  lowEstimate:  number | null
  highEstimate: number | null
  auctionCode:  string | null
  auctionName:  string | null
  auctionDate:  string | null
  vendorNo?:    string | null
  vendorName?:  string | null

  // Enriched fields from CatalogueLot (when available — match by receiptUniqueId)
  catTitle?:        string | null   // Curated lot title (max 83 chars)
  catDescription?:  string | null   // Full cataloguer description
  catKeyPoints?:    string | null   // Bullet-list of key facts
  catCondition?:    string | null   // Condition note
  catSubCategory?:  string | null
  catBrand?:        string | null   // Manufacturer / brand
  catExtraDetails?: string | null
}

export type Draft = {
  id:            string
  title:         string
  contentType:   string
  content:       string
  status:        string
  publishedUrl:  string | null
  createdByName: string | null
  notes:         string | null
  lotsSnapshot:  any
  createdAt:     string
  updatedAt:     string
}

export type HashtagBank = {
  id:        string
  category:  string
  hashtags:  string[]
  updatedAt: string
}

export type Vendor = {
  vendorNo:   string
  vendorName: string
}

export type Sale = {
  auctionCode: string
  auctionName: string
  auctionDate: string
}

export const CONTENT_TYPES = [
  // Articles
  { value: "sale_highlight",   label: "Sale Highlight",      group: "Articles",       desc: "Top results from a sale" },
  { value: "news_story",       label: "News Story",          group: "Articles",       desc: "Vectis editorial style" },
  { value: "collectors_guide", label: "Collector's Guide",   group: "Articles",       desc: "Guide for enthusiasts" },
  { value: "market_report",    label: "Market Report",       group: "Articles",       desc: "Trends & price analysis" },
  { value: "preview_teaser",   label: "Preview Teaser",      group: "Articles",       desc: "Upcoming lots to watch" },
  { value: "year_in_review",   label: "Year in Review",      group: "Articles",       desc: "Annual retrospective" },
  // Email
  { value: "email_newsletter", label: "Email Newsletter",    group: "Email",          desc: "Subject + body for subscribers" },
  // Social
  { value: "social_instagram", label: "Instagram Captions",  group: "Social",         desc: "5 caption variants + hashtags" },
  { value: "social_facebook",  label: "Facebook Posts",      group: "Social",         desc: "3 post variants" },
  { value: "social_twitter",   label: "Twitter / X Posts",   group: "Social",         desc: "5 short post variants" },
  { value: "carousel_pack",    label: "IG Carousel Pack",    group: "Social",         desc: "5–10 slides from a sale" },
  // PR / formal
  { value: "press_release",    label: "Press Release",       group: "PR / Formal",    desc: "Trade press format" },
  { value: "vendor_summary",   label: "Vendor Summary",      group: "PR / Formal",    desc: "Result summary for consignor" },
  // Helpers
  { value: "headline_pack",    label: "Headline Pack",       group: "Helpers",        desc: "10 alternative headlines" },
  { value: "alt_text",         label: "Alt-text & Meta",     group: "Helpers",        desc: "SEO image alt + meta descriptions" },
  { value: "catalogue_blurb",  label: "Catalogue Blurbs",    group: "Helpers",        desc: "Category intros for the catalogue" },
] as const

export const CONTENT_GROUPS = ["Articles", "Email", "Social", "PR / Formal", "Helpers"] as const

export const MONTHS = [
  { value: "01", label: "January" },   { value: "02", label: "February" },
  { value: "03", label: "March" },     { value: "04", label: "April" },
  { value: "05", label: "May" },       { value: "06", label: "June" },
  { value: "07", label: "July" },      { value: "08", label: "August" },
  { value: "09", label: "September" }, { value: "10", label: "October" },
  { value: "11", label: "November" },  { value: "12", label: "December" },
]

export const THIS_YEAR = new Date().getFullYear()
export const YEARS = Array.from({ length: 10 }, (_, i) => String(THIS_YEAR - i))

export function fmt(n: number | null | undefined) {
  if (n == null) return "—"
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 0 })
}

export function htmlToPlain(html: string) {
  return html
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "$1\n\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "• $1\n")
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "$1")
    .replace(/<em[^>]*>(.*?)<\/em>/gi, "$1")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
