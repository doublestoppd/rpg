import type { NpcShop, PrismaClient } from '@prisma/client';
import type {
  NpcShopDetailResponse,
  NpcShopListResponse,
  NpcShopPurchaseResponse,
  SellbackResponse,
  StockLevel,
} from '@rpg/shared';
import { z } from 'zod';

import { DomainError } from '../../lib/http-errors.js';
import { applyBasisPoints } from '../../lib/money.js';
import { secureInt, weightedSample } from '../../lib/rng.js';
import type { CharacterService } from '../character/character-service.js';
import { CURRENCY_TYPES, type CurrencyService } from '../currency/currency-service.js';
import { type InventoryService, toItemDefinitionInfo } from '../inventory/inventory-service.js';
import type { LocationService } from '../location/location-service.js';

/** Validated shape of NpcShop.poolConfig (stored as JSON). */
const poolConfigSchema = z.object({
  restockSlots: z.number().int().min(1).max(12),
  pool: z
    .array(
      z.object({
        itemSlug: z.string().min(1),
        weight: z.number().int().min(1),
        minQuantity: z.number().int().min(1),
        maxQuantity: z.number().int().min(1),
        perCharacterLimit: z.number().int().min(1),
      }),
    )
    .min(1),
});

export const NPC_TRANSFER_REASON = 'NPC_PURCHASE';

function stockLevelOf(remaining: number, total: number): StockLevel {
  if (remaining <= 0) return 'SOLD_OUT';
  const ratio = remaining / total;
  if (ratio <= 0.25) return 'LOW';
  if (ratio <= 0.6) return 'SOME';
  return 'PLENTY';
}

export interface NpcShopService {
  listLocalShops(userId: string): Promise<NpcShopListResponse>;
  getShopDetail(userId: string, shopId: string): Promise<NpcShopDetailResponse>;
  purchase(
    userId: string,
    shopId: string,
    input: { stockEntryId: string; quantity: number; idempotencyKey: string },
  ): Promise<NpcShopPurchaseResponse>;
  /** Sells stackable items to the shop at its sellback rate (Phase 24). */
  sell(
    userId: string,
    shopId: string,
    input: { itemSlug: string; quantity: number; idempotencyKey: string },
  ): Promise<SellbackResponse>;
  /** Lazily restocks if due (timestamp authority; at most one catch-up). */
  ensureRestocked(shopId: string, now?: Date): Promise<void>;
}

