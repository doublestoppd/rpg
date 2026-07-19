import type { PrismaClient } from '@prisma/client';
import type { SalvageResponse } from '@rpg/shared';

import { conflict, DomainError } from '../../lib/http-errors.js';
import type { CharacterService } from '../character/character-service.js';
import type { InventoryService } from '../inventory/inventory-service.js';

export const SALVAGE_DESTRUCTION_REASON = 'SALVAGE';
export const SALVAGE_MATERIAL_REASON = 'SALVAGE_YIELD';
/** Equipment salvages into this common material. */
export const SALVAGE_MATERIAL_SLUG = 'iron-ore';

/** Deterministic salvage yield from an item's reference value. */
export function salvageYield(baseValue: bigint): number {
  const n = Number(baseValue / 40n);
  return Math.max(1, Math.min(10, n));
}

export interface SalvageService {
  salvage(userId: string, itemInstanceId: string): Promise<SalvageResponse>;
}

export function createSalvageService(
  prisma: PrismaClient,
  characterService: CharacterService,
  inventoryService: InventoryService,
): SalvageService {
  return {
    async salvage(userId, itemInstanceId) {
      const character = await characterService.requireCharacter(userId);
      const material = await prisma.itemDefinition.findUniqueOrThrow({
        where: { slug: SALVAGE_MATERIAL_SLUG },
      });

      return prisma.$transaction(async (tx) => {
        await inventoryService.lockCharacter(tx, character.id);
        const instance = await tx.itemInstance.findUnique({
          where: { id: itemInstanceId },
          include: { itemDefinition: true, equipment: true },
        });
        if (!instance || instance.ownerCharacterId !== character.id) {
          throw new DomainError(404, 'UNKNOWN_ITEM', 'You do not own that item.');
        }
        if (instance.destroyedAt) {
          throw conflict('ALREADY_SALVAGED', 'That item has already been salvaged.');
        }
        if (instance.itemDefinition.category !== 'EQUIPMENT') {
          throw conflict('NOT_SALVAGEABLE', 'Only equipment can be salvaged.');
        }
        if (instance.equipment) {
          throw conflict('ITEM_EQUIPPED', 'Unequip the item before salvaging it.');
        }
        if (instance.lockState !== 'NONE') {
          throw conflict(
            'ITEM_LOCKED',
            'That item is listed or in transit and cannot be salvaged.',
          );
        }

        const quantity = salvageYield(instance.itemDefinition.baseValue);

        // Destroy the equipment (a permanent item sink) with an append-only
        // destruction record, then grant the materials with a transfer record —
        // both economic trails are preserved (Phase 24 acceptance). Ownership is
        // retained so a replayed salvage of the same instance resolves to
        // ALREADY_SALVAGED (409) rather than looking like a foreign item (404);
        // destroyed instances never consume inventory slots (countUsedSlots
        // filters destroyedAt: null).
        await tx.itemInstance.update({
          where: { id: instance.id },
          data: { destroyedAt: new Date() },
        });
        const destruction = await tx.itemDestruction.create({
          data: {
            characterId: character.id,
            itemDefinitionId: instance.itemDefinitionId,
            itemInstanceId: instance.id,
            quantity: 1,
            reason: SALVAGE_DESTRUCTION_REASON,
            refType: 'ItemInstance',
            refId: instance.id,
          },
        });
        await inventoryService.addToStack(tx, {
          characterId: character.id,
          itemDefinitionId: material.id,
          quantity,
          reason: SALVAGE_MATERIAL_REASON,
        });
        void destruction;

        return {
          salvagedItemName: instance.itemDefinition.name,
          materials: [{ itemSlug: material.slug, name: material.name, quantity }],
        };
      });
    },
  };
}
