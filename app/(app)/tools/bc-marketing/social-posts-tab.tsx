"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { format, addDays, isSameDay, isAfter, startOfDay } from "date-fns"

// ─── Special dates calendar ───────────────────────────────────────────────────

type SpecialDate = {
  tag:      string
  label:    string
  month:    number   // 1-based
  day:      number
  category: "collector" | "historical" | "general" | "seasonal"
  since?:   number   // year the thing started (for anniversary calc)
  emoji:    string
}

const SPECIAL_DATES: SpecialDate[] = [

  // ── ACTION FIGURES / ACTION MAN ──────────────────────────────────────────
  { tag: "ACTION_MAN",          label: "Action Man UK Launch Anniversary",           month: 2,  day: 1,  category: "collector",  since: 1966, emoji: "🪖" },
  { tag: "GI_JOE",              label: "G.I. Joe Launch Anniversary",                month: 2,  day: 1,  category: "collector",  since: 1964, emoji: "🪖" },
  { tag: "MOTU",                label: "Masters of the Universe Launch Anniversary", month: 5,  day: 1,  category: "collector",  since: 1982, emoji: "⚔️" },
  { tag: "TMNT",                label: "Teenage Mutant Ninja Turtles Anniversary",   month: 5,  day: 5,  category: "collector",  since: 1984, emoji: "🐢" },
  { tag: "MY_LITTLE_PONY",      label: "My Little Pony Launch Anniversary",          month: 10, day: 1,  category: "collector",  since: 1983, emoji: "🦄" },

  // ── AIRFIX & MODEL KITS ──────────────────────────────────────────────────
  { tag: "AIRFIX_FOUNDED",      label: "Airfix Founded Anniversary",                 month: 6,  day: 1,  category: "collector",  since: 1939, emoji: "✈️" },
  { tag: "AIRFIX_FIRST_KIT",    label: "Airfix First Plastic Kit Anniversary",       month: 6,  day: 1,  category: "collector",  since: 1952, emoji: "✈️" },
  { tag: "BATTLE_OF_BRITAIN",   label: "Battle of Britain Anniversary",              month: 7,  day: 10, category: "historical", since: 1940, emoji: "✈️" },
  { tag: "RAF_FOUNDED",         label: "RAF Founded Anniversary",                    month: 4,  day: 1,  category: "historical", since: 1918, emoji: "✈️" },

  // ── BARBIE / DOLLS ───────────────────────────────────────────────────────
  { tag: "BARBIE_BIRTHDAY",     label: "Barbie's Birthday",                          month: 3,  day: 9,  category: "collector",  since: 1959, emoji: "🎀" },
  { tag: "SINDY",               label: "Sindy Doll UK Launch Anniversary",           month: 1,  day: 25, category: "collector",  since: 1963, emoji: "👗" },
  { tag: "CABBAGE_PATCH",       label: "Cabbage Patch Kids Launch Anniversary",      month: 10, day: 1,  category: "collector",  since: 1982, emoji: "🌱" },

  // ── COMICS ───────────────────────────────────────────────────────────────
  { tag: "SUPERMAN",            label: "Superman First Appearance Anniversary",      month: 4,  day: 18, category: "collector",  since: 1938, emoji: "🦸" },
  { tag: "BATMAN",              label: "Batman First Appearance Anniversary",        month: 5,  day: 27, category: "collector",  since: 1939, emoji: "🦇" },
  { tag: "CAPTAIN_AMERICA",     label: "Captain America First Appearance",           month: 3,  day: 1,  category: "collector",  since: 1941, emoji: "🛡️" },
  { tag: "WONDER_WOMAN",        label: "Wonder Woman First Appearance",              month: 12, day: 1,  category: "collector",  since: 1941, emoji: "⚔️" },
  { tag: "SPIDERMAN",           label: "Spider-Man First Appearance Anniversary",    month: 8,  day: 10, category: "collector",  since: 1962, emoji: "🕷️" },
  { tag: "XMEN",                label: "X-Men First Appearance Anniversary",         month: 9,  day: 10, category: "collector",  since: 1963, emoji: "🧬" },
  { tag: "FREE_COMIC_DAY",      label: "Free Comic Book Day (1st Sat May)",          month: 5,  day: 3,  category: "collector",              emoji: "📚" },
  { tag: "STAN_LEE",            label: "Stan Lee's Birthday",                        month: 12, day: 28, category: "collector",  since: 1922, emoji: "✏️" },

  // ── CORGI / DINKY / VINTAGE DIECAST ─────────────────────────────────────
  { tag: "CORGI",               label: "Corgi Toys Founded Anniversary",             month: 7,  day: 9,  category: "collector",  since: 1956, emoji: "🚙" },
  { tag: "DINKY",               label: "Dinky Toys Founded Anniversary",             month: 4,  day: 1,  category: "collector",  since: 1934, emoji: "🚕" },
  { tag: "HOT_WHEELS",          label: "Hot Wheels Launch Anniversary",              month: 9,  day: 9,  category: "collector",  since: 1968, emoji: "🏎️" },
  { tag: "MATCHBOX",            label: "Matchbox Toys Founded Anniversary",          month: 6,  day: 19, category: "collector",  since: 1953, emoji: "🚗" },

  // ── LEGO ─────────────────────────────────────────────────────────────────
  { tag: "LEGO_FOUNDED",        label: "LEGO Company Founded Anniversary",           month: 8,  day: 10, category: "collector",  since: 1932, emoji: "🧱" },
  { tag: "LEGO_PATENT",         label: "LEGO Brick Patent Anniversary",              month: 1,  day: 28, category: "collector",  since: 1958, emoji: "🧱" },
  { tag: "LEGO_STAR_WARS",      label: "LEGO Star Wars Theme Launch Anniversary",   month: 1,  day: 1,  category: "collector",  since: 1999, emoji: "🧱" },

  // ── MILITARIA ────────────────────────────────────────────────────────────
  { tag: "WWI_START",           label: "WWI Outbreak Anniversary",                  month: 7,  day: 28, category: "historical", since: 1914, emoji: "🌹" },
  { tag: "ARMISTICE",           label: "Remembrance Day / Armistice Day (WWI End)", month: 11, day: 11, category: "historical",              emoji: "🌹" },
  { tag: "WWII_START",          label: "WWII Outbreak Anniversary",                 month: 9,  day: 1,  category: "historical", since: 1939, emoji: "🎖️" },
  { tag: "D_DAY",               label: "D-Day Anniversary",                         month: 6,  day: 6,  category: "historical", since: 1944, emoji: "⚓" },
  { tag: "VE_DAY",              label: "VE Day Anniversary",                        month: 5,  day: 8,  category: "historical", since: 1945, emoji: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { tag: "VJ_DAY",              label: "VJ Day (End of WWII in Pacific)",           month: 8,  day: 15, category: "historical", since: 1945, emoji: "🎖️" },
  { tag: "FALKLANDS",           label: "Falklands War Anniversary",                 month: 4,  day: 2,  category: "historical", since: 1982, emoji: "🎖️" },
  { tag: "WATERLOO",            label: "Battle of Waterloo Anniversary",            month: 6,  day: 18, category: "historical", since: 1815, emoji: "⚔️" },

  // ── MUSIC & MEMORABILIA ──────────────────────────────────────────────────
  { tag: "RECORD_STORE_DAY",    label: "Record Store Day (3rd Saturday April)",     month: 4,  day: 19, category: "seasonal",               emoji: "🎵" },
  { tag: "ELVIS_BIRTHDAY",      label: "Elvis Presley's Birthday",                  month: 1,  day: 8,  category: "collector",  since: 1935, emoji: "🎸" },
  { tag: "DAVID_BOWIE",         label: "David Bowie's Birthday",                    month: 1,  day: 8,  category: "collector",  since: 1947, emoji: "⭐" },
  { tag: "JOHN_LENNON",         label: "John Lennon's Birthday",                    month: 10, day: 9,  category: "collector",  since: 1940, emoji: "🎸" },
  { tag: "FREDDIE_MERCURY",     label: "Freddie Mercury's Birthday",                month: 9,  day: 5,  category: "collector",  since: 1946, emoji: "🎤" },
  { tag: "BEATLES_DEBUT",       label: "Beatles First UK Album Anniversary",        month: 3,  day: 22, category: "collector",  since: 1963, emoji: "🎸" },
  { tag: "ROLLING_STONES",      label: "Rolling Stones First Gig Anniversary",      month: 7,  day: 12, category: "collector",  since: 1962, emoji: "🎸" },

  // ── RETRO GAMING ─────────────────────────────────────────────────────────
  { tag: "SPACE_INVADERS",      label: "Space Invaders Launch Anniversary",         month: 6,  day: 1,  category: "collector",  since: 1978, emoji: "👾" },
  { tag: "PACMAN",              label: "Pac-Man Launch Anniversary",                month: 5,  day: 22, category: "collector",  since: 1980, emoji: "👾" },
  { tag: "ATARI_FOUNDED",       label: "Atari Founded Anniversary",                 month: 6,  day: 27, category: "collector",  since: 1972, emoji: "🕹️" },
  { tag: "GAMEBOY",             label: "Nintendo Game Boy Launch Anniversary",      month: 4,  day: 21, category: "collector",  since: 1989, emoji: "🎮" },
  { tag: "SUPER_MARIO",         label: "Super Mario Bros Launch Anniversary",       month: 9,  day: 13, category: "collector",  since: 1985, emoji: "🍄" },
  { tag: "SONIC",               label: "Sonic the Hedgehog Launch Anniversary",     month: 6,  day: 23, category: "collector",  since: 1991, emoji: "💨" },
  { tag: "TETRIS",              label: "Tetris Launch Anniversary",                 month: 6,  day: 6,  category: "collector",  since: 1984, emoji: "🟦" },
  { tag: "DONKEY_KONG",         label: "Donkey Kong Arcade Anniversary",            month: 7,  day: 9,  category: "collector",  since: 1981, emoji: "🦍" },

  // ── RETRO TOYS ───────────────────────────────────────────────────────────
  { tag: "WINNIE_POOH",         label: "Winnie the Pooh Book Anniversary",          month: 10, day: 14, category: "collector",  since: 1926, emoji: "🐻" },
  { tag: "PADDINGTON",          label: "Paddington Bear First Book Anniversary",    month: 10, day: 13, category: "collector",  since: 1958, emoji: "🐻" },
  { tag: "MECCANO",             label: "Meccano Founded Anniversary",               month: 9,  day: 13, category: "collector",  since: 1901, emoji: "🔧" },

  // ── SPORTS MEMORABILIA ───────────────────────────────────────────────────
  { tag: "ENGLAND_WORLD_CUP",   label: "England 1966 World Cup Win Anniversary",    month: 7,  day: 30, category: "historical", since: 1966, emoji: "⚽" },
  { tag: "FA_CUP_FINAL",        label: "FA Cup Final (approx. late May)",           month: 5,  day: 25, category: "seasonal",               emoji: "🏆" },
  { tag: "WIMBLEDON",           label: "Wimbledon Championships Begin",             month: 6,  day: 30, category: "seasonal",               emoji: "🎾" },
  { tag: "GRAND_NATIONAL",      label: "Grand National (approx. early April)",      month: 4,  day: 5,  category: "seasonal",               emoji: "🐎" },

  // ── STAR WARS ────────────────────────────────────────────────────────────
  { tag: "STAR_WARS_DAY",       label: "Star Wars Day (May the 4th)",               month: 5,  day: 4,  category: "collector",               emoji: "⭐" },
  { tag: "STAR_WARS_RELEASE",   label: "Star Wars Film Release Anniversary",        month: 5,  day: 25, category: "collector",  since: 1977, emoji: "🚀" },
  { tag: "EMPIRE_STRIKES_BACK", label: "The Empire Strikes Back Release Anniversary", month: 5, day: 21, category: "collector", since: 1980, emoji: "🚀" },
  { tag: "RETURN_JEDI",         label: "Return of the Jedi Release Anniversary",    month: 5,  day: 25, category: "collector",  since: 1983, emoji: "🚀" },

  // ── TEDDY BEARS ──────────────────────────────────────────────────────────
  { tag: "NATL_TEDDY_DAY",      label: "National Teddy Bear Day",                   month: 9,  day: 9,  category: "collector",               emoji: "🧸" },
  { tag: "INTL_TEDDY_DAY",      label: "International Teddy Bear Day",              month: 10, day: 27, category: "collector",               emoji: "🧸" },
  { tag: "STEIFF_FOUNDED",      label: "Steiff Company Founded Anniversary",        month: 1,  day: 1,  category: "collector",  since: 1880, emoji: "🧸" },
  { tag: "FIRST_TEDDY",         label: "First Teddy Bear Created Anniversary",      month: 11, day: 18, category: "collector",  since: 1902, emoji: "🧸" },

  // ── TRADING CARDS ────────────────────────────────────────────────────────
  { tag: "POKEMON_DAY",         label: "Pokémon Day (Red/Blue Japan Release)",      month: 2,  day: 27, category: "collector",  since: 1996, emoji: "⚡" },
  { tag: "POKEMON_CARDS",       label: "Pokémon TCG Launch Anniversary (Japan)",    month: 10, day: 20, category: "collector",  since: 1996, emoji: "⚡" },
  { tag: "POKEMON_CARDS_UK",    label: "Pokémon TCG UK/US Launch Anniversary",     month: 1,  day: 9,  category: "collector",  since: 1999, emoji: "⚡" },

  // ── TRAINS & MODEL RAILWAY ───────────────────────────────────────────────
  { tag: "FIRST_RAILWAY",       label: "First Public Steam Railway Anniversary (Stockton & Darlington)", month: 9, day: 27, category: "historical", since: 1825, emoji: "🚂" },
  { tag: "LIVPOOL_MANCH_RLY",   label: "Liverpool & Manchester Railway Anniversary", month: 9, day: 15, category: "historical", since: 1830, emoji: "🚂" },
  { tag: "HORNBY_TRAINS",       label: "Hornby Model Trains Founded Anniversary",   month: 1,  day: 1,  category: "collector",  since: 1920, emoji: "🚂" },
  { tag: "FLYING_SCOTSMAN",     label: "Flying Scotsman First Run Anniversary",     month: 4,  day: 11, category: "historical", since: 1923, emoji: "🚂" },
  { tag: "UNDERGROUND",         label: "London Underground Founded Anniversary",    month: 1,  day: 10, category: "historical", since: 1863, emoji: "🚇" },

  // ── TRANSFORMERS ─────────────────────────────────────────────────────────
  { tag: "TRANSFORMERS",        label: "Transformers TV Debut Anniversary",         month: 9,  day: 17, category: "collector",  since: 1984, emoji: "🤖" },

  // ── TV & FILM / PROPS ────────────────────────────────────────────────────
  { tag: "DOCTOR_WHO",          label: "Doctor Who Anniversary",                    month: 11, day: 23, category: "collector",  since: 1963, emoji: "🎭" },
  { tag: "THUNDERBIRDS",        label: "Thunderbirds First Aired Anniversary",      month: 9,  day: 30, category: "collector",  since: 1965, emoji: "🚀" },
  { tag: "STAR_TREK",           label: "Star Trek TV Debut Anniversary",            month: 9,  day: 8,  category: "collector",  since: 1966, emoji: "🖖" },
  { tag: "JAMES_BOND",          label: "James Bond (Dr. No) Film Anniversary",     month: 10, day: 5,  category: "collector",  since: 1962, emoji: "🔫" },
  { tag: "INDIANA_JONES",       label: "Raiders of the Lost Ark Release Anniversary", month: 6, day: 12, category: "collector", since: 1981, emoji: "🎩" },
  { tag: "BACK_TO_FUTURE",      label: "Back to the Future Release Anniversary",   month: 7,  day: 3,  category: "collector",  since: 1985, emoji: "⚡" },
  { tag: "GHOSTBUSTERS",        label: "Ghostbusters Release Anniversary",          month: 6,  day: 8,  category: "collector",  since: 1984, emoji: "👻" },
  { tag: "HARRY_POTTER",        label: "Harry Potter First Book Anniversary",       month: 6,  day: 26, category: "collector",  since: 1997, emoji: "⚡" },
  { tag: "JURASSIC_PARK",       label: "Jurassic Park Release Anniversary",         month: 6,  day: 11, category: "collector",  since: 1993, emoji: "🦕" },
  { tag: "ET_FILM",             label: "E.T. the Extra-Terrestrial Release",        month: 6,  day: 11, category: "collector",  since: 1982, emoji: "👽" },
  { tag: "BATMAN_FILM",         label: "Batman (1989 Film) Release Anniversary",   month: 6,  day: 23, category: "collector",  since: 1989, emoji: "🦇" },

  // ── TINPLATE ─────────────────────────────────────────────────────────────
  { tag: "MARKLIN_FOUNDED",     label: "Märklin Founded Anniversary",               month: 1,  day: 1,  category: "collector",  since: 1859, emoji: "🏭" },
  { tag: "BRITAINS_FOUNDED",    label: "Britains Toy Soldiers Founded Anniversary", month: 1,  day: 1,  category: "collector",  since: 1893, emoji: "🪖" },

  // ── SEASONAL / GENERAL ───────────────────────────────────────────────────
  { tag: "NEW_YEAR",            label: "New Year's Day",                            month: 1,  day: 1,  category: "seasonal",               emoji: "🎆" },
  { tag: "VALENTINES",          label: "Valentine's Day",                           month: 2,  day: 14, category: "seasonal",               emoji: "❤️" },
  { tag: "ST_PATRICKS",         label: "St Patrick's Day",                          month: 3,  day: 17, category: "seasonal",               emoji: "☘️" },
  { tag: "EASTER",              label: "Easter Weekend (approx. late March/April)", month: 3,  day: 30, category: "seasonal",               emoji: "🐣" },
  { tag: "MOTHERS_DAY",         label: "Mother's Day UK (approx. late March)",      month: 3,  day: 22, category: "seasonal",               emoji: "💐" },
  { tag: "APRIL_FOOLS",         label: "April Fool's Day",                          month: 4,  day: 1,  category: "seasonal",               emoji: "🤡" },
  { tag: "FATHERS_DAY",         label: "Father's Day (3rd Sunday June)",            month: 6,  day: 21, category: "seasonal",               emoji: "👨‍👦" },
  { tag: "HALLOWEEN",           label: "Halloween",                                 month: 10, day: 31, category: "seasonal",               emoji: "🎃" },
  { tag: "BONFIRE_NIGHT",       label: "Bonfire Night",                             month: 11, day: 5,  category: "seasonal",               emoji: "🎇" },
  { tag: "BLACK_FRIDAY",        label: "Black Friday",                              month: 11, day: 29, category: "seasonal",               emoji: "🛍️" },
  { tag: "CHRISTMAS",           label: "Christmas Day",                             month: 12, day: 25, category: "seasonal",               emoji: "🎄" },
  { tag: "BOXING_DAY",          label: "Boxing Day",                                month: 12, day: 26, category: "seasonal",               emoji: "🎁" },
]

function getUpcomingDates(days = 90): (SpecialDate & { date: Date; daysAway: number; anniversary?: number })[] {
  const today = startOfDay(new Date())
  const year  = today.getFullYear()
  const result: (SpecialDate & { date: Date; daysAway: number; anniversary?: number })[] = []

  for (const sd of SPECIAL_DATES) {
    for (const y of [year, year + 1]) {
      const d = new Date(y, sd.month - 1, sd.day)
      const daysAway = Math.round((d.getTime() - today.getTime()) / 86400000)
      if (daysAway >= 0 && daysAway <= days) {
        result.push({
          ...sd,
          date: d,
          daysAway,
          anniversary: sd.since ? y - sd.since : undefined,
        })
      }
    }
  }

  return result.sort((a, b) => a.daysAway - b.daysAway)
}

// ─── Types ────────────────────────────────────────────────────────────────────

type SocialPost = {
  id:             string
  platform:       string
  status:         string
  copy:           string
  imageUrl:       string | null
  hashtags:       string | null
  scheduledAt:    string | null
  postedAt:       string | null
  specialDateTag: string | null
  auctionCode:    string | null
  createdByName:  string | null
  createdAt:      string
}

const PLATFORM_COLOURS: Record<string, string> = {
  FACEBOOK:  "bg-blue-600",
  INSTAGRAM: "bg-gradient-to-r from-purple-500 to-pink-500",
}

const STATUS_COLOURS: Record<string, string> = {
  DRAFT:     "bg-gray-700 text-gray-300",
  SCHEDULED: "bg-amber-900/60 text-amber-300",
  POSTED:    "bg-green-900/60 text-green-300",
  FAILED:    "bg-red-900/60 text-red-400",
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SocialPostsTab() {
  const upcoming = getUpcomingDates(90)

  // ── Compose state ──
  const [platforms,      setPlatforms]      = useState<string[]>(["FACEBOOK"])
  const [copy,           setCopy]           = useState("")
  const [hashtags,       setHashtags]       = useState("")
  const [imageKey,       setImageKey]       = useState("")   // R2 key
  const [imageUrl,       setImageUrl]       = useState("")   // preview URL
  const [uploading,      setUploading]      = useState(false)
  const [uploadError,    setUploadError]    = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [scheduledAt,    setScheduledAt]    = useState("")
  const [scheduledTime,  setScheduledTime]  = useState("10:00")
  const [specialDateTag, setSpecialDateTag] = useState("")
  const [auctionCode,    setAuctionCode]    = useState("")
  const [context,        setContext]        = useState("")

  // ── Generation ──
  const [modelList,   setModelList]   = useState<string[]>([])
  const [modelId,     setModelId]     = useState("gemini-2.5-flash-preview-04-17")
  const [generating,  setGenerating]  = useState(false)
  const [genError,    setGenError]    = useState<string | null>(null)

  // ── Save ──
  const [saving,     setSaving]     = useState(false)
  const [saveError,  setSaveError]  = useState<string | null>(null)

  // ── Queue ──
  const [posts,        setPosts]        = useState<SocialPost[]>([])
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [queueTab,     setQueueTab]     = useState<"DRAFT" | "SCHEDULED" | "POSTED">("SCHEDULED")
  const [deletingId,   setDeletingId]   = useState<string | null>(null)
  const [expandedId,   setExpandedId]   = useState<string | null>(null)

  // ── Sidebar ──
  const [sidebarFilter, setSidebarFilter] = useState<"all" | "collector" | "historical" | "seasonal">("all")

  useEffect(() => {
    fetch("/api/auction-ai/models").then(r => r.json()).then(d => {
      if (d.models?.length) {
        setModelList(d.models)
        const saved = localStorage.getItem("bc_marketing_default_model")
        setModelId(saved && d.models.includes(saved) ? saved : d.models[0])
      }
    }).catch(() => {})
    loadPosts()
  }, [])

  const loadPosts = useCallback(() => {
    setLoadingPosts(true)
    fetch("/api/marketing/social-posts")
      .then(r => r.json())
      .then(d => { if (d.posts) setPosts(d.posts) })
      .catch(() => {})
      .finally(() => setLoadingPosts(false))
  }, [])

  // Pre-fill from special date click
  function pickSpecialDate(sd: SpecialDate & { date: Date; anniversary?: number }) {
    setSpecialDateTag(sd.tag)
    setScheduledAt(format(sd.date, "yyyy-MM-dd"))
    setContext(sd.anniversary ? `${sd.label} — ${sd.anniversary}th anniversary` : sd.label)
  }

  // Upload image
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/marketing/social-posts/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Upload failed")
      setImageKey(data.key)
      setImageUrl(`/api/catalogue/photo-proxy?key=${encodeURIComponent(data.key)}`)
    } catch (e: any) {
      setUploadError(e.message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  // Generate copy
  async function generate() {
    if (!copy && !context && !specialDateTag) return
    setGenerating(true)
    setGenError(null)
    const label = SPECIAL_DATES.find(s => s.tag === specialDateTag)?.label ?? context
    try {
      const res = await fetch("/api/marketing/social-posts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specialDate: label || context, context, platform: platforms.join(","), modelId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed")
      setCopy(data.copy)
      if (data.hashtags) setHashtags(data.hashtags)
    } catch (e: any) {
      setGenError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  // Save post
  async function savePost(status: "DRAFT" | "SCHEDULED") {
    if (!copy.trim()) { setSaveError("Post copy is required."); return }
    if (status === "SCHEDULED" && !scheduledAt) { setSaveError("Please set a date to schedule."); return }
    setSaving(true)
    setSaveError(null)
    try {
      const dt = scheduledAt ? `${scheduledAt}T${scheduledTime}:00` : null
      const res = await fetch("/api/marketing/social-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: platforms.join(","), copy,
          hashtags:       hashtags || null,
          imageUrl:       imageKey || null,
          scheduledAt:    dt,
          specialDateTag: specialDateTag || null,
          auctionCode:    auctionCode || null,
          status,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed")
      // Reset compose
      setCopy(""); setHashtags(""); setImageUrl(""); setImageKey(""); setScheduledAt("")
      setScheduledTime("10:00"); setSpecialDateTag(""); setContext(""); setAuctionCode("")
      setQueueTab(status)
      loadPosts()
    } catch (e: any) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // Delete post
  async function deletePost(id: string) {
    setDeletingId(id)
    try {
      await fetch(`/api/marketing/social-posts/${id}`, { method: "DELETE" })
      setPosts(prev => prev.filter(p => p.id !== id))
    } catch {} finally { setDeletingId(null) }
  }

  // Mark as posted
  async function markPosted(id: string) {
    try {
      await fetch(`/api/marketing/social-posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "POSTED", postedAt: new Date().toISOString() }),
      })
      loadPosts()
    } catch {}
  }

  const filteredUpcoming = upcoming.filter(d =>
    sidebarFilter === "all" ? true : d.category === sidebarFilter
  )

  const queuedPosts = posts.filter(p => p.status === queueTab)

  return (
    <div className="flex h-full min-h-0">

      {/* ── Left sidebar — special dates ── */}
      <div className="w-64 shrink-0 border-r border-gray-800 flex flex-col min-h-0">
        <div className="px-4 pt-4 pb-2 shrink-0">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">📅 Upcoming Dates</h3>
          <div className="flex flex-wrap gap-1">
            {(["all", "collector", "historical", "seasonal"] as const).map(f => (
              <button
                key={f}
                onClick={() => setSidebarFilter(f)}
                className={`px-2 py-0.5 rounded text-xs font-medium capitalize transition-colors ${
                  sidebarFilter === f ? "bg-pink-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
          {filteredUpcoming.length === 0 ? (
            <p className="text-xs text-gray-600 px-2 py-4">No upcoming dates in 90 days.</p>
          ) : filteredUpcoming.map((sd, i) => (
            <button
              key={i}
              onClick={() => pickSpecialDate(sd)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors group ${
                specialDateTag === sd.tag ? "bg-pink-900/40 border border-pink-700/50" : "hover:bg-gray-800"
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="text-base shrink-0 mt-0.5">{sd.emoji}</span>
                <div className="min-w-0">
                  <p className="text-xs text-white font-medium leading-tight">{sd.label}</p>
                  {sd.anniversary && (
                    <p className="text-xs text-pink-400 font-bold">{sd.anniversary}th anniversary</p>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">
                    {format(sd.date, "d MMM")}
                    {sd.daysAway === 0 ? " · Today!" : sd.daysAway === 1 ? " · Tomorrow" : ` · ${sd.daysAway}d`}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">

        {/* ── Compose panel ── */}
        <div className="border-b border-gray-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">✍️ Compose Post</h2>

            {/* Platform multi-select */}
            <div className="flex gap-1.5 items-center">
              <span className="text-xs text-gray-500 mr-1">Post to:</span>
              {[
                { key: "FACEBOOK",  label: "f Facebook",   active: "bg-blue-600" },
                { key: "INSTAGRAM", label: "◎ Instagram",  active: "bg-gradient-to-r from-purple-600 to-pink-600" },
              ].map(p => {
                const selected = platforms.includes(p.key)
                return (
                  <button
                    key={p.key}
                    onClick={() => {
                      if (selected) {
                        // Don't allow deselecting both
                        if (platforms.length > 1) setPlatforms(prev => prev.filter(x => x !== p.key))
                      } else {
                        setPlatforms(prev => [...prev, p.key])
                      }
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all border ${
                      selected
                        ? `${p.active} text-white border-transparent`
                        : "border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
                    }`}
                  >
                    {selected && <span className="mr-1">✓</span>}{p.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Left — copy + hashtags */}
            <div className="space-y-3">
              {/* Context / occasion */}
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">
                  Occasion / Topic
                  {specialDateTag && (
                    <span className="ml-2 text-pink-400 font-normal">
                      · {SPECIAL_DATES.find(s => s.tag === specialDateTag)?.label}
                    </span>
                  )}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. New Matchbox auction live, Transformers anniversary…"
                    value={context}
                    onChange={e => setContext(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                  <button
                    onClick={generate}
                    disabled={generating || (!context && !specialDateTag)}
                    className="px-3 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold transition-colors disabled:opacity-40 whitespace-nowrap flex items-center gap-1.5"
                  >
                    {generating ? <span className="animate-spin">⟳</span> : "✨"} Generate
                  </button>
                </div>
                {genError && <p className="text-xs text-red-400 mt-1">{genError}</p>}
              </div>

              {/* Copy */}
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Post Copy</label>
                <textarea
                  rows={6}
                  value={copy}
                  onChange={e => setCopy(e.target.value)}
                  placeholder="Write your post here, or click Generate above…"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-pink-500 resize-none"
                />
              </div>

              {/* Hashtags */}
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Hashtags</label>
                <textarea
                  rows={2}
                  value={hashtags}
                  onChange={e => setHashtags(e.target.value)}
                  placeholder="#VectisAuctions #ToyCollector #Diecast…"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-pink-400 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-pink-500 resize-none font-mono"
                />
              </div>
            </div>

            {/* Right — image + schedule */}
            <div className="space-y-3">
              {/* Image upload */}
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Image</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {/* Upload area / preview */}
                {imageUrl ? (
                  <div className="relative rounded-lg overflow-hidden border border-gray-700 h-36 bg-gray-900">
                    <img src={imageUrl} alt="preview" className="h-full w-full object-cover" />
                    <button
                      onClick={() => { setImageUrl(""); setImageKey("") }}
                      className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold transition-colors"
                      title="Remove image"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full h-36 rounded-lg border-2 border-dashed border-gray-700 hover:border-pink-600 flex flex-col items-center justify-center gap-2 transition-colors group disabled:opacity-50"
                  >
                    {uploading ? (
                      <>
                        <span className="text-2xl animate-spin">⟳</span>
                        <span className="text-xs text-gray-400">Uploading…</span>
                      </>
                    ) : (
                      <>
                        <span className="text-2xl text-gray-600 group-hover:text-pink-500 transition-colors">📷</span>
                        <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">Click to upload image</span>
                        <span className="text-xs text-gray-700">JPG, PNG, WEBP, GIF · max 20MB</span>
                      </>
                    )}
                  </button>
                )}
                {uploadError && <p className="text-xs text-red-400 mt-1">{uploadError}</p>}
              </div>

              {/* Schedule date + time */}
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Schedule Date & Time</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={e => setScheduledTime(e.target.value)}
                    className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                </div>
              </div>

              {/* Auction code (optional) */}
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Auction Code <span className="font-normal text-gray-600">(optional)</span></label>
                <input
                  type="text"
                  placeholder="e.g. SW2024"
                  value={auctionCode}
                  onChange={e => setAuctionCode(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>

              {/* Save buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => savePost("DRAFT")}
                  disabled={saving}
                  className="flex-1 py-2 rounded-lg border border-gray-600 text-gray-300 hover:text-white hover:border-gray-400 text-sm font-semibold transition-colors disabled:opacity-40"
                >
                  Save Draft
                </button>
                <button
                  onClick={() => savePost("SCHEDULED")}
                  disabled={saving || !scheduledAt}
                  className="flex-1 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-sm font-semibold transition-colors disabled:opacity-40"
                >
                  {saving ? "Saving…" : "📅 Schedule"}
                </button>
              </div>
              {saveError && <p className="text-xs text-red-400">{saveError}</p>}
            </div>
          </div>
        </div>

        {/* ── Post queue ── */}
        <div className="flex-1 p-5">
          <div className="flex items-center gap-4 mb-4">
            <h2 className="text-sm font-bold text-white">Post Queue</h2>
            <div className="flex gap-1 bg-gray-900 rounded-lg p-0.5">
              {(["SCHEDULED", "DRAFT", "POSTED"] as const).map(s => {
                const count = posts.filter(p => p.status === s).length
                return (
                  <button
                    key={s}
                    onClick={() => setQueueTab(s)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      queueTab === s ? "bg-gray-700 text-white" : "text-gray-500 hover:text-white"
                    }`}
                  >
                    {s === "SCHEDULED" ? "📅" : s === "DRAFT" ? "📝" : "✅"} {s.charAt(0) + s.slice(1).toLowerCase()}
                    {count > 0 && <span className="ml-1.5 bg-pink-600 text-white text-xs px-1.5 py-0.5 rounded-full">{count}</span>}
                  </button>
                )
              })}
            </div>
            {loadingPosts && <span className="text-xs text-gray-500 animate-pulse">Loading…</span>}
          </div>

          {queuedPosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-700">
              <span className="text-4xl mb-3">{queueTab === "SCHEDULED" ? "📅" : queueTab === "DRAFT" ? "📝" : "✅"}</span>
              <p className="text-sm font-medium text-gray-500">No {queueTab.toLowerCase()} posts.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {queuedPosts.map(post => {
                const sd = SPECIAL_DATES.find(s => s.tag === post.specialDateTag)
                const isExpanded = expandedId === post.id
                return (
                  <div key={post.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    {/* Header row */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      {/* Platform badges (may be multiple) */}
                      <div className="flex gap-1 shrink-0">
                        {post.platform.split(",").map(p => (
                          <span key={p} className={`text-xs font-bold text-white px-2 py-0.5 rounded ${PLATFORM_COLOURS[p.trim()] ?? "bg-gray-700"}`}>
                            {p.trim() === "FACEBOOK" ? "f" : "◎"}
                          </span>
                        ))}
                      </div>

                      {/* Special date tag */}
                      {sd && (
                        <span className="text-sm">{sd.emoji}</span>
                      )}

                      {/* Copy preview */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : post.id)}
                        className="flex-1 text-left text-sm text-gray-300 truncate hover:text-white transition-colors"
                      >
                        {post.copy.slice(0, 90)}{post.copy.length > 90 ? "…" : ""}
                      </button>

                      {/* Scheduled date */}
                      {post.scheduledAt && (
                        <span className="text-xs text-amber-400 font-mono whitespace-nowrap shrink-0">
                          {format(new Date(post.scheduledAt), "d MMM · HH:mm")}
                        </span>
                      )}

                      {/* Status badge */}
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOURS[post.status] ?? ""}`}>
                        {post.status}
                      </span>

                      {/* Actions */}
                      <div className="flex gap-1.5 shrink-0">
                        {post.status === "SCHEDULED" && (
                          <button
                            onClick={() => markPosted(post.id)}
                            title="Mark as posted"
                            className="text-xs px-2 py-1 rounded bg-green-900/40 hover:bg-green-800/60 text-green-400 transition-colors"
                          >
                            ✓ Post
                          </button>
                        )}
                        <button
                          onClick={() => deletePost(post.id)}
                          disabled={deletingId === post.id}
                          title="Delete"
                          className="text-xs px-2 py-1 rounded bg-red-900/30 hover:bg-red-800/50 text-red-400 transition-colors disabled:opacity-40"
                        >
                          {deletingId === post.id ? "…" : "✕"}
                        </button>
                      </div>
                    </div>

                    {/* Expanded view */}
                    {isExpanded && (
                      <div className="border-t border-gray-800 px-4 py-3 space-y-2">
                        <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{post.copy}</p>
                        {post.hashtags && (
                          <p className="text-xs text-pink-400 font-mono">{post.hashtags}</p>
                        )}
                        {post.imageUrl && (
                          <img
                            src={post.imageUrl.startsWith("http") ? post.imageUrl : `/api/catalogue/photo-proxy?key=${encodeURIComponent(post.imageUrl)}`}
                            alt=""
                            className="rounded-lg max-h-48 object-cover mt-2"
                          />
                        )}
                        {post.auctionCode && (
                          <p className="text-xs text-gray-500">Auction: <span className="font-mono text-gray-400">{post.auctionCode}</span></p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(`${post.copy}\n\n${post.hashtags ?? ""}`.trim())
                            }}
                            className="text-xs px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                          >
                            Copy post
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
