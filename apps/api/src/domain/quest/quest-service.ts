import type {
  CharacterQuest,
  Prisma,
  PrismaClient,
  QuestDefinition,
  QuestObjective,
  QuestProgress,
} from '@prisma/client';
import type { ClaimQuestResponse, QuestsResponse, QuestView } from '@rpg/shared';
import { z } from 'zod';

import { conflict, DomainError } from '../../lib/http-errors.js';
import { metrics } from '../../lib/metrics.js';
import type { CharacterService } from '../character/character-service.js';
import { CURRENCY_TYPES, type CurrencyService } from '../currency/currency-service.js';
import type { InventoryService } from '../inventory/inventory-service.js';
import { noopNotifications, type NotificationSink } from '../notification/notification-service.js';
import type { QuestDomainEvent, QuestEventSink } from './quest-events.js';

export const QUEST_TRANSFER_REASON = 'QUEST_REWARD';

/** Validated shape of QuestDefinition.rewardItems (stored JSON). */
const rewardItemsSchema = z.array(
  z.object({ itemSlug: z.string().min(1), quantity: z.number().int().min(1) }),
);

type QuestWithObjectives = QuestDefinition & { objectives: QuestObjective[] };
type CharacterQuestFull = CharacterQuest & {
  quest: QuestWithObjectives;
  progress: QuestProgress[];
};

/** How far one event advances one objective (0 = no match). */
function incrementFor(objective: QuestObjective, event: QuestDomainEvent): number {
  switch (objective.type) {
    case 'TRAVEL_TO_LOCATION':
      return event.type === 'TRAVEL_COMPLETED' && event.locationSlug === objective.targetSlug
        ? 1
        : 0;
    case 'GATHER_ITEM':
      return event.type === 'GATHERING_COMPLETED'
        ? event.rewards
            .filter((reward) => reward.itemSlug === objective.targetSlug)
            .reduce((sum, reward) => sum + reward.quantity, 0)
        : 0;
    case 'CRAFT_RECIPE':
      return event.type === 'CRAFTING_COMPLETED' && event.recipeSlug === objective.targetSlug
        ? 1
        : 0;
    case 'DEFEAT_ENEMY':
      return event.type === 'COMBAT_VICTORY'
        ? event.defeatedEnemySlugs.filter((slug) => slug === objective.targetSlug).length
        : 0;
    case 'DONATE_ITEM':
      return event.type === 'MUSEUM_DONATION' && event.itemSlug === objective.targetSlug ? 1 : 0;
    case 'TALK_TO_NPC':
      return event.type === 'NPC_INTERACTION' && event.npcKey === objective.targetSlug ? 1 : 0;
  }
}

export interface QuestService {
  /** The typed event sink emitting services call inside their transactions. */
  events: QuestEventSink;
  getQuests(userId: string): Promise<QuestsResponse>;
  accept(userId: string, questId: string): Promise<QuestView>;
  /** Grants rewards exactly once; capacity failures leave it claimable. */
  claim(userId: string, questId: string): Promise<ClaimQuestResponse>;
}

