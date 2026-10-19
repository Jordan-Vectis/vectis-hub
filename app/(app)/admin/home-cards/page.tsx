import { redirect } from "next/navigation"

// Home Page Cards is edited on the home page itself now (✏️ Edit home page, /hub?edit=1),
// so the admin card and any old link land there.
export default function HomeCardsPage() {
  redirect("/hub?edit=1")
}
