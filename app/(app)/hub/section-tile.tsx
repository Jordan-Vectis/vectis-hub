import Link from "next/link"

// One section card on the home page. Colours come from Admin → Home Page Cards, so they are
// inline styles, not Tailwind classes. Also used as the live preview on that admin page.
export function SectionTile({ label, icon, colour, textColour, appNames, href }: {
  label: string
  icon: string
  colour: string
  textColour: string | null
  appNames: string[]
  href?: string
}) {
  const body = (
    <>
      <div className="text-5xl mb-4">{icon}</div>
      <h2 className="text-lg font-bold mb-2 text-gray-900 dark:text-white" style={textColour ? { color: textColour } : undefined}>{label}</h2>
      <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed mb-6 flex-1" style={textColour ? { color: textColour, opacity: 0.8 } : undefined}>
        {appNames.join(" · ") || "No apps in this section yet"}
      </p>
      <span className="w-full text-center text-sm font-semibold text-white py-2 px-4 rounded-lg transition hover:brightness-110" style={{ backgroundColor: colour }}>
        Open {appNames.length} {appNames.length === 1 ? "app" : "apps"} →
      </span>
    </>
  )
  const className = "relative bg-white dark:bg-[#1c1f27] border rounded-xl p-7 h-full flex flex-col items-center text-center min-h-[320px] transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5"
  const style = { borderColor: colour, ["--tw-shadow-color" as string]: `${colour}66` }
  return href
    ? <Link href={href} className={`${className} cursor-pointer`} style={style}>{body}</Link>
    : <div className={className} style={style}>{body}</div>
}
