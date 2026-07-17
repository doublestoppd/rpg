-- CreateEnum
CREATE TYPE "QuestObjectiveType" AS ENUM ('TRAVEL_TO_LOCATION', 'GATHER_ITEM', 'CRAFT_RECIPE', 'DEFEAT_ENEMY', 'DONATE_ITEM');

-- CreateEnum
CREATE TYPE "CharacterQuestStatus" AS ENUM ('ACCEPTED', 'ACTIVE', 'COMPLETED_UNCLAIMED', 'CLAIMED');

-- CreateTable
CREATE TABLE "QuestDefinition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rewardXp" INTEGER NOT NULL,
    "rewardGold" BIGINT NOT NULL,
    "rewardItems" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuestDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestObjective" (
    "id" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "type" "QuestObjectiveType" NOT NULL,
    "targetSlug" TEXT NOT NULL,
    "requiredCount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "QuestObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterQuest" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "status" "CharacterQuestStatus" NOT NULL DEFAULT 'ACTIVE',
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "CharacterQuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestProgress" (
    "id" TEXT NOT NULL,
    "characterQuestId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "currentCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "QuestProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestDefinition_slug_key" ON "QuestDefinition"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "QuestDefinition_name_key" ON "QuestDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "QuestObjective_questId_sortOrder_key" ON "QuestObjective"("questId", "sortOrder");

-- CreateIndex
CREATE INDEX "CharacterQuest_characterId_status_idx" ON "CharacterQuest"("characterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterQuest_characterId_questId_key" ON "CharacterQuest"("characterId", "questId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestProgress_characterQuestId_objectiveId_key" ON "QuestProgress"("characterQuestId", "objectiveId");

-- AddForeignKey
ALTER TABLE "QuestObjective" ADD CONSTRAINT "QuestObjective_questId_fkey" FOREIGN KEY ("questId") REFERENCES "QuestDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterQuest" ADD CONSTRAINT "CharacterQuest_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterQuest" ADD CONSTRAINT "CharacterQuest_questId_fkey" FOREIGN KEY ("questId") REFERENCES "QuestDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestProgress" ADD CONSTRAINT "QuestProgress_characterQuestId_fkey" FOREIGN KEY ("characterQuestId") REFERENCES "CharacterQuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestProgress" ADD CONSTRAINT "QuestProgress_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "QuestObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;
