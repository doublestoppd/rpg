-- CreateTable
CREATE TABLE "CharacterClassDefinition" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "baseHp" INTEGER NOT NULL,
    "baseMp" INTEGER NOT NULL,
    "baseStamina" INTEGER NOT NULL,
    "baseStrength" INTEGER NOT NULL,
    "baseAgility" INTEGER NOT NULL,
    "baseMagic" INTEGER NOT NULL,
    "baseDefense" INTEGER NOT NULL,
    "baseMagicDefense" INTEGER NOT NULL,
    "baseLuck" INTEGER NOT NULL,
    "growthHp" INTEGER NOT NULL,
    "growthMp" INTEGER NOT NULL,
    "growthStrength" INTEGER NOT NULL,
    "growthAgility" INTEGER NOT NULL,
    "growthMagic" INTEGER NOT NULL,
    "growthDefense" INTEGER NOT NULL,
    "growthMagicDefense" INTEGER NOT NULL,
    "growthLuck" INTEGER NOT NULL,

    CONSTRAINT "CharacterClassDefinition_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "LevelProgression" (
    "level" INTEGER NOT NULL,
    "cumulativeXp" INTEGER NOT NULL,

    CONSTRAINT "LevelProgression_pkey" PRIMARY KEY ("level")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classSlug" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "gold" BIGINT NOT NULL,
    "currentHp" INTEGER NOT NULL,
    "currentMp" INTEGER NOT NULL,
    "stamina" INTEGER NOT NULL,
    "staminaUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterClassDefinition_name_key" ON "CharacterClassDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Character_userId_key" ON "Character"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_name_key" ON "Character"("name");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_classSlug_fkey" FOREIGN KEY ("classSlug") REFERENCES "CharacterClassDefinition"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;
