import type { PrismaClient } from '@prisma/client';
import type { InnRestResponse } from '@rpg/shared';

import { gameConfig } from '../../config/game.js';
import { DomainError } from '../../lib/http-errors.js';
import type { CharacterService } from '../character/character-service.js';
import { computeDerivedStats } from '../character/progression.js';
import { CURRENCY_TYPES, type CurrencyService } from '../currency/currency-service.js';
import type { InventoryService } from '../inventory/inventory-service.js';
import type { LocationService } from '../location/location-service.js';

/** Level-scaled rest fee in Gold: base + perLevel * level. */
export function innRestFee(level: number): bigint {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error('innRestFee: level must be a positive integer');
  }
  return gameConfig.innRestBaseFee + gameConfig.innRestFeePerLevel * BigInt(level);
}

export interface InnService {
  /**
   * Rests at the local inn: restores HP and MP to their derived maxima for a
   * level-scaled Gold fee, charged through the currency service atomically
   * with the restoration.
   */
  rest(userId: string, input: { idempotencyKey: string }): Promise<InnRestResponse>;
}

export function createInnService(
  prisma: PrismaClient,
  characterService: CharacterService,
  locationService: LocationService,
  currencyService: CurrencyService,
  inventoryService: InventoryService,
): InnService {
  return {
    async rest(userId, input) {
      const character = await characterService.requireCharacter(userId);
      // Location-dependent: finalizes travel, rejects while traveling, and
      // requires an INN feature at the current location.
      const locationId = await locationService.requireCurrentLocationId(userId);
      const inn = await prisma.locationFeature.findFirst({
        where: { locationId, type: 'INN' },
      });
      if (!inn) {
        throw new DomainError(400, 'NO_INN_HERE', 'There is no inn at this location.');
      }

      const fee = innRestFee(character.level);

      return prisma.$transaction(async (tx) => {
        // Serialize with other character mutations, then re-read vitals.
        await inventoryService.lockCharacter(tx, character.id);
        const fresh = await tx.character.findUniqueOrThrow({
          where: { id: character.id },
          include: { class: true },
        });
        const equipment = await tx.equipmentAssignment.findMany({
          where: { characterId: character.id },
          include: { itemInstance: { include: { itemDefinition: true } } },
        });
        const derived = computeDerivedStats(
          fresh.class,
          fresh.level,
          equipment.map((a) => a.itemInstance.itemDefinition),
        );

        // Idempotent replay: if this key already charged, report the stored
        // outcome instead of judging the (already rested) current state.
        const account = await tx.currencyAccount.findUniqueOrThrow({
          where: { characterId: character.id },
        });
        const existing = await tx.currencyTransaction.findUnique({
          where: {
            accountId_operationNamespace_idempotencyKey: {
              accountId: account.id,
              operationNamespace: 'inn-rest',
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) {
          return {
            feePaid: (-existing.amount).toString(),
            gold: account.balance.toString(),
            resources: {
              hp: fresh.currentHp,
              maxHp: derived.maxHp,
              mp: fresh.currentMp,
              maxMp: derived.maxMp,
              stamina: Math.min(fresh.stamina, derived.maxStamina),
              maxStamina: derived.maxStamina,
            },
          };
        }

        if (fresh.currentHp >= derived.maxHp && fresh.currentMp >= derived.maxMp) {
          throw new DomainError(400, 'ALREADY_RESTED', 'You are already fully rested.');
        }

        // Debit and restoration commit together, or not at all.
        const charge = await currencyService.debit(tx, {
          characterId: character.id,
          amount: fee,
          type: CURRENCY_TYPES.INN_REST,
          operationNamespace: 'inn-rest',
          idempotencyKey: input.idempotencyKey,
          relatedType: 'LocationFeature',
          relatedId: inn.id,
        });
        if (charge.applied) {
          await tx.character.update({
            where: { id: character.id },
            data: { currentHp: derived.maxHp, currentMp: derived.maxMp },
          });
        }

        const balance = await tx.currencyAccount.findUniqueOrThrow({
          where: { characterId: character.id },
        });
        const after = await tx.character.findUniqueOrThrow({ where: { id: character.id } });
        return {
          feePaid: fee.toString(),
          gold: balance.balance.toString(),
          resources: {
            hp: after.currentHp,
            maxHp: derived.maxHp,
            mp: after.currentMp,
            maxMp: derived.maxMp,
            stamina: Math.min(after.stamina, derived.maxStamina),
            maxStamina: derived.maxStamina,
          },
        };
      });
    },
  };
}
