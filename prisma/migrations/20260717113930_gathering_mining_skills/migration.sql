-- CreateEnum
CREATE TYPE "SkillType" AS ENUM ('MINING');

-- CreateEnum
CREATE TYPE "GatheringRunStatus" AS ENUM ('IN_PROGRESS', 'REWARD_HELD', 'COMPLETED');

-- CreateTable
CREATE TABLE "CharacterSkill" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "skill" "SkillType" NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatheringActionDefinition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "skill" "SkillType" NOT NULL,
    "locationId" TEXT NOT NULL,
    "levelRequirement" INTEGER NOT NULL,
    "staminaCost" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "xpReward" INTEGER NOT NULL,
    "rewardTable" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GatheringActionDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatheringRun" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "status" "GatheringRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completesAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "outcome" JSONB NOT NULL,
    "staminaCost" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "GatheringRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterSkill_characterId_skill_key" ON "CharacterSkill"("characterId", "skill");

-- CreateIndex
CREATE UNIQUE INDEX "GatheringActionDefinition_slug_key" ON "GatheringActionDefinition"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "GatheringActionDefinition_name_key" ON "GatheringActionDefinition"("name");

-- CreateIndex
CREATE INDEX "GatheringActionDefinition_locationId_idx" ON "GatheringActionDefinition"("locationId");

-- CreateIndex
CREATE INDEX "GatheringRun_characterId_status_idx" ON "GatheringRun"("characterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GatheringRun_characterId_idempotencyKey_key" ON "GatheringRun"("characterId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CharacterSkill" ADD CONSTRAINT "CharacterSkill_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatheringActionDefinition" ADD CONSTRAINT "GatheringActionDefinition_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatheringRun" ADD CONSTRAINT "GatheringRun_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatheringRun" ADD CONSTRAINT "GatheringRun_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "GatheringActionDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A character may have at most one unfinished gathering run (partial unique
-- index; Prisma cannot express partial indexes in the schema DSL).
CREATE UNIQUE INDEX "GatheringRun_one_unfinished_per_character"
  ON "GatheringRun"("characterId")
  WHERE "status" <> 'COMPLETED';
