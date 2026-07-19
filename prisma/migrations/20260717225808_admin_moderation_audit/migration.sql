-- CreateEnum
CREATE TYPE "ChatModerationActionType" AS ENUM ('REDACT_MESSAGE', 'APPLY_RESTRICTION', 'REVOKE_RESTRICTION', 'RESOLVE_REPORT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChatReportStatus" ADD VALUE 'RESOLVED';
ALTER TYPE "ChatReportStatus" ADD VALUE 'DISMISSED';

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "redactedAt" TIMESTAMP(3),
ADD COLUMN     "redactedByUserId" TEXT,
ADD COLUMN     "redactionReason" TEXT;

-- AlterTable
ALTER TABLE "ChatReport" ADD COLUMN     "resolutionReason" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedByUserId" TEXT;

-- AlterTable
ALTER TABLE "ItemDefinition" ADD COLUMN     "configVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "NpcShop" ADD COLUMN     "configVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "adminReauthenticatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorSessionId" TEXT NOT NULL,
    "actionNamespace" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatModerationAction" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" "ChatModerationActionType" NOT NULL,
    "subjectCharacterId" TEXT,
    "messageId" TEXT,
    "reportId" TEXT,
    "restrictionId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorUserId_createdAt_idx" ON "AdminAuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_createdAt_idx" ON "AdminAuditLog"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actionNamespace_createdAt_idx" ON "AdminAuditLog"("actionNamespace", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAuditLog_actorUserId_actionNamespace_idempotencyKey_key" ON "AdminAuditLog"("actorUserId", "actionNamespace", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ChatModerationAction_subjectCharacterId_createdAt_idx" ON "ChatModerationAction"("subjectCharacterId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatModerationAction_action_createdAt_idx" ON "ChatModerationAction"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatModerationAction" ADD CONSTRAINT "ChatModerationAction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only enforcement for AdminAuditLog: reject UPDATE and DELETE at the
-- database level (independent of application role), so the business audit is
-- immutable. Inserts are always allowed.
CREATE OR REPLACE FUNCTION "reject_admin_audit_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AdminAuditLog is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AdminAuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AdminAuditLog"
  FOR EACH ROW EXECUTE FUNCTION "reject_admin_audit_mutation"();