export function createNpcShopService(
  prisma: PrismaClient,
  characterService: CharacterService,
  locationService: LocationService,
  currencyService: CurrencyService,
  inventoryService: InventoryService,
): NpcShopService {
  /** Computes the regional unit price: base × location modifier × markup. */
  async function unitPriceFor(
    shop: NpcShop,
    item: { baseValue: bigint; category: string },
  ): Promise<bigint> {
    const modifier = await prisma.regionalPriceModifier.findUnique({
      where: {
        locationId_category: {
          locationId: shop.locationId,
          category: item.category as never,
        },
      },
    });
    const modifierBps = modifier?.modifierBps ?? 10_000;
    const regional = applyBasisPoints(item.baseValue, modifierBps);
    const withMarkup = applyBasisPoints(regional, shop.markupBps);
    return withMarkup > 0n ? withMarkup : 1n;
  }

  /**
   * The sellback unit price: base × location modifier × sellback rate. Because
   * `sellbackBps` is validated strictly below `markupBps`, the sell price is
   * always below the buy price — a guaranteed buy-then-sell arbitrage is
   * impossible (Phase 24). Rounds down; may be zero for near-worthless goods.
   */
  async function sellbackPriceFor(
    shop: NpcShop,
    item: { baseValue: bigint; category: string },
  ): Promise<bigint> {
    const modifier = await prisma.regionalPriceModifier.findUnique({
      where: {
        locationId_category: { locationId: shop.locationId, category: item.category as never },
      },
    });
    const modifierBps = modifier?.modifierBps ?? 10_000;
    const regional = applyBasisPoints(item.baseValue, modifierBps);
    return applyBasisPoints(regional, shop.sellbackBps);
  }

  async function ensureRestocked(shopId: string, now = new Date()): Promise<void> {
    const due = await prisma.npcShop.findUnique({ where: { id: shopId } });
    if (!due || due.nextRestockAt > now) return;

    await prisma.$transaction(async (tx) => {
      // Lock the shop row; re-check under the lock so exactly one request
      // performs the restock.
      const rows = await tx.$queryRaw<Array<{ id: string; nextRestockAt: Date }>>`
        SELECT "id", "nextRestockAt" FROM "NpcShop" WHERE "id" = ${shopId} FOR UPDATE`;
      const locked = rows[0];
      if (!locked || locked.nextRestockAt > now) return;

      const shop = await tx.npcShop.findUniqueOrThrow({ where: { id: shopId } });
      const config = poolConfigSchema.parse(shop.poolConfig);

      // If downtime skipped several intervals, perform at most this one
      // catch-up restock and schedule the next from the current time.
      const restock = await tx.npcShopRestock.create({
        data: { shopId, restockedAt: now },
      });

      const picks = weightedSample(config.pool, config.restockSlots);
      for (const pick of picks) {
        const item = await tx.itemDefinition.findUnique({ where: { slug: pick.itemSlug } });
        if (!item) continue; // pool validated at seed; tolerate drift
        const quantity = secureInt(pick.minQuantity, pick.maxQuantity);
        await tx.npcShopStockEntry.create({
          data: {
            restockId: restock.id,
            itemDefinitionId: item.id,
            quantityTotal: quantity,
            quantityRemaining: quantity,
            unitPrice: await unitPriceFor(shop, item),
            perCharacterLimit: pick.perCharacterLimit,
          },
        });
      }

      const jitter = secureInt(0, shop.restockJitterSeconds);
      await tx.npcShop.update({
        where: { id: shopId },
        data: {
          lastRestockAt: now,
          nextRestockAt: new Date(now.getTime() + (shop.restockIntervalSeconds + jitter) * 1000),
          currentRestockId: restock.id,
        },
      });
    });
  }

  /** The character's current location, with travel rules applied. */
  async function requireLocationId(userId: string): Promise<string> {
    return locationService.requireCurrentLocationId(userId);
  }

  return {
    ensureRestocked,

    async listLocalShops(userId) {
      const locationId = await requireLocationId(userId);
      const shops = await prisma.npcShop.findMany({
        where: { locationId },
        orderBy: { name: 'asc' },
      });
      return {
        shops: shops.map((shop) => ({
          id: shop.id,
          slug: shop.slug,
          name: shop.name,
          description: shop.description,
        })),
      };
    },

    async getShopDetail(userId, shopId) {
      const character = await characterService.requireCharacter(userId);
      const locationId = await requireLocationId(userId);
      const shop = await prisma.npcShop.findUnique({ where: { id: shopId } });
      if (!shop) throw new DomainError(404, 'UNKNOWN_SHOP', 'No such shop.');
      if (shop.locationId !== locationId) {
        throw new DomainError(409, 'WRONG_LOCATION', 'That shop is not at your location.');
      }

      await ensureRestocked(shopId);
      const fresh = await prisma.npcShop.findUniqueOrThrow({ where: { id: shopId } });
      const entries = fresh.currentRestockId
        ? await prisma.npcShopStockEntry.findMany({
            where: { restockId: fresh.currentRestockId },
            include: { itemDefinition: true },
            orderBy: { itemDefinition: { name: 'asc' } },
          })
        : [];
      const purchases = await prisma.npcShopPurchase.groupBy({
        by: ['stockEntryId'],
        where: { characterId: character.id, stockEntryId: { in: entries.map((e) => e.id) } },
        _sum: { quantity: true },
      });
      const purchasedByEntry = new Map(
        purchases.map((p) => [p.stockEntryId, p._sum.quantity ?? 0]),
      );

      return {
        shop: { id: fresh.id, slug: fresh.slug, name: fresh.name, description: fresh.description },
        stock: entries.map((entry) => ({
          id: entry.id,
          item: toItemDefinitionInfo(entry.itemDefinition),
          unitPrice: entry.unitPrice.toString(),
          // Approximate only: exact remaining counts stay server-side.
          stockLevel: stockLevelOf(entry.quantityRemaining, entry.quantityTotal),
          perCharacterLimit: entry.perCharacterLimit,
          purchasedByYou: purchasedByEntry.get(entry.id) ?? 0,
        })),
      };
    },

    async purchase(userId, shopId, input) {
      const character = await characterService.requireCharacter(userId);
      const locationId = await requireLocationId(userId);
      const shop = await prisma.npcShop.findUnique({ where: { id: shopId } });
      if (!shop) throw new DomainError(404, 'UNKNOWN_SHOP', 'No such shop.');
      if (shop.locationId !== locationId) {
        throw new DomainError(409, 'WRONG_LOCATION', 'That shop is not at your location.');
      }
      await ensureRestocked(shopId);

      return prisma.$transaction(async (tx) => {
        // Serialize per character, then per stock entry (row locks).
        await inventoryService.lockCharacter(tx, character.id);

        // Idempotent replay returns the recorded purchase without reapplying.
        const existing = await tx.npcShopPurchase.findUnique({
          where: {
            characterId_idempotencyKey: {
              characterId: character.id,
              idempotencyKey: input.idempotencyKey,
            },
          },
          include: { stockEntry: { include: { itemDefinition: true } } },
        });
        if (existing) {
          const account = await tx.currencyAccount.findUniqueOrThrow({
            where: { characterId: character.id },
          });
          return {
            purchaseId: existing.id,
            itemSlug: existing.stockEntry.itemDefinition.slug,
            quantity: existing.quantity,
            totalPrice: existing.totalPrice.toString(),
            gold: account.balance.toString(),
          };
        }

        const lockedEntries = await tx.$queryRaw<
          Array<{ id: string; quantityRemaining: number }>
        >`SELECT "id", "quantityRemaining" FROM "NpcShopStockEntry"
          WHERE "id" = ${input.stockEntryId} FOR UPDATE`;
        if (lockedEntries.length === 0) {
          throw new DomainError(404, 'UNKNOWN_STOCK', 'That stock entry does not exist.');
        }
        const entry = await tx.npcShopStockEntry.findUniqueOrThrow({
          where: { id: input.stockEntryId },
          include: { itemDefinition: true, restock: true },
        });
        const freshShop = await tx.npcShop.findUniqueOrThrow({ where: { id: shopId } });
        if (entry.restock.shopId !== shopId || entry.restockId !== freshShop.currentRestockId) {
          throw new DomainError(409, 'STOCK_STALE', 'That stock is no longer available.');
        }
        if (entry.quantityRemaining < input.quantity) {
          throw new DomainError(409, 'OUT_OF_STOCK', 'Not enough stock remains.');
        }

        // Per character, per stock entry, per restock.
        const already = await tx.npcShopPurchase.aggregate({
          where: { characterId: character.id, stockEntryId: entry.id },
          _sum: { quantity: true },
        });
        const previously = already._sum.quantity ?? 0;
        if (previously + input.quantity > entry.perCharacterLimit) {
          throw new DomainError(
            409,
            'LIMIT_REACHED',
            `Limit ${entry.perCharacterLimit} per restock; you have bought ${previously}.`,
          );
        }

        const totalPrice = entry.unitPrice * BigInt(input.quantity);

        // Gold, stock, inventory, ledger, and transfer records: one transaction.
        await currencyService.debit(tx, {
          characterId: character.id,
          amount: totalPrice,
          type: CURRENCY_TYPES.NPC_PURCHASE,
          operationNamespace: 'npc-purchase',
          idempotencyKey: input.idempotencyKey,
          relatedType: 'NpcShopStockEntry',
          relatedId: entry.id,
        });

        if (entry.itemDefinition.stackable) {
          await inventoryService.addToStack(tx, {
            characterId: character.id,
            itemDefinitionId: entry.itemDefinitionId,
            quantity: input.quantity,
            reason: NPC_TRANSFER_REASON,
          });
        } else {
          await inventoryService.assertFreeSlots(tx, character.id, input.quantity);
          for (let i = 0; i < input.quantity; i++) {
            await inventoryService.grantInstance(tx, {
              characterId: character.id,
              itemDefinitionId: entry.itemDefinitionId,
              reason: NPC_TRANSFER_REASON,
            });
          }
        }

        // Conditional decrement keeps stock non-negative under any race.
        const decremented = await tx.npcShopStockEntry.updateMany({
          where: { id: entry.id, quantityRemaining: { gte: input.quantity } },
          data: { quantityRemaining: { decrement: input.quantity } },
        });
        if (decremented.count !== 1) {
          throw new DomainError(409, 'OUT_OF_STOCK', 'Not enough stock remains.');
        }

        const purchase = await tx.npcShopPurchase.create({
          data: {
            shopId,
            restockId: entry.restockId,
            stockEntryId: entry.id,
            characterId: character.id,
            quantity: input.quantity,
            unitPrice: entry.unitPrice,
            totalPrice,
            idempotencyKey: input.idempotencyKey,
          },
        });

        const account = await tx.currencyAccount.findUniqueOrThrow({
          where: { characterId: character.id },
        });
        return {
          purchaseId: purchase.id,
          itemSlug: entry.itemDefinition.slug,
          quantity: input.quantity,
          totalPrice: totalPrice.toString(),
          gold: account.balance.toString(),
        };
      });
    },

    async sell(userId, shopId, input) {
      const character = await characterService.requireCharacter(userId);
      await locationService.requireCurrentLocationId(userId); // must be somewhere valid
      const shop = await prisma.npcShop.findUnique({ where: { id: shopId } });
      if (!shop) throw new DomainError(404, 'UNKNOWN_SHOP', 'No such shop.');
      const item = await prisma.itemDefinition.findUnique({ where: { slug: input.itemSlug } });
      if (!item) throw new DomainError(404, 'UNKNOWN_ITEM', 'No such item.');
      if (!item.stackable) {
        throw new DomainError(400, 'NOT_SELLABLE', 'That item cannot be sold to a shop here.');
      }

      const unitPrice = await sellbackPriceFor(shop, item);
      const total = unitPrice * BigInt(input.quantity);

      const balance = await prisma.$transaction(async (tx) => {
        await inventoryService.lockCharacter(tx, character.id);
        // Credit first (idempotent by key); only remove goods when it actually
        // applied, so a replay never double-removes or double-pays.
        const credited = await currencyService.credit(tx, {
          characterId: character.id,
          amount: total > 0n ? total : 1n,
          type: CURRENCY_TYPES.NPC_SELLBACK,
          operationNamespace: 'npc-sellback',
          idempotencyKey: input.idempotencyKey,
          relatedType: 'NpcShop',
          relatedId: shopId,
        });
        if (credited.applied) {
          const stack = await tx.inventoryStack.findUnique({
            where: {
              characterId_itemDefinitionId: {
                characterId: character.id,
                itemDefinitionId: item.id,
              },
            },
          });
          if (!stack || stack.quantity < input.quantity) {
            throw new DomainError(409, 'INSUFFICIENT_ITEMS', 'You do not have that many to sell.');
          }
          await inventoryService.removeFromStack(tx, {
            characterId: character.id,
            itemDefinitionId: item.id,
            quantity: input.quantity,
            reason: 'NPC_SELLBACK',
          });
        }
        const account = await tx.currencyAccount.findUniqueOrThrow({
          where: { characterId: character.id },
        });
        return account.balance;
      });

      return {
        itemSlug: item.slug,
        quantity: input.quantity,
        unitPrice: unitPrice.toString(),
        goldReceived: total.toString(),
        balance: balance.toString(),
      };
    },
  };
}
