import Link from "next/link"
import { PageHeader, box, btn, btnGo } from "../../_components/ui"

// Shown for a receipt number the Hub doesn't have (the page calls notFound()).

export default function ReceiptNotFound() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader title="Receipt not found" back={{ href: "/tools/warehouse/receipts", label: "Receipts" }} />
      <div className={`${box} p-6 max-w-2xl`}>
        <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
          There&apos;s no Goods In receipt with that number. Check the number on the paperwork — receipts booked in Business Central
          before the Hub took over aren&apos;t in Goods In.
        </p>
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
          A check-in that was thrown away before it was booked in leaves no receipt behind — its number isn&apos;t used again.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/tools/warehouse/receipts" className={btnGo}>Search the receipts</Link>
          <Link href="/tools/warehouse/find" className={btn}>Find a code</Link>
        </div>
      </div>
    </div>
  )
}
