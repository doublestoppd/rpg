-- Phase 22: new gathering and crafting professions.
-- Herbalism is a timed gathering profession; Alchemy is a timed crafting
-- profession. They reuse the existing gathering/crafting engines (stored
-- outcome, capacity hold, lazy finalization, idempotency) — only the enum
-- domains widen here; all Northmarch content is published via the content
-- platform, not seeded.
ALTER TYPE "SkillType" ADD VALUE 'HERBALISM';
ALTER TYPE "ProfessionType" ADD VALUE 'ALCHEMY';
