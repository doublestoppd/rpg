-- CreateEnum
CREATE TYPE "LocationFeatureType" AS ENUM ('INN', 'NPC_SHOP', 'MARKETPLACE', 'GATHERING', 'CRAFTING', 'COMBAT', 'QUEST', 'MUSEUM');

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "currentLocationId" TEXT;

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "artworkKey" TEXT NOT NULL,
    "isSafe" BOOLEAN NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationFeature" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" "LocationFeatureType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LocationFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelRoute" (
    "id" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "travelSeconds" INTEGER NOT NULL,
    "goldCost" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "TravelRoute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE INDEX "LocationFeature_locationId_idx" ON "LocationFeature"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationFeature_locationId_type_name_key" ON "LocationFeature"("locationId", "type", "name");

-- CreateIndex
CREATE INDEX "TravelRoute_fromLocationId_idx" ON "TravelRoute"("fromLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "TravelRoute_fromLocationId_toLocationId_key" ON "TravelRoute"("fromLocationId", "toLocationId");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationFeature" ADD CONSTRAINT "LocationFeature_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelRoute" ADD CONSTRAINT "TravelRoute_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelRoute" ADD CONSTRAINT "TravelRoute_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
