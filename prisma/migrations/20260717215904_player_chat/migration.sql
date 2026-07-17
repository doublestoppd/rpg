-- CreateEnum
CREATE TYPE "ChatChannelKind" AS ENUM ('GLOBAL', 'LOCATION');

-- CreateEnum
CREATE TYPE "ChatMessageStatus" AS ENUM ('VISIBLE');

-- CreateEnum
CREATE TYPE "ChatReportReason" AS ENUM ('HARASSMENT', 'SPAM', 'ABUSIVE_LANGUAGE', 'CHEATING_OR_EXPLOITS', 'OTHER');

-- CreateEnum
CREATE TYPE "ChatReportStatus" AS ENUM ('OPEN');

-- CreateEnum
CREATE TYPE "ChatRestrictionStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "ChatChannel" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "ChatChannelKind" NOT NULL,
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorCharacterId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ChatMessageStatus" NOT NULL DEFAULT 'VISIBLE',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatChannelReadState" (
    "characterId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastReadMessageId" TEXT NOT NULL,
    "lastReadMessageCreatedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatChannelReadState_pkey" PRIMARY KEY ("characterId","channelId")
);

-- CreateTable
CREATE TABLE "ChatBlock" (
    "blockerCharacterId" TEXT NOT NULL,
    "blockedCharacterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatBlock_pkey" PRIMARY KEY ("blockerCharacterId","blockedCharacterId")
);

-- CreateTable
CREATE TABLE "ChatReport" (
    "id" TEXT NOT NULL,
    "reporterCharacterId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "reason" "ChatReportReason" NOT NULL,
    "details" TEXT,
    "snapshotBody" TEXT NOT NULL,
    "snapshotAuthorCharacterId" TEXT NOT NULL,
    "snapshotChannelId" TEXT NOT NULL,
    "status" "ChatReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatRestriction" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "status" "ChatRestrictionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ChatRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_slug_key" ON "ChatChannel"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_locationId_key" ON "ChatChannel"("locationId");

-- CreateIndex
CREATE INDEX "ChatMessage_channelId_createdAt_id_idx" ON "ChatMessage"("channelId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_authorCharacterId_idempotencyKey_key" ON "ChatMessage"("authorCharacterId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ChatReport_status_createdAt_idx" ON "ChatReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatReport_reporterCharacterId_messageId_key" ON "ChatReport"("reporterCharacterId", "messageId");

-- CreateIndex
CREATE INDEX "ChatRestriction_characterId_status_expiresAt_idx" ON "ChatRestriction"("characterId", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorCharacterId_fkey" FOREIGN KEY ("authorCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannelReadState" ADD CONSTRAINT "ChatChannelReadState_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannelReadState" ADD CONSTRAINT "ChatChannelReadState_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatBlock" ADD CONSTRAINT "ChatBlock_blockerCharacterId_fkey" FOREIGN KEY ("blockerCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatBlock" ADD CONSTRAINT "ChatBlock_blockedCharacterId_fkey" FOREIGN KEY ("blockedCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_reporterCharacterId_fkey" FOREIGN KEY ("reporterCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRestriction" ADD CONSTRAINT "ChatRestriction_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written constraints (beyond Prisma's schema language):

-- A GLOBAL channel has no location; a LOCATION channel has exactly one.
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_kind_location_check"
  CHECK (
    ("kind" = 'GLOBAL' AND "locationId" IS NULL) OR
    ("kind" = 'LOCATION' AND "locationId" IS NOT NULL)
  );

-- At most one GLOBAL channel exists.
CREATE UNIQUE INDEX "ChatChannel_one_global"
  ON "ChatChannel" ("kind") WHERE "kind" = 'GLOBAL';

-- A character can never block itself.
ALTER TABLE "ChatBlock" ADD CONSTRAINT "ChatBlock_no_self_block_check"
  CHECK ("blockerCharacterId" <> "blockedCharacterId");
