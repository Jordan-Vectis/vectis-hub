// JORDAN.SYS → MEAL PLANNER (personal, /jordan). The maths, the shapes and the prompts.
// ⚠ A plain module with NO server-only imports — the client uses the maths and the normalisers
// too, so the numbers on screen are the same numbers the plan is written against.

export type Sex = "male" | "female"
export type Activity = "sedentary" | "light" | "moderate" | "active" | "very"

export const ACTIVITY: { key: Activity; label: string; mult: number; hint: string }[] = [
  { key: "sedentary", label: "Sedentary",         mult: 1.2,   hint: "desk job, little or no exercise" },
  { key: "light",     label: "Lightly active",    mult: 1.375, hint: "exercise 1–3 days a week" },
  { key: "moderate",  label: "Moderately active", mult: 1.55,  hint: "exercise 3–5 days a week" },
  { key: "active",    label: "Very active",       mult: 1.725, hint: "hard exercise 6–7 days a week" },
  { key: "very",      label: "Extra active",      mult: 1.9,   hint: "physical job plus training" },
]

// ── What you're actually trying to do ────────────────────────────────────────
// Jordan, 2026-09-16: "there should be an option for if you want to lose maintain weight or gain
// muscle etc". The goal is the headline choice and it decides three things, not one: how far the
// calories sit from maintenance, the macro split it suggests, and what the AI is told to cook.
// Losing and building muscle are NOT the same plan at the same calories — one wants volume and
// fibre, the other protein spread across the day.
//
// About 7,700 kcal is a kilo of fat, so −500 a day is roughly a pound a week.

export type GoalKey = "lose" | "maintain" | "muscle" | "gain"

export type GoalDef = {
  key: GoalKey
  label: string
  blurb: string
  /** How fast, as calories a day against maintenance. Empty = no choice to make (maintain). */
  rates: { delta: number; label: string }[]
  defaultDelta: number
  macros: { protein: number; carbs: number; fat: number }
  /** Why that split, in Jordan's words — shown under the macro boxes. */
  macroWhy: string
  /** The cooking brief the AI gets for this goal. `%D%` becomes the calorie gap. */
  prompt: string
}

export const GOAL_DEFS: GoalDef[] = [
  {
    key: "lose", label: "Lose weight",
    blurb: "Eat under maintenance. Protein stays high so what comes off is fat, not muscle.",
    rates: [
      { delta: -250, label: "Gently — about ½ lb a week" },
      { delta: -500, label: "Steady — about 1 lb a week" },
      { delta: -750, label: "Faster — about 1½ lb a week" },
    ],
    defaultDelta: -500,
    macros: { protein: 35, carbs: 35, fat: 30 },
    macroWhy: "protein high so the weight lost is fat, not muscle",
    prompt: "GOAL: LOSE WEIGHT — about %D% kcal a day under maintenance. Make the day FEEL like enough food: big portions of vegetables, protein in every meal, and plenty of fibre, rather than small rich plates. Protein is a floor — never under the target, even if the calories have to come from somewhere else.",
  },
  {
    key: "maintain", label: "Maintain",
    blurb: "Eat at maintenance — stay where you are.",
    rates: [],
    defaultDelta: 0,
    macros: { protein: 30, carbs: 40, fat: 30 },
    macroWhy: "an even split — nothing to push either way",
    prompt: "GOAL: MAINTAIN — eat at maintenance. Keep it varied and easy to cook; no need to push protein beyond the target.",
  },
  {
    key: "muscle", label: "Build muscle",
    blurb: "A small surplus with high protein, for training. Muscle is built slowly — faster is mostly fat.",
    rates: [
      { delta: 250, label: "Lean — about ½ lb a week" },
      { delta: 500, label: "Faster — about 1 lb a week" },
    ],
    defaultDelta: 250,
    macros: { protein: 35, carbs: 40, fat: 25 },
    macroWhy: "protein to build with, carbs to train on",
    prompt: "GOAL: BUILD MUSCLE — about %D% kcal a day above maintenance, alongside training. SPREAD THE PROTEIN: at least 30 g in every main meal rather than one huge protein meal, since that is what actually drives the building. Put the bigger carb meals around training. Protein is a floor — never under the target.",
  },
  {
    key: "gain", label: "Gain weight",
    blurb: "A bigger surplus, using calorie-dense food so the meals don't become enormous.",
    rates: [
      { delta: 250, label: "Gently — about ½ lb a week" },
      { delta: 500, label: "Steady — about 1 lb a week" },
      { delta: 750, label: "Faster — about 1½ lb a week" },
    ],
    defaultDelta: 500,
    macros: { protein: 25, carbs: 45, fat: 30 },
    macroWhy: "calorie-dense food, so the plate stays a sensible size",
    prompt: "GOAL: GAIN WEIGHT — about %D% kcal a day above maintenance. Lean on calorie-dense foods (nut butters, olive oil, full-fat dairy, dried fruit, oats) so the calories fit into normal-sized meals. Avoid filling, high-volume, low-calorie plates — they are the reason people struggle to eat enough.",
  },
]

