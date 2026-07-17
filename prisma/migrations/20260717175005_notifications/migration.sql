-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_characterId_readAt_idx" ON "Notification"("characterId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_characterId_createdAt_idx" ON "Notification"("characterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_characterId_dedupeKey_key" ON "Notification"("characterId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
