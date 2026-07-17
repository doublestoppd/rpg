import type {
  CharacterCollectionDonation,
  CollectionDefinition,
  CollectionEntry,
  ItemDefinition,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type { CollectionsResponse, CollectionView, DonateResponse } from '@rpg/shared';

import { conflict, DomainError } from '../../lib/http-errors.js';
import type { CharacterService } from '../character/character-service.js';
import { type InventoryService, toItemDefinitionInfo } from '../inventory/inventory-service.js';
import type { LocationService } from '../location/location-service.js';
import { noopQuestEvents, type QuestEventSink } from '../quest/quest-events.js';

export const MUSEUM_TRANSFER_REASON = 'MUSEUM_DONATION';
export const MUSEUM_DESTRUCTION_REASON = 'MUSEUM_DONATION';

type CollectionFull = CollectionDefinition & {
  location: { slug: string };
  entries: Array<CollectionEntry & { itemDefinition: ItemDefinition }>;
};

export interface MuseumService {
  /** All collections with this character's donation progress. */
  getCollections(userId: string): Promise<CollectionsResponse>;
  /**
   * Donates one copy of an eligible artifact: removes the asset, records
   * the transfer and destruction, updates the collection, and emits the
   * donation quest event — all in one transaction. Irreversible.
   */
  donate(
    userId: string,
    collectionId: string,
    input: { itemSlug: string },
  ): Promise<DonateResponse>;
}

export function createMuseumService(
  prisma: PrismaClient,
  characterService: CharacterService,
  locationService: LocationService,
  inventoryService: InventoryService,
  questEvents: QuestEventSink = noopQuestEvents,
): MuseumService {
  async function loadCollections(): Promise<CollectionFull[]> {
    return prisma.collectionDefinition.findMany({
      include: {
        location: { select: { slug: true } },
        entries: { include: { itemDefinition: true }, orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async function toView(
    collection: CollectionFull,
    characterId: string,
    donations: CharacterCollectionDonation[],
  ): Promise<CollectionView> {
    const donationByEntry = new Map(donations.map((d) => [d.collectionEntryId, d]));
    const entries = await Promise.all(
      collection.entries.map(async (entry) => {
        const donation = donationByEntry.get(entry.id);
        // Copies available to donate: active stack quantity or unlocked,
        // unequipped instances.
        let ownedCount = 0;
        if (entry.itemDefinition.stackable) {
          const stack = await prisma.inventoryStack.findUnique({
            where: {
              characterId_itemDefinitionId: {
                characterId,
                itemDefinitionId: entry.itemDefinitionId,
              },
            },
          });
          ownedCount = stack?.quantity ?? 0;
        } else {
          ownedCount = await prisma.itemInstance.count({
            where: {
              ownerCharacterId: characterId,
              itemDefinitionId: entry.itemDefinitionId,
              destroyedAt: null,
              lockState: 'NONE',
              equipment: null,
            },
          });
        }
        return {
          item: toItemDefinitionInfo(entry.itemDefinition),
          donated: Boolean(donation),
          donatedAt: donation?.donatedAt.toISOString() ?? null,
          curatorNote: donation ? entry.curatorNote : null,
          ownedCount,
        };
      }),
    );
    return {
      id: collection.id,
      slug: collection.slug,
      name: collection.name,
      description: collection.description,
      locationSlug: collection.location.slug,
      entries,
      donatedCount: entries.filter((e) => e.donated).length,
      totalCount: entries.length,
    };
  }

  return {
    async getCollections(userId) {
      const character = await characterService.requireCharacter(userId);
      const [collections, donations] = await Promise.all([
        loadCollections(),
        prisma.characterCollectionDonation.findMany({ where: { characterId: character.id } }),
      ]);
      return {
        collections: await Promise.all(
          collections.map((collection) => toView(collection, character.id, donations)),
        ),
      };
    },

    async donate(userId, collectionId, input) {
      const character = await characterService.requireCharacter(userId);
      const collection = await prisma.collectionDefinition.findUnique({
        where: { id: collectionId },
        include: {
          location: { select: { slug: true } },
          entries: { include: { itemDefinition: true }, orderBy: { sortOrder: 'asc' } },
        },
      });
      if (!collection) {
        throw new DomainError(404, 'UNKNOWN_COLLECTION', 'No such collection exists.');
      }

      // Donations happen at the museum (lazily finalizes travel first).
      const locationId = await locationService.requireCurrentLocationId(userId);
      if (collection.locationId !== locationId) {
        throw conflict('NOT_HERE', 'The curators accept donations at the museum itself.');
      }

      const entry = collection.entries.find((e) => e.itemDefinition.slug === input.itemSlug);
      if (!entry) {
        throw new DomainError(404, 'NOT_ELIGIBLE', 'The museum has no place for that.');
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await inventoryService.lockCharacter(tx, character.id);

        const existing = await tx.characterCollectionDonation.findUnique({
          where: {
            characterId_collectionEntryId: {
              characterId: character.id,
              collectionEntryId: entry.id,
            },
          },
        });
        if (existing) {
          throw conflict(
            'ALREADY_DONATED',
            'The collection already holds your donation of this artifact.',
          );
        }

        let donatedInstanceId: string | null = null;
        if (entry.itemDefinition.stackable) {
          // Reduces the stack (throws INSUFFICIENT_ITEMS when missing) and
          // records the aggregate ItemTransfer to the world.
          await inventoryService.removeFromStack(tx, {
            characterId: character.id,
            itemDefinitionId: entry.itemDefinitionId,
            quantity: 1,
            reason: MUSEUM_TRANSFER_REASON,
          });
        } else {
          // Listed, in-transit, equipped, destroyed, or foreign instances
          // are all unreachable by this filter — donation requires a free
          // asset in active inventory.
          const instance = await tx.itemInstance.findFirst({
            where: {
              ownerCharacterId: character.id,
              itemDefinitionId: entry.itemDefinitionId,
              destroyedAt: null,
              lockState: 'NONE',
              equipment: null,
            },
            orderBy: { createdAt: 'asc' },
          });
          if (!instance) {
            throw conflict('ITEM_UNAVAILABLE', 'You have no free copy of that artifact to donate.');
          }
          // Ownership ends and the instance is destroyed, permanently.
          await tx.itemInstance.update({
            where: { id: instance.id },
            data: { ownerCharacterId: null, destroyedAt: new Date() },
          });
          await tx.itemTransfer.create({
            data: {
              itemDefinitionId: entry.itemDefinitionId,
              itemInstanceId: instance.id,
              quantity: 1,
              fromCharacterId: character.id,
              toCharacterId: null,
              reason: MUSEUM_TRANSFER_REASON,
            },
          });
          donatedInstanceId = instance.id;
        }

        const donation = await tx.characterCollectionDonation.create({
          data: {
            characterId: character.id,
            collectionEntryId: entry.id,
            itemDefinitionId: entry.itemDefinitionId,
            itemInstanceId: donatedInstanceId,
          },
        });

        await tx.itemDestruction.create({
          data: {
            characterId: character.id,
            itemDefinitionId: entry.itemDefinitionId,
            itemInstanceId: donatedInstanceId,
            quantity: 1,
            reason: MUSEUM_DESTRUCTION_REASON,
            refType: 'CharacterCollectionDonation',
            refId: donation.id,
          },
        });

        // The donation quest event commits (or rolls back) with everything
        // above — the collection and quest progress cannot diverge.
        await questEvents.handle(tx, character.id, {
          type: 'MUSEUM_DONATION',
          itemSlug: entry.itemDefinition.slug,
        });
      });

      const [collections, donations] = await Promise.all([
        loadCollections(),
        prisma.characterCollectionDonation.findMany({ where: { characterId: character.id } }),
      ]);
      const updated = collections.find((c) => c.id === collection.id);
      if (!updated) throw new Error('museum: collection vanished mid-donation');
      const view = await toView(updated, character.id, donations);
      const entryView = view.entries.find((e) => e.item.slug === input.itemSlug);
      if (!entryView) throw new Error('museum: entry vanished mid-donation');
      return { collection: view, entry: entryView };
    },
  };
}
