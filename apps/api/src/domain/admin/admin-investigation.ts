import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AdminCharacterListResponse,
  AdminCharacterOverviewResponse,
  AdminCharacterSearchQuery,
  AdminCurrencyTransactionsResponse,
  AdminDateWindowQuery,
  AdminInventoryResponse,
  AdminItemTransfersResponse,
  AdminMarketplaceActivityResponse,
  AdminProgressResponse,
} from '@rpg/shared';

import { DomainError } from '../../lib/http-errors.js';
import { decodeCursor, encodeCursor, maskEmail } from './admin-cursor.js';

const unknownCharacter = () =>
  new DomainError(404, 'UNKNOWN_CHARACTER', 'No such character exists.');

/** Bounded, paginated, date-limited read views for player investigation. */
export interface AdminInvestigationService {
  searchCharacters(query: AdminCharacterSearchQuery): Promise<AdminCharacterListResponse>;
  overview(characterId: string): Promise<AdminCharacterOverviewResponse>;
  inventory(characterId: string): Promise<AdminInventoryResponse>;
  currencyTransactions(
    characterId: string,
    query: AdminDateWindowQuery,
  ): Promise<AdminCurrencyTransactionsResponse>;
  itemTransfers(
    characterId: string,
    query: AdminDateWindowQuery,
  ): Promise<AdminItemTransfersResponse>;
  marketplaceActivity(
    characterId: string,
    query: AdminDateWindowQuery,
  ): Promise<AdminMarketplaceActivityResponse>;
  progress(characterId: string): Promise<AdminProgressResponse>;
}

