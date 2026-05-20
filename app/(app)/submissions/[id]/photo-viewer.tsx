"use client"

import { useEffect, useState } from "react"

export default function PhotoViewer({ imageUrls }: { imageUrls: string[] }) {
  const [signedUrls, setSignedUrls] = useState<string[]>([])
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => {
    if (imageUrls.length === 0) return
    Promise.all(
      imageUrls.map((key) =>
        fetch(`/api/image?key=${encodeURIComponent(key)}`)
          .then((r) => r.json())
          .then((d) => d.url as string)
      )
    ).then(setSignedUrls)
  }, [imageUrls])

  if (imageUrls.length === 0) return null

  const isPdf = (url: string) => url.includes(".pdf") || url.includes("application%2Fpdf")

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <p className="text-xs text-gray-400 mb-2">Photos ({imageUrls.length})</p>
      {signedUrls.length === 0 ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {signedUrls.map((url, i) => (
            isPdf(imageUrls[i]) ? (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-gray-50 dark:bg-[#141416] border border-gray-200 dark:border-gray-700 rounded px-2 py-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                PDF {i + 1}
              </a>
            ) : (
              <img
                key={i}
                src={url}
                alt={`Photo ${i + 1}`}
                onClick={() => setLightbox(url)}
                className="w-20 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-80 transition-opacity"
              />
            )
          ))}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Full size"
            className="max-w-full max-h-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-white text-2xl font-bold hover:text-gray-300"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  )
}
