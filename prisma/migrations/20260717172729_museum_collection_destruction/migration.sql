-- CreateTable
CREATE TABLE "CollectionDefinition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CollectionDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionEntry" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "curatorNote" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CollectionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterCollectionDonation" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "collectionEntryId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "itemInstanceId" TEXT,
    "donatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterCollectionDonation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemDestruction" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "itemInstanceId" TEXT,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemDestruction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectionDefinition_slug_key" ON "CollectionDefinition"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionDefinition_name_key" ON "CollectionDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionEntry_collectionId_itemDefinitionId_key" ON "CollectionEntry"("collectionId", "itemDefinitionId");

-- CreateIndex
CREATE INDEX "CharacterCollectionDonation_characterId_idx" ON "CharacterCollectionDonation"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterCollectionDonation_characterId_collectionEntryId_key" ON "CharacterCollectionDonation"("characterId", "collectionEntryId");

-- CreateIndex
CREATE INDEX "ItemDestruction_characterId_createdAt_idx" ON "ItemDestruction"("characterId", "createdAt");

-- AddForeignKey
ALTER TABLE "CollectionDefinition" ADD CONSTRAINT "CollectionDefinition_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionEntry" ADD CONSTRAINT "CollectionEntry_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "CollectionDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionEntry" ADD CONSTRAINT "CollectionEntry_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCollectionDonation" ADD CONSTRAINT "CharacterCollectionDonation_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCollectionDonation" ADD CONSTRAINT "CharacterCollectionDonation_collectionEntryId_fkey" FOREIGN KEY ("collectionEntryId") REFERENCES "CollectionEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDestruction" ADD CONSTRAINT "ItemDestruction_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
