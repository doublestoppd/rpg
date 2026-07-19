-- Phase 23: per-character ability loadout + talent choices, and a build
-- snapshot on each combat so an in-progress battle is never altered by a later
-- respec or content publish.

-- AlterTable
ALTER TABLE "Combat" ADD COLUMN "buildSnapshot" JSONB;

-- CreateTable
CREATE TABLE "CharacterBuild" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "loadout" JSONB NOT NULL,
    "talents" JSONB NOT NULL,
    "configVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterBuild_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterBuild_characterId_key" ON "CharacterBuild"("characterId");

-- AddForeignKey
ALTER TABLE "CharacterBuild" ADD CONSTRAINT "CharacterBuild_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