export const GOAL_KEYS = GOAL_DEFS.map(g => g.key)

/** Always a definition, never undefined — an unknown key (an old row) reads as "lose". */
export function goalDef(key: string | null | undefined): GoalDef {
  return GOAL_DEFS.find(g => g.key === key) ?? GOAL_DEFS[0]
}

/** The stored calorie gap must be one this goal actually offers — a delta left over from the
 *  previous goal would mean "Build muscle" quietly running a 500 kcal deficit. */
export function deltaFor(key: string | null | undefined, delta: number): number {
  const g = goalDef(key)
  if (!g.rates.length) return 0
  return g.rates.some(r => r.delta === delta) ? delta : g.defaultDelta
}

/** "Build muscle — 250 kcal a day above maintenance", for the screen and the plan's own brief. */
export function goalSummary(key: string | null | undefined, delta: number): string {
  const g = goalDef(key)
  const d = deltaFor(key, delta)
  if (!d) return `${g.label} — eating at maintenance`
  return `${g.label} — ${Math.abs(d)} kcal a day ${d < 0 ? "under" : "above"} maintenance`
}

export const MACRO_PRESETS: { label: string; protein: number; carbs: number; fat: number }[] = [
  { label: "Balanced",     protein: 30, carbs: 40, fat: 30 },
  { label: "High protein", protein: 40, carbs: 30, fat: 30 },
  { label: "Lower carb",   protein: 35, carbs: 25, fat: 40 },
]

// ── Which meals you actually eat ─────────────────────────────────────────────
// Jordan, 2026-09-17: "instead of having a list of options can we have a tickbox to be more
// flexible". A count forced his day into a shape someone else chose — 4 meals meant breakfast,
// lunch, a snack and dinner whether or not that is how he eats. Tick the ones you have.
// ⚠ Kept in DAY ORDER here; the order on screen and the order in the plan both come from this.

export const MEAL_SLOT_OPTIONS: { key: string; label: string }[] = [
  { key: "breakfast",       label: "Breakfast" },
  { key: "morning-snack",   label: "Morning snack" },
  { key: "lunch",           label: "Lunch" },
  { key: "afternoon-snack", label: "Afternoon snack" },
  { key: "dinner",          label: "Dinner" },
  { key: "evening-snack",   label: "Evening snack" },
]

/** The ticks that match an old profile's count — so switching to tickboxes shows him the day he
 *  already had. ⚠ Not derived from mealSlots()'s labels: that says plain "Snack", which matches
 *  none of the options above and would quietly drop a meal. */
export function defaultMealKeys(n: number): string[] {
  switch (Math.max(1, Math.min(6, n))) {
    case 1:  return ["dinner"]
    case 2:  return ["breakfast", "dinner"]
    case 3:  return ["breakfast", "lunch", "dinner"]
    case 4:  return ["breakfast", "lunch", "afternoon-snack", "dinner"]
    case 5:  return ["breakfast", "morning-snack", "lunch", "afternoon-snack", "dinner"]
    default: return MEAL_SLOT_OPTIONS.map(o => o.key)
  }
}

