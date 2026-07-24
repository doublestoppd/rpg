import type {
  EquipmentAssignment,
  ItemDefinition,
  ItemInstance,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type { InventoryResponse, ItemDefinitionInfo, ItemRarity, RolledAffix } from '@rpg/shared';

import { effectiveItemBonuses, parseAffixes } from '../../config/affixes.js';
import { gameConfig } from '../../config/game.js';
import { DomainError } from '../../lib/http-errors.js';

type Tx = Prisma.TransactionClient | PrismaClient;

export const TRANSFER_REASONS = {
  STARTER_KIT: 'STARTER_KIT',
  TEST_GRANT: 'TEST_GRANT',
} as const;

export function toItemDefinitionInfo(def: ItemDefinition): ItemDefinitionInfo {
  return {
    slug: def.slug,
    name: def.name,
    description: def.description,
    category: def.category,
    stackable: def.stackable,
    maxStackQuantity: def.maxStackQuantity,
    equipmentSlot: def.equipmentSlot,
    levelRequirement: def.levelRequirement,
    bonuses: {
      strength: def.bonusStrength,
      agility: def.bonusAgility,
      magic: def.bonusMagic,
      defense: def.bonusDefense,
      magicDefense: def.bonusMagicDefense,
      luck: def.bonusLuck,
      maxHp: def.bonusMaxHp,
      maxMp: def.bonusMaxMp,
    },
    hpRestore: def.hpRestore,
    mpRestore: def.mpRestore,
    usableInCombat: def.usableInCombat,
    baseValue: def.baseValue.toString(),
  };
}

const insufficientCapacity = () =>
  new DomainError(409, 'INVENTORY_FULL', 'You have no free inventory space.');

export interface InventoryService {
  /**
   * Serializes concurrent inventory mutations for one character. Repository
   * function using raw SQL for row locking (ADR 0003).
   */
  lockCharacter(tx: Prisma.TransactionClient, characterId: string): Promise<void>;
  /** Slots in use: stacks + unequipped active instances + active reservations. */
  countUsedSlots(tx: Tx, characterId: string): Promise<{ used: number; reserved: number }>;
  /** Throws INVENTORY_FULL unless `needed` free slots are available. */
  assertFreeSlots(tx: Tx, characterId: string, needed: number): Promise<void>;
  /**
   * Adds stackable quantity, creating the stack (one slot) when absent.
   * Enforces the stack maximum and records an aggregate ItemTransfer.
   */
  addToStack(
    tx: Prisma.TransactionClient,
    input: {
      characterId: string;
      itemDefinitionId: string;
      quantity: number;
      reason: string;
      fromCharacterId?: string | null;
      /** False when the ownership transfer was already recorded (e.g. at
       *  remote purchase time, before the delivery placed the goods). */
      recordTransfer?: boolean;
    },
  ): Promise<void>;
  /** Removes stackable quantity (deleting at zero) with a transfer record. */
  removeFromStack(
    tx: Prisma.TransactionClient,
    input: {
      characterId: string;
      itemDefinitionId: string;
      quantity: number;
      reason: string;
      toCharacterId?: string | null;
    },
  ): Promise<void>;
  /** Creates a unique instance owned by the character (one slot). */
  grantInstance(
    tx: Prisma.TransactionClient,
    input: {
      characterId: string;
      itemDefinitionId: string;
      reason: string;
      /** Rolled quality (Improvement Phase 2); defaults to a plain COMMON item. */
      rarity?: ItemRarity;
      affixes?: RolledAffix[];
    },
  ): Promise<ItemInstance>;
  getInventoryResponse(characterId: string): Promise<InventoryResponse>;
  getItemBySlug(slug: string): Promise<ItemDefinitionInfo>;
}

export function createInventoryService(prisma: PrismaClient): InventoryService {
  async function countUsedSlots(tx: Tx, characterId: string) {
    const [stacks, instances, reservations] = await Promise.all([
      tx.inventoryStack.count({ where: { characterId } }),
      tx.itemInstance.count({
        where: {
          ownerCharacterId: characterId,
          destroyedAt: null,
          lockState: 'NONE',
          equipment: null, // equipped instances consume no inventory slot
        },
      }),
      tx.inventoryCapacityReservation.aggregate({
        where: { characterId, releasedAt: null },
        _sum: { slots: true },
      }),
    ]);
    const reserved = reservations._sum.slots ?? 0;
    return { used: stacks + instances + reserved, reserved };
  }

  async function assertFreeSlots(tx: Tx, characterId: string, needed: number) {
    const { used } = await countUsedSlots(tx, characterId);
    if (used + needed > gameConfig.inventoryCapacity) throw insufficientCapacity();
  }

  return {
    async lockCharacter(tx, characterId) {
      await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
    },

    countUsedSlots,
    assertFreeSlots,

    async addToStack(tx, input) {
      if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
        throw new DomainError(400, 'INVALID_QUANTITY', 'Quantity must be a positive integer.');
      }
      const definition = await tx.itemDefinition.findUniqueOrThrow({
        where: { id: input.itemDefinitionId },
      });
      if (!definition.stackable) {
        throw new DomainError(400, 'NOT_STACKABLE', `${definition.name} is not stackable.`);
      }
      const existing = await tx.inventoryStack.findUnique({
        where: {
          characterId_itemDefinitionId: {
            characterId: input.characterId,
            itemDefinitionId: input.itemDefinitionId,
          },
        },
      });
      const newQuantity = (existing?.quantity ?? 0) + input.quantity;
      if (newQuantity > definition.maxStackQuantity) {
        throw new DomainError(
          409,
          'STACK_LIMIT',
          `You cannot carry more than ${definition.maxStackQuantity} ${definition.name}.`,
        );
      }
      if (existing) {
        await tx.inventoryStack.update({
          where: { id: existing.id },
          data: { quantity: newQuantity },
        });
      } else {
        // A new stack consumes one slot regardless of quantity.
        await assertFreeSlots(tx, input.characterId, 1);
        await tx.inventoryStack.create({
          data: {
            characterId: input.characterId,
            itemDefinitionId: input.itemDefinitionId,
            quantity: input.quantity,
          },
        });
      }
      if (input.recordTransfer !== false) {
        await tx.itemTransfer.create({
          data: {
            itemDefinitionId: input.itemDefinitionId,
            quantity: input.quantity,
            fromCharacterId: input.fromCharacterId ?? null,
            toCharacterId: input.characterId,
            reason: input.reason,
          },
        });
      }
    },

    async removeFromStack(tx, input) {
      if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
        throw new DomainError(400, 'INVALID_QUANTITY', 'Quantity must be a positive integer.');
      }
      const existing = await tx.inventoryStack.findUnique({
        where: {
          characterId_itemDefinitionId: {
            characterId: input.characterId,
            itemDefinitionId: input.itemDefinitionId,
          },
        },
      });
      if (!existing || existing.quantity < input.quantity) {
        throw new DomainError(409, 'INSUFFICIENT_ITEMS', 'You do not have enough of that item.');
      }
      if (existing.quantity === input.quantity) {
        await tx.inventoryStack.delete({ where: { id: existing.id } });
      } else {
        await tx.inventoryStack.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity - input.quantity },
        });
      }
      await tx.itemTransfer.create({
        data: {
          itemDefinitionId: input.itemDefinitionId,
          quantity: input.quantity,
          fromCharacterId: input.characterId,
          toCharacterId: input.toCharacterId ?? null,
          reason: input.reason,
        },
      });
    },

    async grantInstance(tx, input) {
      const definition = await tx.itemDefinition.findUniqueOrThrow({
        where: { id: input.itemDefinitionId },
      });
      if (definition.stackable) {
        throw new DomainError(400, 'STACKABLE', `${definition.name} is a stackable commodity.`);
      }
      await assertFreeSlots(tx, input.characterId, 1);
      const instance = await tx.itemInstance.create({
        data: {
          itemDefinitionId: input.itemDefinitionId,
          ownerCharacterId: input.characterId,
          rarity: input.rarity ?? 'COMMON',
          affixes: input.affixes ?? [],
        },
      });
      await tx.itemTransfer.create({
        data: {
          itemDefinitionId: input.itemDefinitionId,
          itemInstanceId: instance.id,
          quantity: 1,
          toCharacterId: input.characterId,
          reason: input.reason,
        },
      });
      return instance;
    },

    async getInventoryResponse(characterId) {
      const [stacks, instances, usage] = await Promise.all([
        prisma.inventoryStack.findMany({
          where: { characterId },
          include: { itemDefinition: true },
          orderBy: { itemDefinition: { name: 'asc' } },
        }),
        prisma.itemInstance.findMany({
          where: { ownerCharacterId: characterId, destroyedAt: null },
          include: { itemDefinition: true, equipment: true },
          orderBy: { createdAt: 'asc' },
        }) as Promise<
          Array<
            ItemInstance & { itemDefinition: ItemDefinition; equipment: EquipmentAssignment | null }
          >
        >,
        countUsedSlots(prisma, characterId),
      ]);
      return {
        slots: {
          used: usage.used,
          capacity: gameConfig.inventoryCapacity,
          reserved: usage.reserved,
        },
        stacks: stacks.map((stack) => ({
          item: toItemDefinitionInfo(stack.itemDefinition),
          quantity: stack.quantity,
        })),
        instances: instances.map((instance) => {
          const affixes = parseAffixes(instance.affixes);
          return {
            id: instance.id,
            item: toItemDefinitionInfo(instance.itemDefinition),
            lockState: instance.lockState,
            equippedSlot: instance.equipment?.slot ?? null,
            rarity: instance.rarity,
            affixes,
            effectiveBonuses: effectiveItemBonuses(instance.itemDefinition, affixes),
          };
        }),
      };
    },

    async getItemBySlug(slug) {
      const definition = await prisma.itemDefinition.findUnique({ where: { slug } });
      if (!definition) {
        throw new DomainError(404, 'UNKNOWN_ITEM', 'No such item exists.');
      }
      return toItemDefinitionInfo(definition);
    },
  };
}
