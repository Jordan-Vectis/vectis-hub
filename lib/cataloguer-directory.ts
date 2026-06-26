// Cataloguer directory — maps a BC salesperson/cataloguer code (WarehouseItem.cataloguedBy)
// to that staff member's name and email. Seeded from the BC "User Setup" export.
// Update here when staff change.

export type CataloguerEntry = { name: string; email: string }

export const CATALOGUER_DIRECTORY: Record<string, CataloguerEntry> = {
  AA: { name: "Abigail Andrew", email: "abigail.andrew@vectis.co.uk" },
  AM: { name: "User_4b5238814e754bbc84838f7ab9d5db2d", email: "user_4b5238814e754bbc84838f7ab9d5db2d@bcn.co.uk" },
  AR: { name: "Andrea Rowntree", email: "andrea.rowntree@vectis.co.uk" },
  AR2: { name: "Andrew Reed", email: "andrew@vectis.co.uk" },
  AROB: { name: "Amelia Robson", email: "amelia.robson@vectis.co.uk" },
  AW: { name: "Andrew Wilson", email: "andrew.wilson@vectis.co.uk" },
  BC: { name: "Bob Coulson", email: "bob.coulson@hambletongroup.com" },
  BG: { name: "Bryan Goodall", email: "Bryan.Goodall@vectis.co.uk" },
  BJ: { name: "Becky Jones", email: "becky@hambletongroup.com" },
  BK: { name: "Ben Kennington", email: "ben.kennington@vectis.co.uk" },
  CDT: { name: "Craig Deery-Taylor", email: "craig.deery-taylor@vectis.co.uk" },
  CH: { name: "Chris Hemingway", email: "chris.hemingway@hambletongroup.com" },
  CW: { name: "Chris Whan", email: "chris.whan@vectis.co.uk" },
  DB: { name: "Daniel Brakenbury", email: "daniel.brakenbury@vectis.co.uk" },
  DC: { name: "Dave Cannings", email: "dave.cannings@vectis.co.uk" },
  DEBBIEC: { name: "Debbiecockerill", email: "debbie@vectis.co.uk" },
  DL: { name: "Daniel Lorraine", email: "daniel.lorraine@vectis.co.uk" },
  DP: { name: "Dispatch", email: "Dispatch@vectis.co.uk" },
  ED: { name: "Edward Duffy", email: "edward.duffy@vectis.co.uk" },
  EG: { name: "Ewan Gray", email: "ewan.gray@vectis.co.uk" },
  ET: { name: "Emma Tomlinson", email: "emma.tomlinson@hambletongroup.com" },
  EVO: { name: "User_ef2adf2c4bfa44bc94906848aa9293ac", email: "user_ef2adf2c4bfa44bc94906848aa9293ac@bcn.co.uk" },
  EW: { name: "Eve Walker", email: "eve.walker@vectis.co.uk" },
  GH: { name: "Gill Harley", email: "gill.harley@hambletongroup.com" },
  HW: { name: "Harry Wheatley", email: "harry.wheatley@vectis.co.uk" },
  IM: { name: "Ian Main", email: "ian.main@vectis.co.uk" },
  JC: { name: "Jack Collings", email: "jack.collings@vectis.co.uk" },
  JGOOD: { name: "Jonathan Goodall", email: "jonathan.goodall@hambletongroup.com" },
  JK: { name: "Jake Kenyon", email: "jake.kenyon@vectis.co.uk" },
  JO: { name: "Jordan Orange", email: "jordan.orange@vectis.co.uk" },
  JS: { name: "Jake Smithson", email: "jake.smithson@vectis.co.uk" },
  KR: { name: "Kay Rankin", email: "kay.rankin@vectis.co.uk" },
  KS: { name: "Keiran Southgate", email: "keiran.southgate@vectis.co.uk" },
  KT: { name: "Kathy Taylor", email: "Kathy.Taylor@vectis.co.uk" },
  LH: { name: "Lesley Hill", email: "lesley.hill@hambletongroup.com" },
  LOUISEH: { name: "Louise", email: "louise@vectis.co.uk" },
  LS: { name: "Lisa", email: "lisa@hambletongroup.com" },
  LW: { name: "Leanne Whitelock", email: "leanne.whitelock@vectis.co.uk" },
  MB: { name: "Matt Bailey", email: "matt.bailey@vectis.co.uk" },
  MBAR: { name: "Matthew Barras", email: "matthew.barras@hambletongroup.com" },
  MD: { name: "Mike Delaney", email: "mike.delaney@vectis.co.uk" },
  MF: { name: "Mike Fishwick", email: "mike.fishwick@hambletongroup.com" },
  MT: { name: "Michelle Trotter", email: "michelle.trotter@vectis.co.uk" },
  MV: { name: "Melanie Vasey", email: "melanie.vasey@vectis.co.uk" },
  ND: { name: "Nick Dykes", email: "nick.dykes@vectis.co.uk" },
  NO: { name: "Naomi Oconner", email: "naomi.oconner@vectis.co.uk" },
  OB: { name: "Olivia Burley", email: "olivia.burley@vectis.co.uk" },
  OJ: { name: "Olivia Jordan", email: "Olivia.Jordan@vectis.co.uk" },
  PATM: { name: "Pat Mcknight", email: "Patricia.McKnight@vectis.co.uk" },
  PB: { name: "Paul Beverley", email: "paul_bev@vectis.co.uk" },
  PC: { name: "Phil Cochrane", email: "phil.cochrane@vectis.co.uk" },
  PD: { name: "Peter Davis", email: "peter.davis@vectis.co.uk" },
  PM: { name: "Peter Morris", email: "peter.morris@vectis.co.uk" },
  SC: { name: "Simon Clarke", email: "simon.clark@vectis.co.uk" },
  SM: { name: "Sanaz Moghaddam", email: "sanaz.moghaddam@vectis.co.uk" },
  SS: { name: "Simon Smith", email: "simon@vectis.co.uk" },
  SW: { name: "Stephanie Williamson", email: "stephanie.williamson@hambletongroup.com" },
  TR: { name: "Timothy Routh", email: "timothy.routh@vectis.co.uk" },
  US1: { name: "User_01854d670fae4175ac71a5d80da303bd", email: "user_01854d670fae4175ac71a5d80da303bd@bcn.co.uk" },
  US2: { name: "User_b693831159994b709bdaf81039596314", email: "user_b693831159994b709bdaf81039596314@bcn.co.uk" },
  VA: { name: "Vectis Accounts", email: "accounts@vectis.co.uk" },
  VS: { name: "Vanessa Stanton", email: "vanessa.stanton@vectis.co.uk" },
  WA: { name: "Admin Warehouse", email: "admin.warehouse@vectis.co.uk" },
  WR: { name: "Wendy Robins", email: "wendy.robins@hambletongroup.com" },
}

// Look up a cataloguer by their BC code (case-insensitive). Returns null if unknown.
export function lookupCataloguerByCode(code: string | null | undefined): (CataloguerEntry & { code: string }) | null {
  if (!code) return null
  const key = code.trim().toUpperCase()
  const entry = CATALOGUER_DIRECTORY[key]
  return entry ? { code: key, ...entry } : null
}
