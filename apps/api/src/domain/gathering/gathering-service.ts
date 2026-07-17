import type {
  GatheringActionDefinition,
  GatheringRun as GatheringRunRow,
  Prisma,
  PrismaClient,
  SkillType,
} from '@prisma/client';
import {
  type ClaimGatheringResponse,
  type GatheringActionsResponse,
  type GatheringResult,
  type GatheringRun,
  type GatheringStatusResponse,
  miningLevelForXp,
  type MiningSkillInfo,
  miningXpForNextLevel,
} from '@rpg/shared';
import { z } from 'zod';

import { conflict, DomainError } from '../../lib/http-errors.js';
import { metrics } from '../../lib/metrics.js';
import { secureInt, weightedSample } from '../../lib/rng.js';
import type { TimedStateFinalizer } from '../../lib/timed-state.js';
import type { CharacterService } from '../character/character-service.js';
import { type InventoryService, toItemDefinitionInfo } from '../inventory/inventory-service.js';
import type { LocationService } from '../location/location-service.js';
import { noopQuestEvents, type QuestEventSink } from '../quest/quest-events.js';

export const GATHERING_TRANSFER_REASON = 'GATHERING_REWARD';

/** Validated shape of GatheringActionDefinition.rewardTable (stored JSON). */
const rewardTableSchema = z.object({
  entries: z
    .array(
      z.object({
        itemSlug: z.string().min(1),
        weight: z.number().int().min(1),
        minQuantity: z.number().int().min(1),
        maxQuantity: z.number().int().min(1),
      }),
    )
    .min(1),
});

/**
 * Server-private rolled outcome stored on the run at start. Never serialized
 * into pending API responses; revealed only after the run finalizes.
 */
