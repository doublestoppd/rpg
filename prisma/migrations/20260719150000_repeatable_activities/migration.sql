-- Phase 24: repeatable activities. Bounty claims are unique per character +
-- timestamp cycle + bounty (exactly-once rewards, rotation-safe); regional
-- reputation is a bounded, non-spendable counter.

-- CreateTable
CREATE TABLE "BountyClaim" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "bountySlug" TEXT NOT NULL,
    "rewardGold" BIGINT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BountyClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterReputation" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CharacterReputation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BountyClaim_characterId_idx" ON "BountyClaim"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "BountyClaim_characterId_cycleId_bountySlug_key" ON "BountyClaim"("characterId", "cycleId", "bountySlug");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterReputation_characterId_region_key" ON "CharacterReputation"("characterId", "region");

-- AddForeignKey
ALTER TABLE "BountyClaim" ADD CONSTRAINT "BountyClaim_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterReputation" ADD CONSTRAINT "CharacterReputation_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
