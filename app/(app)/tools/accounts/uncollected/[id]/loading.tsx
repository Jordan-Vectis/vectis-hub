// One Paid, not collected case, while it is being read.

export default function UncollectedCaseLoading() {
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto" role="status" aria-live="polite">
      <p className="text-base text-gray-500 dark:text-gray-400 mt-12 inline-flex items-center gap-2">
        <span className="block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
        Opening the case…
      </p>
    </div>
  )
}
