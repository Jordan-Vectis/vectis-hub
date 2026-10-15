import Link from "next/link"

// The test site's 404, worded and laid out as vectis.co.uk's ("PAGE NOT FOUND … GO TO HOMEPAGE").
export default function SiteNotFound() {
  return (
    <div className="vs-container text-center py-24 sm:py-32">
      <h1 className="vs-h2 mb-8">Page not found</h1>
      <p className="vs-lead max-w-[720px] mx-auto mb-8">
        Sorry, but the page you are looking for has not been found. Try checking the URL for errors, then hit the
        refresh button on your browser.
      </p>
      <Link href="/" className="vs-btn">Go to homepage</Link>
    </div>
  )
}
