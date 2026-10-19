import Link from "next/link"

export type TileCard = {
  key: string
  href: string
  label: string
  description: string
  icon: string
  border: string
  iconBg: string
  btnBg: string
  glow: string
  pinned: boolean
  comingSoon?: boolean
  colour: string | null       // admin-picked, replaces the built-in classes
  textColour: string | null
}

// One app card on the home page. Also drawn by the home page editor (link = false).
export function AppCardTile({ app, link = true }: { app: TileCard; link?: boolean }) {
  const cardClass = `relative bg-white dark:bg-[#1c1f27] border ${app.border} rounded-xl p-7 flex flex-col items-center text-center min-h-[320px]
    transition-all duration-200 hover:shadow-xl ${app.glow} hover:-translate-y-0.5`

  const colour = app.colour ? { borderColor: app.colour } : undefined
  const btn    = app.colour ? { backgroundColor: app.colour } : undefined
  const text   = app.textColour ? { color: app.textColour } : undefined

  const inner = (
    <>
      {app.pinned && (
        <span className="absolute top-3 right-3 text-xs font-medium bg-yellow-500/20 text-yellow-600 dark:text-yellow-300 px-2 py-0.5 rounded-full">
          ★ Featured
        </span>
      )}

      <div className={`text-5xl mb-4 ${app.iconBg}`}>{app.icon}</div>

      <h2 className="text-lg font-bold mb-2 text-gray-900 dark:text-white" style={text}>{app.label}</h2>

      <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed mb-6 flex-1" style={text ? { ...text, opacity: 0.8 } : undefined}>{app.description}</p>

      {app.comingSoon ? (
        <span className="w-full text-center text-sm font-semibold text-gray-500 bg-gray-200 dark:bg-gray-800 py-2 px-4 rounded-lg cursor-not-allowed">
          Coming Soon
        </span>
      ) : (
        <span className={`w-full text-center text-sm font-semibold text-white py-2 px-4 rounded-lg transition-colors ${app.colour ? "hover:brightness-110" : app.btnBg}`} style={btn}>
          Open {app.label} →
        </span>
      )}
    </>
  )

  // The whole card is the click target (not just the button) so a click
  // anywhere on it navigates. Coming-soon cards aren't links.
  return app.comingSoon || !link ? (
    <div className={`${cardClass} ${app.comingSoon ? "cursor-not-allowed" : ""}`} style={colour}>{inner}</div>
  ) : (
    <Link href={app.href} className={`${cardClass} cursor-pointer`} style={colour}>{inner}</Link>
  )
}