export function createAdminInvestigationService(prisma: PrismaClient): AdminInvestigationService {
  /** Time-descending keyset filter from an opaque cursor. */
  function timeCursorFilter(raw: string | undefined): Prisma.DateTimeFilter | undefined {
    if (!raw) return undefined;
    const { c } = decodeCursor(raw);
    if (!c) return undefined;
    return { lt: new Date(c) };
  }

  function dateWindow(query: AdminDateWindowQuery): Prisma.DateTimeFilter {
    const filter: Prisma.DateTimeFilter = {};
    if (query.start) filter.gte = new Date(query.start);
    if (query.end) filter.lte = new Date(query.end);
    return filter;
  }

  async function requireCharacter(characterId: string) {
    const character = await prisma.character.findUnique({
      where: { id: characterId },
      include: { user: true, currencyAccount: true, currentLocation: true },
    });
    if (!character) throw unknownCharacter();
    return character;
  }

  return {
    async searchCharacters(query) {
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const where: Prisma.CharacterWhereInput = {
        ...(query.query ? { name: { startsWith: query.query, mode: 'insensitive' } } : {}),
        ...(cursor?.name && cursor.id
          ? {
              OR: [{ name: { gt: cursor.name } }, { name: cursor.name, id: { gt: cursor.id } }],
            }
          : {}),
      };
      const rows = await prisma.character.findMany({
        where,
        include: { user: { select: { email: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: query.limit,
      });
      const last = rows.at(-1);
      return {
        characters: rows.map((row) => ({
          characterId: row.id,
          name: row.name,
          level: row.level,
          classSlug: row.classSlug,
          accountEmailMasked: maskEmail(row.user.email),
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor:
          rows.length === query.limit && last
            ? encodeCursor({ name: last.name, id: last.id })
            : null,
      };
    },

    async overview(characterId) {
      const character = await requireCharacter(characterId);
      return {
        characterId: character.id,
        name: character.name,
        level: character.level,
        xp: character.xp,
        classSlug: character.classSlug,
        gold: (character.currencyAccount?.balance ?? 0n).toString(),
        currentLocationSlug: character.currentLocation?.slug ?? null,
        accountEmailMasked: maskEmail(character.user.email),
        accountRole: character.user.role,
        createdAt: character.createdAt.toISOString(),
      };
    },

    async inventory(characterId) {
      await requireCharacter(characterId);
      const [stacks, instances] = await Promise.all([
        prisma.inventoryStack.findMany({
          where: { characterId },
          include: { itemDefinition: true },
          orderBy: { itemDefinition: { name: 'asc' } },
        }),
        prisma.itemInstance.findMany({
          where: { ownerCharacterId: characterId, destroyedAt: null },
          include: { itemDefinition: true, equipment: true },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      return {
        stacks: stacks.map((s) => ({
          itemSlug: s.itemDefinition.slug,
          name: s.itemDefinition.name,
          quantity: s.quantity,
        })),
        instances: instances.map((i) => ({
          id: i.id,
          itemSlug: i.itemDefinition.slug,
          name: i.itemDefinition.name,
          lockState: i.lockState,
          equipped: i.equipment !== null,
        })),
      };
    },

    async currencyTransactions(characterId, query) {
      const character = await requireCharacter(characterId);
      if (!character.currencyAccount) return { transactions: [], nextCursor: null };
      const createdAt = { ...dateWindow(query), ...timeCursorFilter(query.cursor) };
      const rows = await prisma.currencyTransaction.findMany({
        where: {
          accountId: character.currencyAccount.id,
          ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      const last = rows.at(-1);
      return {
        transactions: rows.map((row) => ({
          id: row.id,
          amount: row.amount.toString(),
          balanceAfter: row.balanceAfter.toString(),
          type: row.type,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor:
          rows.length === query.limit && last
            ? encodeCursor({ c: last.createdAt.toISOString() })
            : null,
      };
    },

    async itemTransfers(characterId, query) {
      await requireCharacter(characterId);
      const createdAt = { ...dateWindow(query), ...timeCursorFilter(query.cursor) };
      const rows = await prisma.itemTransfer.findMany({
        where: {
          OR: [{ fromCharacterId: characterId }, { toCharacterId: characterId }],
          ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
        },
        include: { itemDefinition: { select: { slug: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      const last = rows.at(-1);
      return {
        transfers: rows.map((row) => ({
          id: row.id,
          itemSlug: row.itemDefinition.slug,
          quantity: row.quantity,
          fromCharacterId: row.fromCharacterId,
          toCharacterId: row.toCharacterId,
          reason: row.reason,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor:
          rows.length === query.limit && last
            ? encodeCursor({ c: last.createdAt.toISOString() })
            : null,
      };
    },

    async marketplaceActivity(characterId, query) {
      await requireCharacter(characterId);
      const createdAt = { ...dateWindow(query), ...timeCursorFilter(query.cursor) };
      const rows = await prisma.marketplaceSale.findMany({
        where: {
          OR: [{ buyerCharacterId: characterId }, { sellerCharacterId: characterId }],
          ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
        },
        include: { listing: { include: { itemDefinition: { select: { slug: true } } } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      const last = rows.at(-1);
      return {
        sales: rows.map((row) => ({
          id: row.id,
          itemSlug: row.listing.itemDefinition.slug,
          quantity: row.quantity,
          role: row.buyerCharacterId === characterId ? ('BUYER' as const) : ('SELLER' as const),
          grossPrice: row.grossPrice.toString(),
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor:
          rows.length === query.limit && last
            ? encodeCursor({ c: last.createdAt.toISOString() })
            : null,
      };
    },

    async progress(characterId) {
      await requireCharacter(characterId);
      const [quests, donations, skills] = await Promise.all([
        prisma.characterQuest.findMany({
          where: { characterId },
          include: { quest: { select: { slug: true } } },
          orderBy: { acceptedAt: 'asc' },
        }),
        prisma.characterCollectionDonation.findMany({
          where: { characterId },
          include: { collectionEntry: { include: { itemDefinition: { select: { slug: true } } } } },
          orderBy: { donatedAt: 'asc' },
        }),
        prisma.characterSkill.findMany({ where: { characterId } }),
      ]);
      return {
        quests: quests.map((q) => ({ slug: q.quest.slug, status: q.status })),
        collections: donations.map((d) => ({
          entrySlug: d.collectionEntry.itemDefinition.slug,
          donatedAt: d.donatedAt.toISOString(),
        })),
        skills: skills.map((s) => ({ skill: s.skill, xp: s.xp })),
      };
    },
  };
}
