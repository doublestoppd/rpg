import type {
  CraftingRecipe,
  CraftingRun as CraftingRunRow,
  Prisma,
  PrismaClient,
  ProfessionType,
} from '@prisma/client';
import {
  blacksmithingLevelForXp,
  blacksmithingXpForNextLevel,
  type ClaimCraftingResponse,
  type CraftingRecipesResponse,
  type CraftingResult,
  type CraftingRun,
  type CraftingStatusResponse,
  type ProfessionProgressInfo,
} from '@rpg/shared';
import { z } from 'zod';

import { conflict, DomainError } from '../../lib/http-errors.js';
import type { TimedStateFinalizer } from '../../lib/timed-state.js';
import type { CharacterService } from '../character/character-service.js';
import { CURRENCY_TYPES, type CurrencyService } from '../currency/currency-service.js';
import { toItemDefinitionInfo, type InventoryService } from '../inventory/inventory-service.js';
import type { LocationService } from '../location/location-service.js';

export const CRAFTING_CONSUME_REASON = 'CRAFTING_CONSUME';
export const CRAFTING_OUTPUT_REASON = 'CRAFTING_OUTPUT';

/** Validated shape of CraftingRecipe.inputs (stored JSON). */
const inputsSchema = z
  .array(
    z.object({
      itemSlug: z.string().min(1),
      quantity: z.number().int().min(1),
    }),
  )
  .min(1);

/**
 * Pending-output snapshot stored on the run at start; deterministic (no RNG)
 * but snapshotted so completion grants exactly what was promised even if the
 * recipe is later reseeded.
 */
const outputSnapshotSchema = z.object({
  outputs: z
    .array(
      z.object({
        itemDefinitionId: z.string(),
        itemSlug: z.string(),
        quantity: z.number().int().min(1),
        stackable: z.boolean(),
      }),
    )
    .min(1),
  xp: z.number().int().min(0),
});
type OutputSnapshot = z.infer<typeof outputSnapshotSchema>;

/** Errors that mean "no room" — the output is held, never discarded. */
const CAPACITY_ERROR_CODES = new Set(['INVENTORY_FULL', 'STACK_LIMIT']);

export interface CraftingService {
  /** Timed-state finalizer: grants (or holds) expired runs exactly once. */
  finalizer: TimedStateFinalizer;
  /** Recipes offered at the character's current location + profession. */
  getRecipes(userId: string): Promise<CraftingRecipesResponse>;
  /**
   * Starts a run: consumes the recipe inputs and Gold atomically inside the
   * run-creation transaction. Idempotent per character + idempotencyKey
   * (replays return the existing run without consuming again).
   */
  start(
    userId: string,
    input: { recipeSlug: string; idempotencyKey: string },
  ): Promise<CraftingRun>;
  /** Current crafting state after lazy finalization. */
  status(userId: string): Promise<CraftingStatusResponse>;
  /** Places a capacity-held output into inventory (exactly once). */
  claim(userId: string): Promise<ClaimCraftingResponse>;
}

