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
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-start py-10 px-4">
      {/* Header */}
      <div className="text-center mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-blue-600 mb-1">Vectis Auctions</p>
        {expired && (
          <h1 className="text-2xl font-bold text-gray-900">This link has expired</h1>
        )}
      </div>

      {expired ? (
        <div className="bg-white rounded-3xl border border-gray-100 p-8 text-center max-w-sm w-full shadow-sm">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-bold text-gray-900 mb-3">Link no longer active</h2>
          <p className="text-gray-600 text-base leading-relaxed mb-4">
            This photo upload link has expired. Please contact Vectis Auctions directly if you still need to send photos.
          </p>
          <a
            href="tel:01983520722"
            className="inline-flex items-center gap-2 bg-blue-600 text-white font-bold text-lg px-6 py-4 rounded-2xl"
          >
            📞 01983 520 722
          </a>
        </div>
      ) : (
        <UploadClient token={token} items={submission.items} />
      )}
    </div>
  )
}
