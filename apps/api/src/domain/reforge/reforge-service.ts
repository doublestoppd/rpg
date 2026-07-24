import type { PrismaClient } from '@prisma/client';
import type { ReforgeQuote, ReforgeRequest, ReforgeResult } from '@rpg/shared';

import {
  effectiveItemBonuses,
  parseAffixes,
  rollAffixes,
  type RollRng,
} from '../../config/affixes.js';
import { isReforgeable, reforgeCost } from '../../config/reforge.js';
import { DomainError } from '../../lib/http-errors.js';
import { secureInt } from '../../lib/rng.js';
import { CURRENCY_TYPES, type CurrencyService } from '../currency/currency-service.js';

/**
 * The Reforge Anvil (Improvement Phase 4): reroll an equipment instance's
 * affixes at its current rarity for Gold. Server-authoritative and idempotent —
 * a replayed request never charges or rerolls twice.
 */

/** Secure server RNG in the affix engine's integer-source shape. */
const secureRng: RollRng = { nextInt: (min, max) => secureInt(min, max) };

const OPERATION_NAMESPACE = 'reforge';

export interface ReforgeService {
  quote(userId: string, itemInstanceId: string): Promise<ReforgeQuote>;
  reforge(userId: string, input: ReforgeRequest): Promise<ReforgeResult>;
}

export function createReforgeService(
  prisma: PrismaClient,
  currencyService: CurrencyService,
): ReforgeService {
  async function loadCharacter(userId: string) {
    const character = await prisma.character.findUnique({
      where: { userId },
      include: { currentLocation: true },
    });
    if (!character) throw new DomainError(404, 'NO_CHARACTER', 'Create a character first.');
    return character;
  }

  /** Reason the instance cannot be reforged, or null if it can. */
  function ineligibleReason(
    character: { id: string; currentLocation: { isSafe: boolean } | null },
    instance: {
      ownerCharacterId: string | null;
      destroyedAt: Date | null;
      lockState: string;
      rarity: string;
      equipment: unknown;
    },
  ): string | null {
    if (!character.currentLocation) return 'You cannot reforge while traveling.';
    if (!character.currentLocation.isSafe) return 'Find a settlement with an anvil to reforge.';
    if (instance.ownerCharacterId !== character.id || instance.destroyedAt) {
      return 'You do not own that item.';
    }
    if (instance.equipment) return 'Unequip the item before reforging it.';
    if (instance.lockState !== 'NONE') return 'That item is listed or in transit.';
    if (!isReforgeable(instance.rarity as ReforgeQuote['rarity'])) {
      return 'Common gear has no affixes to reforge.';
    }
    return null;
  }

  async function loadInstance(itemInstanceId: string) {
    return prisma.itemInstance.findUnique({
      where: { id: itemInstanceId },
      include: { itemDefinition: true, equipment: true },
    });
  }

  return {
    async quote(userId, itemInstanceId) {
      const character = await loadCharacter(userId);
      const instance = await loadInstance(itemInstanceId);
      const account = await prisma.currencyAccount.findUnique({
        where: { characterId: character.id },
      });
      const balance = account?.balance ?? 0n;
      if (!instance || instance.ownerCharacterId !== character.id || instance.destroyedAt) {
        throw new DomainError(404, 'UNKNOWN_ITEM', 'No such item in your pack.');
      }
      const rarity = instance.rarity;
      const cost = reforgeCost(rarity, instance.itemDefinition.levelRequirement);
      const reason = ineligibleReason(character, instance);
      return {
        itemInstanceId: instance.id,
        itemName: instance.itemDefinition.name,
        rarity,
        affixes: parseAffixes(instance.affixes),
        cost: cost.toString(),
        balance: balance.toString(),
        canReforge: reason === null && balance >= cost,
        reason: reason ?? (balance < cost ? 'You cannot afford this reforge.' : null),
      };
    },

    async reforge(userId, input) {
      const character = await loadCharacter(userId);
      return prisma.$transaction(async (tx) => {
        const instance = await tx.itemInstance.findUnique({
          where: { id: input.itemInstanceId },
          include: { itemDefinition: true, equipment: true },
        });
        if (!instance || instance.ownerCharacterId !== character.id || instance.destroyedAt) {
          throw new DomainError(404, 'UNKNOWN_ITEM', 'No such item in your pack.');
        }
        const reason = ineligibleReason(character, instance);
        if (reason) throw new DomainError(409, 'NOT_REFORGEABLE', reason);

        const rarity = instance.rarity;
        const cost = reforgeCost(rarity, instance.itemDefinition.levelRequirement);

        // Charge Gold idempotently: a replay of the same key returns the prior
        // charge without reapplying it, and we skip the reroll below.
        const debit = await currencyService.debit(tx, {
          characterId: character.id,
          amount: cost,
          type: CURRENCY_TYPES.REFORGE_FEE,
          operationNamespace: OPERATION_NAMESPACE,
          idempotencyKey: input.idempotencyKey,
          relatedType: 'ItemInstance',
          relatedId: instance.id,
        });

        if (debit.applied) {
          const affixes = rollAffixes(secureRng, rarity, instance.itemDefinition.levelRequirement);
          await tx.itemInstance.update({
            where: { id: instance.id },
            data: { affixes },
          });
        }

        // Re-read for the authoritative post-state (covers the replay path).
        const [fresh, account] = await Promise.all([
          tx.itemInstance.findUniqueOrThrow({
            where: { id: instance.id },
            include: { itemDefinition: true },
          }),
          tx.currencyAccount.findUniqueOrThrow({ where: { characterId: character.id } }),
        ]);
        const affixes = parseAffixes(fresh.affixes);
        return {
          itemInstanceId: fresh.id,
          rarity,
          affixes,
          effectiveBonuses: effectiveItemBonuses(fresh.itemDefinition, affixes),
          cost: (debit.applied ? cost : 0n).toString(),
          balance: account.balance.toString(),
        };
      });
    },
  };
}
