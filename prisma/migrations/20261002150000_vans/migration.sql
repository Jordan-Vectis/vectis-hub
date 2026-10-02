-- Facilities → Vans (2026-10-02): the collection vans, their history and sign-outs.
CREATE TABLE IF NOT EXISTS "Van" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "name"         TEXT NOT NULL,
    "reg"          TEXT NOT NULL DEFAULT '',
    "make"         TEXT NOT NULL DEFAULT '',
    "model"        TEXT NOT NULL DEFAULT '',
    "colour"       TEXT NOT NULL DEFAULT '',
    "year"         TEXT NOT NULL DEFAULT '',
    "fuel"         TEXT NOT NULL DEFAULT '',
    "notes"        TEXT NOT NULL DEFAULT '',
    "photoKey"     TEXT NOT NULL DEFAULT '',
    "mileage"      INTEGER,
    "motDue"       TIMESTAMP(3),
    "taxDue"       TIMESTAMP(3),
    "serviceDue"   TIMESTAMP(3),
    "insuranceDue" TIMESTAMP(3),
    "active"       BOOLEAN NOT NULL DEFAULT TRUE,
    "position"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE INDEX IF NOT EXISTS "Van_active_idx" ON "Van"("active");
CREATE TABLE IF NOT EXISTS "VanRecord" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "vanId"         TEXT NOT NULL,
    "kind"          TEXT NOT NULL DEFAULT 'SERVICE',
    "date"          TIMESTAMP(3) NOT NULL,
    "mileage"       INTEGER,
    "costPence"     INTEGER,
    "garage"        TEXT NOT NULL DEFAULT '',
    "result"        TEXT NOT NULL DEFAULT '',
    "notes"         TEXT NOT NULL DEFAULT '',
    "fileKeys"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VanRecord_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
CREATE INDEX IF NOT EXISTS "VanRecord_vanId_idx" ON "VanRecord"("vanId");
CREATE INDEX IF NOT EXISTS "VanRecord_date_idx" ON "VanRecord"("date");
CREATE TABLE IF NOT EXISTS "VanTrip" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "vanId"         TEXT NOT NULL,
    "driverName"    TEXT NOT NULL,
    "purpose"       TEXT NOT NULL DEFAULT '',
    "outAt"         TIMESTAMP(3) NOT NULL,
    "outMileage"    INTEGER,
    "inAt"          TIMESTAMP(3),
    "inMileage"     INTEGER,
    "notes"         TEXT NOT NULL DEFAULT '',
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VanTrip_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
CREATE INDEX IF NOT EXISTS "VanTrip_vanId_inAt_idx" ON "VanTrip"("vanId", "inAt");
CREATE INDEX IF NOT EXISTS "VanTrip_outAt_idx" ON "VanTrip"("outAt");
