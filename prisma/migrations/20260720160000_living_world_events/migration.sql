-- Phase 26 (increment 4): world events. Definitions are versioned content
-- projected into WorldEventDefinition; occurrences are timestamp-authoritative
-- rows created idempotently by lazy finalization (unique eventKey + startCycle)
-- with the definition's effects snapshotted in.

-- AlterEnum
ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'WORLD_EVENT';

-- CreateTable
CREATE TABLE "WorldEventDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "locationSlug" TEXT,
    "everyCycles" INTEGER NOT NULL,
    "offsetCycles" INTEGER NOT NULL DEFAULT 0,
    "durationCycles" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "sceneDescriptionKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldEventDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldEventOccurrence" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "startCycle" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "locationSlug" TEXT,
    "priority" INTEGER NOT NULL,
    "sceneDescriptionKey" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorldEventOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorldEventDefinition_key_key" ON "WorldEventDefinition"("key");

-- CreateIndex
CREATE INDEX "WorldEventDefinition_region_status_idx" ON "WorldEventDefinition"("region", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorldEventOccurrence_eventKey_startCycle_key" ON "WorldEventOccurrence"("eventKey", "startCycle");

-- CreateIndex
CREATE INDEX "WorldEventOccurrence_region_endsAt_idx" ON "WorldEventOccurrence"("region", "endsAt");
