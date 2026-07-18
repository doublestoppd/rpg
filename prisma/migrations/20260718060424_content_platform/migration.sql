-- CreateEnum
CREATE TYPE "ContentReleaseStatus" AS ENUM ('DRAFT', 'VALIDATING', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('ITEM', 'LOCATION', 'TRAVEL_ROUTE', 'LOCATION_FEATURE', 'REGIONAL_PRICE_MODIFIER', 'NPC_SHOP', 'GATHERING_ACTION', 'CRAFTING_RECIPE', 'ENEMY', 'ENCOUNTER', 'QUEST', 'COLLECTION', 'CHARACTER_CLASS', 'LEVEL_PROGRESSION');

-- CreateTable
CREATE TABLE "ContentRelease" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ContentReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "ContentRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentDefinition" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "contentType" "ContentType" NOT NULL,
    "stableKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentRelease_version_key" ON "ContentRelease"("version");

-- CreateIndex
CREATE INDEX "ContentRelease_status_version_idx" ON "ContentRelease"("status", "version");

-- CreateIndex
CREATE INDEX "ContentDefinition_contentType_stableKey_idx" ON "ContentDefinition"("contentType", "stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "ContentDefinition_releaseId_contentType_stableKey_key" ON "ContentDefinition"("releaseId", "contentType", "stableKey");

-- AddForeignKey
ALTER TABLE "ContentDefinition" ADD CONSTRAINT "ContentDefinition_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ContentRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Immutability for published content: a ContentDefinition belonging to a
-- PUBLISHED release can never be updated or deleted, so a published revision is
-- permanently reproducible. Drafts remain fully editable. Retiring a release
-- changes only the ContentRelease.status, not its definitions.
CREATE OR REPLACE FUNCTION "reject_published_content_mutation"()
RETURNS trigger AS $$
DECLARE
  release_status "ContentReleaseStatus";
BEGIN
  SELECT status INTO release_status FROM "ContentRelease"
    WHERE id = COALESCE(OLD."releaseId", NEW."releaseId");
  IF release_status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'ContentDefinition of a PUBLISHED release is immutable: % rejected', TG_OP;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ContentDefinition_published_immutable"
  BEFORE UPDATE OR DELETE ON "ContentDefinition"
  FOR EACH ROW EXECUTE FUNCTION "reject_published_content_mutation"();
