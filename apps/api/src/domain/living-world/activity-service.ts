import type { PrismaClient } from '@prisma/client';
import type { ActivityEntry, ActivityResponse } from '@rpg/shared';

import type { LocationService } from '../location/location-service.js';

/**
 * Privacy-safe local activity feed (Phase 26, increment 4). A bounded
 * READ-TIME PROJECTION over verified domain records — marketplace sales,
 * museum donations, shop restocks, and world-event starts. Because entries are
 * derived from the authoritative rows themselves:
 *
 * - no fake player events can exist (every entry has a verified source row);
 * - duplicates are impossible by construction (source rows are unique);
 * - publication never blocks a gameplay transaction (nothing extra is written);
 * - privacy is enforced in the projection: no account ids, request ids,
 *   character names, or balances — only item/shop/collection/event names and
 *   quantities, phrased anonymously by the client from typed parameters.
 */

const FEED_LIMIT = 12;
const PER_SOURCE_LIMIT = 6;

export interface ActivityService {
  recentAt(locationSlug: string, region: string, now?: Date): Promise<ActivityEntry[]>;
  forCurrentLocation(userId: string, now?: Date): Promise<ActivityResponse>;
}

export function createActivityService(
  prisma: PrismaClient,
  locationService: LocationService,
): ActivityService {
  return {
    async recentAt(locationSlug, region, now = new Date()) {
      const entries: ActivityEntry[] = [];

      // World events that started recently in this region.
      const events = await prisma.worldEventOccurrence.findMany({
        where: { region, startsAt: { lte: now } },
        orderBy: { startsAt: 'desc' },
        take: PER_SOURCE_LIMIT,
      });
      for (const event of events) {
        entries.push({
          type: 'WORLD_EVENT_STARTED',
          name: event.name,
          at: event.startsAt.toISOString(),
        });
      }

      // Museum donations to a collection housed at this location (anonymous).
      const donations = await prisma.characterCollectionDonation.findMany({
        where: { collectionEntry: { collection: { location: { slug: locationSlug } } } },
        orderBy: { donatedAt: 'desc' },
        take: PER_SOURCE_LIMIT,
        include: {
          collectionEntry: {
            include: { itemDefinition: true, collection: { select: { name: true } } },
          },
        },
      });
      for (const donation of donations) {
        entries.push({
          type: 'MUSEUM_DONATION',
          itemName: donation.collectionEntry.itemDefinition.name,
          collectionName: donation.collectionEntry.collection.name,
          at: donation.donatedAt.toISOString(),
        });
      }

      // NPC shop restocks at this location.
      const restocks = await prisma.npcShopRestock.findMany({
        where: { shop: { location: { slug: locationSlug } } },
        orderBy: { restockedAt: 'desc' },
        take: PER_SOURCE_LIMIT,
        include: { shop: { select: { name: true } } },
      });
      for (const restock of restocks) {
        entries.push({
          type: 'SHOP_RESTOCKED',
          shopName: restock.shop.name,
          at: restock.restockedAt.toISOString(),
        });
      }

      // Recent marketplace commerce, shown at marketplace-capable (safe)
      // locations. Item + quantity only — never who bought or sold.
      const location = await prisma.location.findUnique({ where: { slug: locationSlug } });
      if (location?.isSafe) {
        const sales = await prisma.marketplaceSale.findMany({
          orderBy: { createdAt: 'desc' },
          take: PER_SOURCE_LIMIT,
          include: { listing: { include: { itemDefinition: true } } },
        });
        for (const sale of sales) {
          entries.push({
            type: 'MARKETPLACE_SALE',
            itemName: sale.listing.itemDefinition.name,
            quantity: sale.quantity,
            at: sale.createdAt.toISOString(),
          });
        }
      }

      // Newest first; stable under concurrent inserts because ordering is by
      // the immutable source timestamps (ties broken by type for determinism).
      entries.sort((a, b) =>
        a.at === b.at ? a.type.localeCompare(b.type) : b.at.localeCompare(a.at),
      );
      return entries.slice(0, FEED_LIMIT);
    },

    async forCurrentLocation(userId, now = new Date()) {
      const { location } = await locationService.getCurrentLocation(userId);
      return {
        locationSlug: location.slug,
        entries: await this.recentAt(location.slug, location.region, now),
      };
    },
  };
}
