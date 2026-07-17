// Shared Prisma error classification.
//
// Code deploys to Railway before Run Migrations is clicked, so "this table doesn't
// exist yet" is an EXPECTED state that pages must degrade into rather than 500 on.
// But it must be told apart from a real database fault: reporting a dead database
// as a missing migration sends the admin to a button that can't help and hides the
// actual problem. Same reasoning as the message-matching in
// app/api/bc/cataloguing/route.ts.

// P2021 = Prisma "table does not exist"; 42P01 is the underlying Postgres code,
// which can surface through the pg adapter instead. The message check is a last
// resort for when neither code is attached.
export function isMissingTable(e: any): boolean {
  if (e?.code === "P2021" || e?.code === "42P01") return true
  return /does not exist|relation .* does not exist/i.test(e?.message ?? "")
}
