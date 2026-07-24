-- Improvement Phase 2: per-instance equipment rarity and rolled affixes.
CREATE TYPE "ItemRarity" AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY');

ALTER TABLE "ItemInstance"
  ADD COLUMN "rarity" "ItemRarity" NOT NULL DEFAULT 'COMMON',
  ADD COLUMN "affixes" JSONB NOT NULL DEFAULT '[]';