/**
 * The meals a profile eats, in day order.
 * ⚠ An EMPTY list falls back to the old count, so profiles saved before the tickboxes existed
 * keep the day they already had instead of silently becoming "no meals".
 */
export function chosenMeals(meals: string[] | null | undefined, mealsPerDay: number): string[] {
  const picked = MEAL_SLOT_OPTIONS.filter(o => (meals ?? []).includes(o.key)).map(o => o.label)
  return picked.length ? picked : mealSlots(mealsPerDay)
}

/** What each meal of the day is called, by how many there are. Still here for the fallback above
 *  and for any profile that has never been saved since the tickboxes arrived. */
export function mealSlots(n: number): string[] {
  switch (Math.max(1, Math.min(6, n))) {
    case 1: return ["Main meal"]
    case 2: return ["Breakfast", "Dinner"]
    case 3: return ["Breakfast", "Lunch", "Dinner"]
    case 4: return ["Breakfast", "Lunch", "Snack", "Dinner"]
    case 5: return ["Breakfast", "Snack", "Lunch", "Snack", "Dinner"]
    default: return ["Breakfast", "Snack", "Lunch", "Snack", "Dinner", "Evening snack"]
  }
}

// ── Units ────────────────────────────────────────────────────────────────────
// Entered in stone/pounds and feet/inches; stored in kg and cm.

const LB_KG = 0.45359237
export const kgFromStone = (st: number, lb: number) => (st * 14 + lb) * LB_KG
export const cmFromFeet  = (ft: number, inch: number) => (ft * 12 + inch) * 2.54

export function stoneFromKg(kg: number): { st: number; lb: number } {
  const totalLb = Math.round(kg / LB_KG)
  return { st: Math.floor(totalLb / 14), lb: totalLb % 14 }
}
export function feetFromCm(cm: number): { ft: number; in: number } {
  const totalIn = Math.round(cm / 2.54)
  return { ft: Math.floor(totalIn / 12), in: totalIn % 12 }
}

// ── The maths ────────────────────────────────────────────────────────────────

export type ProfileNumbers = {
  sex: string; age: number | null; heightCm: number | null; weightKg: number | null
  activity: string; goalDelta: number; kcalOverride: number | null
  proteinPct: number; carbsPct: number; fatPct: number
  /** Optional here — the calories come from `goalDelta`; the goal decides the cooking. */
  goal?: string
}

export type Targets = {
  bmr: number; tdee: number; kcal: number
  protein: number; carbs: number; fat: number   // grams a day
  proteinPct: number; carbsPct: number; fatPct: number
  overridden: boolean
}

/** Mifflin–St Jeor — the formula dietitians use today (Harris–Benedict is the 1919 one). */
export function bmr(sex: string, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return Math.round(sex === "female" ? base - 161 : base + 5)
}

/** null until sex, age, height and weight are all in. */
export function targets(p: ProfileNumbers): Targets | null {
  if (!p.age || !p.heightCm || !p.weightKg) return null
  const rest = bmr(p.sex, p.weightKg, p.heightCm, p.age)
  const mult = ACTIVITY.find(a => a.key === p.activity)?.mult ?? 1.375
  const tdee = Math.round(rest * mult)
  const overridden = !!p.kcalOverride && p.kcalOverride > 0
  // The goal decides which gaps are on offer, so a delta left over from a previous goal is
  // corrected here too — never silently run a deficit under "Build muscle".
  const delta = p.goal ? deltaFor(p.goal, p.goalDelta) : p.goalDelta
  // ⚠ Never below the BMR — a target under what the body burns at rest is a starvation plan.
  const kcal = overridden ? p.kcalOverride! : Math.max(rest, tdee + delta)
  const pct = { protein: p.proteinPct, carbs: p.carbsPct, fat: p.fatPct }
  const sum = pct.protein + pct.carbs + pct.fat || 100
  return {
    bmr: rest, tdee, kcal, overridden,
    proteinPct: pct.protein, carbsPct: pct.carbs, fatPct: pct.fat,
    protein: Math.round((kcal * pct.protein / sum) / 4),
    carbs:   Math.round((kcal * pct.carbs   / sum) / 4),
    fat:     Math.round((kcal * pct.fat     / sum) / 9),
  }
}

