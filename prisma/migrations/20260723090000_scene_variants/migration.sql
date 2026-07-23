-- Authored scene-flavor overlays selected server-side from the current
-- conditions (segment / weather / active event type). Presentation only.
CREATE TABLE "SceneVariantDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "locationSlug" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "segment" TEXT,
    "weather" TEXT,
    "eventType" TEXT,
    "narration" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SceneVariantDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SceneVariantDefinition_key_key" ON "SceneVariantDefinition"("key");
CREATE INDEX "SceneVariantDefinition_locationSlug_status_idx" ON "SceneVariantDefinition"("locationSlug", "status");
