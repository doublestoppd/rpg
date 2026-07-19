import type { PrismaClient } from '@prisma/client';
import type { BountyBoardResponse, ClaimBountyResponse, ReputationInfo } from '@rpg/shared';

import { activeBounties, findBounty, REPUTATION_CAP } from '../../config/bounties.js';
import { conflict, DomainError } from '../../lib/http-errors.js';
import type { CharacterService } from '../character/character-service.js';
import { CURRENCY_TYPES, type CurrencyService } from '../currency/currency-service.js';
import type { InventoryService } from '../inventory/inventory-service.js';

export const BOUNTY_TURN_IN_REASON = 'BOUNTY_TURN_IN';

export interface BountyService {
  getBoard(userId: string): Promise<BountyBoardResponse>;
  claim(userId: string, bountySlug: string, idempotencyKey: string): Promise<ClaimBountyResponse>;
}

export function createBountyService(
  prisma: PrismaClient,
  characterService: CharacterService,
  currencyService: CurrencyService,
  inventoryService: InventoryService,
): BountyService {
  async function reputationFor(characterId: string, region: string): Promise<ReputationInfo> {
    const row = await prisma.characterReputation.findUnique({
      where: { characterId_region: { characterId, region } },
    });
    return { region, points: row?.points ?? 0, cap: REPUTATION_CAP };
  }

  return {
    async getBoard(userId) {
      const character = await characterService.requireCharacter(userId);
      const active = activeBounties(new Date());

      const itemSlugs = [...new Set(active.map((a) => a.bounty.requirement.itemSlug))];
      const items = await prisma.itemDefinition.findMany({ where: { slug: { in: itemSlugs } } });
      const itemBySlug = new Map(items.map((i) => [i.slug, i]));
      const stacks = await prisma.inventoryStack.findMany({
        where: { characterId: character.id, itemDefinition: { slug: { in: itemSlugs } } },
        include: { itemDefinition: true },
      });
      const heldBySlug = new Map(stacks.map((s) => [s.itemDefinition.slug, s.quantity]));

      const claims = await prisma.bountyClaim.findMany({
        where: {
          characterId: character.id,
          cycleId: { in: [...new Set(active.map((a) => a.cycleId))] },
        },
      });
      const claimed = new Set(claims.map((c) => `${c.cycleId}:${c.bountySlug}`));

      const bounties = active.map(({ bounty, cycleId }) => ({
        slug: bounty.slug,
        name: bounty.name,
        description: bounty.description,
        cadence: bounty.cadence,
        region: bounty.region,
        cycleId,
        requirement: {
          itemSlug: bounty.requirement.itemSlug,
          itemName:
            itemBySlug.get(bounty.requirement.itemSlug)?.name ?? bounty.requirement.itemSlug,
          quantity: bounty.requirement.quantity,
          held: heldBySlug.get(bounty.requirement.itemSlug) ?? 0,
        },
        rewardGold: bounty.rewardGold.toString(),
        rewardReputation: bounty.rewardReputation,
        claimed: claimed.has(`${cycleId}:${bounty.slug}`),
      }));

      const repRows = await prisma.characterReputation.findMany({
        where: { characterId: character.id },
        orderBy: { region: 'asc' },
      });
      const reputation = repRows.map((r) => ({
        region: r.region,
        points: r.points,
        cap: REPUTATION_CAP,
      }));

      return { bounties, reputation };
    },

    // The claim's idempotency boundary is (character, cycle, bounty) — enforced
    // by the BountyClaim unique and the deterministic credit key below — so the
    // client-supplied key is accepted for API symmetry but intentionally unused.
    async claim(userId, bountySlug, _idempotencyKey) {
      const character = await characterService.requireCharacter(userId);
      const bounty = findBounty(bountySlug);
      if (!bounty) throw new DomainError(404, 'UNKNOWN_BOUNTY', 'No such bounty.');

      // The bounty must be active in the current cycle (timestamp-authoritative).
      const active = activeBounties(new Date()).find((a) => a.bounty.slug === bountySlug);
      if (!active)
        throw conflict('BOUNTY_NOT_ACTIVE', 'That bounty is not on the board right now.');
      const cycleId = active.cycleId;

      const item = await prisma.itemDefinition.findUnique({
        where: { slug: bounty.requirement.itemSlug },
      });
      if (!item) throw new DomainError(500, 'BOUNTY_ITEM_MISSING', 'Bounty item is unavailable.');

      const result = await prisma.$transaction(async (tx) => {
        await inventoryService.lockCharacter(tx, character.id);

        // Exactly once per character + cycle + bounty: an existing claim is an
        // idempotent no-op (never re-consumes items or re-pays).
        const existing = await tx.bountyClaim.findUnique({
          where: {
            characterId_cycleId_bountySlug: { characterId: character.id, cycleId, bountySlug },
          },
        });
        if (existing) {
          const account = await tx.currencyAccount.findUniqueOrThrow({
            where: { characterId: character.id },
          });
          return {
            bountySlug,
            goldAwarded: '0',
            balance: account.balance.toString(),
            region: bounty.region,
            reputation: await reputationFor(character.id, bounty.region),
          };
        }

        // Consume the turn-in (an item sink; records an ItemTransfer).
        const stack = await tx.inventoryStack.findUnique({
          where: {
            characterId_itemDefinitionId: {
              characterId: character.id,
              itemDefinitionId: item.id,
            },
          },
        });
        if (!stack || stack.quantity < bounty.requirement.quantity) {
          throw conflict(
            'REQUIREMENT_UNMET',
            `You need ${bounty.requirement.quantity} ${item.name}.`,
          );
        }
        await inventoryService.removeFromStack(tx, {
          characterId: character.id,
          itemDefinitionId: item.id,
          quantity: bounty.requirement.quantity,
          reason: BOUNTY_TURN_IN_REASON,
        });

        await currencyService.credit(tx, {
          characterId: character.id,
          amount: bounty.rewardGold,
          type: CURRENCY_TYPES.BOUNTY_REWARD,
          operationNamespace: 'bounty-claim',
          idempotencyKey: `${cycleId}:${bountySlug}`,
          relatedType: 'BountyClaim',
        });

        // Bounded reputation: never exceeds the cap.
        const current = await tx.characterReputation.findUnique({
          where: { characterId_region: { characterId: character.id, region: bounty.region } },
        });
        const points = Math.min(REPUTATION_CAP, (current?.points ?? 0) + bounty.rewardReputation);
        await tx.characterReputation.upsert({
          where: { characterId_region: { characterId: character.id, region: bounty.region } },
          create: { characterId: character.id, region: bounty.region, points },
          update: { points },
        });

        // The claim marker — the unique makes a rotation-safe once-per-cycle.
        await tx.bountyClaim.create({
          data: { characterId: character.id, cycleId, bountySlug, rewardGold: bounty.rewardGold },
        });

        const account = await tx.currencyAccount.findUniqueOrThrow({
          where: { characterId: character.id },
        });
        return {
          bountySlug,
          goldAwarded: bounty.rewardGold.toString(),
          balance: account.balance.toString(),
          region: bounty.region,
          reputation: { region: bounty.region, points, cap: REPUTATION_CAP },
        };
      });

      return result;
    },
  };
}