// ── The plan ─────────────────────────────────────────────────────────────────

export type Ingredient = { item: string; qty: string }
export type Meal = {
  slot: string; name: string; prepMinutes: number
  ingredients: Ingredient[]; method: string[]
  kcal: number; protein: number; carbs: number; fat: number
}
export type PlanDay = { day: number; meals: Meal[] }
export type Plan = { title: string; tips: string; days: PlanDay[] }

/** `price` is the AI's estimate in POUNDS for the quantity bought — 0 means it didn't give one
 *  (an old list made before estimates existed, or an item it wouldn't guess at). */
export type ShoppingItem = { item: string; qty: string; done: boolean; price: number }
export type ShoppingGroup = { name: string; items: ShoppingItem[] }
/** `stale` = a meal was swapped after this list was made, so it is buying for a plan that has
 *  changed. ⚠ Kept INSIDE the JSON rather than as a column — no migration, and the flag can
 *  never drift away from the list it describes. */
export type Shopping = { groups: ShoppingGroup[]; stale?: boolean }

const str = (v: unknown, max = 400) => String(v ?? "").trim().slice(0, max)
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0 }
/** Pounds and pence. Strips a £ if the model wrote one; anything daft (or negative) is 0 = no
 *  estimate, so one silly figure can never poison the total. */
const money = (v: unknown) => {
  const n = Number(typeof v === "string" ? v.replace(/[£,\s]/g, "") : v)
  return Number.isFinite(n) && n > 0 && n < 500 ? Math.round(n * 100) / 100 : 0
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** One meal, coerced. Shared by the plan and by the swap options, so a swapped-in meal is held to
 *  exactly the same shape as one the plan was born with. */
export function normaliseMeal(m: unknown): Meal {
  const mm = (m && typeof m === "object" ? m : {}) as Record<string, unknown>
  return {
    slot: str(mm.slot, 40) || "Meal",
    name: str(mm.name, 120) || "Untitled",
    prepMinutes: num(mm.prepMinutes),
    ingredients: arr(mm.ingredients).map(x => {
      const xx = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
      return typeof x === "string" ? { item: str(x, 120), qty: "" } : { item: str(xx.item, 120), qty: str(xx.qty, 40) }
    }).filter(x => x.item),
    method: arr(mm.method).map(s => str(s, 600)).filter(Boolean),
    kcal: num(mm.kcal), protein: num(mm.protein), carbs: num(mm.carbs), fat: num(mm.fat),
  }
}

/** Coerce whatever the model (or an old row) returned into a complete Plan — a missing array
 *  must become an empty one, never a crashed page. */
export function normalisePlan(raw: unknown): Plan {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const days = arr(r.days).map((d, i) => {
    const dd = (d && typeof d === "object" ? d : {}) as Record<string, unknown>
    return { day: num(dd.day) || i + 1, meals: arr(dd.meals).map(normaliseMeal) }
  }).filter(d => d.meals.length)
  return { title: str(r.title, 120), tips: str(r.tips, 1000), days }
}

// ── Swapping one meal ────────────────────────────────────────────────────────
// Jordan, 2026-09-17: "can I have like a substitute option where it will swap it for something
// else?". ⚠ Three COMPLETE meals come back in one call, not names to expand later — picking one
// applies instantly instead of making him wait twice.

export function swapMealSystemPrompt(): string {
  return `You suggest replacement meals for one adult in the UK. Real, cookable recipes from a normal UK supermarket, metric quantities, British spelling.

RULES:
1. Every option must be for the SAME meal of the day, and must land within about 10% of the calories given and NOT below the protein given. Those numbers are what the day is built on — a "lighter option" that misses them is no use.
2. NEVER use a food listed under dislikes or allergies, in any form or hidden in anything.
3. Make the three genuinely different from each other — a different protein or a different style, not three versions of the same dish. None of them may be the meal being replaced.
4. Honest nutrition for the quantities written, worked out from the ingredients. One serving.
5. Short numbered method, at most 8 steps.
6. Give exactly 3 options.
7. Answer with JSON only, exactly this shape: {"options":[{"slot":"Dinner","name":"...","prepMinutes":20,"why":"one short line on when you'd pick this one","ingredients":[{"item":"chicken breast","qty":"200 g"}],"method":["..."],"kcal":620,"protein":48,"carbs":55,"fat":18}]}`
}

export function swapMealUserPrompt(input: {
  meal: Meal; dayNo: number; likes: string; dislikes: string; notes: string; why: string
  goal?: string; otherMeals: string[]
}): string {
  return [
    `REPLACING, on day ${input.dayNo}: ${input.meal.slot} — "${input.meal.name}" (${input.meal.kcal} kcal, protein ${input.meal.protein} g, carbs ${input.meal.carbs} g, fat ${input.meal.fat} g).`,
    `THE REPLACEMENT MUST HIT: about ${input.meal.kcal} kcal and at least ${input.meal.protein} g protein, as a ${input.meal.slot.toLowerCase()}.`,
    input.goal ? goalDef(input.goal).prompt.replace("%D%", "the planned") : "",
    input.likes.trim()    ? `LIKES / USUAL FOODS: ${input.likes.trim()}` : "",
    input.dislikes.trim() ? `DISLIKES AND ALLERGIES — NEVER USE: ${input.dislikes.trim()}` : "",
    input.notes.trim()    ? `OTHER NOTES: ${input.notes.trim()}` : "",
    input.why.trim()      ? `WHY IT IS BEING REPLACED: ${input.why.trim()}` : "",
    input.otherMeals.length ? `ALREADY ON THE PLAN THIS WEEK — don't suggest these again: ${input.otherMeals.join("; ")}` : "",
  ].filter(Boolean).join("\n")
}

export type MealOption = Meal & { why: string }

export function normaliseMealOptions(raw: unknown): MealOption[] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return arr(r.options).map(o => {
    const oo = (o && typeof o === "object" ? o : {}) as Record<string, unknown>
    return { ...normaliseMeal(o), why: str(oo.why, 200) }
  }).filter(o => o.name !== "Untitled" && o.ingredients.length).slice(0, 4)
}

