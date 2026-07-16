-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('RESOURCE', 'CONSUMABLE', 'EQUIPMENT', 'CRAFTING_COMPONENT', 'COLLECTIBLE', 'QUEST_ITEM', 'SPECIALTY');

-- CreateEnum
CREATE TYPE "EquipmentSlot" AS ENUM ('MAIN_HAND', 'OFF_HAND', 'HEAD', 'BODY', 'HANDS', 'LEGS', 'FEET', 'ACCESSORY_1', 'ACCESSORY_2');

-- CreateEnum
CREATE TYPE "ItemInstanceLock" AS ENUM ('NONE', 'LISTED', 'IN_TRANSIT');

-- CreateTable
CREATE TABLE "ItemDefinition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "stackable" BOOLEAN NOT NULL,
    "maxStackQuantity" INTEGER NOT NULL DEFAULT 1,
    "equipmentSlot" "EquipmentSlot",
    "levelRequirement" INTEGER NOT NULL DEFAULT 1,
    "bonusStrength" INTEGER NOT NULL DEFAULT 0,
    "bonusAgility" INTEGER NOT NULL DEFAULT 0,
    "bonusMagic" INTEGER NOT NULL DEFAULT 0,
    "bonusDefense" INTEGER NOT NULL DEFAULT 0,
    "bonusMagicDefense" INTEGER NOT NULL DEFAULT 0,
    "bonusLuck" INTEGER NOT NULL DEFAULT 0,
    "bonusMaxHp" INTEGER NOT NULL DEFAULT 0,
    "bonusMaxMp" INTEGER NOT NULL DEFAULT 0,
    "hpRestore" INTEGER NOT NULL DEFAULT 0,
    "mpRestore" INTEGER NOT NULL DEFAULT 0,
    "usableInCombat" BOOLEAN NOT NULL DEFAULT false,
    "baseValue" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ItemDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryStack" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryStack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemInstance" (
    "id" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "ownerCharacterId" TEXT,
    "lockState" "ItemInstanceLock" NOT NULL DEFAULT 'NONE',
    "destroyedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentAssignment" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "slot" "EquipmentSlot" NOT NULL,
    "itemInstanceId" TEXT NOT NULL,

    CONSTRAINT "EquipmentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCapacityReservation" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "slots" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryCapacityReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemTransfer" (
    "id" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "itemInstanceId" TEXT,
    "quantity" INTEGER NOT NULL,
    "fromCharacterId" TEXT,
    "toCharacterId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemDefinition_slug_key" ON "ItemDefinition"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ItemDefinition_name_key" ON "ItemDefinition"("name");

-- CreateIndex
CREATE INDEX "InventoryStack_characterId_idx" ON "InventoryStack"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryStack_characterId_itemDefinitionId_key" ON "InventoryStack"("characterId", "itemDefinitionId");

-- CreateIndex
CREATE INDEX "ItemInstance_ownerCharacterId_idx" ON "ItemInstance"("ownerCharacterId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentAssignment_itemInstanceId_key" ON "EquipmentAssignment"("itemInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentAssignment_characterId_slot_key" ON "EquipmentAssignment"("characterId", "slot");

-- CreateIndex
CREATE INDEX "InventoryCapacityReservation_characterId_releasedAt_idx" ON "InventoryCapacityReservation"("characterId", "releasedAt");

-- CreateIndex
CREATE INDEX "ItemTransfer_itemInstanceId_idx" ON "ItemTransfer"("itemInstanceId");

-- CreateIndex
CREATE INDEX "ItemTransfer_fromCharacterId_idx" ON "ItemTransfer"("fromCharacterId");

-- CreateIndex
CREATE INDEX "ItemTransfer_toCharacterId_idx" ON "ItemTransfer"("toCharacterId");

-- AddForeignKey
ALTER TABLE "InventoryStack" ADD CONSTRAINT "InventoryStack_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStack" ADD CONSTRAINT "InventoryStack_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_ownerCharacterId_fkey" FOREIGN KEY ("ownerCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_itemInstanceId_fkey" FOREIGN KEY ("itemInstanceId") REFERENCES "ItemInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCapacityReservation" ADD CONSTRAINT "InventoryCapacityReservation_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTransfer" ADD CONSTRAINT "ItemTransfer_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTransfer" ADD CONSTRAINT "ItemTransfer_itemInstanceId_fkey" FOREIGN KEY ("itemInstanceId") REFERENCES "ItemInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTransfer" ADD CONSTRAINT "ItemTransfer_fromCharacterId_fkey" FOREIGN KEY ("fromCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTransfer" ADD CONSTRAINT "ItemTransfer_toCharacterId_fkey" FOREIGN KEY ("toCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;
