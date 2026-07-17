-- Force-refresh signal: one "current" row whose token changes each time an admin
-- pushes a refresh. Clients poll it (and get a Socket.IO nudge) and reload.
--
-- IF NOT EXISTS because this may be applied by hand — `prisma migrate deploy` on
-- startup can silently time out acquiring an advisory lock against Neon's pooled
-- endpoint and leave the migration unapplied.

-- CreateTable
CREATE TABLE IF NOT EXISTS "AppReload" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL DEFAULT '',
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "requestedByName" TEXT,

    CONSTRAINT "AppReload_pkey" PRIMARY KEY ("id")
);