/** Put a chosen meal into a saved plan. Returns null when that day or slot has gone, so the
 *  caller can say so rather than saving nothing and reporting success. */
export function applyMealSwap(plan: Plan, dayNo: number, index: number, meal: Meal): Plan | null {
  const day = plan.days.find(d => d.day === dayNo)
  if (!day || !day.meals[index]) return null
  return {
    ...plan,
    days: plan.days.map(d => d.day !== dayNo ? d : {
      ...d,
      // ⚠ The SLOT is kept from the meal being replaced — the model is asked for the same one,
      // but a plan whose dinner turns into a second breakfast reads as broken.
      meals: d.meals.map((m, i) => i !== index ? m : { ...meal, slot: m.slot }),
    }),
  }
}

export function normaliseShopping(raw: unknown, keepDone?: Shopping | null): Shopping {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  // Ticks survive a re-make when the same item comes back.
  const wasDone = new Set<string>()
  for (const g of keepDone?.groups ?? []) for (const it of g.items) if (it.done) wasDone.add(it.item.toLowerCase())
  const groups = arr(r.groups).map(g => {
    const gg = (g && typeof g === "object" ? g : {}) as Record<string, unknown>
    return {
      name: str(gg.name, 60) || "Other",
      items: arr(gg.items).map(x => {
        const xx = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
        const item = typeof x === "string" ? str(x, 120) : str(xx.item, 120)
        return {
          item,
          qty:   typeof x === "string" ? "" : str(xx.qty, 40),
          done:  xx.done === true || wasDone.has(item.toLowerCase()),
          price: typeof x === "string" ? 0 : money(xx.price),
        }
      }).filter(x => x.item),
    }
  }).filter(g => g.items.length)
  return { groups, stale: r.stale === true }
}

/** A saved plan row in the shape the client works with. Lives here, not in a route file — Next
 *  route files may only export HTTP handlers, and two routes need it. */