export function createCraftingService(
  prisma: PrismaClient,
  characterService: CharacterService,
  locationService: LocationService,
  currencyService: CurrencyService,
  inventoryService: InventoryService,
): CraftingService {
  type Tx = Prisma.TransactionClient;

  async function professionInfo(
    tx: Prisma.TransactionClient | PrismaClient,
    characterId: string,
    profession: ProfessionType = 'BLACKSMITHING',
  ): Promise<ProfessionProgressInfo> {
    const row = await tx.craftingProfessionProgress.findUnique({
      where: { characterId_profession: { characterId, profession } },
    });
    const xp = row?.xp ?? 0;
    const level = blacksmithingLevelForXp(xp);
    return { profession, level, xp, xpForNextLevel: blacksmithingXpForNextLevel(level) };
  }

  function toRun(row: CraftingRunRow, recipe: CraftingRecipe, now: Date): CraftingRun {
    return {
      id: row.id,
      recipeSlug: recipe.slug,
      recipeName: recipe.name,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      completesAt: row.completesAt.toISOString(),
      remainingSeconds:
        row.status === 'IN_PROGRESS'
          ? Math.max(0, Math.ceil((row.completesAt.getTime() - now.getTime()) / 1000))
          : 0,
    };
  }

  async function toResult(row: CraftingRunRow, recipe: CraftingRecipe): Promise<CraftingResult> {
    const snapshot = outputSnapshotSchema.parse(row.output);
    const definitions = await prisma.itemDefinition.findMany({
      where: { id: { in: snapshot.outputs.map((o) => o.itemDefinitionId) } },
    });
    const byId = new Map(definitions.map((d) => [d.id, d]));
    return {
      id: row.id,
      recipeSlug: recipe.slug,
      recipeName: recipe.name,
      status: row.status,
      completedAt: (row.completedAt ?? row.completesAt).toISOString(),
      output: snapshot.outputs.map((output) => {
        const definition = byId.get(output.itemDefinitionId);
        if (!definition) throw new Error(`crafting: missing item ${output.itemSlug}`);
        return { item: toItemDefinitionInfo(definition), quantity: output.quantity };
      }),
      xpAwarded: snapshot.xp,
    };
  }

  /** Grants the snapshotted output inside the caller's transaction. */
  async function grantOutput(tx: Tx, characterId: string, snapshot: OutputSnapshot): Promise<void> {
    for (const output of snapshot.outputs) {
      if (output.stackable) {
        await inventoryService.addToStack(tx, {
          characterId,
          itemDefinitionId: output.itemDefinitionId,
          quantity: output.quantity,
          reason: CRAFTING_OUTPUT_REASON,
        });
      } else {
        for (let i = 0; i < output.quantity; i++) {
          await inventoryService.grantInstance(tx, {
            characterId,
            itemDefinitionId: output.itemDefinitionId,
            reason: CRAFTING_OUTPUT_REASON,
          });
        }
      }
    }
    if (snapshot.xp > 0) {
      await tx.craftingProfessionProgress.upsert({
        where: { characterId_profession: { characterId, profession: 'BLACKSMITHING' } },
        create: { characterId, profession: 'BLACKSMITHING', xp: snapshot.xp },
        update: { xp: { increment: snapshot.xp } },
      });
    }
  }

  /**
   * Finalizes one expired run: conditional status update first, then the
   * grant, in one transaction — a capacity failure rolls both back and the
   * run is parked as OUTPUT_HELD with its pending output untouched.
   */
  async function finalizeRun(run: CraftingRunRow, now: Date): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        await inventoryService.lockCharacter(tx, run.characterId);
        const updated = await tx.craftingRun.updateMany({
          where: { id: run.id, status: 'IN_PROGRESS' },
          data: { status: 'COMPLETED', completedAt: now, claimedAt: now },
        });
        if (updated.count !== 1) return; // another request finalized it
        await grantOutput(tx, run.characterId, outputSnapshotSchema.parse(run.output));
      });
    } catch (error) {
      if (error instanceof DomainError && CAPACITY_ERROR_CODES.has(error.code)) {
        // No room: the work is done, so park the pending output on the run.
        await prisma.craftingRun.updateMany({
          where: { id: run.id, status: 'IN_PROGRESS' },
          data: { status: 'OUTPUT_HELD', completedAt: now },
        });
        return;
      }
      throw error;
    }
  }

  const finalizer: TimedStateFinalizer = {
    name: 'crafting',
    async finalizeExpired(characterId, now) {
      const expired = await prisma.craftingRun.findFirst({
        where: { characterId, status: 'IN_PROGRESS', completesAt: { lte: now } },
      });
      if (expired) await finalizeRun(expired, now);
    },
  };

  async function toRecipeInfo(recipe: CraftingRecipe, professionLevel: number) {
    const inputs = inputsSchema.parse(recipe.inputs);
    const slugs = [...inputs.map((i) => i.itemSlug)];
    const definitions = await prisma.itemDefinition.findMany({
      where: { OR: [{ slug: { in: slugs } }, { id: recipe.outputItemDefinitionId }] },
    });
    const bySlug = new Map(definitions.map((d) => [d.slug, d]));
    const output = definitions.find((d) => d.id === recipe.outputItemDefinitionId);
    if (!output) throw new Error(`crafting: missing output item for ${recipe.slug}`);
    return {
      slug: recipe.slug,
      name: recipe.name,
      description: recipe.description,
      profession: recipe.profession,
      levelRequirement: recipe.levelRequirement,
      goldCost: recipe.goldCost.toString(),
      durationSeconds: recipe.durationSeconds,
      xpReward: recipe.xpReward,
      inputs: inputs.map((input) => {
        const definition = bySlug.get(input.itemSlug);
        if (!definition) throw new Error(`crafting: missing input item ${input.itemSlug}`);
        return { item: toItemDefinitionInfo(definition), quantity: input.quantity };
      }),
      outputItem: toItemDefinitionInfo(output),
      outputQuantity: recipe.outputQuantity,
      unlocked: professionLevel >= recipe.levelRequirement,
    };
  }

  return {
    finalizer,

    async getRecipes(userId) {
      const character = await characterService.requireCharacter(userId);
      const locationId = await locationService.requireCurrentLocationId(userId);
      const [profession, recipes] = await Promise.all([
        professionInfo(prisma, character.id),
        prisma.craftingRecipe.findMany({ where: { locationId }, orderBy: { sortOrder: 'asc' } }),
      ]);
      return {
        profession,
        recipes: await Promise.all(recipes.map((r) => toRecipeInfo(r, profession.level))),
      };
    },

    async start(userId, input) {
      const now = new Date();
      const character = await characterService.requireCharacter(userId);

      // Stale replay: the same idempotency key returns the original run
      // without consuming inputs or Gold again.
      const existingByKey = await prisma.craftingRun.findUnique({
        where: {
          characterId_idempotencyKey: {
            characterId: character.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: { recipe: true },
      });
      if (existingByKey) return toRun(existingByKey, existingByKey.recipe, now);

      const recipe = await prisma.craftingRecipe.findUnique({
        where: { slug: input.recipeSlug },
      });
      if (!recipe) throw new DomainError(404, 'UNKNOWN_RECIPE', 'No such recipe exists.');

      // Location check (also lazily finalizes travel and expired runs).
      const locationId = await locationService.requireCurrentLocationId(userId);
      if (recipe.locationId !== locationId) {
        throw conflict('NOT_HERE', 'This recipe needs the forge — you are not there.');
      }

      const profession = await professionInfo(prisma, character.id);
      if (profession.level < recipe.levelRequirement) {
        throw new DomainError(
          400,
          'SKILL_TOO_LOW',
          `That work needs Blacksmithing level ${recipe.levelRequirement}.`,
        );
      }

      const inputs = inputsSchema.parse(recipe.inputs);
      const inputDefinitions = await prisma.itemDefinition.findMany({
        where: { slug: { in: inputs.map((i) => i.itemSlug) } },
      });
      const defBySlug = new Map(inputDefinitions.map((d) => [d.slug, d]));
      const outputDefinition = await prisma.itemDefinition.findUniqueOrThrow({
        where: { id: recipe.outputItemDefinitionId },
      });
      const snapshot: OutputSnapshot = {
        outputs: [
          {
            itemDefinitionId: outputDefinition.id,
            itemSlug: outputDefinition.slug,
            quantity: recipe.outputQuantity,
            stackable: outputDefinition.stackable,
          },
        ],
        xp: recipe.xpReward,
      };

      try {
        const created = await prisma.$transaction(async (tx) => {
          await inventoryService.lockCharacter(tx, character.id);
          // Re-check under the lock: one unfinished run per character.
          const active = await tx.craftingRun.findFirst({
            where: { characterId: character.id, status: { not: 'COMPLETED' } },
          });
          if (active) {
            throw conflict(
              'CRAFTING_ACTIVE',
              active.status === 'OUTPUT_HELD'
                ? 'Collect your finished work before starting more.'
                : 'The forge is already busy with your work.',
            );
          }
          // Inputs and Gold are consumed exactly once, here, atomically with
          // run creation. Listed/locked goods are never reachable: stack
          // quantities held on listings were already moved off the stack.
          for (const recipeInput of inputs) {
            const definition = defBySlug.get(recipeInput.itemSlug);
            if (!definition) throw new Error(`crafting: missing input ${recipeInput.itemSlug}`);
            await inventoryService.removeFromStack(tx, {
              characterId: character.id,
              itemDefinitionId: definition.id,
              quantity: recipeInput.quantity,
              reason: CRAFTING_CONSUME_REASON,
            });
          }
          if (recipe.goldCost > 0n) {
            await currencyService.debit(tx, {
              characterId: character.id,
              amount: recipe.goldCost,
              type: CURRENCY_TYPES.CRAFTING_FEE,
              operationNamespace: 'crafting-start',
              idempotencyKey: input.idempotencyKey,
              relatedType: 'CraftingRecipe',
              relatedId: recipe.id,
            });
          }
          return tx.craftingRun.create({
            data: {
              characterId: character.id,
              recipeId: recipe.id,
              startedAt: now,
              completesAt: new Date(now.getTime() + recipe.durationSeconds * 1000),
              output: snapshot,
              goldPaid: recipe.goldCost,
              idempotencyKey: input.idempotencyKey,
            },
          });
        });
        return toRun(created, recipe, now);
      } catch (error) {
        // Unique-index race (idempotency key or the one-unfinished-run
        // partial index): replay wins return the existing run.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          const replay = await prisma.craftingRun.findUnique({
            where: {
              characterId_idempotencyKey: {
                characterId: character.id,
                idempotencyKey: input.idempotencyKey,
              },
            },
            include: { recipe: true },
          });
          if (replay) return toRun(replay, replay.recipe, now);
          throw conflict('CRAFTING_ACTIVE', 'The forge is already busy with your work.');
        }
        throw error;
      }
    },

    async status(userId) {
      const now = new Date();
      const character = await characterService.requireCharacter(userId);
      await finalizer.finalizeExpired(character.id, now);

      const [profession, active, held, lastCompleted] = await Promise.all([
        professionInfo(prisma, character.id),
        prisma.craftingRun.findFirst({
          where: { characterId: character.id, status: 'IN_PROGRESS' },
          include: { recipe: true },
        }),
        prisma.craftingRun.findFirst({
          where: { characterId: character.id, status: 'OUTPUT_HELD' },
          include: { recipe: true },
        }),
        prisma.craftingRun.findFirst({
          where: { characterId: character.id, status: 'COMPLETED' },
          orderBy: { completedAt: 'desc' },
          include: { recipe: true },
        }),
      ]);

      return {
        profession,
        active: active ? toRun(active, active.recipe, now) : null,
        held: held ? await toResult(held, held.recipe) : null,
        lastCompleted: lastCompleted ? await toResult(lastCompleted, lastCompleted.recipe) : null,
      };
    },

    async claim(userId) {
      const now = new Date();
      const character = await characterService.requireCharacter(userId);
      await finalizer.finalizeExpired(character.id, now);

      const held = await prisma.craftingRun.findFirst({
        where: { characterId: character.id, status: 'OUTPUT_HELD' },
        include: { recipe: true },
      });
      if (!held) {
        throw conflict('NOTHING_TO_CLAIM', 'You have no finished work to collect.');
      }

      // Conditional update first, then the grant: a capacity failure rolls
      // everything back and the run stays OUTPUT_HELD with the same output.
      await prisma.$transaction(async (tx) => {
        await inventoryService.lockCharacter(tx, character.id);
        const updated = await tx.craftingRun.updateMany({
          where: { id: held.id, status: 'OUTPUT_HELD' },
          data: { status: 'COMPLETED', claimedAt: now },
        });
        if (updated.count !== 1) {
          throw conflict('NOTHING_TO_CLAIM', 'You have no finished work to collect.');
        }
        await grantOutput(tx, character.id, outputSnapshotSchema.parse(held.output));
      });

      const claimed = await prisma.craftingRun.findUniqueOrThrow({
        where: { id: held.id },
        include: { recipe: true },
      });
      return {
        result: await toResult(claimed, claimed.recipe),
        profession: await professionInfo(prisma, character.id),
      };
    },
  };
}
