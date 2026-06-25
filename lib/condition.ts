// Shared parse/build for a lot's condition string. Used by the Lot Wizard, the desktop
// auction-manager lot editor, and the tablet lot editor so the three never drift.
//
// Format: an item condition, optionally followed by a SEPARATE box/packaging sentence:
//   "Near Mint to Excellent"
//   "Near Mint to Excellent. Box is Good to Good Plus."
//   "Mint. Packaging is Fair."
//   "Good. Inner tray is Good."        (custom prefix)
//   "Box is Good."                     (box only, no item condition)

export const CONDITION_GRADES = ["Mint", "Near Mint", "Excellent", "Good Plus", "Good", "Fair", "Poor"]

export type BoxPrefixMode = "Box is" | "Packaging is" | "custom"

export interface ConditionParts {
  cond1: string
  cond2: string
  boxOn: boolean
  boxPrefixMode: BoxPrefixMode
  boxCustomPrefix: string
  boxCond1: string
  boxCond2: string
}

export const emptyCondition: ConditionParts = {
  cond1: "", cond2: "", boxOn: false, boxPrefixMode: "Box is", boxCustomPrefix: "", boxCond1: "", boxCond2: "",
}

// Sort a pair of grades best→worst the same way every editor does.
const byGrade = (a: string, b: string) => CONDITION_GRADES.indexOf(b) - CONDITION_GRADES.indexOf(a)
const gradeRange = (a: string, b: string) => [a, b].filter(Boolean).sort(byGrade).join(" to ")

// Longest-first so "Near Mint" wins over "Mint" and "Good Plus" over "Good".
const GRADE = "(?:Near Mint|Good Plus|Mint|Excellent|Good|Fair|Poor)"
// Whole string = optional prefix text + a trailing grade or "grade to grade", optional ".".
const BOX_RE = new RegExp(`^(.*?)\\s*(${GRADE}(?:\\s+to\\s+${GRADE})?)\\.?$`)

export function buildCondition(p: ConditionParts): string {
  const item = gradeRange(p.cond1, p.cond2)
  const prefix = (p.boxPrefixMode === "custom" ? p.boxCustomPrefix.trim() : p.boxPrefixMode)
  const boxGrade = gradeRange(p.boxCond1, p.boxCond2)
  const box = p.boxOn && prefix && boxGrade ? `${prefix} ${boxGrade}` : ""
  if (item && box) return `${item}. ${box}.`
  if (box) return `${box}.`
  return item
}

export function parseCondition(raw: string | null | undefined): ConditionParts {
  const s = (raw ?? "").trim().replace(/\.\s*$/, "")
  if (!s) return { ...emptyCondition }

  let itemStr = s
  let boxStr = ""
  const sep = s.indexOf(". ")
  if (sep >= 0) {
    // "item. box." — only treat the tail as a box sentence if it has a prefix + grade,
    // otherwise the ". " is part of a legacy free-text condition and we keep it as item.
    const candidate = s.slice(sep + 2).trim()
    const m = BOX_RE.exec(candidate)
    if (m && m[1].trim()) { itemStr = s.slice(0, sep).trim(); boxStr = candidate }
  } else if (/^(Box|Packaging) is\s+/i.test(s)) {
    // Box-only (no item) — only recognised for the two built-in prefixes, so legacy
    // free-text that happens to end in a grade word is never mis-read as a box condition.
    itemStr = ""; boxStr = s
  }

  const [c1 = "", c2 = ""] = itemStr.split(/\s+to\s+/i).map(x => x.trim())
  const parts: ConditionParts = { ...emptyCondition, cond1: c1, cond2: c2 }

  if (boxStr) {
    const m = BOX_RE.exec(boxStr)
    if (m) {
      const prefix = m[1].trim()
      const [b1 = "", b2 = ""] = m[2].split(/\s+to\s+/i).map(x => x.trim())
      parts.boxOn = true
      parts.boxCond1 = b1
      parts.boxCond2 = b2
      if (prefix === "Box is") parts.boxPrefixMode = "Box is"
      else if (prefix === "Packaging is") parts.boxPrefixMode = "Packaging is"
      else { parts.boxPrefixMode = "custom"; parts.boxCustomPrefix = prefix }
    }
  }
  return parts
}
