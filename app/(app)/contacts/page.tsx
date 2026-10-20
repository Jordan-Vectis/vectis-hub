import { redirect } from "next/navigation"

// The old test Contacts page was retired on 2026-10-20 for the Hub's own customer database.
// Submissions still keep their contacts (the Contact table) — only this screen went.
export default function ContactsRedirect() {
  redirect("/tools/customers")
}
