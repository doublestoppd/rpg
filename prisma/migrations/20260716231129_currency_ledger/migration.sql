/*
  Warnings:

  - You are about to drop the column `gold` on the `Character` table. All the data in the column will be lost.

*/

-- CreateTable
CREATE TABLE "CurrencyAccount" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "balance" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceBefore" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "operationNamespace" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CurrencyAccount_characterId_key" ON "CurrencyAccount"("characterId");

-- CreateIndex
CREATE INDEX "CurrencyTransaction_accountId_createdAt_idx" ON "CurrencyTransaction"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CurrencyTransaction_accountId_operationNamespace_idempotenc_key" ON "CurrencyTransaction"("accountId", "operationNamespace", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CurrencyAccount" ADD CONSTRAINT "CurrencyAccount_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyTransaction" ADD CONSTRAINT "CurrencyTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CurrencyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: move existing Character.gold balances into CurrencyAccount,
-- with one synthetic STARTING_GRANT ledger entry per non-zero balance so the
-- "every Gold change has a ledger entry" invariant holds from day one.
INSERT INTO "CurrencyAccount" ("id", "characterId", "balance", "updatedAt")
SELECT gen_random_uuid(), c."id", c."gold", CURRENT_TIMESTAMP
FROM "Character" c;

INSERT INTO "CurrencyTransaction"
  ("id", "accountId", "amount", "balanceBefore", "balanceAfter", "type", "operationNamespace", "createdAt")
SELECT gen_random_uuid(), a."id", a."balance", 0, a."balance", 'STARTING_GRANT', 'migration', CURRENT_TIMESTAMP
FROM "CurrencyAccount" a
WHERE a."balance" <> 0;

-- Now the column can go.
ALTER TABLE "Character" DROP COLUMN "gold";
