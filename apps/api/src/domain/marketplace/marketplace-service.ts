import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  CreateListingRequest,
  CreatePlayerShopRequest,
  DeliveriesResponse,
  ListingsQuery,
  MarketplaceListingsResponse,
  MarketSummary,
  PlayerShopInfo,
  PurchaseListingResponse,
  RegionsResponse,
  UpdatePlayerShopRequest,
} from '@rpg/shared';

import { gameConfig } from '../../config/game.js';
import { DomainError } from '../../lib/http-errors.js';
import { metrics } from '../../lib/metrics.js';
import { applyBasisPoints, parseGold } from '../../lib/money.js';
import type { TimedStateFinalizer } from '../../lib/timed-state.js';
import type { CharacterService } from '../character/character-service.js';
import { CURRENCY_TYPES, type CurrencyService } from '../currency/currency-service.js';
import { type InventoryService, toItemDefinitionInfo } from '../inventory/inventory-service.js';
import type { LocationService } from '../location/location-service.js';
import { noopNotifications, type NotificationSink } from '../notification/notification-service.js';

type Tx = Prisma.TransactionClient;

export const MARKET_TRANSFER_REASONS = {
  LISTING_HOLD: 'LISTING_HOLD',
  LISTING_RETURN: 'LISTING_RETURN',
  MARKET_SALE: 'MARKET_SALE',
} as const;

/**
 * Returns an expired-but-unfinalized ACTIVE listing to its seller: goods back
 * to inventory (using the return reservation), status EXPIRED. Idempotent and
 * exactly-once via a conditional status update. Shared by the lazy paths and
 * the periodic worker cleanup.
 */
export async function finalizeExpiredListing(
  tx: Tx,
  inventoryService: InventoryService,
  listingId: string,
  now: Date,
): Promise<boolean> {
  const flipped = await tx.marketplaceListing.updateMany({
    where: { id: listingId, status: 'ACTIVE', expiresAt: { lte: now } },
    data: { status: 'EXPIRED', finalizedAt: now },
  });
  if (flipped.count !== 1) return false;

  const listing = await tx.marketplaceListing.findUniqueOrThrow({ where: { id: listingId } });
  // Release the reservation first: the freed slot is what the returning
  // asset occupies, so capacity can never overflow here.
  if (listing.returnReservationId) {
    await tx.inventoryCapacityReservation.updateMany({
      where: { id: listing.returnReservationId, releasedAt: null },
      data: { releasedAt: now },
    });
  }
  if (listing.itemInstanceId) {
    await tx.itemInstance.update({
      where: { id: listing.itemInstanceId },
      data: { lockState: 'NONE' },
    });
  } else {
    await inventoryService.addToStack(tx, {
      characterId: listing.sellerCharacterId,
      itemDefinitionId: listing.itemDefinitionId,
      quantity: listing.quantity,
      reason: MARKET_TRANSFER_REASONS.LISTING_RETURN,
    });
  }
  return true;
}

/** Batch sweep used by marketplace views and the periodic worker cleanup. */
export async function sweepExpiredListings(
  prisma: PrismaClient,
  inventoryService: InventoryService,
  limit = 20,
  now = new Date(),
): Promise<number> {
  const expired = await prisma.marketplaceListing.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } },
    select: { id: true },
    take: limit,
  });
  let finalized = 0;
  for (const { id } of expired) {
    await prisma.$transaction(async (tx) => {
      if (await finalizeExpiredListing(tx, inventoryService, id, now)) finalized += 1;
    });
  }
  return finalized;
}

export interface MarketplaceService {
  /** Finalizes expired listings owned by the character (timed-state hook). */
  listingExpiryFinalizer: TimedStateFinalizer;
  /** Completes arrived deliveries for the character (timed-state hook). */
  deliveryFinalizer: TimedStateFinalizer;

  createShop(userId: string, input: CreatePlayerShopRequest): Promise<PlayerShopInfo>;
  getMyShop(userId: string): Promise<PlayerShopInfo>;
  updateMyShop(userId: string, input: UpdatePlayerShopRequest): Promise<PlayerShopInfo>;
  listRegions(): Promise<RegionsResponse>;

