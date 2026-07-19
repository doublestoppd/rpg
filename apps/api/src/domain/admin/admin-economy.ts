import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AdminEconomyMetricsResponse,
  AdminGoldAdjustmentResponse,
  AdminItemActionResponse,
  AdminItemDefinitionPatch,
  AdminItemDefinitionResponse,
  AdminItemGrantRequest,
  AdminItemRemovalRequest,
  AdminMetricsQuery,
  AdminNpcShopConfigPatch,
  AdminNpcShopResponse,
  AdminRestockResponse,
} from '@rpg/shared';
import { ADMIN_MAX_METRIC_WINDOW_DAYS } from '@rpg/shared';

import { conflict, DomainError } from '../../lib/http-errors.js';
import { CURRENCY_TYPES, type CurrencyService } from '../currency/currency-service.js';
import type { InventoryService } from '../inventory/inventory-service.js';
import { toItemDefinitionInfo } from '../inventory/inventory-service.js';
import type { NpcShopService } from '../npc-shop/npc-shop-service.js';
import { type AdminActor, isUniqueViolation, writeAudit } from './admin-audit.js';

export const ADMIN_TRANSFER_REASONS = {
  GRANT: 'ADMIN_GRANT',
  REMOVAL: 'ADMIN_REMOVAL',
} as const;

const unknownCharacter = () =>
  new DomainError(404, 'UNKNOWN_CHARACTER', 'No such character exists.');
const unknownItem = () => new DomainError(404, 'UNKNOWN_ITEM', 'No such item exists.');

export interface AdminEconomyService {
  adjustGold(
    actor: AdminActor,
    characterId: string,
    input: { amount: string; reason: string; idempotencyKey: string },
  ): Promise<AdminGoldAdjustmentResponse>;
  grantItem(
    actor: AdminActor,
    characterId: string,
    input: AdminItemGrantRequest,
  ): Promise<AdminItemActionResponse>;
  removeItem(
    actor: AdminActor,
    characterId: string,
    input: AdminItemRemovalRequest,
  ): Promise<AdminItemActionResponse>;
  patchItemDefinition(
    actor: AdminActor,
    slug: string,
    input: AdminItemDefinitionPatch,
  ): Promise<AdminItemDefinitionResponse>;
  patchShopConfig(
    actor: AdminActor,
    shopId: string,
    input: AdminNpcShopConfigPatch,
  ): Promise<AdminNpcShopResponse>;
  requestRestock(
    actor: AdminActor,
    shopId: string,
    input: { reason: string; idempotencyKey: string },
  ): Promise<AdminRestockResponse>;
  economyMetrics(query: AdminMetricsQuery): Promise<AdminEconomyMetricsResponse>;
}

