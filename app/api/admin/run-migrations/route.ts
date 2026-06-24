import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// POST /api/admin/run-migrations
// Runs any missing column additions directly via SQL.
// Safe to call multiple times — all statements use IF NOT EXISTS.

const MIGRATIONS = [
  `ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "extraDetails" TEXT`,
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
