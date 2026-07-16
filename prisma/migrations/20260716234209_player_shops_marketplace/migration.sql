-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'SOLD', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('IN_TRANSIT', 'DELIVERED');

-- CreateTable
CREATE TABLE "PlayerShop" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerShop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceListing" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sellerCharacterId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "itemInstanceId" TEXT,
    "quantity" INTEGER NOT NULL,
    "price" BIGINT NOT NULL,
    "feePaid" BIGINT NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "returnReservationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceSale" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerCharacterId" TEXT NOT NULL,
    "sellerCharacterId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "grossPrice" BIGINT NOT NULL,
    "tax" BIGINT NOT NULL,
    "sellerProceeds" BIGINT NOT NULL,
    "shippingFee" BIGINT NOT NULL,
    "remote" BOOLEAN NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "buyerCharacterId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrivesAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "capacityReservationId" TEXT NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryLine" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "itemInstanceId" TEXT,

    CONSTRAINT "DeliveryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerShop_characterId_key" ON "PlayerShop"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerShop_name_key" ON "PlayerShop"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceListing_itemInstanceId_key" ON "MarketplaceListing"("itemInstanceId");

-- CreateIndex
CREATE INDEX "MarketplaceListing_status_expiresAt_idx" ON "MarketplaceListing"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "MarketplaceListing_itemDefinitionId_status_idx" ON "MarketplaceListing"("itemDefinitionId", "status");

-- CreateIndex
CREATE INDEX "MarketplaceListing_sellerCharacterId_status_idx" ON "MarketplaceListing"("sellerCharacterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceListing_sellerCharacterId_idempotencyKey_key" ON "MarketplaceListing"("sellerCharacterId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceSale_listingId_key" ON "MarketplaceSale"("listingId");

-- CreateIndex
CREATE INDEX "MarketplaceSale_itemDefinitionId_createdAt_idx" ON "MarketplaceSale"("itemDefinitionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceSale_buyerCharacterId_idempotencyKey_key" ON "MarketplaceSale"("buyerCharacterId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_saleId_key" ON "Delivery"("saleId");

-- CreateIndex
CREATE INDEX "Delivery_buyerCharacterId_status_idx" ON "Delivery"("buyerCharacterId", "status");

-- CreateIndex
CREATE INDEX "DeliveryLine_deliveryId_idx" ON "DeliveryLine"("deliveryId");

-- AddForeignKey
ALTER TABLE "PlayerShop" ADD CONSTRAINT "PlayerShop_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "PlayerShop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_sellerCharacterId_fkey" FOREIGN KEY ("sellerCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_itemInstanceId_fkey" FOREIGN KEY ("itemInstanceId") REFERENCES "ItemInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceSale" ADD CONSTRAINT "MarketplaceSale_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketplaceListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceSale" ADD CONSTRAINT "MarketplaceSale_buyerCharacterId_fkey" FOREIGN KEY ("buyerCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "MarketplaceSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_buyerCharacterId_fkey" FOREIGN KEY ("buyerCharacterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
