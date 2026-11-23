-- Admin & Operations → Collection bookings: trips out to collect a vendor's items, the hotel stays
-- on them, and everything that happened on each booking.
CREATE TABLE IF NOT EXISTS "CollectionBooking" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "ref"           SERIAL NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'NEW',
    "ownerId"       TEXT,
    "ownerName"     TEXT,
    "pickedUpAt"    TIMESTAMP(3),
    "vendorName"    TEXT NOT NULL DEFAULT '',
    "vendorNo"      TEXT NOT NULL DEFAULT '',
    "phone"         TEXT NOT NULL DEFAULT '',
    "email"         TEXT NOT NULL DEFAULT '',
    "address"       TEXT NOT NULL DEFAULT '',
    "postcode"      TEXT NOT NULL DEFAULT '',
    "lat"           DOUBLE PRECISION,
    "lng"           DOUBLE PRECISION,
    "area"          TEXT,
    "geoPostcode"   TEXT,
    "collectFrom"   TIMESTAMP(3),
    "collectTo"     TIMESTAMP(3),
    "timeWindow"    TEXT NOT NULL DEFAULT '',
    "description"   TEXT NOT NULL DEFAULT '',
    "size"          TEXT NOT NULL DEFAULT '',
    "requirements"  TEXT NOT NULL DEFAULT '',
    "photoKeys"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "drivers"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "vanId"         TEXT,
    "needsHotel"    BOOLEAN NOT NULL DEFAULT false,
    "createdById"   TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "CollectionBooking_ref_key" ON "CollectionBooking"("ref");
CREATE INDEX IF NOT EXISTS "CollectionBooking_status_idx" ON "CollectionBooking"("status");
CREATE INDEX IF NOT EXISTS "CollectionBooking_collectFrom_idx" ON "CollectionBooking"("collectFrom");
CREATE INDEX IF NOT EXISTS "CollectionBooking_ownerId_idx" ON "CollectionBooking"("ownerId");
CREATE TABLE IF NOT EXISTS "CollectionHotel" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "bookingId"      TEXT NOT NULL,
    "name"           TEXT NOT NULL DEFAULT '',
    "address"        TEXT NOT NULL DEFAULT '',
    "phone"          TEXT NOT NULL DEFAULT '',
    "checkIn"        TIMESTAMP(3),
    "checkOut"       TIMESTAMP(3),
    "rooms"          TEXT NOT NULL DEFAULT '',
    "guests"         TEXT NOT NULL DEFAULT '',
    "confirmationNo" TEXT NOT NULL DEFAULT '',
    "bookedVia"      TEXT NOT NULL DEFAULT '',
    "costPence"      INTEGER,
    "payment"        TEXT NOT NULL DEFAULT '',
    "notes"          TEXT NOT NULL DEFAULT '',
    "fileKeys"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionHotel_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "CollectionBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CollectionHotel_bookingId_idx" ON "CollectionHotel"("bookingId");
CREATE TABLE IF NOT EXISTS "CollectionBookingEvent" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "text"      TEXT NOT NULL DEFAULT '',
    "byId"      TEXT,
    "byName"    TEXT NOT NULL DEFAULT '',
    "at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionBookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "CollectionBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CollectionBookingEvent_bookingId_at_idx" ON "CollectionBookingEvent"("bookingId", "at");
