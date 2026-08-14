import { loadInductionSlides, loadInductionLiveData } from "@/lib/induction-data"
import Presenter from "./presenter"

export const dynamic = "force-dynamic"

// The deck on the big screen. Only ACTIVE slides — unticking a slide in the editor is how you
// take something out of the running order without deleting it.
export default async function InductionPresentPage() {
  const [slides, live] = await Promise.all([
    loadInductionSlides({ activeOnly: true }),
    loadInductionLiveData(),
  ])
  return <Presenter slides={slides} live={live} />
}
