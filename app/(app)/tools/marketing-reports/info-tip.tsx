"use client"

// A small "?" badge that reveals a plain-English explanation on hover/focus.
export default function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle ml-1.5">
      <span
        tabIndex={0}
        className="cursor-help inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300 text-[10px] font-bold select-none leading-none"
        aria-label="What's this?"
      >
        ?
      </span>
      <span className="pointer-events-none invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity absolute left-0 bottom-full mb-2 w-72 z-50 rounded-lg bg-gray-900 text-gray-100 text-xs leading-relaxed p-3 shadow-xl border border-gray-700 normal-case font-normal tracking-normal text-left">
        {text}
      </span>
    </span>
  )
}