export function createAdminEconomyService(
  prisma: PrismaClient,
  currencyService: CurrencyService,
  inventoryService: InventoryService,
  npcShopService: NpcShopService,
): AdminEconomyService {
  /** Returns a recorded result on idempotent replay, else null. */
  async function findAudit(actor: AdminActor, namespace: string, key: string) {
    return prisma.adminAuditLog.findUnique({
      where: {
        actorUserId_actionNamespace_idempotencyKey: {
          actorUserId: actor.userId,
          actionNamespace: namespace,
          idempotencyKey: key,
        },
      },
    });
  }

  return {
    async adjustGold(actor, characterId, input) {
      const namespace = 'currency.adjust';
      const existing = await findAudit(actor, namespace, input.idempotencyKey);
      if (existing) {
        const after = (existing.afterJson ?? {}) as {
          transactionId?: string;
          balanceAfter?: string;
        };
        return {
          transactionId: after.transactionId ?? '',
          gold: after.balanceAfter ?? '0',
          auditId: existing.id,
        };
      }

      const amount = BigInt(input.amount);
      if (amount === 0n) {
        throw new DomainError(400, 'INVALID_AMOUNT', 'Adjustment amount must be non-zero.');
      }

      const character = await prisma.character.findUnique({ where: { id: characterId } });
      if (!character) throw unknownCharacter();

      try {
        return await prisma.$transaction(async (tx) => {
          await inventoryService.lockCharacter(tx, characterId);
          const before = await tx.currencyAccount.findUnique({ where: { characterId } });
          // credit/debit go through the immutable ledger; a debit that would go
          // negative throws INSUFFICIENT_GOLD and rolls everything back.
          const result =
            amount > 0n
              ? await currencyService.credit(tx, {
                  characterId,
                  amount,
                  type: CURRENCY_TYPES.ADMIN_ADJUSTMENT,
                  operationNamespace: 'admin-gold-adjust',
                  idempotencyKey: input.idempotencyKey,
                })
              : await currencyService.debit(tx, {
                  characterId,
                  amount: -amount,
                  type: CURRENCY_TYPES.ADMIN_ADJUSTMENT,
                  operationNamespace: 'admin-gold-adjust',
                  idempotencyKey: input.idempotencyKey,
                });
          const audit = await writeAudit(tx, {
            actor,
            actionNamespace: namespace,
            targetType: 'Character',
            targetId: characterId,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            before: { balanceBefore: (before?.balance ?? 0n).toString() },
            after: {
              transactionId: result.transaction.id,
              balanceAfter: result.transaction.balanceAfter.toString(),
            },
          });
          return {
            transactionId: result.transaction.id,
            gold: result.transaction.balanceAfter.toString(),
            auditId: audit.id,
          };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const replay = await findAudit(actor, namespace, input.idempotencyKey);
          if (replay) {
            const after = (replay.afterJson ?? {}) as {
              transactionId?: string;
              balanceAfter?: string;
            };
            return {
              transactionId: after.transactionId ?? '',
              gold: after.balanceAfter ?? '0',
              auditId: replay.id,
            };
          }
        }
        throw error;
      }
    },

    async grantItem(actor, characterId, input) {
      const namespace = 'item.grant';
      const existing = await findAudit(actor, namespace, input.idempotencyKey);
      if (existing) return { auditId: existing.id };

      const character = await prisma.character.findUnique({ where: { id: characterId } });
      if (!character) throw unknownCharacter();
      const item = await prisma.itemDefinition.findUnique({ where: { slug: input.itemSlug } });
      if (!item) throw unknownItem();

      try {
        return await prisma.$transaction(async (tx) => {
          await inventoryService.lockCharacter(tx, characterId);
          if (item.stackable) {
            await inventoryService.addToStack(tx, {
              characterId,
              itemDefinitionId: item.id,
              quantity: input.quantity,
              reason: ADMIN_TRANSFER_REASONS.GRANT,
            });
          } else {
            await inventoryService.assertFreeSlots(tx, characterId, input.quantity);
            for (let i = 0; i < input.quantity; i++) {
              await inventoryService.grantInstance(tx, {
                characterId,
                itemDefinitionId: item.id,
                reason: ADMIN_TRANSFER_REASONS.GRANT,
              });
            }
          }
          const audit = await writeAudit(tx, {
            actor,
            actionNamespace: namespace,
            targetType: 'Character',
            targetId: characterId,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            after: { itemSlug: item.slug, quantity: input.quantity },
          });
          return { auditId: audit.id };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const replay = await findAudit(actor, namespace, input.idempotencyKey);
          if (replay) return { auditId: replay.id };
        }
        throw error;
      }
    },

    async removeItem(actor, characterId, input) {
      const namespace = 'item.remove';
      const existing = await findAudit(actor, namespace, input.idempotencyKey);
      if (existing) return { auditId: existing.id };

      const character = await prisma.character.findUnique({ where: { id: characterId } });
      if (!character) throw unknownCharacter();

      try {
        return await prisma.$transaction(async (tx) => {
          await inventoryService.lockCharacter(tx, characterId);
          let auditAfter: Prisma.InputJsonValue;

          if (input.itemInstanceId) {
            const instance = await tx.itemInstance.findUnique({
              where: { id: input.itemInstanceId },
              include: { equipment: true, itemDefinition: { select: { slug: true } } },
            });
            // Only a free, owned, unlocked, unequipped, non-destroyed instance
            // is removable — every locked state is rejected, no force path.
            if (
              !instance ||
              instance.ownerCharacterId !== characterId ||
              instance.destroyedAt !== null
            ) {
              throw new DomainError(404, 'ITEM_UNAVAILABLE', 'No such removable item.');
            }
            if (instance.lockState !== 'NONE' || instance.equipment !== null) {
              throw conflict('ITEM_LOCKED', 'That item is locked and cannot be removed.');
            }
            await tx.itemInstance.update({
              where: { id: instance.id },
              data: { ownerCharacterId: null, destroyedAt: new Date() },
            });
            await tx.itemTransfer.create({
              data: {
                itemDefinitionId: instance.itemDefinitionId,
                itemInstanceId: instance.id,
                quantity: 1,
                fromCharacterId: characterId,
                toCharacterId: null,
                reason: ADMIN_TRANSFER_REASONS.REMOVAL,
              },
            });
            await tx.itemDestruction.create({
              data: {
                characterId,
                itemDefinitionId: instance.itemDefinitionId,
                itemInstanceId: instance.id,
                quantity: 1,
                reason: ADMIN_TRANSFER_REASONS.REMOVAL,
                refType: 'AdminAuditLog',
                refId: input.idempotencyKey,
              },
            });
            auditAfter = { itemInstanceId: instance.id, itemSlug: instance.itemDefinition.slug };
          } else {
            const item = await tx.itemDefinition.findUnique({ where: { slug: input.itemSlug! } });
            if (!item) throw unknownItem();
            const quantity = input.quantity ?? 1;
            // Throws INSUFFICIENT_ITEMS if the active stack is too small; listed
            // quantities already live off the active stack and are unreachable.
            await inventoryService.removeFromStack(tx, {
              characterId,
              itemDefinitionId: item.id,
              quantity,
              reason: ADMIN_TRANSFER_REASONS.REMOVAL,
            });
            await tx.itemDestruction.create({
              data: {
                characterId,
                itemDefinitionId: item.id,
                quantity,
                reason: ADMIN_TRANSFER_REASONS.REMOVAL,
                refType: 'AdminAuditLog',
                refId: input.idempotencyKey,
              },
            });
            auditAfter = { itemSlug: item.slug, quantity };
          }

          const audit = await writeAudit(tx, {
            actor,
            actionNamespace: namespace,
            targetType: 'Character',
            targetId: characterId,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            after: auditAfter,
          });
          return { auditId: audit.id };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const replay = await findAudit(actor, namespace, input.idempotencyKey);
          if (replay) return { auditId: replay.id };
        }
        throw error;
      }
    },

    async patchItemDefinition(actor, slug, input) {
      const namespace = 'item-definition.patch';
      // The audit key encodes the version so distinct edits get distinct rows;
      // safety and idempotency come from the atomic compare-and-set, not an
      // early replay short-circuit — a stale retry must return 409, not 200.
      const idempotencyKey = `${slug}-v${input.expectedVersion}`;
      const current = await prisma.itemDefinition.findUnique({ where: { slug } });
      if (!current) throw unknownItem();

      // Only allowlisted presentation/economic fields; structural fields never.
      const data: Prisma.ItemDefinitionUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      if (input.baseValue !== undefined) data.baseValue = BigInt(input.baseValue);

      try {
        return await prisma.$transaction(async (tx) => {
          // Atomic compare-and-set on the version.
          const updated = await tx.itemDefinition.updateMany({
            where: { slug, configVersion: input.expectedVersion },
            data: { ...data, configVersion: { increment: 1 } },
          });
          if (updated.count === 0) {
            const fresh = await tx.itemDefinition.findUniqueOrThrow({ where: { slug } });
            throw conflict(
              'STALE_VERSION',
              `Configuration changed; expected version ${input.expectedVersion}, current is ${fresh.configVersion}.`,
            );
          }
          const fresh = await tx.itemDefinition.findUniqueOrThrow({ where: { slug } });
          await writeAudit(tx, {
            actor,
            actionNamespace: namespace,
            targetType: 'ItemDefinition',
            targetId: slug,
            reason: input.reason,
            idempotencyKey,
            before: {
              name: current.name,
              description: current.description,
              baseValue: current.baseValue.toString(),
              configVersion: current.configVersion,
            },
            after: {
              name: fresh.name,
              description: fresh.description,
              baseValue: fresh.baseValue.toString(),
              configVersion: fresh.configVersion,
            },
          });
          return { item: toItemDefinitionInfo(fresh), configVersion: fresh.configVersion };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const item = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug } });
          return { item: toItemDefinitionInfo(item), configVersion: item.configVersion };
        }
        throw error;
      }
    },

    async patchShopConfig(actor, shopId, input) {
      const namespace = 'npc-shop.patch';
      const idempotencyKey = `${shopId}-v${input.expectedVersion}`;
      const toResponse = (shop: {
        id: string;
        slug: string;
        name: string;
        description: string;
        markupBps: number;
        sellbackBps: number;
        configVersion: number;
      }): AdminNpcShopResponse => ({
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        description: shop.description,
        markupBps: shop.markupBps,
        sellbackBps: shop.sellbackBps,
        configVersion: shop.configVersion,
      });

      // Safety comes from the compare-and-set; a stale retry must 409.
      const current = await prisma.npcShop.findUnique({ where: { id: shopId } });
      if (!current) throw new DomainError(404, 'UNKNOWN_SHOP', 'No such shop.');
      // Resale spread invariant must hold: markup strictly above sellback.
      if (input.markupBps !== undefined && input.markupBps <= current.sellbackBps) {
        throw new DomainError(
          400,
          'INVALID_MARKUP',
          'Markup must remain strictly above the sellback rate.',
        );
      }

      const data: Prisma.NpcShopUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      if (input.markupBps !== undefined) data.markupBps = input.markupBps;

      try {
        return await prisma.$transaction(async (tx) => {
          const updated = await tx.npcShop.updateMany({
            where: { id: shopId, configVersion: input.expectedVersion },
            data: { ...data, configVersion: { increment: 1 } },
          });
          if (updated.count === 0) {
            const fresh = await tx.npcShop.findUniqueOrThrow({ where: { id: shopId } });
            throw conflict(
              'STALE_VERSION',
              `Configuration changed; expected version ${input.expectedVersion}, current is ${fresh.configVersion}.`,
            );
          }
          const fresh = await tx.npcShop.findUniqueOrThrow({ where: { id: shopId } });
          await writeAudit(tx, {
            actor,
            actionNamespace: namespace,
            targetType: 'NpcShop',
            targetId: shopId,
            reason: input.reason,
            idempotencyKey,
            before: {
              name: current.name,
              markupBps: current.markupBps,
              configVersion: current.configVersion,
            },
            after: {
              name: fresh.name,
              markupBps: fresh.markupBps,
              configVersion: fresh.configVersion,
            },
          });
          return toResponse(fresh);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const shop = await prisma.npcShop.findUniqueOrThrow({ where: { id: shopId } });
          return toResponse(shop);
        }
        throw error;
      }
    },

    async requestRestock(actor, shopId, input) {
      const namespace = 'npc-shop.restock';
      const existing = await findAudit(actor, namespace, input.idempotencyKey);
      if (existing) return { restocked: false, auditId: existing.id };

      const shop = await prisma.npcShop.findUnique({ where: { id: shopId } });
      if (!shop) throw new DomainError(404, 'UNKNOWN_SHOP', 'No such shop.');

      let auditId: string;
      try {
        auditId = await prisma.$transaction(async (tx) => {
          // Make the shop due immediately, then let the normal locked restock
          // service perform the actual restock (secure RNG, snapshot, limits).
          await tx.npcShop.update({ where: { id: shopId }, data: { nextRestockAt: new Date(0) } });
          const audit = await writeAudit(tx, {
            actor,
            actionNamespace: namespace,
            targetType: 'NpcShop',
            targetId: shopId,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            after: { scheduled: true },
          });
          return audit.id;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const replay = await findAudit(actor, namespace, input.idempotencyKey);
          if (replay) return { restocked: false, auditId: replay.id };
        }
        throw error;
      }
      // The normal race-safe path; cannot duplicate or bypass per-restock rules.
      await npcShopService.ensureRestocked(shopId);
      return { restocked: true, auditId };
    },

    async economyMetrics(query) {
      const start = new Date(query.start);
      const end = new Date(query.end);
      if (!(start < end)) {
        throw new DomainError(400, 'INVALID_WINDOW', 'start must be before end.');
      }
      const maxMs = ADMIN_MAX_METRIC_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      if (end.getTime() - start.getTime() > maxMs) {
        throw new DomainError(
          400,
          'WINDOW_TOO_LARGE',
          `Window may not exceed ${ADMIN_MAX_METRIC_WINDOW_DAYS} days.`,
        );
      }

      const itemFilter = query.itemSlug
        ? await prisma.itemDefinition.findUnique({ where: { slug: query.itemSlug } })
        : null;
      if (query.itemSlug && !itemFilter) throw unknownItem();
      const itemId = itemFilter?.id;
      const createdAt = { gte: start, lte: end };

      const [accounts, ledger, sales, npcPurchases, transfers, destructions, activeListings] =
        await Promise.all([
          prisma.currencyAccount.aggregate({ _sum: { balance: true } }),
          prisma.currencyTransaction.findMany({
            where: { createdAt },
            select: { amount: true },
          }),
          prisma.marketplaceSale.findMany({
            where: { createdAt, ...(itemId ? { itemDefinitionId: itemId } : {}) },
            select: { grossPrice: true, tax: true, shippingFee: true, quantity: true },
          }),
          prisma.currencyTransaction.aggregate({
            where: { createdAt, type: CURRENCY_TYPES.NPC_PURCHASE },
            _sum: { amount: true },
          }),
          prisma.itemTransfer.aggregate({
            where: {
              createdAt,
              fromCharacterId: null,
              ...(itemId ? { itemDefinitionId: itemId } : {}),
            },
            _sum: { quantity: true },
          }),
          prisma.itemDestruction.aggregate({
            where: { createdAt, ...(itemId ? { itemDefinitionId: itemId } : {}) },
            _sum: { quantity: true },
          }),
          prisma.marketplaceListing.count({
            where: { status: 'ACTIVE', ...(itemId ? { itemDefinitionId: itemId } : {}) },
          }),
        ]);

      let goldSources = 0n;
      let goldSinks = 0n;
      for (const row of ledger) {
        if (row.amount > 0n) goldSources += row.amount;
        else goldSinks += -row.amount;
      }
      let gross = 0n;
      let tax = 0n;
      let shipping = 0n;
      const unitPrices: bigint[] = [];
      for (const sale of sales) {
        gross += sale.grossPrice;
        tax += sale.tax;
        shipping += sale.shippingFee;
        if (sale.quantity > 0) unitPrices.push(sale.grossPrice / BigInt(sale.quantity));
      }
      // Documented comparable-sale median: per-unit price over sales in the
      // window; below five comparable sales is "insufficient history" (null).
      let median: string | null = null;
      if (unitPrices.length >= 5) {
        unitPrices.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const mid = Math.floor(unitPrices.length / 2);
        median =
          unitPrices.length % 2 === 1
            ? unitPrices[mid]!.toString()
            : ((unitPrices[mid - 1]! + unitPrices[mid]!) / 2n).toString();
      }

      return {
        window: { start: start.toISOString(), end: end.toISOString() },
        totalGold: (accounts._sum.balance ?? 0n).toString(),
        goldSources: goldSources.toString(),
        goldSinks: goldSinks.toString(),
        marketplaceGross: gross.toString(),
        marketplaceTax: tax.toString(),
        marketplaceShipping: shipping.toString(),
        marketplaceVolume: sales.length,
        npcSpending: (-(npcPurchases._sum.amount ?? 0n)).toString(),
        itemsGenerated: transfers._sum.quantity ?? 0,
        itemsDestroyed: destructions._sum.quantity ?? 0,
        activeListings,
        medianUnitPrice: median,
      };
    },
  };
}
