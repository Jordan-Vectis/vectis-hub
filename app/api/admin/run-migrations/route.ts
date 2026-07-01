import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// POST /api/admin/run-migrations
// Runs any missing column additions directly via SQL.
// Safe to call multiple times — all statements use IF NOT EXISTS.

const MIGRATIONS = [
  `ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "extraDetails" TEXT`,
  `ALTER TABLE "PipelineLot" ADD COLUMN IF NOT EXISTS "appliedDesc" TEXT`,
  `ALTER TABLE "AiPreset" ADD COLUMN IF NOT EXISTS "favourite" BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastTote"    TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastVendor"  TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastReceipt" TEXT`,
  `CREATE TABLE IF NOT EXISTS "ToolModel" (
    "slot"      TEXT NOT NULL,
    "modelId"   TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "ToolModel_pkey" PRIMARY KEY ("slot")
  )`,
  `CREATE TABLE IF NOT EXISTS "ConditionWording" (
    "id"        TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "ConditionWording_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ConditionWording_label_key" UNIQUE ("label")
  )`,
  `CREATE TABLE IF NOT EXISTS "Announcement" (
    "id"            TEXT NOT NULL,
    "message"       TEXT NOT NULL DEFAULT '',
    "level"         TEXT NOT NULL DEFAULT 'warning',
    "active"        BOOLEAN NOT NULL DEFAULT false,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedByName" TEXT,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "RoleDefault" (
    "role"           TEXT NOT NULL,
    "allowedApps"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "appPermissions" JSONB,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RoleDefault_pkey" PRIMARY KEY ("role")
  )`,
  `CREATE TABLE IF NOT EXISTS "Device" (
    "id"           TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "deviceType"   TEXT NOT NULL DEFAULT 'iPad',
    "notes"        TEXT,
    "assignedToId" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Device_serialNumber_key" UNIQUE ("serialNumber")
  )`,
  `CREATE TABLE IF NOT EXISTS "ClaudeMemory" (
    "filename"  TEXT NOT NULL,
    "content"   TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "ClaudeMemory_pkey" PRIMARY KEY ("filename")
  )`,
  `CREATE TABLE IF NOT EXISTS "MarketingDraft" (
    "id"            TEXT NOT NULL,
    "title"         TEXT NOT NULL,
    "contentType"   TEXT NOT NULL,
    "content"       TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedUrl"  TEXT,
    "createdById"   TEXT,
    "createdByName" TEXT,
    "lotsSnapshot"  JSONB,
    "notes"         TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "MarketingDraft_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "MarketingHashtag" (
    "id"        TEXT NOT NULL,
    "category"  TEXT NOT NULL,
    "hashtags"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "MarketingHashtag_pkey" PRIMARY KEY ("id")
  )`,
  // BC cataloguing-report cache: split into two modes (barcode | uniqueid).
  // Existing rows keep their default 'barcode' value, no data loss.
  `ALTER TABLE "BCCatalogueDay"   ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'barcode'`,
  `ALTER TABLE "BCCatalogueEntry" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'barcode'`,
  `ALTER TABLE "BCCatalogueDay"   DROP CONSTRAINT IF EXISTS "BCCatalogueDay_pkey"`,
  `ALTER TABLE "BCCatalogueEntry" DROP CONSTRAINT IF EXISTS "BCCatalogueEntry_pkey"`,
  `ALTER TABLE "BCCatalogueDay"   ADD CONSTRAINT "BCCatalogueDay_pkey"   PRIMARY KEY ("date", "mode")`,
  `ALTER TABLE "BCCatalogueEntry" ADD CONSTRAINT "BCCatalogueEntry_pkey" PRIMARY KEY ("date", "userId", "mode")`,
  // CatalogueLot.addedToBC — manual cataloguer tick once a lot has gone over to BC
  `ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "addedToBC" BOOLEAN NOT NULL DEFAULT FALSE`,

  // Packer — packing-floor staff list, used to generate the barcode sheet
  `CREATE TABLE IF NOT EXISTS "Packer" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "staffGroup"  TEXT NOT NULL DEFAULT 'FULL_TIME',
    "active"      BOOLEAN NOT NULL DEFAULT TRUE,
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "Packer_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "Packer_staffGroup_idx" ON "Packer"("staffGroup")`,
  `ALTER TABLE "Packer" ADD COLUMN IF NOT EXISTS "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,

  // User.role: convert from enum Role → TEXT so admins can add custom roles.
  // Existing enum values ('ADMIN', 'COLLECTIONS', 'CATALOGUER') survive
  // unchanged as their text equivalents. The old "Role" enum type stays
  // in the DB (harmless) so we don't need a DROP TYPE.
  // The DO block makes it idempotent — repeats just check the column type.
  `DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'User' AND column_name = 'role' AND udt_name = 'Role'
     ) THEN
       ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
       ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT USING role::text;
       ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'COLLECTIONS';
     END IF;
   END $$`,

  // Ticket — IT problem / feature request log
  `CREATE TABLE IF NOT EXISTS "Ticket" (
    "id"             TEXT NOT NULL,
    "title"          TEXT NOT NULL,
    "description"    TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'OPEN',
    "priority"       TEXT NOT NULL DEFAULT 'MEDIUM',
    "category"       TEXT NOT NULL DEFAULT 'OTHER',
    "createdById"    TEXT,
    "createdByName"  TEXT NOT NULL,
    "assignedToId"   TEXT,
    "assignedToName" TEXT,
    "resolvedAt"     TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "Ticket_status_idx"    ON "Ticket"("status")`,
  `CREATE INDEX IF NOT EXISTS "Ticket_priority_idx"  ON "Ticket"("priority")`,
  `CREATE INDEX IF NOT EXISTS "Ticket_createdAt_idx" ON "Ticket"("createdAt")`,

  // KnowledgeArticle — IT solutions & how-tos for the IT Help chatbot
  `CREATE TABLE IF NOT EXISTS "KnowledgeArticle" (
    "id"            TEXT NOT NULL,
    "title"         TEXT NOT NULL,
    "body"          TEXT NOT NULL,
    "tags"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "category"      TEXT NOT NULL DEFAULT 'GENERAL',
    "createdById"   TEXT,
    "createdByName" TEXT NOT NULL,
    "updatedById"   TEXT,
    "updatedByName" TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "KnowledgeArticle_category_idx"  ON "KnowledgeArticle"("category")`,
  `CREATE INDEX IF NOT EXISTS "KnowledgeArticle_updatedAt_idx" ON "KnowledgeArticle"("updatedAt")`,

  `CREATE TABLE IF NOT EXISTS "TicketCategory" (
    "id"        TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active"    BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "TicketCategory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TicketCategory_key_key" UNIQUE ("key")
  )`,

  // EmailTemplate — pre-typed reply snippets for the IT Tools "Templates" tab
  `CREATE TABLE IF NOT EXISTS "EmailTemplate" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "category"  TEXT NOT NULL DEFAULT 'GENERAL',
    "body"      TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "EmailTemplate_category_idx" ON "EmailTemplate"("category")`,

  `CREATE TABLE IF NOT EXISTS "TicketComment" (
    "id"         TEXT NOT NULL,
    "ticketId"   TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorId"   TEXT,
    "body"       TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId")
      REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "TicketComment_ticketId_idx" ON "TicketComment"("ticketId")`,

  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "showScanTimer" BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "timerYellowMins" INTEGER NOT NULL DEFAULT 4`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "timerRedMins" INTEGER NOT NULL DEFAULT 10`,

  // Document Storage — folders and files backed by Cloudflare R2
  `CREATE TABLE IF NOT EXISTS "DocumentFolder" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "parentId"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentFolder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DocumentFolder_parentId_fkey" FOREIGN KEY ("parentId")
      REFERENCES "DocumentFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "DocumentFile" (
    "id"         TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "key"        TEXT NOT NULL,
    "size"       INTEGER NOT NULL,
    "mimeType"   TEXT NOT NULL,
    "folderId"   TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentFile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DocumentFile_folderId_fkey" FOREIGN KEY ("folderId")
      REFERENCES "DocumentFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,

  // 2026-05-22 — Auction stage flags replacing Locked/Finished
  `ALTER TABLE "CatalogueAuction" ADD COLUMN IF NOT EXISTS "catalogued"  BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE "CatalogueAuction" ADD COLUMN IF NOT EXISTS "addedToBC"   BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE "CatalogueAuction" ADD COLUMN IF NOT EXISTS "photography" BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE "CatalogueAuction" ADD COLUMN IF NOT EXISTS "aiRan"       BOOLEAN NOT NULL DEFAULT FALSE`,

  // 2026-05-28 — Remove lotNumber from CatalogueLot and CatalogueTimingLog
  `ALTER TABLE "CatalogueLot" DROP COLUMN IF EXISTS "lotNumber"`,
  `ALTER TABLE "CatalogueTimingLog" DROP COLUMN IF EXISTS "lotNumber"`,

  // 2026-05-28 — AI estimate fields on CatalogueLot (separate from human estimate)
  `ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "aiEstimateLow"  INTEGER`,
  `ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "aiEstimateHigh" INTEGER`,

  // 2026-05-28 — Pipeline: automated batch → double check → key points run
  `CREATE TABLE IF NOT EXISTS "PipelineRun" (
    "id"        TEXT         NOT NULL,
    "code"      TEXT         NOT NULL,
    "preset"    TEXT         NOT NULL DEFAULT '',
    "model"     TEXT         NOT NULL DEFAULT '',
    "stage"     TEXT         NOT NULL DEFAULT 'batch',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PipelineRun_code_key" UNIQUE ("code")
  )`,
  `CREATE TABLE IF NOT EXISTS "PipelineLot" (
    "id"           TEXT         NOT NULL,
    "runId"        TEXT         NOT NULL,
    "lotId"        TEXT         NOT NULL,
    "label"        TEXT         NOT NULL,
    "batchStatus"  TEXT,
    "description"  TEXT,
    "estimate"     TEXT,
    "dcStatus"     TEXT,
    "contradictions" TEXT,
    "unsupported"  TEXT,
    "kpStatus"     TEXT,
    "revised"      TEXT,
    "kpMissing"    TEXT,
    "kpAdded"      TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "PipelineLot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PipelineLot_runId_lotId_key" UNIQUE ("runId", "lotId"),
    CONSTRAINT "PipelineLot_runId_fkey" FOREIGN KEY ("runId")
      REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "PipelineLot_runId_idx" ON "PipelineLot"("runId")`,

  // 2026-06-01 — Preserve original raw batch text for DC before/after in review
  `ALTER TABLE "PipelineLot" ADD COLUMN IF NOT EXISTS "batchDesc" TEXT`,

  // Review tab — error flags raised by checkers against individual lots
  `ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "reviewFlag" TEXT`,
  `ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "reviewFlaggedBy" TEXT`,
  `ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "reviewFlaggedAt" TIMESTAMP(3)`,

  // Auction AI — models disabled by the user (presence = disabled)
  `CREATE TABLE IF NOT EXISTS "DisabledModel" (
    "modelId"   TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DisabledModel_pkey" PRIMARY KEY ("modelId")
  )`,

  // Invoices — flat file list backed by Cloudflare R2
  `CREATE TABLE IF NOT EXISTS "InvoiceFile" (
    "id"         TEXT         NOT NULL,
    "name"       TEXT         NOT NULL,
    "key"        TEXT         NOT NULL,
    "size"       INTEGER      NOT NULL,
    "mimeType"   TEXT         NOT NULL,
    "uploadedBy" TEXT         NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceFile_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "InvoiceFile_createdAt_idx" ON "InvoiceFile"("createdAt")`,

  // 2026-06-11 — AI exclusion flag: lot description typed manually, skip all AI runs
  `ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "aiExcluded" BOOLEAN NOT NULL DEFAULT FALSE`,

  // 2026-06-11 — AI flag note: potential cataloguer mistake flagged by the batch pipeline
  `ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "aiFlagNote" TEXT`,

  // 2026-04-29 — MacroFile: stores uploaded macro/instruction files for Auction AI
  `CREATE TABLE IF NOT EXISTS "MacroFile" (
    "id"          TEXT         NOT NULL,
    "name"        TEXT         NOT NULL,
    "filename"    TEXT         NOT NULL,
    "description" TEXT,
    "content"     BYTEA        NOT NULL,
    "mimeType"    TEXT         NOT NULL DEFAULT 'text/plain',
    "size"        INTEGER      NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MacroFile_pkey" PRIMARY KEY ("id")
  )`,

  // 2026-06-12 — Lot change log: records every field change made via updateLot
  `CREATE TABLE IF NOT EXISTS "CatalogueLotEvent" (
    "id"          TEXT         NOT NULL,
    "lotId"       TEXT         NOT NULL,
    "auctionId"   TEXT         NOT NULL,
    "auctionCode" TEXT         NOT NULL,
    "lotBarcode"  TEXT,
    "lotTitle"    TEXT,
    "field"       TEXT         NOT NULL,
    "oldValue"    TEXT,
    "newValue"    TEXT,
    "changedBy"   TEXT         NOT NULL,
    "changedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "CatalogueLotEvent_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "CatalogueLotEvent_lotId_idx"    ON "CatalogueLotEvent"("lotId")`,
  `CREATE INDEX IF NOT EXISTS "CatalogueLotEvent_auctionId_idx" ON "CatalogueLotEvent"("auctionId")`,
  `CREATE INDEX IF NOT EXISTS "CatalogueLotEvent_changedAt_idx" ON "CatalogueLotEvent"("changedAt")`,
  `CREATE INDEX IF NOT EXISTS "CatalogueLotEvent_field_idx"    ON "CatalogueLotEvent"("field")`,

  // 2026-06-12 — Submission photo upload token for customer-facing photo request links
  `ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "photoUploadToken" TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Submission_photoUploadToken_key" ON "Submission"("photoUploadToken")`,

  // 2026-06-12 — External cataloguer valuation link
  `ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "valuationToken" TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Submission_valuationToken_key" ON "Submission"("valuationToken")`,
  `ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "valuationNotes" TEXT`,
  `ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "valuationSubmittedAt" TIMESTAMP(3)`,
  `ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "externalEstimate" INTEGER`,
  `ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "externalNotes" TEXT`,

  // 2026-06-17 — Manual follow-up flag on submissions (to be automated later)
  `ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "needsFollowUp" BOOLEAN NOT NULL DEFAULT FALSE`,

  // 2026-06-17 — Note of which cataloguer the valuation request was sent to (display only)
  `ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "valuationSentTo" TEXT`,

  // 2026-06-17 — IT Job Board: jobs from the IT@vectis.co.uk inbox + the mailbox OAuth connection
  `CREATE TABLE IF NOT EXISTS "ITJob" (
    "id"             TEXT         NOT NULL,
    "title"          TEXT         NOT NULL,
    "body"           TEXT         NOT NULL DEFAULT '',
    "fromName"       TEXT,
    "fromEmail"      TEXT,
    "status"         TEXT         NOT NULL DEFAULT 'NEW',
    "source"         TEXT         NOT NULL DEFAULT 'EMAIL',
    "graphMessageId" TEXT,
    "webLink"        TEXT,
    "receivedAt"     TIMESTAMP(3),
    "createdByName"  TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "ITJob_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ITJob_graphMessageId_key" ON "ITJob"("graphMessageId")`,
  `CREATE INDEX IF NOT EXISTS "ITJob_status_idx"     ON "ITJob"("status")`,
  `CREATE INDEX IF NOT EXISTS "ITJob_receivedAt_idx" ON "ITJob"("receivedAt")`,
  `CREATE TABLE IF NOT EXISTS "ITMailboxAuth" (
    "id"           TEXT         NOT NULL,
    "accessToken"  TEXT         NOT NULL,
    "refreshToken" TEXT         NOT NULL,
    "expiresAt"    TIMESTAMP(3) NOT NULL,
    "connectedBy"  TEXT,
    "lastSyncAt"   TIMESTAMP(3),
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "ITMailboxAuth_pkey" PRIMARY KEY ("id")
  )`,

  // 2026-06-17 — IT Job Board upgrade: assignees, replies/threading, internal chat
  `ALTER TABLE "ITJob" ADD COLUMN IF NOT EXISTS "threadKey"      TEXT`,
  `ALTER TABLE "ITJob" ADD COLUMN IF NOT EXISTS "assignedToId"   TEXT`,
  `ALTER TABLE "ITJob" ADD COLUMN IF NOT EXISTS "assignedToName" TEXT`,
  `ALTER TABLE "ITJob" ADD COLUMN IF NOT EXISTS "hasNewReply"    BOOLEAN NOT NULL DEFAULT FALSE`,
  `CREATE INDEX IF NOT EXISTS "ITJob_threadKey_idx" ON "ITJob"("threadKey")`,
  `ALTER TABLE "User"  ADD COLUMN IF NOT EXISTS "isITStaff"      BOOLEAN NOT NULL DEFAULT FALSE`,
  `CREATE TABLE IF NOT EXISTS "ITJobMessage" (
    "id"          TEXT         NOT NULL,
    "jobId"       TEXT         NOT NULL,
    "kind"        TEXT         NOT NULL DEFAULT 'NOTE',
    "authorName"  TEXT,
    "authorEmail" TEXT,
    "body"        TEXT         NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "ITJobMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ITJobMessage_jobId_fkey" FOREIGN KEY ("jobId")
      REFERENCES "ITJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "ITJobMessage_jobId_idx" ON "ITJobMessage"("jobId")`,

  // 2026-06-17 — precise reply matching via Office 365 Conversation Id
  `ALTER TABLE "ITJob" ADD COLUMN IF NOT EXISTS "conversationId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "ITJob_conversationId_idx" ON "ITJob"("conversationId")`,

  // 2026-06-18 — Job Board due dates
  `ALTER TABLE "ITJob" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3)`,
  `CREATE INDEX IF NOT EXISTS "ITJob_dueDate_idx" ON "ITJob"("dueDate")`,

  // 2026-06-18 — Job Board image attachments (email images stored in R2)
  `CREATE TABLE IF NOT EXISTS "ITJobAttachment" (
    "id"        TEXT         NOT NULL,
    "jobId"     TEXT         NOT NULL,
    "messageId" TEXT,
    "filename"  TEXT         NOT NULL,
    "mimeType"  TEXT         NOT NULL,
    "size"      INTEGER      NOT NULL,
    "r2Key"     TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "ITJobAttachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ITJobAttachment_jobId_fkey" FOREIGN KEY ("jobId")
      REFERENCES "ITJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ITJobAttachment_messageId_fkey" FOREIGN KEY ("messageId")
      REFERENCES "ITJobMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "ITJobAttachment_jobId_idx"     ON "ITJobAttachment"("jobId")`,
  `CREATE INDEX IF NOT EXISTS "ITJobAttachment_messageId_idx" ON "ITJobAttachment"("messageId")`,

  // 2026-06-18 — Job Board: render original email HTML + mark inline images by Content-ID
  `ALTER TABLE "ITJob"           ADD COLUMN IF NOT EXISTS "bodyHtml"  TEXT`,
  `ALTER TABLE "ITJobMessage"    ADD COLUMN IF NOT EXISTS "bodyHtml"  TEXT`,
  `ALTER TABLE "ITJobAttachment" ADD COLUMN IF NOT EXISTS "contentId" TEXT`,

  // 2026-06-18 — Submissions: internal staff notes (running log)
  `CREATE TABLE IF NOT EXISTS "SubmissionNote" (
    "id"           TEXT         NOT NULL,
    "submissionId" TEXT         NOT NULL,
    "body"         TEXT         NOT NULL,
    "authorId"     TEXT,
    "authorName"   TEXT         NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "SubmissionNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SubmissionNote_submissionId_fkey" FOREIGN KEY ("submissionId")
      REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "SubmissionNote_submissionId_idx" ON "SubmissionNote"("submissionId")`,

  // 2026-06-18 — Marketing Reports: saved shared layouts
  `CREATE TABLE IF NOT EXISTS "MarketingLayout" (
    "id"        TEXT         NOT NULL,
    "name"      TEXT         NOT NULL,
    "sections"  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isDefault" BOOLEAN      NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "MarketingLayout_pkey" PRIMARY KEY ("id")
  )`,

  // 2026-06-19 — Marketing Reports: shared favourite sections
  `CREATE TABLE IF NOT EXISTS "MarketingFavourite" (
    "sectionId" TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "MarketingFavourite_pkey" PRIMARY KEY ("sectionId")
  )`,

  // 2026-06-19 — Accounts: monthly bookkeeping from scanned documents
  `CREATE TABLE IF NOT EXISTS "AccountingMonth" (
    "id"        TEXT         NOT NULL,
    "label"     TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "AccountingMonth_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AccountingMonth_label_key" ON "AccountingMonth"("label")`,
  `CREATE TABLE IF NOT EXISTS "AccountingDocument" (
    "id"         TEXT             NOT NULL,
    "monthId"    TEXT             NOT NULL,
    "cardholder" TEXT             NOT NULL,
    "source"     TEXT             NOT NULL DEFAULT 'SCAN',
    "imageKey"   TEXT,
    "supplier"   TEXT             NOT NULL DEFAULT '',
    "docDate"    TIMESTAMP(3),
    "vatCode"    INTEGER          NOT NULL DEFAULT 1,
    "gross"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vat"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "column"     TEXT             NOT NULL DEFAULT 'vectis',
    "reviewed"   BOOLEAN          NOT NULL DEFAULT FALSE,
    "aiNotes"    TEXT,
    "createdAt"  TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
    "updatedAt"  TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
    CONSTRAINT "AccountingDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountingDocument_monthId_fkey" FOREIGN KEY ("monthId")
      REFERENCES "AccountingMonth"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "AccountingDocument_monthId_idx" ON "AccountingDocument"("monthId")`,
  `CREATE TABLE IF NOT EXISTS "AccountingSupplierRule" (
    "id"        TEXT         NOT NULL,
    "match"     TEXT         NOT NULL,
    "vatCode"   INTEGER      NOT NULL,
    "column"    TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "AccountingSupplierRule_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AccountingSupplierRule_match_key" ON "AccountingSupplierRule"("match")`,
  `CREATE TABLE IF NOT EXISTS "AccountingCardholder" (
    "id"        TEXT         NOT NULL,
    "name"      TEXT         NOT NULL,
    "sortOrder" INTEGER      NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "AccountingCardholder_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AccountingCardholder_name_key" ON "AccountingCardholder"("name")`,
  `INSERT INTO "AccountingCardholder" ("id","name","sortOrder") VALUES
     ('seed_bgoodall','B Goodall',1),
     ('seed_jgoodall','J Goodall',2),
     ('seed_james','James',3),
     ('seed_michael','Michael',4),
     ('seed_vectis','Vectis',5)
   ON CONFLICT DO NOTHING`,

  // 2026-06-19 — Accounts: extra capture fields + AI-run flag
  `ALTER TABLE "AccountingDocument" ADD COLUMN IF NOT EXISTS "item"    TEXT    NOT NULL DEFAULT ''`,
  `ALTER TABLE "AccountingDocument" ADD COLUMN IF NOT EXISTS "website" TEXT    NOT NULL DEFAULT ''`,
  `ALTER TABLE "AccountingDocument" ADD COLUMN IF NOT EXISTS "aiRun"   BOOLEAN NOT NULL DEFAULT FALSE`,

  // 2026-06-19 — Accounts: multi-page invoices (multiple images per document)
  `ALTER TABLE "AccountingDocument" ADD COLUMN IF NOT EXISTS "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,
  `UPDATE "AccountingDocument" SET "images" = ARRAY["imageKey"] WHERE "imageKey" IS NOT NULL AND ("images" IS NULL OR array_length("images",1) IS NULL)`,

  // 2026-06-23 — Accounts: lines split from one invoice share a splitGroupId (grouped in the UI)
  `ALTER TABLE "AccountingDocument" ADD COLUMN IF NOT EXISTS "splitGroupId" TEXT`,

  // 2026-06-23 — Accounts: capture original currency + foreign amount (for reconciliation)
  `ALTER TABLE "AccountingDocument" ADD COLUMN IF NOT EXISTS "currency"       TEXT DEFAULT 'GBP'`,
  `ALTER TABLE "AccountingDocument" ADD COLUMN IF NOT EXISTS "originalAmount" DOUBLE PRECISION`,

  // 2026-06-23 — Accounts: bank/card statement reconciliation
  `CREATE TABLE IF NOT EXISTS "BankStatement" (
    "id"        TEXT         NOT NULL,
    "monthId"   TEXT         NOT NULL,
    "label"     TEXT         NOT NULL DEFAULT '',
    "source"    TEXT         NOT NULL DEFAULT 'SCAN',
    "images"    TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BankStatement_monthId_fkey" FOREIGN KEY ("monthId")
      REFERENCES "AccountingMonth"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "BankStatement_monthId_idx" ON "BankStatement"("monthId")`,
  `CREATE TABLE IF NOT EXISTS "BankTransaction" (
    "id"             TEXT             NOT NULL,
    "statementId"    TEXT             NOT NULL,
    "monthId"        TEXT             NOT NULL,
    "postDate"       TIMESTAMP(3),
    "tranDate"       TIMESTAMP(3),
    "description"    TEXT             NOT NULL DEFAULT '',
    "reference"      TEXT             NOT NULL DEFAULT '',
    "amount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency"       TEXT             NOT NULL DEFAULT 'GBP',
    "originalAmount" DOUBLE PRECISION,
    "feeAmount"      DOUBLE PRECISION,
    "direction"      TEXT             NOT NULL DEFAULT 'DEBIT',
    "matchedDocIds"  TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
    "ignored"        BOOLEAN          NOT NULL DEFAULT FALSE,
    "createdAt"      TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BankTransaction_statementId_fkey" FOREIGN KEY ("statementId")
      REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "BankTransaction_statementId_idx" ON "BankTransaction"("statementId")`,
  `CREATE INDEX IF NOT EXISTS "BankTransaction_monthId_idx"     ON "BankTransaction"("monthId")`,

  // 2026-06-23 — Reconciliation: a statement belongs to one cardholder (scopes matching)
  `ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "cardholder" TEXT NOT NULL DEFAULT ''`,

  // 2026-06-23 — Accounts: favourite/current month flag (pinned to top of the list)
  `ALTER TABLE "AccountingMonth" ADD COLUMN IF NOT EXISTS "favourite" BOOLEAN NOT NULL DEFAULT FALSE`,

  // 2026-06-23 — Reconciliation: mark a bank transaction as "receipt missing" (no paperwork)
  `ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "receiptMissing" BOOLEAN NOT NULL DEFAULT FALSE`,

  // 2026-06-23 — Reconciliation: park an entered line in the shared reserve (belongs to another check)
  `ALTER TABLE "AccountingDocument" ADD COLUMN IF NOT EXISTS "reserved" BOOLEAN NOT NULL DEFAULT FALSE`,

  // 2026-06-23 — Cataloguing: manageable categories + subcategories (was a hardcoded map)
  `CREATE TABLE IF NOT EXISTS "LotCategory" (
    "id"        TEXT         NOT NULL,
    "name"      TEXT         NOT NULL,
    "sortOrder" INTEGER      NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "LotCategory_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LotCategory_name_key" ON "LotCategory"("name")`,
  `CREATE TABLE IF NOT EXISTS "LotSubcategory" (
    "id"         TEXT    NOT NULL,
    "categoryId" TEXT    NOT NULL,
    "name"       TEXT    NOT NULL,
    "sortOrder"  INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LotSubcategory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LotSubcategory_categoryId_fkey" FOREIGN KEY ("categoryId")
      REFERENCES "LotCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "LotSubcategory_categoryId_idx" ON "LotSubcategory"("categoryId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LotSubcategory_categoryId_name_key" ON "LotSubcategory"("categoryId", "name")`,

  // 2026-06-26 — TRAINS: add the BC subcategory codes that were missing from the managed
  // list (Dapol O, Fleischmann HO, Heljan OO, Triang Hornby, Liliput, Mixed Lots, Rivarossi).
  // Idempotent: ON CONFLICT on (categoryId,name) skips any already present; appended after the
  // existing subs via MAX(sortOrder)+n (same as the admin "add subcategory" action). No-op if
  // the TRAINS category doesn't exist.
  `INSERT INTO "LotSubcategory" ("id","categoryId","name","sortOrder")
   SELECT v.id, c.id, v.name,
          (SELECT COALESCE(MAX(s."sortOrder"),-1) FROM "LotSubcategory" s WHERE s."categoryId" = c.id) + v.ord
   FROM "LotCategory" c,
        (VALUES
          ('seed_sub_trains_dapol_o',        'DAPOL_O',        1),
          ('seed_sub_trains_fleischmann_ho', 'FLEISCHMANN_HO', 2),
          ('seed_sub_trains_heljan_oo',      'HELJAN_OO',      3),
          ('seed_sub_trains_hornby_triang',  'HORNBY_TRIANG',  4),
          ('seed_sub_trains_liliput',        'LILIPUT',        5),
          ('seed_sub_trains_mixed',          'MIXED',          6),
          ('seed_sub_trains_rivarossi',      'RIVAROSSI',      7)
        ) AS v(id, name, ord)
   WHERE c.name = 'TRAINS'
   ON CONFLICT ("categoryId","name") DO NOTHING`,

  // 2026-06-26 — bulk-add the BC subcategories missing across all categories (211 codes), from the
  // "Auction Statistics by Sub-Category" export. Excludes the retired TRAINS item-type scheme (only
  // the current master/screenshot codes are valid). Idempotent (ON CONFLICT on categoryId,name);
  // appended per category via MAX(sortOrder)+ord. Safe to re-run.
  `INSERT INTO "LotSubcategory" ("id","categoryId","name","sortOrder")
 SELECT v.id, c.id, v.sub,
        (SELECT COALESCE(MAX(s."sortOrder"),-1) FROM "LotSubcategory" s WHERE s."categoryId" = c.id) + v.ord
 FROM "LotCategory" c
 JOIN (VALUES
   ('seed_sub_2606_1','BEARS','ACCESSORIES',1),
   ('seed_sub_2606_2','BEARS','COLLECTOR_BOOKS',2),
   ('seed_sub_2606_3','BEARS','DISNEYANA',3),
   ('seed_sub_2606_4','BEARS','FIGURES',4),
   ('seed_sub_2606_5','BEARS','FIGURES_STORAGE',5),
   ('seed_sub_2606_6','BEARS','MINIATURES',6),
   ('seed_sub_2606_7','COLLECTABLES','ANIMAL',1),
   ('seed_sub_2606_8','COLLECTABLES','BOTTLES_POTS',2),
   ('seed_sub_2606_9','COLLECTABLES','BREWERIANA',3),
   ('seed_sub_2606_10','COLLECTABLES','EPHEMERA',4),
   ('seed_sub_2606_11','COLLECTABLES','FANTASY',5),
   ('seed_sub_2606_12','COLLECTABLES','HOME',6),
   ('seed_sub_2606_13','COLLECTABLES','JEWELLERY',7),
   ('seed_sub_2606_14','COLLECTABLES','KEYRINGS',8),
   ('seed_sub_2606_15','COLLECTABLES','LIGHTING',9),
   ('seed_sub_2606_16','COLLECTABLES','MASONIC',10),
   ('seed_sub_2606_17','COLLECTABLES','MEMORABILIA',11),
   ('seed_sub_2606_18','COLLECTABLES','MILITARIA MEDALS',12),
   ('seed_sub_2606_19','COLLECTABLES','MONEYBOXES',13),
   ('seed_sub_2606_20','COLLECTABLES','PEZ',14),
   ('seed_sub_2606_21','COLLECTABLES','POSTCARDS',15),
   ('seed_sub_2606_22','COLLECTABLES','RADIO_TV_PHO',16),
   ('seed_sub_2606_23','COLLECTABLES','SEASONAL',17),
   ('seed_sub_2606_24','COLLECTABLES','SEWING',18),
   ('seed_sub_2606_25','COLLECTABLES','TEA & CIGERATTE',19),
   ('seed_sub_2606_26','COLLECTABLES','TEXTILES',20),
   ('seed_sub_2606_27','COLLECTABLES','TOBACCIANA',21),
   ('seed_sub_2606_28','COLLECTABLES','VANITY',22),
   ('seed_sub_2606_29','DOLLS','BOOKS',1),
   ('seed_sub_2606_30','DOLLS','HOUSE_FIGURES',2),
   ('seed_sub_2606_31','DOLLS','REPAIR',3),
   ('seed_sub_2606_32','GAMING','ARCADE MACHINES',1),
   ('seed_sub_2606_33','GAMING','COIN_OPERATED',2),
   ('seed_sub_2606_34','GAMING','COMPUTERS',3),
   ('seed_sub_2606_35','GAMING','ELECTRONIC GAMES',4),
   ('seed_sub_2606_36','GAMING','HANDHELD CONSOLES',5),
   ('seed_sub_2606_37','GAMING','MERCHANDISE',6),
   ('seed_sub_2606_38','KITS','KITS_AUTOMOTIVE',1),
   ('seed_sub_2606_39','KITS','KITS_BOATS_SHIPS',2),
   ('seed_sub_2606_40','KITS','KITS_BUILDINGS',3),
   ('seed_sub_2606_41','KITS','KITS_DIORAMAS',4),
   ('seed_sub_2606_42','KITS','KITS_FIGURES',5),
   ('seed_sub_2606_43','KITS','KITS_MILITARY',6),
   ('seed_sub_2606_44','KITS','KITS_OTHER',7),
   ('seed_sub_2606_45','KITS','KITS_PUBLICATIONS',8),
   ('seed_sub_2606_46','KITS','KITS_SPACECRAFT',9),
   ('seed_sub_2606_47','KITS','KITS_TOOLS_SUPPLIES',10),
   ('seed_sub_2606_48','MATCHBOX','POS_PROMO',1),
   ('seed_sub_2606_49','MILITARY','AIRFIX',1),
   ('seed_sub_2606_50','MILITARY','ALBA MINIATURES',2),
   ('seed_sub_2606_51','MILITARY','BENBROS',3),
   ('seed_sub_2606_52','MILITARY','BLENHEIM',4),
   ('seed_sub_2606_53','MILITARY','BOOKS',5),
   ('seed_sub_2606_54','MILITARY','BRITAINS ACW (LEAD)',6),
   ('seed_sub_2606_55','MILITARY','BRITAINS ACW PLASTIC',7),
   ('seed_sub_2606_56','MILITARY','BRITAINS CIVILIAN',8),
   ('seed_sub_2606_57','MILITARY','BRITAINS COWBOYS',9),
   ('seed_sub_2606_58','MILITARY','BRITAINS DEETAIL',10),
   ('seed_sub_2606_59','MILITARY','BRITAINS DELHI DURBA',11),
   ('seed_sub_2606_60','MILITARY','BRITAINS EYES RIGHT',12),
   ('seed_sub_2606_61','MILITARY','BRITAINS FARM',13),
   ('seed_sub_2606_62','MILITARY','BRITAINS FLORAL',14),
   ('seed_sub_2606_63','MILITARY','BRITAINS FOOTBALL',15),
   ('seed_sub_2606_64','MILITARY','BRITAINS HERALD',16),
   ('seed_sub_2606_65','MILITARY','BRITAINS HOME FARM',17),
   ('seed_sub_2606_66','MILITARY','BRITAINS LILLIPUT',18),
   ('seed_sub_2606_67','MILITARY','BRITAINS MEDIEVAL',19),
   ('seed_sub_2606_68','MILITARY','BRITAINS METAL MODEL',20),
   ('seed_sub_2606_69','MILITARY','BRITAINS MILITARY',21),
   ('seed_sub_2606_70','MILITARY','BRITAINS MINI GARDEN',22),
   ('seed_sub_2606_71','MILITARY','BRITAINS MOTORCYCLES',23),
   ('seed_sub_2606_72','MILITARY','BRITAINS NAPOLEONIC',24),
   ('seed_sub_2606_73','MILITARY','BRITAINS NOVELTY',25),
   ('seed_sub_2606_74','MILITARY','BRITAINS PREMIER',26),
   ('seed_sub_2606_75','MILITARY','BRITAINS RACING COL',27),
   ('seed_sub_2606_76','MILITARY','BRITAINS REGIMENTS',28),
   ('seed_sub_2606_77','MILITARY','BRITAINS ROAD',29),
   ('seed_sub_2606_78','MILITARY','BRITAINS SOLDIERS',30),
   ('seed_sub_2606_79','MILITARY','BRITAINS SWOPPETS',31),
   ('seed_sub_2606_80','MILITARY','BRITAINS VINTAGE',32),
   ('seed_sub_2606_81','MILITARY','BRITAINS WWI',33),
   ('seed_sub_2606_82','MILITARY','BRITAINS WWII',34),
   ('seed_sub_2606_83','MILITARY','BRITAINS ZOO',35),
   ('seed_sub_2606_84','MILITARY','BRITAINS ZOO (LEAD)',36),
   ('seed_sub_2606_85','MILITARY','BRITAINS ZOO-PLASTIC',37),
   ('seed_sub_2606_86','MILITARY','BRITAINS ZULU WARS',38),
   ('seed_sub_2606_87','MILITARY','C.B.G. MIGNOT',39),
   ('seed_sub_2606_88','MILITARY','CHARBENS',40),
   ('seed_sub_2606_89','MILITARY','CHERILEA',41),
   ('seed_sub_2606_90','MILITARY','CIVILIAN',42),
   ('seed_sub_2606_91','MILITARY','COLLECTORS SHOWCASE',43),
   ('seed_sub_2606_92','MILITARY','CORGI',44),
   ('seed_sub_2606_93','MILITARY','COWBOYS & INDIANS',45),
   ('seed_sub_2606_94','MILITARY','CRESCENT',46),
   ('seed_sub_2606_95','MILITARY','DEL PRADO OR SIMILAR',47),
   ('seed_sub_2606_96','MILITARY','DIORAMAS / SCENERY',48),
   ('seed_sub_2606_97','MILITARY','DORSET SOLDIERS',49),
   ('seed_sub_2606_98','MILITARY','DRAGON IN DREAM',50),
   ('seed_sub_2606_99','MILITARY','DUCAL',51),
   ('seed_sub_2606_100','MILITARY','ELASTOLIN',52),
   ('seed_sub_2606_101','MILITARY','FIGURES',53),
   ('seed_sub_2606_102','MILITARY','FIRST LEGION',54),
   ('seed_sub_2606_103','MILITARY','FORCES OF VALOR',55),
   ('seed_sub_2606_104','MILITARY','FRONTLINE FIGURES',56),
   ('seed_sub_2606_105','MILITARY','HEYDE',57),
   ('seed_sub_2606_106','MILITARY','HISTOREX',58),
   ('seed_sub_2606_107','MILITARY','HUGAR',59),
   ('seed_sub_2606_108','MILITARY','JOHILLCO',60),
   ('seed_sub_2606_109','MILITARY','JOHN JENKINS',61),
   ('seed_sub_2606_110','MILITARY','KEYMEN',62),
   ('seed_sub_2606_111','MILITARY','KING & COUNTRY',63),
   ('seed_sub_2606_112','MILITARY','KING & COUNTRY ACW',64),
   ('seed_sub_2606_113','MILITARY','KING & COUNTRY HK',65),
   ('seed_sub_2606_114','MILITARY','KING & COUNTRY NAP',66),
   ('seed_sub_2606_115','MILITARY','KING & COUNTRY WWI',67),
   ('seed_sub_2606_116','MILITARY','KING & COUNTRY WWII',68),
   ('seed_sub_2606_117','MILITARY','KIT FIGURES METAL',69),
   ('seed_sub_2606_118','MILITARY','KIT FIGURES RESIN',70),
   ('seed_sub_2606_119','MILITARY','LINEOL & ELASTOLIN',71),
   ('seed_sub_2606_120','MILITARY','LONE STAR',72),
   ('seed_sub_2606_121','MILITARY','LUCOTTE',73),
   ('seed_sub_2606_122','MILITARY','MÄRKLIN',74),
   ('seed_sub_2606_123','MILITARY','MIXED LEAD FIGURES',75),
   ('seed_sub_2606_124','MILITARY','MIXED PLASTIC FIGURE',76),
   ('seed_sub_2606_125','MILITARY','MKL MODELS',77),
   ('seed_sub_2606_126','MILITARY','NIENA',78),
   ('seed_sub_2606_127','MILITARY','ORYON',79),
   ('seed_sub_2606_128','MILITARY','OTHER',80),
   ('seed_sub_2606_129','MILITARY','OTHER PLASTIC',81),
   ('seed_sub_2606_130','MILITARY','PHILLIP SEGAL',82),
   ('seed_sub_2606_131','MILITARY','PIXYLAND-KEW',83),
   ('seed_sub_2606_132','MILITARY','SACUL',84),
   ('seed_sub_2606_133','MILITARY','SILVER DREAM STUDIOS',85),
   ('seed_sub_2606_134','MILITARY','SOLID FIGURES',86),
   ('seed_sub_2606_135','MILITARY','STADDEN',87),
   ('seed_sub_2606_136','MILITARY','STARLUX',88),
   ('seed_sub_2606_137','MILITARY','STEADFAST SOLDIERS',89),
   ('seed_sub_2606_138','MILITARY','TAYLOR & BARRETT',90),
   ('seed_sub_2606_139','MILITARY','THOMAS GUNN',91),
   ('seed_sub_2606_140','MILITARY','THOMAS GUNN WWII',92),
   ('seed_sub_2606_141','MILITARY','TIMPO LEAD',93),
   ('seed_sub_2606_142','MILITARY','TIMPO PLASTIC',94),
   ('seed_sub_2606_143','MILITARY','TIMPO ROMANS',95),
   ('seed_sub_2606_144','MILITARY','TIMPO WILD WEST',96),
   ('seed_sub_2606_145','MILITARY','TINPLATE',97),
   ('seed_sub_2606_146','MILITARY','TOY SOLDIER CENTRE',98),
   ('seed_sub_2606_147','MILITARY','TOY SOLDIERS',99),
   ('seed_sub_2606_148','MILITARY','TRADITION',100),
   ('seed_sub_2606_149','MILITARY','TRIANG',101),
   ('seed_sub_2606_150','MILITARY','TROPHY MINIATURES',102),
   ('seed_sub_2606_151','MILITARY','UNDER TWO FLAGS',103),
   ('seed_sub_2606_152','MILITARY','VERO',104),
   ('seed_sub_2606_153','MILITARY','WARGAMING',105),
   ('seed_sub_2606_154','MILITARY','WATERLINE SHIPS',106),
   ('seed_sub_2606_155','MILITARY','WEND-AL, QUIRALU',107),
   ('seed_sub_2606_156','MODELS_KITS','DRONES',1),
   ('seed_sub_2606_157','MODELS_KITS','TETHER_CARS',2),
   ('seed_sub_2606_158','MODERN_DIECAST','MOTORBIKES',1),
   ('seed_sub_2606_159','MODERN_DIECAST','PLANES AND VEHICLES',2),
   ('seed_sub_2606_160','MUSIC_MEDIA','CASSETTES',1),
   ('seed_sub_2606_161','PUBLICATIONS','ARTBOOKS',1),
   ('seed_sub_2606_162','PUBLICATIONS','FAN_ZINES',2),
   ('seed_sub_2606_163','PUBLICATIONS','HISTORICAL',3),
   ('seed_sub_2606_164','PUBLICATIONS','MANGA',4),
   ('seed_sub_2606_165','PUBLICATIONS','PRICE_GUIDES',5),
   ('seed_sub_2606_166','PUBLICATIONS','TOY REFERENCE BOOKS',6),
   ('seed_sub_2606_167','RETRO_TOYS','LEGO TV / FILM',1),
   ('seed_sub_2606_168','RETRO_TOYS','SKATEBOARDS',2),
   ('seed_sub_2606_169','SPORTS','AMERICAN_FOOTBALL',1),
   ('seed_sub_2606_170','SPORTS','BOXING',2),
   ('seed_sub_2606_171','SPORTS','CRICKET',3),
   ('seed_sub_2606_172','SPORTS','FOOTBALL_SHIRTS',4),
   ('seed_sub_2606_173','SPORTS','GOLF',5),
   ('seed_sub_2606_174','SPORTS','HOCKEY',6),
   ('seed_sub_2606_175','SPORTS','MOTOR_SPORT',7),
   ('seed_sub_2606_176','SPORTS','OLYMPICS',8),
   ('seed_sub_2606_177','SPORTS','OTHER',9),
   ('seed_sub_2606_178','SPORTS','RACING',10),
   ('seed_sub_2606_179','SPORTS','RUGBY_LEAGUE',11),
   ('seed_sub_2606_180','SPORTS','RUGBY_UNION',12),
   ('seed_sub_2606_181','SPORTS','SPORTS_STICKERS',13),
   ('seed_sub_2606_182','SPORTS','TENNIS',14),
   ('seed_sub_2606_183','SPORTS','TRADING_CARDS',15),
   ('seed_sub_2606_184','SPORTS','WRESTLING',16),
   ('seed_sub_2606_185','STAR_WARS','BOXED_ACCESSORIES',1),
   ('seed_sub_2606_186','STAR_WARS','BOXED_FIGURES_12',2),
   ('seed_sub_2606_187','STAR_WARS','CARDED_GRADED',3),
   ('seed_sub_2606_188','STAR_WARS','CARDED_UNGRADED',4),
   ('seed_sub_2606_189','STAR_WARS','CLOTHING',5),
   ('seed_sub_2606_190','STAR_WARS','COLLECTOR_PLATES',6),
   ('seed_sub_2606_191','STAR_WARS','DIECAST_MICRO',7),
   ('seed_sub_2606_192','STAR_WARS','GRADED_FIGURES_12',8),
   ('seed_sub_2606_193','STAR_WARS','LOOSE_ACCESSORIES',9),
   ('seed_sub_2606_194','STAR_WARS','LOOSE_FIGURES_12',10),
   ('seed_sub_2606_195','STAR_WARS','LOOSE_FIGURES_GRADED',11),
   ('seed_sub_2606_196','STAR_WARS','LOOSE_FIGURES_UNGRAD',12),
   ('seed_sub_2606_197','STAR_WARS','MERCHANDISE',13),
   ('seed_sub_2606_198','STAR_WARS','PROMOTIONAL',14),
   ('seed_sub_2606_199','TOY_FIGURES','CLOTHING',1),
   ('seed_sub_2606_200','TOY_FIGURES','ROLEPLAYING',2),
   ('seed_sub_2606_201','TRADING_CARDS','BOX_BREAKS',1),
   ('seed_sub_2606_202','TRADING_CARDS','CARD_SHEETS',2),
   ('seed_sub_2606_203','TRADING_CARDS','CASES',3),
   ('seed_sub_2606_204','TRADING_CARDS','GRADED_CARDS',4),
   ('seed_sub_2606_205','TRADING_CARDS','PACKS',5),
   ('seed_sub_2606_206','TRADING_CARDS','PLAYER_BUILT_DECKS',6),
   ('seed_sub_2606_207','TRADING_CARDS','PUBLICATIONS',7),
   ('seed_sub_2606_208','TRADING_CARDS','THEME DECKS',8),
   ('seed_sub_2606_209','TRADING_CARDS','TINS',9),
   ('seed_sub_2606_210','VINTAGE_DIECAST','AIRCRAFT',1),
   ('seed_sub_2606_211','VINTAGE_TOYS','NOAHS_ARKS',1)
 ) AS v(id, cat, sub, ord) ON c.name = v.cat
 ON CONFLICT ("categoryId","name") DO NOTHING`,

  // 2026-06-26 — Shipping report: parcel size + collection number on WarehouseItem
  // (synced from Receipt_Lines_Excel). Needs a full receipt-lines resync afterwards
  // to backfill historical rows. Joins to ShipmentRequestAPI.EVA_DocumentNo.
  `ALTER TABLE "WarehouseItem" ADD COLUMN IF NOT EXISTS "collectionNo"       TEXT`,
  `ALTER TABLE "WarehouseItem" ADD COLUMN IF NOT EXISTS "sizeClassification" TEXT`,
  `CREATE INDEX IF NOT EXISTS "WarehouseItem_collectionNo_idx" ON "WarehouseItem"("collectionNo")`,
]

export async function POST() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    // Each statement is idempotent (IF NOT EXISTS / ON CONFLICT), so a single
    // failure should NOT block the rest — record it and carry on, then report.
    const results: string[] = []
    const errors: string[] = []
    for (const sql of MIGRATIONS) {
      try {
        await prisma.$executeRawUnsafe(sql)
        results.push(`OK: ${sql.slice(0, 60)}…`)
      } catch (e: any) {
        errors.push(`FAIL: ${sql.slice(0, 80)}… — ${e?.message ?? e}`)
      }
    }

    return NextResponse.json({ ok: errors.length === 0, ran: results.length, errors })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