  createListing(userId: string, input: CreateListingRequest): Promise<{ listingId: string }>;
  cancelListing(userId: string, listingId: string): Promise<void>;
  browseListings(userId: string, query: ListingsQuery): Promise<MarketplaceListingsResponse>;
  purchaseListing(
    userId: string,
    listingId: string,
    input: { idempotencyKey: string },
  ): Promise<PurchaseListingResponse>;
  getItemSummary(userId: string, itemSlug: string): Promise<MarketSummary>;
  getDeliveries(userId: string): Promise<DeliveriesResponse>;
}

export function createMarketplaceService(
  prisma: PrismaClient,
  characterService: CharacterService,
  locationService: LocationService,
  currencyService: CurrencyService,
  inventoryService: InventoryService,
  notifications: NotificationSink = noopNotifications,
): MarketplaceService {
  async function currentLocation(userId: string) {
    const locationId = await locationService.requireCurrentLocationId(userId);
    return prisma.location.findUniqueOrThrow({
      where: { id: locationId },
      include: { features: true },
    });
  }

  function assertMarketplaceLocation(location: { features: Array<{ type: string }> }) {
    if (!location.features.some((f) => f.type === 'MARKETPLACE')) {
      throw new DomainError(
        409,
        'NO_MARKETPLACE_HERE',
        'Listings can only be created or bought at a marketplace.',
      );
    }
  }

  async function requireShop(characterId: string) {
    const shop = await prisma.playerShop.findUnique({ where: { characterId } });
    if (!shop) throw new DomainError(404, 'NO_SHOP', 'You have not opened a shop yet.');
    return shop;
  }

  function toShopInfo(shop: {
    id: string;
    name: string;
    description: string;
    region: string;
    createdAt: Date;
  }): PlayerShopInfo {
    return {
      id: shop.id,
      name: shop.name,
      description: shop.description,
      region: shop.region,
      createdAt: shop.createdAt.toISOString(),
    };
  }

  const listingExpiryFinalizer: TimedStateFinalizer = {
    name: 'marketplace-listing-expiry',
    async finalizeExpired(characterId, now) {
      const expired = await prisma.marketplaceListing.findMany({
        where: { sellerCharacterId: characterId, status: 'ACTIVE', expiresAt: { lte: now } },
        select: { id: true },
      });
      for (const { id } of expired) {
        await prisma.$transaction(async (tx) => {
          await finalizeExpiredListing(tx, inventoryService, id, now);
        });
      }
    },
  };

  const deliveryFinalizer: TimedStateFinalizer = {
    name: 'marketplace-delivery',
    async finalizeExpired(characterId, now) {
      const arrived = await prisma.delivery.findMany({
        where: { buyerCharacterId: characterId, status: 'IN_TRANSIT', arrivesAt: { lte: now } },
        select: { id: true },
      });
      for (const { id } of arrived) {
        await prisma.$transaction(async (tx) => {
          // Conditional flip makes completion exactly-once under races.
          const flipped = await tx.delivery.updateMany({
            where: { id, status: 'IN_TRANSIT' },
            data: { status: 'DELIVERED', deliveredAt: now },
          });
          if (flipped.count !== 1) return;
          const delivery = await tx.delivery.findUniqueOrThrow({
            where: { id },
            include: { lines: true },
          });
          // Convert the reservation into placement: release it, then place —
          // the freed slots are exactly what the goods occupy.
          await tx.inventoryCapacityReservation.updateMany({
            where: { id: delivery.capacityReservationId, releasedAt: null },
            data: { releasedAt: now },
          });
          for (const line of delivery.lines) {
            if (line.itemInstanceId) {
              await tx.itemInstance.update({
                where: { id: line.itemInstanceId },
                data: { lockState: 'NONE' },
              });
            } else {
              // Ownership was recorded at purchase; placement records nothing.
              await inventoryService.addToStack(tx, {
                characterId,
                itemDefinitionId: line.itemDefinitionId,
                quantity: line.quantity,
                reason: MARKET_TRANSFER_REASONS.MARKET_SALE,
                recordTransfer: false,
              });
            }
          }
          await notifications.create(tx, {
            characterId,
            type: 'DELIVERY_COMPLETED',
            dedupeKey: `delivery:${delivery.id}`,
            title: 'Delivery arrived',
            body: 'Your marketplace goods have arrived and are in your pack.',
          });
        });
      }
    },
  };

  return {
    listingExpiryFinalizer,
    deliveryFinalizer,

    async listRegions() {
      const rows = await prisma.location.findMany({
        select: { region: true },
        distinct: ['region'],
        orderBy: { region: 'asc' },
      });
      return { regions: rows.map((r) => r.region) };
    },

    async createShop(userId, input) {
      const character = await characterService.requireCharacter(userId);
      const regions = await this.listRegions();
      if (!regions.regions.includes(input.region)) {
        throw new DomainError(400, 'UNKNOWN_REGION', 'That region does not exist.');
      }
      const existing = await prisma.playerShop.findUnique({
        where: { characterId: character.id },
      });
      if (existing) throw new DomainError(409, 'SHOP_EXISTS', 'You already have a shop.');
      const nameTaken = await prisma.playerShop.findUnique({ where: { name: input.name } });
      if (nameTaken) throw new DomainError(409, 'NAME_TAKEN', 'That shop name is taken.');
      const shop = await prisma.playerShop.create({
        data: {
          characterId: character.id,
          name: input.name,
          description: input.description,
          region: input.region,
        },
      });
      return toShopInfo(shop);
    },

    async getMyShop(userId) {
      const character = await characterService.requireCharacter(userId);
      return toShopInfo(await requireShop(character.id));
    },

    async updateMyShop(userId, input) {
      const character = await characterService.requireCharacter(userId);
      const shop = await requireShop(character.id);
      if (input.name && input.name !== shop.name) {
        const nameTaken = await prisma.playerShop.findUnique({ where: { name: input.name } });
        if (nameTaken) throw new DomainError(409, 'NAME_TAKEN', 'That shop name is taken.');
      }
      const updated = await prisma.playerShop.update({
        where: { id: shop.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });
      return toShopInfo(updated);
    },

    async createListing(userId, input) {
      const character = await characterService.requireCharacter(userId);
      const shop = await requireShop(character.id);
      const location = await currentLocation(userId);
      assertMarketplaceLocation(location);

      const price = parseGold(input.price);
      if (price < 1n) throw new DomainError(400, 'PRICE_TOO_LOW', 'Minimum price is 1 Gold.');
      if (price > gameConfig.maxListingPrice) {
        throw new DomainError(400, 'PRICE_TOO_HIGH', 'That price exceeds the market maximum.');
      }
      const isInstance = Boolean(input.itemInstanceId);
      if (isInstance === Boolean(input.itemSlug)) {
        throw new DomainError(
          400,
          'INVALID_LISTING',
          'List either a stack (itemSlug + quantity) or a single unique item.',
        );
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + gameConfig.listingDurationSeconds * 1000);
      const fee = (() => {
        const computed = applyBasisPoints(price, gameConfig.listingFeeBps);
        return computed > 0n ? computed : 1n;
      })();

      return prisma.$transaction(async (tx) => {
        await inventoryService.lockCharacter(tx, character.id);

        // Idempotent replay.
        const existing = await tx.marketplaceListing.findUnique({
          where: {
            sellerCharacterId_idempotencyKey: {
              sellerCharacterId: character.id,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) return { listingId: existing.id };

        let itemDefinitionId: string;
        let quantity: number;
        let itemInstanceId: string | null = null;

        if (isInstance) {
          const instance = await tx.itemInstance.findUnique({
            where: { id: input.itemInstanceId! },
            include: { equipment: true },
          });
          if (!instance || instance.ownerCharacterId !== character.id || instance.destroyedAt) {
            throw new DomainError(404, 'UNKNOWN_INSTANCE', 'You do not own that item.');
          }
          if (instance.lockState !== 'NONE' || instance.equipment) {
            throw new DomainError(409, 'ITEM_LOCKED', 'That item is equipped or locked.');
          }
          await tx.itemInstance.update({
            where: { id: instance.id },
            data: { lockState: 'LISTED' },
          });
          itemDefinitionId = instance.itemDefinitionId;
          quantity = 1;
          itemInstanceId = instance.id;
        } else {
          const definition = await tx.itemDefinition.findUnique({
            where: { slug: input.itemSlug! },
          });
          if (!definition) throw new DomainError(404, 'UNKNOWN_ITEM', 'No such item.');
          quantity = input.quantity ?? 1;
          // Moves the goods out of active inventory; held on the listing.
          await inventoryService.removeFromStack(tx, {
            characterId: character.id,
            itemDefinitionId: definition.id,
            quantity,
            reason: MARKET_TRANSFER_REASONS.LISTING_HOLD,
          });
          itemDefinitionId = definition.id;
        }

        // Reservation guarantees the asset can safely return on cancel/expiry.
        const reservation = await tx.inventoryCapacityReservation.create({
          data: { characterId: character.id, slots: 1, reason: 'LISTING_RETURN' },
        });

        await currencyService.debit(tx, {
          characterId: character.id,
          amount: fee,
          type: CURRENCY_TYPES.LISTING_FEE,
          operationNamespace: 'listing-fee',
          idempotencyKey: input.idempotencyKey,
        });

        const listing = await tx.marketplaceListing.create({
          data: {
            shopId: shop.id,
            sellerCharacterId: character.id,
            itemDefinitionId,
            itemInstanceId,
            quantity,
            price,
            feePaid: fee,
            expiresAt,
            returnReservationId: reservation.id,
            idempotencyKey: input.idempotencyKey,
          },
        });
        await tx.inventoryCapacityReservation.update({
          where: { id: reservation.id },
          data: { refId: listing.id },
        });
        return { listingId: listing.id };
      });
    },

    async cancelListing(userId, listingId) {
      const character = await characterService.requireCharacter(userId);
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "MarketplaceListing" WHERE "id" = ${listingId} FOR UPDATE`;
        if (rows.length === 0) throw new DomainError(404, 'UNKNOWN_LISTING', 'No such listing.');
        const listing = await tx.marketplaceListing.findUniqueOrThrow({
          where: { id: listingId },
        });
        if (listing.sellerCharacterId !== character.id) {
          throw new DomainError(403, 'NOT_YOURS', 'That listing is not yours.');
        }
        if (listing.status !== 'ACTIVE') {
          throw new DomainError(409, 'NOT_ACTIVE', 'That listing is no longer active.');
        }
        // Expired-but-unfinalized: finalize as expiry instead of cancel.
        if (listing.expiresAt <= now) {
          await finalizeExpiredListing(tx, inventoryService, listingId, now);
          return;
        }
        await tx.marketplaceListing.update({
          where: { id: listingId },
          data: { status: 'CANCELED', finalizedAt: now },
        });
        if (listing.returnReservationId) {
          await tx.inventoryCapacityReservation.updateMany({
            where: { id: listing.returnReservationId, releasedAt: null },
            data: { releasedAt: now },
          });
        }
        if (listing.itemInstanceId) {
          await tx.itemInstance.update({
            where: { id: listing.itemInstanceId },
            data: { lockState: 'NONE' },
          });
        } else {
          await inventoryService.addToStack(tx, {
            characterId: character.id,
            itemDefinitionId: listing.itemDefinitionId,
            quantity: listing.quantity,
            reason: MARKET_TRANSFER_REASONS.LISTING_RETURN,
          });
        }
      });
    },

    async browseListings(userId, query) {
      const character = await characterService.requireCharacter(userId);
      const location = await currentLocation(userId);
      // Browsing is available from any safe location.
      if (!location.isSafe) {
        throw new DomainError(
          409,
          'UNSAFE_LOCATION',
          'The marketplace boards cannot be consulted somewhere this dangerous.',
        );
      }
      // Opportunistic global cleanup; expired rows are filtered out regardless.
      await sweepExpiredListings(prisma, inventoryService);

      const now = new Date();
      const listings = await prisma.marketplaceListing.findMany({
        where: {
          ...(query.mine
            ? { sellerCharacterId: character.id, status: { in: ['ACTIVE', 'SOLD', 'EXPIRED'] } }
            : { status: 'ACTIVE', expiresAt: { gt: now } }),
          ...(query.itemSlug || query.category
            ? {
                itemDefinition: {
                  ...(query.itemSlug ? { slug: query.itemSlug } : {}),
                  ...(query.category ? { category: query.category } : {}),
                },
              }
            : {}),
        },
        include: { itemDefinition: true, shop: true },
        orderBy: [{ price: 'asc' }, { createdAt: 'asc' }],
        take: 50,
      });
      return {
        listings: listings.map((listing) => ({
          id: listing.id,
          item: toItemDefinitionInfo(listing.itemDefinition),
          quantity: listing.quantity,
          price: listing.price.toString(),
          status: listing.status,
          shopName: listing.shop.name,
          shopRegion: listing.shop.region,
          local: listing.shop.region === location.region,
          isYours: listing.sellerCharacterId === character.id,
          expiresAt: listing.expiresAt.toISOString(),
        })),
      };
    },

    async purchaseListing(userId, listingId, input) {
      const character = await characterService.requireCharacter(userId);
      const location = await currentLocation(userId);
      assertMarketplaceLocation(location);
      const now = new Date();

      return prisma.$transaction(async (tx) => {
        await inventoryService.lockCharacter(tx, character.id);

        // Idempotent replay.
        const existingSale = await tx.marketplaceSale.findUnique({
          where: {
            buyerCharacterId_idempotencyKey: {
              buyerCharacterId: character.id,
              idempotencyKey: input.idempotencyKey,
            },
          },
          include: { delivery: true },
        });
        if (existingSale) {
          const account = await tx.currencyAccount.findUniqueOrThrow({
            where: { characterId: character.id },
          });
          return {
            saleId: existingSale.id,
            remote: existingSale.remote,
            grossPrice: existingSale.grossPrice.toString(),
            shippingFee: existingSale.shippingFee.toString(),
            totalCharged: (existingSale.grossPrice + existingSale.shippingFee).toString(),
            gold: account.balance.toString(),
            deliveryArrivesAt: existingSale.delivery?.arrivesAt.toISOString() ?? null,
          };
        }

        // Lock the listing; whole-listing purchase, exactly one buyer.
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "MarketplaceListing" WHERE "id" = ${listingId} FOR UPDATE`;
        if (rows.length === 0) throw new DomainError(404, 'UNKNOWN_LISTING', 'No such listing.');
        const listing = await tx.marketplaceListing.findUniqueOrThrow({
          where: { id: listingId },
          include: { shop: true, itemDefinition: true },
        });
        if (listing.status !== 'ACTIVE' || listing.expiresAt <= now) {
          metrics.increment('marketplace_purchase_conflict');
          throw new DomainError(409, 'LISTING_UNAVAILABLE', 'That listing is no longer available.');
        }
        if (listing.sellerCharacterId === character.id) {
          throw new DomainError(400, 'SELF_PURCHASE', 'You cannot buy your own listing.');
        }

        const remote = listing.shop.region !== location.region;
        const gross = listing.price;
        const tax = applyBasisPoints(gross, gameConfig.marketTaxBps);
        const proceeds = gross - tax;
        const shipping = remote ? gameConfig.shippingFee : 0n;

        // Buyer pays price + shipping; seller receives gross − tax. Tax and
        // shipping are sinks.
        await currencyService.debit(tx, {
          characterId: character.id,
          amount: gross + shipping,
          type: CURRENCY_TYPES.MARKET_PURCHASE,
          operationNamespace: 'market-purchase',
          idempotencyKey: input.idempotencyKey,
          relatedType: 'MarketplaceListing',
          relatedId: listing.id,
        });
        await currencyService.credit(tx, {
          characterId: listing.sellerCharacterId,
          amount: proceeds,
          type: CURRENCY_TYPES.MARKET_PROCEEDS,
          operationNamespace: 'market-proceeds',
          idempotencyKey: `listing-${listing.id}`,
          relatedType: 'MarketplaceListing',
          relatedId: listing.id,
        });

        await tx.marketplaceListing.update({
          where: { id: listing.id },
          data: { status: 'SOLD', finalizedAt: now },
        });
        // The seller's return reservation is no longer needed.
        if (listing.returnReservationId) {
          await tx.inventoryCapacityReservation.updateMany({
            where: { id: listing.returnReservationId, releasedAt: null },
            data: { releasedAt: now },
          });
        }

        const sale = await tx.marketplaceSale.create({
          data: {
            listingId: listing.id,
            buyerCharacterId: character.id,
            sellerCharacterId: listing.sellerCharacterId,
            itemDefinitionId: listing.itemDefinitionId,
            quantity: listing.quantity,
            grossPrice: gross,
            tax,
            sellerProceeds: proceeds,
            shippingFee: shipping,
            remote,
            idempotencyKey: input.idempotencyKey,
          },
        });

        await notifications.create(tx, {
          characterId: listing.sellerCharacterId,
          type: 'LISTING_SOLD',
          dedupeKey: `listing-sold:${listing.id}`,
          title: 'Listing sold',
          body: `Your listing sold for ${gross} Gold — ${proceeds} Gold after tax.`,
        });

        let deliveryArrivesAt: string | null = null;
        if (!remote) {
          // Local: immediate delivery into the buyer's inventory.
          if (listing.itemInstanceId) {
            await inventoryService.assertFreeSlots(tx, character.id, 1);
            await tx.itemInstance.update({
              where: { id: listing.itemInstanceId },
              data: { ownerCharacterId: character.id, lockState: 'NONE' },
            });
            await tx.itemTransfer.create({
              data: {
                itemDefinitionId: listing.itemDefinitionId,
                itemInstanceId: listing.itemInstanceId,
                quantity: 1,
                fromCharacterId: listing.sellerCharacterId,
                toCharacterId: character.id,
                reason: MARKET_TRANSFER_REASONS.MARKET_SALE,
              },
            });
          } else {
            // Held goods go to the buyer (hold was seller→world).
            await inventoryService.addToStack(tx, {
              characterId: character.id,
              itemDefinitionId: listing.itemDefinitionId,
              quantity: listing.quantity,
              reason: MARKET_TRANSFER_REASONS.MARKET_SALE,
            });
          }
        } else {
          // Remote: ownership now, goods transit-locked, capacity reserved.
          await inventoryService.assertFreeSlots(tx, character.id, 1);
          const reservation = await tx.inventoryCapacityReservation.create({
            data: {
              characterId: character.id,
              slots: 1,
              reason: 'DELIVERY',
              refId: sale.id,
            },
          });
          const arrivesAt = new Date(now.getTime() + gameConfig.deliverySeconds * 1000);
          const delivery = await tx.delivery.create({
            data: {
              saleId: sale.id,
              buyerCharacterId: character.id,
              arrivesAt,
              capacityReservationId: reservation.id,
            },
          });
          if (listing.itemInstanceId) {
            await tx.itemInstance.update({
              where: { id: listing.itemInstanceId },
              data: { ownerCharacterId: character.id, lockState: 'IN_TRANSIT' },
            });
            await tx.itemTransfer.create({
              data: {
                itemDefinitionId: listing.itemDefinitionId,
                itemInstanceId: listing.itemInstanceId,
                quantity: 1,
                fromCharacterId: listing.sellerCharacterId,
                toCharacterId: character.id,
                reason: MARKET_TRANSFER_REASONS.MARKET_SALE,
              },
            });
            await tx.deliveryLine.create({
              data: {
                deliveryId: delivery.id,
                itemDefinitionId: listing.itemDefinitionId,
                quantity: 1,
                itemInstanceId: listing.itemInstanceId,
              },
            });
          } else {
            await tx.itemTransfer.create({
              data: {
                itemDefinitionId: listing.itemDefinitionId,
                quantity: listing.quantity,
                fromCharacterId: listing.sellerCharacterId,
                toCharacterId: character.id,
                reason: MARKET_TRANSFER_REASONS.MARKET_SALE,
              },
            });
            await tx.deliveryLine.create({
              data: {
                deliveryId: delivery.id,
                itemDefinitionId: listing.itemDefinitionId,
                quantity: listing.quantity,
              },
            });
          }
          deliveryArrivesAt = arrivesAt.toISOString();
        }

        const account = await tx.currencyAccount.findUniqueOrThrow({
          where: { characterId: character.id },
        });
        return {
          saleId: sale.id,
          remote,
          grossPrice: gross.toString(),
          shippingFee: shipping.toString(),
          totalCharged: (gross + shipping).toString(),
          gold: account.balance.toString(),
          deliveryArrivesAt,
        };
      });
    },

    async getItemSummary(userId, itemSlug) {
      await characterService.requireCharacter(userId);
      const definition = await prisma.itemDefinition.findUnique({ where: { slug: itemSlug } });
      if (!definition) throw new DomainError(404, 'UNKNOWN_ITEM', 'No such item.');
      const now = new Date();
      const recentWindow = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

      const [active, cheapest, sales] = await Promise.all([
        prisma.marketplaceListing.count({
          where: { itemDefinitionId: definition.id, status: 'ACTIVE', expiresAt: { gt: now } },
        }),
        prisma.marketplaceListing.findFirst({
          where: { itemDefinitionId: definition.id, status: 'ACTIVE', expiresAt: { gt: now } },
          orderBy: { price: 'asc' },
        }),
        prisma.marketplaceSale.findMany({
          where: { itemDefinitionId: definition.id, createdAt: { gte: recentWindow } },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ]);

      const insufficientHistory = sales.length < 5;
      let median: bigint | null = null;
      if (!insufficientHistory) {
        const unitPrices = sales
          .map((sale) => sale.grossPrice / BigInt(sale.quantity))
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const mid = Math.floor(unitPrices.length / 2);
        median =
          unitPrices.length % 2 === 1
            ? unitPrices[mid]!
            : (unitPrices[mid - 1]! + unitPrices[mid]!) / 2n;
      }

      return {
        itemSlug,
        activeListings: active,
        cheapestPrice: cheapest?.price.toString() ?? null,
        recentSales: sales.length,
        medianUnitPrice: median?.toString() ?? null,
        volume: sales.reduce((sum, sale) => sum + sale.quantity, 0),
        insufficientHistory,
      };
    },

    async getDeliveries(userId) {
      const character = await characterService.requireCharacter(userId);
      const now = new Date();
      await deliveryFinalizer.finalizeExpired(character.id, now);
      const deliveries = await prisma.delivery.findMany({
        where: { buyerCharacterId: character.id },
        include: { lines: { include: { itemDefinition: true } } },
        orderBy: { startedAt: 'desc' },
        take: 20,
      });
      return {
        deliveries: deliveries.map((delivery) => ({
          id: delivery.id,
          status: delivery.status,
          arrivesAt: delivery.arrivesAt.toISOString(),
          remainingSeconds:
            delivery.status === 'DELIVERED'
              ? 0
              : Math.max(0, Math.ceil((delivery.arrivesAt.getTime() - now.getTime()) / 1000)),
          lines: delivery.lines.map((line) => ({
            itemName: line.itemDefinition.name,
            itemSlug: line.itemDefinition.slug,
            quantity: line.quantity,
          })),
        })),
      };
    },
  };
}
