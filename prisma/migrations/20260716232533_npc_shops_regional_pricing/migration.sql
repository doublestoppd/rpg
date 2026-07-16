-- CreateTable
CREATE TABLE "RegionalPriceModifier" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "modifierBps" INTEGER NOT NULL,

    CONSTRAINT "RegionalPriceModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpcShop" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "markupBps" INTEGER NOT NULL,
    "sellbackBps" INTEGER NOT NULL,
    "poolConfig" JSONB NOT NULL,
    "restockIntervalSeconds" INTEGER NOT NULL,
    "restockJitterSeconds" INTEGER NOT NULL,
    "nextRestockAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRestockAt" TIMESTAMP(3),
    "currentRestockId" TEXT,

    CONSTRAINT "NpcShop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpcShopRestock" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "restockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NpcShopRestock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpcShopStockEntry" (
    "id" TEXT NOT NULL,
    "restockId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "quantityTotal" INTEGER NOT NULL,
    "quantityRemaining" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "perCharacterLimit" INTEGER NOT NULL,

    CONSTRAINT "NpcShopStockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpcShopPurchase" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "restockId" TEXT NOT NULL,
    "stockEntryId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "totalPrice" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NpcShopPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegionalPriceModifier_locationId_category_key" ON "RegionalPriceModifier"("locationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "NpcShop_slug_key" ON "NpcShop"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "NpcShop_name_key" ON "NpcShop"("name");

-- CreateIndex
CREATE INDEX "NpcShopRestock_shopId_restockedAt_idx" ON "NpcShopRestock"("shopId", "restockedAt");

-- CreateIndex
CREATE INDEX "NpcShopStockEntry_restockId_idx" ON "NpcShopStockEntry"("restockId");

-- CreateIndex
CREATE INDEX "NpcShopPurchase_characterId_stockEntryId_idx" ON "NpcShopPurchase"("characterId", "stockEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "NpcShopPurchase_characterId_idempotencyKey_key" ON "NpcShopPurchase"("characterId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "RegionalPriceModifier" ADD CONSTRAINT "RegionalPriceModifier_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcShop" ADD CONSTRAINT "NpcShop_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcShopRestock" ADD CONSTRAINT "NpcShopRestock_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "NpcShop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcShopStockEntry" ADD CONSTRAINT "NpcShopStockEntry_restockId_fkey" FOREIGN KEY ("restockId") REFERENCES "NpcShopRestock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcShopStockEntry" ADD CONSTRAINT "NpcShopStockEntry_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcShopPurchase" ADD CONSTRAINT "NpcShopPurchase_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "NpcShop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcShopPurchase" ADD CONSTRAINT "NpcShopPurchase_restockId_fkey" FOREIGN KEY ("restockId") REFERENCES "NpcShopRestock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcShopPurchase" ADD CONSTRAINT "NpcShopPurchase_stockEntryId_fkey" FOREIGN KEY ("stockEntryId") REFERENCES "NpcShopStockEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcShopPurchase" ADD CONSTRAINT "NpcShopPurchase_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
