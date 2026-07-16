-- CreateEnum
CREATE TYPE "TravelStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "TravelState" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "originLocationId" TEXT NOT NULL,
    "destinationLocationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completesAt" TIMESTAMP(3) NOT NULL,
    "status" "TravelStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "completedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "TravelState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TravelState_characterId_status_idx" ON "TravelState"("characterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TravelState_characterId_idempotencyKey_key" ON "TravelState"("characterId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "TravelState" ADD CONSTRAINT "TravelState_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelState" ADD CONSTRAINT "TravelState_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TravelRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A character may have at most one travel in progress (partial unique index;
-- Prisma cannot express this in the schema DSL).
CREATE UNIQUE INDEX "TravelState_one_in_progress_per_character"
  ON "TravelState" ("characterId")
  WHERE "status" = 'IN_PROGRESS';