export function createQuestService(
  prisma: PrismaClient,
  characterService: CharacterService,
  currencyService: CurrencyService,
  inventoryService: InventoryService,
  notifications: NotificationSink = noopNotifications,
): QuestService {
  async function rewardsView(quest: QuestDefinition) {
    const rewardItems = rewardItemsSchema.parse(quest.rewardItems);
    const definitions = await prisma.itemDefinition.findMany({
      where: { slug: { in: rewardItems.map((r) => r.itemSlug) } },
    });
    const nameBySlug = new Map(definitions.map((d) => [d.slug, d.name]));
    return {
      xp: quest.rewardXp,
      gold: quest.rewardGold.toString(),
      items: rewardItems.map((reward) => ({
        name: nameBySlug.get(reward.itemSlug) ?? reward.itemSlug,
        quantity: reward.quantity,
      })),
    };
  }

  async function toView(
    quest: QuestWithObjectives,
    characterQuest: (CharacterQuest & { progress: QuestProgress[] }) | null,
  ): Promise<QuestView> {
    const progressByObjective = new Map(
      (characterQuest?.progress ?? []).map((p) => [p.objectiveId, p]),
    );
    return {
      id: quest.id,
      slug: quest.slug,
      name: quest.name,
      description: quest.description,
      status: characterQuest?.status ?? 'NOT_ACCEPTED',
      objectives: [...quest.objectives]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((objective) => {
          const progress = progressByObjective.get(objective.id);
          const current = progress?.currentCount ?? 0;
          return {
            description: objective.description,
            type: objective.type,
            requiredCount: objective.requiredCount,
            currentCount: current,
            completed: current >= objective.requiredCount,
          };
        }),
      rewards: await rewardsView(quest),
      claimable: characterQuest?.status === 'COMPLETED_UNCLAIMED',
    };
  }

  const events: QuestEventSink = {
    async handle(tx, characterId, event) {
      const active = (await tx.characterQuest.findMany({
        where: { characterId, status: 'ACTIVE' },
        include: { quest: { include: { objectives: true } }, progress: true },
      })) as CharacterQuestFull[];
      const now = new Date();
      for (const characterQuest of active) {
        let touched = false;
        for (const objective of characterQuest.quest.objectives) {
          const increment = incrementFor(objective, event);
          if (increment === 0) continue;
          const progress = characterQuest.progress.find((p) => p.objectiveId === objective.id);
          if (!progress || progress.currentCount >= objective.requiredCount) continue;
          const next = Math.min(objective.requiredCount, progress.currentCount + increment);
          await tx.questProgress.update({
            where: { id: progress.id },
            data: {
              currentCount: next,
              ...(next >= objective.requiredCount && !progress.completedAt
                ? { completedAt: now }
                : {}),
            },
          });
          progress.currentCount = next;
          touched = true;
        }
        if (!touched) continue;
        const allDone = characterQuest.quest.objectives.every((objective) => {
          const progress = characterQuest.progress.find((p) => p.objectiveId === objective.id);
          return (progress?.currentCount ?? 0) >= objective.requiredCount;
        });
        if (allDone) {
          // Conditional flip: completion happens exactly once even if two
          // qualifying transactions race.
          const flipped = await tx.characterQuest.updateMany({
            where: { id: characterQuest.id, status: 'ACTIVE' },
            data: { status: 'COMPLETED_UNCLAIMED', completedAt: now },
          });
          if (flipped.count === 1) {
            await notifications.create(tx, {
              characterId,
              type: 'QUEST_COMPLETED',
              dedupeKey: `quest:${characterQuest.id}`,
              title: 'Quest complete',
              body: `"${characterQuest.quest.name}" is complete — claim your reward.`,
            });
          }
        }
      }
    },
  };

  return {
    events,

    async getQuests(userId) {
      const character = await characterService.requireCharacter(userId);
      const [quests, characterQuests] = await Promise.all([
        prisma.questDefinition.findMany({
          include: { objectives: true },
          orderBy: { sortOrder: 'asc' },
        }),
        prisma.characterQuest.findMany({
          where: { characterId: character.id },
          include: { progress: true },
        }),
      ]);
      const byQuestId = new Map(characterQuests.map((cq) => [cq.questId, cq]));
      return {
        quests: await Promise.all(
          quests.map((quest) => toView(quest, byQuestId.get(quest.id) ?? null)),
        ),
      };
    },

    async accept(userId, questId) {
      const character = await characterService.requireCharacter(userId);
      const quest = await prisma.questDefinition.findUnique({
        where: { id: questId },
        include: { objectives: true },
      });
      if (!quest) throw new DomainError(404, 'UNKNOWN_QUEST', 'No such quest exists.');

      try {
        const characterQuest = await prisma.$transaction(async (tx) => {
          // Acceptance activates immediately; progress starts from zero —
          // prior actions never count retroactively.
          const created = await tx.characterQuest.create({
            data: { characterId: character.id, questId: quest.id, status: 'ACTIVE' },
          });
          for (const objective of quest.objectives) {
            await tx.questProgress.create({
              data: { characterQuestId: created.id, objectiveId: objective.id },
            });
          }
          return tx.characterQuest.findUniqueOrThrow({
            where: { id: created.id },
            include: { progress: true },
          });
        });
        return await toView(quest, characterQuest);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          throw conflict('ALREADY_ACCEPTED', 'You already carry that quest.');
        }
        throw error;
      }
    },

    async claim(userId, questId) {
      const character = await characterService.requireCharacter(userId);
      const quest = await prisma.questDefinition.findUnique({
        where: { id: questId },
        include: { objectives: true },
      });
      if (!quest) throw new DomainError(404, 'UNKNOWN_QUEST', 'No such quest exists.');
      const existing = await prisma.characterQuest.findUnique({
        where: { characterId_questId: { characterId: character.id, questId: quest.id } },
      });
      if (!existing || existing.status === 'ACTIVE' || existing.status === 'ACCEPTED') {
        throw conflict('NOT_CLAIMABLE', 'That quest is not finished.');
      }
      if (existing.status === 'CLAIMED') {
        metrics.increment('quest_claim_retry');
        throw conflict('ALREADY_CLAIMED', 'You already claimed that reward.');
      }

      const rewardItems = rewardItemsSchema.parse(quest.rewardItems);
      // Conditional flip first, then grants: a capacity failure rolls the
      // whole transaction back and the quest stays COMPLETED_UNCLAIMED.
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await inventoryService.lockCharacter(tx, character.id);
        const updated = await tx.characterQuest.updateMany({
          where: { id: existing.id, status: 'COMPLETED_UNCLAIMED' },
          data: { status: 'CLAIMED', claimedAt: new Date() },
        });
        if (updated.count !== 1) {
          metrics.increment('quest_claim_retry');
          throw conflict('ALREADY_CLAIMED', 'You already claimed that reward.');
        }
        if (quest.rewardXp > 0) {
          await characterService.addExperience(tx, character.id, quest.rewardXp);
        }
        if (quest.rewardGold > 0n) {
          await currencyService.credit(tx, {
            characterId: character.id,
            amount: quest.rewardGold,
            type: CURRENCY_TYPES.QUEST_REWARD,
            operationNamespace: 'quest-claim',
            idempotencyKey: existing.id,
            relatedType: 'CharacterQuest',
            relatedId: existing.id,
          });
        }
        for (const reward of rewardItems) {
          const definition = await tx.itemDefinition.findUnique({
            where: { slug: reward.itemSlug },
          });
          if (!definition) continue; // validated at seed; tolerate drift
          await inventoryService.addToStack(tx, {
            characterId: character.id,
            itemDefinitionId: definition.id,
            quantity: reward.quantity,
            reason: QUEST_TRANSFER_REASON,
          });
        }
      });

      const claimed = await prisma.characterQuest.findUniqueOrThrow({
        where: { id: existing.id },
        include: { progress: true },
      });
      const view = await toView(quest, claimed);
      return { quest: view, granted: view.rewards };
    },
  };
}
