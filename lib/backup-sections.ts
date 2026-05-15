export interface BackupSection {
  label: string
  description: string
  tables: string[]
}

export const BACKUP_SECTIONS: Record<string, BackupSection> = {
  admin: {
    label: "Admin & Settings",
    description: "Users, departments, devices, email templates, macro files, packers",
    tables: [
      "departments", "users", "bcTokens", "roleDefaults",
      "appCards", "devices", "claudeMemory", "emailTemplates", "macroFiles", "packers",
    ],
  },
  contacts: {
    label: "Contacts & Customers",
    description: "Contact records and customer accounts",
    tables: ["contacts", "customerAccounts"],
  },
  submissions: {
    label: "Submissions & Items",
    description: "Submissions, items, valuations, contact logs, logistics",
    tables: ["submissions", "items", "valuations", "contactLogs", "logistics"],
  },
  cataloguing: {
    label: "Cataloguing & Auctions",
    description: "Auction runs, lots, catalogue auctions, live auctions, bidder registrations",
    tables: [
      "auctionRuns", "auctionLots", "aiPresets",
      "catalogueAuctions", "liveAuctions", "catalogueLots",
      "bidderRegistrations", "commissionBids",
      "idleLogs", "catalogueTimingLogs", "cataloguePhotoSessions",
    ],
  },
  marketing: {
    label: "Marketing",
    description: "Marketing drafts, hashtags, hero slides",
    tables: ["marketingDrafts", "marketingHashtags", "heroSlides"],
  },
  parcels: {
    label: "Parcels",
    description: "Parcel records and parcel lots",
    tables: ["parcels", "parcelLots"],
  },
  helpdesk: {
    label: "Help & Knowledge Base",
    description: "Knowledge articles, ticket categories, tickets, comments",
    tables: ["knowledgeArticles", "ticketCategories", "tickets", "ticketComments"],
  },
  research: {
    label: "Research",
    description: "Research log entries",
    tables: ["researchLogs"],
  },
}

export const ALL_SECTION_KEYS = Object.keys(BACKUP_SECTIONS)

/** Returns the deduplicated list of table names for the given section keys. */
export function getTablesForSections(sectionKeys: string[]): string[] {
  const seen = new Set<string>()
  for (const key of sectionKeys) {
    for (const t of BACKUP_SECTIONS[key]?.tables ?? []) seen.add(t)
  }
  return [...seen]
}
