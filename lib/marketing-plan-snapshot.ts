// The one place that READS Google Analytics for a marketing plan.
//
// Split out of lib/marketing-plan.ts on purpose: that module is imported by the
// client editor, and a value import of lib/ga would drag the
// @google-analytics/data client into the browser bundle. Keep every GA call in
// here, and keep this file out of any "use client" component.

import { getMarketingReport, type GaRange } from "@/lib/ga"
import { PLAN_SECTION_IDS, STAT_DEFS, rangeLabelFor, type PlanSnapshot } from "@/lib/marketing-plan"

/** Read GA and freeze the figures a plan is written against. */
export async function buildPlanSnapshot(
  range: GaRange,
  excludeBots: boolean,
  ukOnly: boolean,
  now: Date = new Date(),
): Promise<PlanSnapshot> {
  const data = await getMarketingReport(range, excludeBots, PLAN_SECTION_IDS, ukOnly)
  return {
    takenAt:     now.toISOString(),
    rangeKey:    range,
    rangeLabel:  rangeLabelFor(range),
    ukOnly,
    excludeBots,
    stats: STAT_DEFS.map((s) => ({
      key:   String(s.key),
      label: s.label,
      value: s.fmt(data.summary[s.key]),
      raw:   data.summary[s.key],
      delta: data.deltas[s.key],
    })),
    // Keep the tables short — a plan needs the shape of the traffic, not 12
    // rows of long tail, and every row costs tokens in the AI prompt.
    sections: data.sections.map((sec) => ({
      id:     sec.id,
      title:  sec.title,
      suffix: sec.suffix ?? "",
      rows:   sec.rows.slice(0, 8).map((r) => ({ name: r.name, value: r.value })),
    })),
  }
}
