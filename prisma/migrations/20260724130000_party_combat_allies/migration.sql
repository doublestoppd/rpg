-- Party combat: PLAYER-side AI allies summoned mid-battle.
ALTER TYPE "CombatantKind" ADD VALUE IF NOT EXISTS 'ALLY';

ALTER TABLE "CombatantState" ADD COLUMN "aiActions" JSONB;
