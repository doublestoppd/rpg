import type { ItemDefinition, PrismaClient } from '@prisma/client';
import type { EquipmentSlotName } from '@rpg/shared';

import { DomainError } from '../../lib/http-errors.js';
import type { CharacterService } from '../character/character-service.js';
import type { InventoryService } from './inventory-service.js';

const ACCESSORY_SLOTS: EquipmentSlotName[] = ['ACCESSORY_1', 'ACCESSORY_2'];

export interface EquipmentService {
  equip(
    userId: string,
    input: { itemInstanceId: string; slot?: EquipmentSlotName | undefined },
  ): Promise<void>;
  unequip(userId: string, input: { slot: EquipmentSlotName }): Promise<void>;
  /** Definitions of currently equipped items (for derived-stat bonuses). */
  equippedDefinitions(characterId: string): Promise<ItemDefinition[]>;
}

export function createEquipmentService(
  prisma: PrismaClient,
  characterService: CharacterService,
  inventoryService: InventoryService,
): EquipmentService {
  return {
    async equip(userId, input) {
      const character = await characterService.requireCharacter(userId);
      await prisma.$transaction(async (tx) => {
        await inventoryService.lockCharacter(tx, character.id);

        const instance = await tx.itemInstance.findUnique({
          where: { id: input.itemInstanceId },
          include: { itemDefinition: true, equipment: true },
        });
        if (!instance || instance.ownerCharacterId !== character.id || instance.destroyedAt) {
          throw new DomainError(404, 'UNKNOWN_INSTANCE', 'You do not own that item.');
        }
        // Locked, listed, or in-transit assets cannot be equipped.
        if (instance.lockState !== 'NONE') {
          throw new DomainError(409, 'ITEM_LOCKED', 'That item is locked and cannot be equipped.');
        }
        if (instance.equipment) {
          throw new DomainError(409, 'ALREADY_EQUIPPED', 'That item is already equipped.');
        }
        const definition = instance.itemDefinition;
        if (definition.category !== 'EQUIPMENT' || !definition.equipmentSlot) {
          throw new DomainError(400, 'NOT_EQUIPMENT', `${definition.name} cannot be equipped.`);
        }
        if (character.level < definition.levelRequirement) {
          throw new DomainError(
            400,
            'LEVEL_TOO_LOW',
            `${definition.name} requires level ${definition.levelRequirement}.`,
          );
        }

        // Resolve the concrete slot: accessories fit either accessory slot.
        const isAccessory = ACCESSORY_SLOTS.includes(definition.equipmentSlot);
        let slot: EquipmentSlotName;
        if (input.slot) {
          const fits = isAccessory
            ? ACCESSORY_SLOTS.includes(input.slot)
            : input.slot === definition.equipmentSlot;
          if (!fits) {
            throw new DomainError(400, 'WRONG_SLOT', `${definition.name} does not fit that slot.`);
          }
          slot = input.slot;
        } else if (isAccessory) {
          const taken = await tx.equipmentAssignment.findMany({
            where: { characterId: character.id, slot: { in: ACCESSORY_SLOTS } },
          });
          const free = ACCESSORY_SLOTS.find((s) => !taken.some((t) => t.slot === s));
          if (!free) {
            throw new DomainError(409, 'SLOT_OCCUPIED', 'Both accessory slots are occupied.');
          }
          slot = free;
        } else {
          slot = definition.equipmentSlot;
        }

        // Swapping is capacity-neutral: the newly equipped item frees the slot
        // that the displaced item then occupies.
        const occupant = await tx.equipmentAssignment.findUnique({
          where: { characterId_slot: { characterId: character.id, slot } },
        });
        if (occupant) {
          await tx.equipmentAssignment.delete({ where: { id: occupant.id } });
        }
        await tx.equipmentAssignment.create({
          data: { characterId: character.id, slot, itemInstanceId: instance.id },
        });
      });
    },

    async unequip(userId, input) {
      const character = await characterService.requireCharacter(userId);
      await prisma.$transaction(async (tx) => {
        await inventoryService.lockCharacter(tx, character.id);
        const assignment = await tx.equipmentAssignment.findUnique({
          where: { characterId_slot: { characterId: character.id, slot: input.slot } },
        });
        if (!assignment) {
          throw new DomainError(404, 'SLOT_EMPTY', 'Nothing is equipped in that slot.');
        }
        // The unequipped instance re-enters active inventory and needs a slot.
        await inventoryService.assertFreeSlots(tx, character.id, 1);
        await tx.equipmentAssignment.delete({ where: { id: assignment.id } });
      });
    },

    async equippedDefinitions(characterId) {
      const assignments = await prisma.equipmentAssignment.findMany({
        where: { characterId },
        include: { itemInstance: { include: { itemDefinition: true } } },
      });
      return assignments.map((a) => a.itemInstance.itemDefinition);
    },
  };
}
