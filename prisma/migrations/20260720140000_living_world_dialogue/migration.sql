-- Phase 26 (increment 3): authored dialogue, the interaction lifecycle, and
-- per-character NPC state. Dialogue and narrative flags are versioned content;
-- interactions snapshot the content revisions they used and are replay-safe
-- (start idempotency key) and concurrency-safe (optimistic version + per-step
-- idempotency key).

-- AlterEnum
ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'DIALOGUE';
ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'NARRATIVE_FLAG';

-- AlterEnum: a dialogue effect can progress a TALK_TO_NPC quest objective.
ALTER TYPE "QuestObjectiveType" ADD VALUE IF NOT EXISTS 'TALK_TO_NPC';

-- CreateTable
CREATE TABLE "DialogueDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "entryNodeId" TEXT NOT NULL,
    "nodes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DialogueDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrativeFlagDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "allowedValues" TEXT[],
    "defaultValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NarrativeFlagDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterNpcState" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "npcKey" TEXT NOT NULL,
    "firstMetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInteractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "interactionCount" INTEGER NOT NULL DEFAULT 0,
    "familiarity" INTEGER NOT NULL DEFAULT 0,
    "lastDialogueKey" TEXT,
    "lastDialogueRevision" INTEGER,

    CONSTRAINT "CharacterNpcState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterNpcFlag" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterNpcFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpcInteraction" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "npcKey" TEXT NOT NULL,
    "npcRevision" INTEGER NOT NULL,
    "dialogueKey" TEXT NOT NULL,
    "dialogueRevision" INTEGER NOT NULL,
    "dialogueSnapshot" JSONB NOT NULL,
    "currentNodeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "startIdempotencyKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "NpcInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpcInteractionStep" (
    "id" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "choiceId" TEXT NOT NULL,
    "toNodeId" TEXT,
    "conditionsPassed" BOOLEAN NOT NULL,
    "effectsAttempted" JSONB NOT NULL,
    "effectsCommitted" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NpcInteractionStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DialogueDefinition_key_key" ON "DialogueDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "NarrativeFlagDefinition_key_key" ON "NarrativeFlagDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterNpcState_characterId_npcKey_key" ON "CharacterNpcState"("characterId", "npcKey");

-- CreateIndex
CREATE INDEX "CharacterNpcState_characterId_idx" ON "CharacterNpcState"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterNpcFlag_characterId_flagKey_key" ON "CharacterNpcFlag"("characterId", "flagKey");

-- CreateIndex
CREATE INDEX "CharacterNpcFlag_characterId_idx" ON "CharacterNpcFlag"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "NpcInteraction_characterId_startIdempotencyKey_key" ON "NpcInteraction"("characterId", "startIdempotencyKey");

-- CreateIndex
CREATE INDEX "NpcInteraction_characterId_status_idx" ON "NpcInteraction"("characterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NpcInteractionStep_interactionId_idempotencyKey_key" ON "NpcInteractionStep"("interactionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "NpcInteractionStep_interactionId_idx" ON "NpcInteractionStep"("interactionId");

-- AddForeignKey
ALTER TABLE "CharacterNpcState" ADD CONSTRAINT "CharacterNpcState_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterNpcFlag" ADD CONSTRAINT "CharacterNpcFlag_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcInteraction" ADD CONSTRAINT "NpcInteraction_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcInteractionStep" ADD CONSTRAINT "NpcInteractionStep_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "NpcInteraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
