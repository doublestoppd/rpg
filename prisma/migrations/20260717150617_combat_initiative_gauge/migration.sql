-- CreateEnum
CREATE TYPE "EncounterKind" AS ENUM ('NORMAL', 'ELITE', 'BOSS');

-- CreateEnum
CREATE TYPE "CombatStatus" AS ENUM ('ACTIVE', 'VICTORY', 'DEFEAT', 'FLED');

-- CreateEnum
CREATE TYPE "CombatantKind" AS ENUM ('PLAYER', 'ENEMY');

-- CreateEnum
CREATE TYPE "CombatRow" AS ENUM ('FRONT', 'BACK');

-- CreateTable
CREATE TABLE "EnemyDefinition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "maxHp" INTEGER NOT NULL,
    "maxMp" INTEGER NOT NULL,
    "strength" INTEGER NOT NULL,
    "agility" INTEGER NOT NULL,
    "magic" INTEGER NOT NULL,
    "defense" INTEGER NOT NULL,
    "magicDefense" INTEGER NOT NULL,
    "luck" INTEGER NOT NULL,
    "ranged" BOOLEAN NOT NULL DEFAULT false,
    "affinities" JSONB NOT NULL,
    "aiConfig" JSONB NOT NULL,
    "rewardConfig" JSONB NOT NULL,

    CONSTRAINT "EnemyDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncounterDefinition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kind" "EncounterKind" NOT NULL,
    "fleeable" BOOLEAN NOT NULL DEFAULT true,
    "composition" JSONB NOT NULL,
    "fleeModifierBps" INTEGER NOT NULL DEFAULT 0,
    "unlockRequirements" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EncounterDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Combat" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "status" "CombatStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "rngSeed" TEXT NOT NULL,
    "rngCounter" INTEGER NOT NULL DEFAULT 0,
    "log" JSONB NOT NULL,
    "fleeAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "Combat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombatantState" (
    "id" TEXT NOT NULL,
    "combatId" TEXT NOT NULL,
    "kind" "CombatantKind" NOT NULL,
    "slot" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "enemyDefinitionId" TEXT,
    "row" "CombatRow" NOT NULL,
    "ranged" BOOLEAN NOT NULL DEFAULT false,
    "currentHp" INTEGER NOT NULL,
    "currentMp" INTEGER NOT NULL,
    "gauge" INTEGER NOT NULL DEFAULT 0,
    "maxHp" INTEGER NOT NULL,
    "maxMp" INTEGER NOT NULL,
    "strength" INTEGER NOT NULL,
    "agility" INTEGER NOT NULL,
    "magic" INTEGER NOT NULL,
    "defense" INTEGER NOT NULL,
    "magicDefense" INTEGER NOT NULL,
    "luck" INTEGER NOT NULL,
    "affinities" JSONB NOT NULL,

    CONSTRAINT "CombatantState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombatStatusEffect" (
    "id" TEXT NOT NULL,
    "combatantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "magnitude" INTEGER NOT NULL,
    "remainingTurns" INTEGER NOT NULL,

    CONSTRAINT "CombatStatusEffect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombatRewardGrant" (
    "id" TEXT NOT NULL,
    "combatId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL,
    "gold" BIGINT NOT NULL,
    "drops" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CombatRewardGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnemyDefinition_slug_key" ON "EnemyDefinition"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "EnemyDefinition_name_key" ON "EnemyDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "EncounterDefinition_slug_key" ON "EncounterDefinition"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "EncounterDefinition_name_key" ON "EncounterDefinition"("name");

-- CreateIndex
CREATE INDEX "Combat_characterId_status_idx" ON "Combat"("characterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Combat_characterId_idempotencyKey_key" ON "Combat"("characterId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CombatantState_combatId_idx" ON "CombatantState"("combatId");

-- CreateIndex
CREATE UNIQUE INDEX "CombatantState_combatId_slot_key" ON "CombatantState"("combatId", "slot");

-- CreateIndex
CREATE INDEX "CombatStatusEffect_combatantId_idx" ON "CombatStatusEffect"("combatantId");

-- CreateIndex
CREATE UNIQUE INDEX "CombatRewardGrant_combatId_key" ON "CombatRewardGrant"("combatId");

-- AddForeignKey
ALTER TABLE "EncounterDefinition" ADD CONSTRAINT "EncounterDefinition_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combat" ADD CONSTRAINT "Combat_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combat" ADD CONSTRAINT "Combat_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "EncounterDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatantState" ADD CONSTRAINT "CombatantState_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "Combat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatStatusEffect" ADD CONSTRAINT "CombatStatusEffect_combatantId_fkey" FOREIGN KEY ("combatantId") REFERENCES "CombatantState"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatRewardGrant" ADD CONSTRAINT "CombatRewardGrant_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "Combat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A character may have at most one active combat (partial unique index;
-- Prisma cannot express partial indexes in the schema DSL).
CREATE UNIQUE INDEX "Combat_one_active_per_character"
  ON "Combat"("characterId")
  WHERE "status" = 'ACTIVE';
