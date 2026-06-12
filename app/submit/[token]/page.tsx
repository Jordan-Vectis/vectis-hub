import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import UploadClient from "./upload-client"

const CLOSED_STATUSES = ["COMPLETED", "DECLINED"]

export default async function SubmitPhotosPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const submission = await prisma.submission.findUnique({
    where:   { photoUploadToken: token },
    include: { items: { select: { id: true, name: true } } },
  })

  if (!submission) notFound()

  const expired = CLOSED_STATUSES.includes(submission.status)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0A0A0C] flex flex-col items-center justify-start py-12 px-4">
      {/* Header */}
      <div className="text-center mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Vectis Auctions</p>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {expired ? "This link has expired" : "We'd like a few more photos"}
        </h1>
        {!expired && (
          <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">
            Please upload photos of your item{submission.items.length !== 1 ? "s" : ""} below.
            The clearer the better — good lighting and multiple angles help us give you the most accurate valuation.
          </p>
        )}
      </div>

      {expired ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center max-w-sm w-full">
          <p className="text-gray-500 text-sm">
            This photo upload link is no longer active. Please contact Vectis Auctions if you need to send photos.
          </p>
          <p className="text-xs text-gray-400 mt-3">01983 520 722</p>
        </div>
      ) : (
        <UploadClient token={token} items={submission.items} />
      )}
    </div>
  )
}
