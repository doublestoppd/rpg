-- Character presence: a read-activity heartbeat that drives the "who is here"
-- panel. Existing rows default to now() so nobody is retroactively "present".
ALTER TABLE "Character" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Presence lookups: characters at a location seen within the recent window.
CREATE INDEX "Character_currentLocationId_lastSeenAt_idx" ON "Character" ("currentLocationId", "lastSeenAt");
