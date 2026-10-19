"use client"

import Form from "next/form"
import Link from "next/link"
import { useEffect, useRef } from "react"
import { useFormStatus } from "react-dom"
import { btn, btnGo, input } from "../../_components/ui"

// The Customers list's search box. (It lives in this folder only because of how the Goods In build
// split the files; it belongs to the list page one level up.)
//
// A plain GET form, so the search is in the address bar and Back works. Enter searches — which is
// what a barcode scanner presses after typing a vendor number. After each search the words are
// left SELECTED, so the next scan or the next typed search replaces them rather than being added
// on the end ("smithC227976"). The button says "Searching…" while the results load.

function SearchButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={`${btnGo} !min-h-14 flex-1 sm:flex-none sm:min-w-32`} disabled={pending} aria-live="polite">
      {pending ? "Searching…" : "Search"}
    </button>
  )
}

export default function CustomerSearchBox({ q, action }: { q: string; action: string }) {
  const ref = useRef<HTMLInputElement>(null)

  // Keep the box in step with the address bar (Clear, Back, a page link) and select what's in it.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.value !== q) el.value = q
    if (document.activeElement === el) el.select()
  }, [q])

  // On a desktop with a scanner, the box is ready the moment the page opens. (An iPad ignores this
  // until the box is tapped, so its keyboard doesn't pop up on its own.)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.select()
  }, [])

  return (
    <Form action={action} className="flex flex-wrap sm:flex-nowrap gap-2" role="search">
      <label htmlFor="customer-search" className="sr-only">Search customers</label>
      <input
        ref={ref}
        id="customer-search"
        name="q"
        type="search"
        defaultValue={q}
        onFocus={e => e.currentTarget.select()}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={100}
        placeholder="Name, postcode, email, phone or vendor number"
        className={`${input} !min-h-14 !text-lg flex-1 min-w-0 basis-full sm:basis-auto`}
      />
      <SearchButton />
      {q && <Link href={action} className={`${btn} !min-h-14 flex-1 sm:flex-none`}>Clear</Link>}
    </Form>
  )
}
