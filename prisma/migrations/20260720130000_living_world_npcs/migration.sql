-- Phase 26 (increment 2): named NPCs and placement schedules. NPCs are
-- versioned content (new ContentType values) materialized into live projection
-- tables, exactly like items/shops/quests. Availability is computed from the
-- world-time segment; retirement blocks new interactions without deleting rows.

-- AlterEnum: additive content types (safe, additive).
ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'NPC';
ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'NPC_PLACEMENT';

-- CreateTable
CREATE TABLE "NpcDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "pronouns" TEXT NOT NULL DEFAULT 'they/them',
    "shortDescription" TEXT NOT NULL,
    "longDescription" TEXT NOT NULL,
    "roles" TEXT[],
    "tags" TEXT[],
    "portraitAssetKey" TEXT NOT NULL,
    "sceneAssetKey" TEXT,
    "homeRegion" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL DEFAULT 'NONE',
    "serviceRef" TEXT,
    "dialogueKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NpcDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpcPlacement" (
    "id" TEXT NOT NULL,
    "npcKey" TEXT NOT NULL,
    "locationSlug" TEXT NOT NULL,
    "segments" TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NpcPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NpcDefinition_key_key" ON "NpcDefinition"("key");

-- CreateIndex
CREATE INDEX "NpcDefinition_homeRegion_idx" ON "NpcDefinition"("homeRegion");

-- CreateIndex
CREATE UNIQUE INDEX "NpcPlacement_npcKey_locationSlug_key" ON "NpcPlacement"("npcKey", "locationSlug");

-- CreateIndex
CREATE INDEX "NpcPlacement_locationSlug_status_idx" ON "NpcPlacement"("locationSlug", "status");

-- AddForeignKey
ALTER TABLE "NpcPlacement" ADD CONSTRAINT "NpcPlacement_npcKey_fkey" FOREIGN KEY ("npcKey") REFERENCES "NpcDefinition"("key") ON DELETE CASCADE ON UPDATE CASCADE;