export function planOut(r: {
  id: string; title: string; days: number; targets: unknown; plan: unknown; shopping: unknown
  brief: string; model: string; createdAt: Date
}) {
  return {
    id: r.id, title: r.title, days: r.days, brief: r.brief, model: r.model, createdAt: r.createdAt,
    targets: (r.targets && typeof r.targets === "object" ? r.targets : {}) as Record<string, number>,
    plan: normalisePlan(r.plan),
    shopping: r.shopping ? normaliseShopping(r.shopping) : null,
  }
}

export function dayTotals(day: PlanDay): { kcal: number; protein: number; carbs: number; fat: number } {
  return day.meals.reduce((t, m) => ({ kcal: t.kcal + m.kcal, protein: t.protein + m.protein, carbs: t.carbs + m.carbs, fat: t.fat + m.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 })
}

/** £4 · £4.50 — pence only when there are any. */
export const gbp = (n: number) => `£${n.toFixed(2).replace(/\.00$/, "")}`

/** What the list adds up to. `priced` says how many items carry an estimate at all — with none
 *  (an old list) the screen shows no total rather than a confident £0. */
export function shoppingTotals(s: Shopping): { total: number; toGet: number; priced: number; items: number } {
  let total = 0, toGet = 0, priced = 0, items = 0
  for (const g of s.groups) for (const it of g.items) {
    items++
    if (it.price > 0) { priced++; total += it.price; if (!it.done) toGet += it.price }
  }
  return { total: Math.round(total * 100) / 100, toGet: Math.round(toGet * 100) / 100, priced, items }
}

/** The shopping list as plain text, for the clipboard. */
export function shoppingText(s: Shopping, title: string): string {
  const lines = [title.toUpperCase()]
  for (const g of s.groups) {
    lines.push("", g.name.toUpperCase())
    for (const it of g.items) {
      lines.push(`${it.done ? "[x]" : "[ ]"} ${it.qty ? `${it.qty} ` : ""}${it.item}${it.price > 0 ? ` — ${gbp(it.price)}` : ""}`)
    }
  }
  const { total, priced } = shoppingTotals(s)
  if (priced > 0) lines.push("", `ESTIMATED TOTAL ${gbp(total)} (a rough guide, not real prices)`)
  return lines.join("\n")
}

// ── Prompts ──────────────────────────────────────────────────────────────────

export function planSystemPrompt(): string {
  return `You plan meals for one adult living in the UK. Write real, cookable recipes using ingredients from a normal UK supermarket, in metric quantities (g, ml, or counts), with British spelling. No brand names needed.

RULES — every one of them matters:
1. Every day's meals must add up to the daily target: total calories within 5% of the target, and protein within 10% of the target and never under it. Carbs and fat may flex to make the calories work.
2. Give each meal honest nutrition figures for the quantities written — work them out from the ingredients, never round guesses. Figures are for ONE serving; every recipe serves one unless its name says it is a batch.
3. NEVER use a food listed under dislikes or allergies, in any form or as a hidden ingredient.
4. Keep the shopping simple: reuse ingredients across the days (the same protein two nights, the same vegetables in several meals). Prefer recipes under 30 minutes unless a slower one is clearly worth it.
5. Vary the days. A batch cook is fine when it says so in the meal's name, e.g. "Chilli (batch — day 1 of 2)".
6. Method: short numbered steps, at most 8.
7. Answer with JSON only, exactly this shape and nothing else:
{"title":"a short name for the plan","tips":"one or two lines of prep-ahead or batch-cook advice","days":[{"day":1,"meals":[{"slot":"Breakfast","name":"...","prepMinutes":10,"ingredients":[{"item":"chicken breast","qty":"200 g"}],"method":["...","..."],"kcal":520,"protein":42,"carbs":48,"fat":16}]}]}`
}

export function planUserPrompt(input: {
  name: string; sex: string; age: number | null; weightKg: number | null
  t: Targets; days: number; slots: string[]; likes: string; dislikes: string; notes: string; brief: string
  goal?: string; goalDelta?: number
  /** Written a few days at a time — see the plan route. Day numbers are the REAL ones. */
  fromDay?: number; toDay?: number; alreadyMade?: string[]
}): string {
  const slots = input.slots
  // ⚠ The goal is the SHAPE of the food, not just the calorie number — without this line the
  // model wrote the same meals for someone cutting and someone building.
  const g = goalDef(input.goal)
  const gap = Math.abs(deltaFor(input.goal, input.goalDelta ?? g.defaultDelta))
  const lines = [
    `PERSON: ${input.name} — ${input.sex}, ${input.age ?? "?"} years old, ${input.weightKg ? `${Math.round(input.weightKg)} kg` : "weight unknown"}.`,
    g.prompt.replace("%D%", String(gap)),
    `DAILY TARGET: ${input.t.kcal} kcal · protein ${input.t.protein} g · carbs ${input.t.carbs} g · fat ${input.t.fat} g.`,
    // ⚠ A long plan is written a few days at a time, so the model is asked for a RANGE and told
    // what it has already written — otherwise day 5 is the same dinner as day 1.
    input.fromDay && input.toDay && (input.fromDay !== 1 || input.toDay !== input.days)
      ? `PLAN: part of a ${input.days}-day plan. Write ONLY days ${input.fromDay} to ${input.toDay}, numbered exactly that way. ${slots.length} meals a day, in this order each day: ${slots.join(", ")}. Use exactly these slot names.`
      : `PLAN: ${input.days} day${input.days === 1 ? "" : "s"}, ${slots.length} meals a day, in this order each day: ${slots.join(", ")}. Use exactly these slot names.`,
    input.alreadyMade?.length
      ? `ALREADY WRITTEN FOR THE EARLIER DAYS — do NOT repeat these, though reusing the same ingredients is good: ${input.alreadyMade.join("; ")}`
      : "",
    input.likes.trim()    ? `LIKES / USUAL FOODS: ${input.likes.trim()}` : "",
    input.dislikes.trim() ? `DISLIKES AND ALLERGIES — NEVER USE: ${input.dislikes.trim()}` : "",
    input.notes.trim()    ? `OTHER NOTES: ${input.notes.trim()}` : "",
    input.brief.trim()    ? `THIS PLAN SPECIFICALLY: ${input.brief.trim()}` : "",
  ]
  return lines.filter(Boolean).join("\n")
}

export function shoppingSystemPrompt(): string {
  return `You turn the recipes of a meal plan into ONE shopping list for a UK supermarket.
- Combine the same ingredient across every recipe into a single line with the TOTAL quantity, rounded UP to what you would actually buy (a 500 g pack, 6 eggs, 1 bag, 1 tin).
- Group by aisle, using exactly these group names in this order (leave out any that are empty): "Fruit & veg", "Meat & fish", "Dairy & eggs", "Bakery", "Tins, jars & dry goods", "Frozen", "Herbs, spices & sauces", "Other".
- Leave out water, salt and pepper, and cooking oil. Everything else goes on, even if most kitchens have it.
- Give each line a "price": what that quantity typically costs in POUNDS at a mid-range UK supermarket (Tesco, Sainsbury's, Asda) at own-brand prices — a plain number like 2.75, no £ sign, no range. Price what you would actually BUY, so a recipe needing 100 g of a 500 g pack is priced as the pack. If you genuinely cannot judge an item, use 0 rather than a wild guess.
- Answer with JSON only, exactly this shape: {"groups":[{"name":"Fruit & veg","items":[{"item":"chicken breast","qty":"1 kg","price":6.50}]}]}`
}

export function shoppingUserPrompt(plan: Plan): string {
  const lines: string[] = [`PLAN: ${plan.title || "meal plan"} — ${plan.days.length} day(s).`, "RECIPES AND THEIR INGREDIENTS:"]
  for (const d of plan.days) for (const m of d.meals) {
    lines.push(`Day ${d.day} ${m.slot} — ${m.name}: ${m.ingredients.map(i => `${i.qty} ${i.item}`.trim()).join("; ")}`)
  }
  return lines.join("\n")
}
