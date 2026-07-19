-- Phase 26 (increment 1): living world — deterministic world clock and regional
-- atmosphere. World-time config is versioned by revision (highest is active);
-- the current cycle/segment is derived from server time, never stored per row.
-- Atmosphere is deterministic given (secret seed, region, cycleId) and stored
-- once per (region, cycleId) so the worker and the lazy API path agree.

-- CreateTable
CREATE TABLE "WorldTimeConfig" (
    "revision" INTEGER NOT NULL,
    "cycleLengthSeconds" INTEGER NOT NULL,
    "segments" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorldTimeConfig_pkey" PRIMARY KEY ("revision")
);

-- CreateTable
CREATE TABLE "WorldSecret" (
    "id" TEXT NOT NULL,
    "seedHex" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorldSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegionAtmosphereState" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "weather" TEXT NOT NULL,
    "intensity" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "temperature" TEXT NOT NULL,
    "wind" TEXT NOT NULL,
    "crowdLevel" TEXT NOT NULL,
    "descriptionKey" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "configRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegionAtmosphereState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegionAtmosphereState_region_cycleId_key" ON "RegionAtmosphereState"("region", "cycleId");

-- CreateIndex
CREATE INDEX "RegionAtmosphereState_region_expiresAt_idx" ON "RegionAtmosphereState"("region", "expiresAt");
