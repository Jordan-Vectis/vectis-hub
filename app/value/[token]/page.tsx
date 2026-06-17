import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getSignedImageUrl } from "@/lib/r2"
import ValueClient from "./value-client"

export default async function ValuationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const submission = await prisma.submission.findUnique({
    where:   { valuationToken: token },
    include: {
      contact: { select: { name: true } },
      items: {
        select: { id: true, name: true, description: true, imageUrls: true,
                  externalEstimate: true, externalNotes: true },
      },
    },
  })

  if (!submission) notFound()

  // Generate presigned GET URLs for all photos — valid for 2 hours
  const itemsWithPhotos = await Promise.all(
    submission.items.map(async item => ({
      ...item,
      signedPhotoUrls: await Promise.all(item.imageUrls.map(key => getSignedImageUrl(key))),
    }))
  )

  const alreadySubmitted = !!submission.valuationSubmittedAt

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-start py-10 px-4">
      {/* Header */}
      <div className="w-full max-w-2xl mb-8 flex flex-col items-center text-center">
        <img
          src="/vectis-logo.svg"
          alt="Vectis Auctions"
          className="h-12 object-contain mb-5"
        />
        <p className="text-sm font-bold uppercase tracking-widest text-blue-600 mb-1">Valuation Request</p>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          {alreadySubmitted ? "Valuation Submitted" : `Items from ${submission.contact.name}`}
        </h1>
        {!alreadySubmitted && (
          <p className="text-gray-500 text-sm max-w-md">
            Vectis Auctions is requesting your expert valuation on the items below.
            Please provide an estimate and any notes for each item, then submit.
          </p>
        )}
      </div>

      <ValueClient
        token={token}
        items={itemsWithPhotos}
        alreadySubmitted={alreadySubmitted}
        overallNotes={submission.valuationNotes ?? ""}
      />
    </div>
  )
}
