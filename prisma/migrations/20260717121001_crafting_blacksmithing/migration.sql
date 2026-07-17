-- CreateEnum
CREATE TYPE "ProfessionType" AS ENUM ('BLACKSMITHING');

-- CreateEnum
CREATE TYPE "CraftingRunStatus" AS ENUM ('IN_PROGRESS', 'OUTPUT_HELD', 'COMPLETED');

-- CreateTable
CREATE TABLE "CraftingProfessionProgress" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "profession" "ProfessionType" NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CraftingProfessionProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CraftingRecipe" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "profession" "ProfessionType" NOT NULL,
    "locationId" TEXT NOT NULL,
    "levelRequirement" INTEGER NOT NULL,
    "goldCost" BIGINT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "xpReward" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "outputItemDefinitionId" TEXT NOT NULL,
    "outputQuantity" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CraftingRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CraftingRun" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "status" "CraftingRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completesAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "output" JSONB NOT NULL,
    "goldPaid" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "CraftingRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CraftingProfessionProgress_characterId_profession_key" ON "CraftingProfessionProgress"("characterId", "profession");

-- CreateIndex
CREATE UNIQUE INDEX "CraftingRecipe_slug_key" ON "CraftingRecipe"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CraftingRecipe_name_key" ON "CraftingRecipe"("name");

-- CreateIndex
CREATE INDEX "CraftingRecipe_locationId_idx" ON "CraftingRecipe"("locationId");

-- CreateIndex
CREATE INDEX "CraftingRun_characterId_status_idx" ON "CraftingRun"("characterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CraftingRun_characterId_idempotencyKey_key" ON "CraftingRun"("characterId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CraftingProfessionProgress" ADD CONSTRAINT "CraftingProfessionProgress_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CraftingRecipe" ADD CONSTRAINT "CraftingRecipe_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CraftingRecipe" ADD CONSTRAINT "CraftingRecipe_outputItemDefinitionId_fkey" FOREIGN KEY ("outputItemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CraftingRun" ADD CONSTRAINT "CraftingRun_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CraftingRun" ADD CONSTRAINT "CraftingRun_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "CraftingRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A character may have at most one unfinished crafting run (partial unique
-- index; Prisma cannot express partial indexes in the schema DSL).
CREATE UNIQUE INDEX "CraftingRun_one_unfinished_per_character"
  ON "CraftingRun"("characterId")
  WHERE "status" <> 'COMPLETED';