const outcomeSchema = z.object({
  rewards: z
    .array(
      z.object({
        itemDefinitionId: z.string(),
        itemSlug: z.string(),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1),
  xp: z.number().int().min(0),
});
type Outcome = z.infer<typeof outcomeSchema>;

/** Errors that mean "no room" — the reward is held, never rerolled. */
const CAPACITY_ERROR_CODES = new Set(['INVENTORY_FULL', 'STACK_LIMIT']);

export interface GatheringService {
  /** Timed-state finalizer: grants (or holds) expired runs exactly once. */
  finalizer: TimedStateFinalizer;
  /** Actions offered at the character's current location + skill progress. */
  getActions(userId: string): Promise<GatheringActionsResponse>;
  /**
   * Starts a run: rolls the authoritative reward with secure server RNG,
   * charges stamina once, and stores the outcome server-privately. Idempotent
   * per character + idempotencyKey (replays return the existing run).
   */
  start(
    userId: string,
    input: { actionSlug: string; idempotencyKey: string },
  ): Promise<GatheringRun>;
  /** Current gathering state after lazy finalization. Reveals no pending reward. */
  status(userId: string): Promise<GatheringStatusResponse>;
  /** Places a capacity-held reward into inventory (exactly once). */
  claim(userId: string): Promise<ClaimGatheringResponse>;
}

export function createGatheringService(
  prisma: PrismaClient,
  characterService: CharacterService,
  locationService: LocationService,
  inventoryService: InventoryService,
  questEvents: QuestEventSink = noopQuestEvents,
): GatheringService {
  type Tx = Prisma.TransactionClient;

  async function skillInfo(
    tx: Prisma.TransactionClient | PrismaClient,
    characterId: string,
    skill: SkillType = 'MINING',
  ): Promise<MiningSkillInfo> {
    const row = await tx.characterSkill.findUnique({
      where: { characterId_skill: { characterId, skill } },
    });
    const xp = row?.xp ?? 0;
    const level = miningLevelForXp(xp);
    return { skill, level, xp, xpForNextLevel: miningXpForNextLevel(level) };
  }

  function toRun(row: GatheringRunRow, action: GatheringActionDefinition, now: Date): GatheringRun {
    return {
      id: row.id,
      actionSlug: action.slug,
      actionName: action.name,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      completesAt: row.completesAt.toISOString(),
      remainingSeconds:
        row.status === 'IN_PROGRESS'
          ? Math.max(0, Math.ceil((row.completesAt.getTime() - now.getTime()) / 1000))
          : 0,
    };
  }

  /** Reveals a finished run's rewards (safe only after completesAt passed). */
  async function toResult(
    row: GatheringRunRow,
    action: GatheringActionDefinition,
  ): Promise<GatheringResult> {
    const outcome = outcomeSchema.parse(row.outcome);
    const definitions = await prisma.itemDefinition.findMany({
      where: { id: { in: outcome.rewards.map((r) => r.itemDefinitionId) } },
    });
    const byId = new Map(definitions.map((d) => [d.id, d]));
    return {
      id: row.id,
      actionSlug: action.slug,
      actionName: action.name,
      status: row.status,
      completedAt: (row.completedAt ?? row.completesAt).toISOString(),
      rewards: outcome.rewards.map((reward) => {
        const definition = byId.get(reward.itemDefinitionId);
        if (!definition) throw new Error(`gathering: missing item ${reward.itemSlug}`);
        return { item: toItemDefinitionInfo(definition), quantity: reward.quantity };
      }),
      xpAwarded: outcome.xp,
    };
  }

  /** Grants the stored outcome inside the caller's transaction. */
  async function grantOutcome(
    tx: Tx,
    characterId: string,
    actionSlug: string,
    outcome: Outcome,
  ): Promise<void> {
    for (const reward of outcome.rewards) {
      await inventoryService.addToStack(tx, {
        characterId,
        itemDefinitionId: reward.itemDefinitionId,
        quantity: reward.quantity,
        reason: GATHERING_TRANSFER_REASON,
      });
    }
    if (outcome.xp > 0) {
      await tx.characterSkill.upsert({
        where: { characterId_skill: { characterId, skill: 'MINING' } },
        create: { characterId, skill: 'MINING', xp: outcome.xp },
        update: { xp: { increment: outcome.xp } },
      });
    }
    // Typed domain event in the same transaction as the verified grant.
    await questEvents.handle(tx, characterId, {
      type: 'GATHERING_COMPLETED',
      actionSlug,
      rewards: outcome.rewards.map((r) => ({ itemSlug: r.itemSlug, quantity: r.quantity })),
    });
  }

  /**
   * Finalizes one expired run: conditional status update first, then the
   * grant, in one transaction — a capacity failure rolls both back and the
   * run is parked as REWARD_HELD with its outcome untouched.
   */
  async function finalizeRun(
    run: GatheringRunRow & { action: GatheringActionDefinition },
    now: Date,
  ): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        await inventoryService.lockCharacter(tx, run.characterId);
        const updated = await tx.gatheringRun.updateMany({
          where: { id: run.id, status: 'IN_PROGRESS' },
          data: { status: 'COMPLETED', completedAt: now, claimedAt: now },
        });
        if (updated.count !== 1) return; // another request finalized it
        await grantOutcome(tx, run.characterId, run.action.slug, outcomeSchema.parse(run.outcome));
      });
    } catch (error) {
      if (error instanceof DomainError && CAPACITY_ERROR_CODES.has(error.code)) {
        // No room: the work is done, so park the rolled reward on the run.
        await prisma.gatheringRun.updateMany({
          where: { id: run.id, status: 'IN_PROGRESS' },
          data: { status: 'REWARD_HELD', completedAt: now },
        });
        return;
      }
      throw error;
    }
  }

  const finalizer: TimedStateFinalizer = {
    name: 'gathering',
    async finalizeExpired(characterId, now) {
      const expired = await prisma.gatheringRun.findFirst({
        where: { characterId, status: 'IN_PROGRESS', completesAt: { lte: now } },
        include: { action: true },
      });
      if (expired) await finalizeRun(expired, now);
    },
  };

  async function requireAction(slug: string): Promise<GatheringActionDefinition> {
    const action = await prisma.gatheringActionDefinition.findUnique({ where: { slug } });
    if (!action) throw new DomainError(404, 'UNKNOWN_ACTION', 'No such gathering action exists.');
    return action;
  }

  return {
    finalizer,

    async getActions(userId) {
      const character = await characterService.requireCharacter(userId);
      const locationId = await locationService.requireCurrentLocationId(userId);
      const [skill, actions] = await Promise.all([
        skillInfo(prisma, character.id),
        prisma.gatheringActionDefinition.findMany({
          where: { locationId },
          orderBy: { sortOrder: 'asc' },
        }),
      ]);
      return {
        skill,
        actions: actions.map((action) => ({
          slug: action.slug,
          name: action.name,
          description: action.description,
          skill: action.skill,
          levelRequirement: action.levelRequirement,
          staminaCost: action.staminaCost,
          durationSeconds: action.durationSeconds,
          xpReward: action.xpReward,
          unlocked: skill.level >= action.levelRequirement,
        })),
      };
    },

    async start(userId, input) {
      const now = new Date();
      const character = await characterService.requireCharacter(userId);

      // Stale replay: the same idempotency key returns the original run
      // (whatever its status) without charging stamina or rolling again.
      const existingByKey = await prisma.gatheringRun.findUnique({
        where: {
          characterId_idempotencyKey: {
            characterId: character.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: { action: true },
      });
      if (existingByKey) {
        metrics.increment('idempotency_replay');
        return toRun(existingByKey, existingByKey.action, now);
      }

      const action = await requireAction(input.actionSlug);

      // Location check (also lazily finalizes travel and expired runs).
      const locationId = await locationService.requireCurrentLocationId(userId);
      if (action.locationId !== locationId) {
        throw conflict('NOT_HERE', 'You cannot work that claim from here.');
      }

      const skill = await skillInfo(prisma, character.id);
      if (skill.level < action.levelRequirement) {
        throw new DomainError(
          400,
          'SKILL_TOO_LOW',
          `That work needs Mining level ${action.levelRequirement}.`,
        );
      }

      // The authoritative reward is rolled once, now, with secure server RNG,
      // and stored server-privately on the run (ADR 0005). Nothing at or
      // after completion ever rerolls it.
      const table = rewardTableSchema.parse(action.rewardTable);
      const pick = weightedSample(table.entries, 1)[0]!;
      const rewardItem = await prisma.itemDefinition.findUniqueOrThrow({
        where: { slug: pick.itemSlug },
      });
      const outcome: Outcome = {
        rewards: [
          {
            itemDefinitionId: rewardItem.id,
            itemSlug: rewardItem.slug,
            quantity: secureInt(pick.minQuantity, pick.maxQuantity),
          },
        ],
        xp: action.xpReward,
      };

      try {
        const created = await prisma.$transaction(async (tx) => {
          await inventoryService.lockCharacter(tx, character.id);
          // Re-check under the lock: one unfinished run per character.
          const active = await tx.gatheringRun.findFirst({
            where: { characterId: character.id, status: { not: 'COMPLETED' } },
          });
          if (active) {
            throw conflict(
              'GATHERING_ACTIVE',
              active.status === 'REWARD_HELD'
                ? 'Claim your held rewards before starting new work.'
                : 'You are already working a claim.',
            );
          }
          // Stamina is charged exactly once, here, atomically with creation.
          await characterService.spendStamina(tx, character.id, action.staminaCost);
          return tx.gatheringRun.create({
            data: {
              characterId: character.id,
              actionId: action.id,
              startedAt: now,
              completesAt: new Date(now.getTime() + action.durationSeconds * 1000),
              outcome,
              staminaCost: action.staminaCost,
              idempotencyKey: input.idempotencyKey,
            },
          });
        });
        return toRun(created, action, now);
      } catch (error) {
        // Unique-index race (idempotency key or the one-unfinished-run
        // partial index): replay wins return the existing run.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          metrics.increment('concurrency_conflict');
          const replay = await prisma.gatheringRun.findUnique({
            where: {
              characterId_idempotencyKey: {
                characterId: character.id,
                idempotencyKey: input.idempotencyKey,
              },
            },
            include: { action: true },
          });
          if (replay) return toRun(replay, replay.action, now);
          throw conflict('GATHERING_ACTIVE', 'You are already working a claim.');
        }
        throw error;
      }
    },

    async status(userId) {
      const now = new Date();
      const character = await characterService.requireCharacter(userId);
      await finalizer.finalizeExpired(character.id, now);

      const [skill, active, held, lastCompleted] = await Promise.all([
        skillInfo(prisma, character.id),
        prisma.gatheringRun.findFirst({
          where: { characterId: character.id, status: 'IN_PROGRESS' },
          include: { action: true },
        }),
        prisma.gatheringRun.findFirst({
          where: { characterId: character.id, status: 'REWARD_HELD' },
          include: { action: true },
        }),
        prisma.gatheringRun.findFirst({
          where: { characterId: character.id, status: 'COMPLETED' },
          orderBy: { completedAt: 'desc' },
          include: { action: true },
        }),
      ]);

      return {
        skill,
        active: active ? toRun(active, active.action, now) : null,
        held: held ? await toResult(held, held.action) : null,
        lastCompleted: lastCompleted ? await toResult(lastCompleted, lastCompleted.action) : null,
      };
    },

    async claim(userId) {
      const now = new Date();
      const character = await characterService.requireCharacter(userId);
      await finalizer.finalizeExpired(character.id, now);

      const held = await prisma.gatheringRun.findFirst({
        where: { characterId: character.id, status: 'REWARD_HELD' },
        include: { action: true },
      });
      if (!held) {
        throw conflict('NOTHING_TO_CLAIM', 'You have no held rewards to claim.');
      }

      // Conditional update first, then the grant: a capacity failure rolls
      // everything back and the run stays REWARD_HELD with the same outcome.
      await prisma.$transaction(async (tx) => {
        await inventoryService.lockCharacter(tx, character.id);
        const updated = await tx.gatheringRun.updateMany({
          where: { id: held.id, status: 'REWARD_HELD' },
          data: { status: 'COMPLETED', claimedAt: now },
        });
        if (updated.count !== 1) {
          throw conflict('NOTHING_TO_CLAIM', 'You have no held rewards to claim.');
        }
        await grantOutcome(tx, character.id, held.action.slug, outcomeSchema.parse(held.outcome));
      });

      const claimed = await prisma.gatheringRun.findUniqueOrThrow({
        where: { id: held.id },
        include: { action: true },
      });
      return {
        result: await toResult(claimed, claimed.action),
        skill: await skillInfo(prisma, character.id),
      };
    },
  };
}
