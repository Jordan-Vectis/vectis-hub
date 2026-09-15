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

/** Calories a day against maintenance. About 7,700 kcal is a kilo of fat, so −500 a day is
 *  roughly a pound a week. */
export const GOALS: { delta: number; label: string }[] = [
  { delta: -750, label: "Lose faster — about 1½ lb a week" },
  { delta: -500, label: "Lose — about 1 lb a week" },
  { delta: -250, label: "Lose gently — about ½ lb a week" },
  { delta: 0,    label: "Maintain" },
  { delta: 250,  label: "Gain gently" },
  { delta: 500,  label: "Gain" },
]

export const MACRO_PRESETS: { label: string; protein: number; carbs: number; fat: number }[] = [
  { label: "Balanced",     protein: 30, carbs: 40, fat: 30 },
  { label: "High protein", protein: 40, carbs: 30, fat: 30 },
  { label: "Lower carb",   protein: 35, carbs: 25, fat: 40 },
]

/** What each meal of the day is called, by how many there are. */
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
  // ⚠ Never below the BMR — a target under what the body burns at rest is a starvation plan.
  const kcal = overridden ? p.kcalOverride! : Math.max(rest, tdee + p.goalDelta)
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

export type ShoppingItem = { item: string; qty: string; done: boolean }
export type ShoppingGroup = { name: string; items: ShoppingItem[] }
export type Shopping = { groups: ShoppingGroup[] }

const str = (v: unknown, max = 400) => String(v ?? "").trim().slice(0, max)
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0 }
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Coerce whatever the model (or an old row) returned into a complete Plan — a missing array
 *  must become an empty one, never a crashed page. */
export function normalisePlan(raw: unknown): Plan {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const days = arr(r.days).map((d, i) => {
    const dd = (d && typeof d === "object" ? d : {}) as Record<string, unknown>
    return {
      day: num(dd.day) || i + 1,
      meals: arr(dd.meals).map(m => {
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
      }),
    }
  }).filter(d => d.meals.length)
  return { title: str(r.title, 120), tips: str(r.tips, 1000), days }
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
        return { item, qty: typeof x === "string" ? "" : str(xx.qty, 40), done: xx.done === true || wasDone.has(item.toLowerCase()) }
      }).filter(x => x.item),
    }
  }).filter(g => g.items.length)
  return { groups }
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

/** The shopping list as plain text, for the clipboard. */
export function shoppingText(s: Shopping, title: string): string {
  const lines = [title.toUpperCase()]
  for (const g of s.groups) {
    lines.push("", g.name.toUpperCase())
    for (const it of g.items) lines.push(`${it.done ? "[x]" : "[ ]"} ${it.qty ? `${it.qty} ` : ""}${it.item}`)
  }
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
  t: Targets; days: number; mealsPerDay: number; likes: string; dislikes: string; notes: string; brief: string
}): string {
  const slots = mealSlots(input.mealsPerDay)
  const lines = [
    `PERSON: ${input.name} — ${input.sex}, ${input.age ?? "?"} years old, ${input.weightKg ? `${Math.round(input.weightKg)} kg` : "weight unknown"}.`,
    `DAILY TARGET: ${input.t.kcal} kcal · protein ${input.t.protein} g · carbs ${input.t.carbs} g · fat ${input.t.fat} g.`,
    `PLAN: ${input.days} day${input.days === 1 ? "" : "s"}, ${input.mealsPerDay} meals a day, in this order each day: ${slots.join(", ")}. Use exactly these slot names.`,
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
- Answer with JSON only, exactly this shape: {"groups":[{"name":"Fruit & veg","items":[{"item":"chicken breast","qty":"1 kg"}]}]}`
}

export function shoppingUserPrompt(plan: Plan): string {
  const lines: string[] = [`PLAN: ${plan.title || "meal plan"} — ${plan.days.length} day(s).`, "RECIPES AND THEIR INGREDIENTS:"]
  for (const d of plan.days) for (const m of d.meals) {
    lines.push(`Day ${d.day} ${m.slot} — ${m.name}: ${m.ingredients.map(i => `${i.qty} ${i.item}`.trim()).join("; ")}`)
  }
  return lines.join("\n")
}
