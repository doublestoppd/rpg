import type {
  Combat,
  CombatantState,
  CombatStatusEffect,
  EncounterDefinition,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type {
  CombatCommandRequest,
  CombatRewards,
  CombatView,
  EncountersResponse,
} from '@rpg/shared';
import { z } from 'zod';

import { abilitiesForClass, combatConfig, findAbility } from '../../config/combat.js';
import { gameConfig } from '../../config/game.js';
import { createCombatRng, newCombatSeed } from '../../lib/combat-rng.js';
import { conflict, DomainError } from '../../lib/http-errors.js';
import { metrics } from '../../lib/metrics.js';
import type { BuildService } from '../character/build-service.js';
import type { CharacterService } from '../character/character-service.js';
import { computeDerivedStats } from '../character/progression.js';
import { CURRENCY_TYPES, type CurrencyService } from '../currency/currency-service.js';
import type { InventoryService } from '../inventory/inventory-service.js';
import type { LocationService } from '../location/location-service.js';
import { noopQuestEvents, type QuestEventSink } from '../quest/quest-events.js';
import {
  type EngineCombatant,
  EngineRuleError,
  type EngineState,
  GAUGE_MAX,
  type PlayerCommand,
  resolvePlayerCommand,
  runUntilPlayerCommand,
} from './combat-engine.js';

export const COMBAT_TRANSFER_REASON = 'COMBAT_DROP';

const affinitiesSchema = z.partialRecord(
  z.enum(['FLAME', 'FROST', 'STORM', 'STONE']),
  z.number().int(),
);

const aiConfigSchema = z.object({
  actions: z
    .array(
      z.object({
        kind: z.enum(['ATTACK', 'PHYSICAL', 'SPELL', 'STATUS']),
        name: z.string(),
        weight: z.number().int().min(1),
        powerBps: z.number().int().min(1).optional(),
        element: z.enum(['FLAME', 'FROST', 'STORM', 'STONE']).optional(),
        status: z
          .enum(['POISON', 'BLIND', 'SILENCE', 'SLOW', 'HASTE', 'GUARD', 'STUN', 'ARMOR_BREAK'])
          .optional(),
        magnitude: z.number().int().min(1).optional(),
        turns: z.number().int().min(1).optional(),
        applies: z
          .object({
            status: z.enum([
              'POISON',
              'BLIND',
              'SILENCE',
              'SLOW',
              'HASTE',
              'GUARD',
              'STUN',
              'ARMOR_BREAK',
            ]),
            magnitude: z.number().int().min(1),
            turns: z.number().int().min(1),
            chanceBps: z.number().int().min(1).max(10_000),
          })
          .optional(),
      }),
    )
    .min(1),
});

const rewardConfigSchema = z.object({
  xp: z.number().int().min(1),
  goldMin: z.number().int().min(0),
  goldMax: z.number().int().min(0),
  drops: z.array(
    z.object({
      itemSlug: z.string(),
      chanceBps: z.number().int().min(1).max(10_000),
      minQuantity: z.number().int().min(1),
      maxQuantity: z.number().int().min(1),
    }),
  ),
});

const compositionSchema = z
  .array(z.object({ enemySlug: z.string(), row: z.enum(['FRONT', 'BACK']) }))
  .min(1);

const unlockRequirementsSchema = z
  .object({
    minCharacterLevel: z.number().int().min(1).optional(),
    requiresVictoryOverEncounterSlug: z.string().optional(),
  })
  .nullable();

type CombatantRow = CombatantState & { statusEffects: CombatStatusEffect[] };

export interface CombatService {
  getEncounters(userId: string): Promise<EncountersResponse>;
  start(
    userId: string,
    input: { encounterSlug: string; idempotencyKey: string },
  ): Promise<CombatView>;
  getCombat(userId: string, combatId: string): Promise<CombatView>;
  command(userId: string, combatId: string, input: CombatCommandRequest): Promise<CombatView>;
}

export function createCombatService(
  prisma: PrismaClient,
  characterService: CharacterService,
  locationService: LocationService,
  currencyService: CurrencyService,
  inventoryService: InventoryService,
  questEvents: QuestEventSink = noopQuestEvents,
  buildService?: BuildService,
): CombatService {
  type Tx = Prisma.TransactionClient;

  /** Validated shape of Combat.buildSnapshot (Phase 23). */
  const buildSnapshotSchema = z.object({
    loadout: z.array(z.string()),
    talents: z.array(z.string()),
    cooldowns: z.record(z.string(), z.number().int().min(0)),
  });
  type BuildSnapshot = z.infer<typeof buildSnapshotSchema>;
  const readBuildSnapshot = (value: unknown): BuildSnapshot => {
    const parsed = buildSnapshotSchema.safeParse(value);
    return parsed.success ? parsed.data : { loadout: [], talents: [], cooldowns: {} };
  };

  function toEngineCombatant(row: CombatantRow): EngineCombatant {
    return {
      id: row.id,
      slot: row.slot,
      kind: row.kind,
      name: row.name,
      row: row.row,
      ranged: row.ranged,
      gauge: row.gauge,
      hp: row.currentHp,
      mp: row.currentMp,
      maxHp: row.maxHp,
      maxMp: row.maxMp,
      strength: row.strength,
      agility: row.agility,
      magic: row.magic,
      defense: row.defense,
      magicDefense: row.magicDefense,
      luck: row.luck,
      affinities: affinitiesSchema.parse(row.affinities ?? {}),
      statuses: row.statusEffects.map((s) => ({
        type: s.type as EngineCombatant['statuses'][number]['type'],
        magnitude: s.magnitude,
        remainingTurns: s.remainingTurns,
      })),
    };
  }

  async function loadEngineState(
    tx: Tx,
    combat: Combat & { encounter: EncounterDefinition },
  ): Promise<{ state: EngineState; rows: CombatantRow[] }> {
    const rows = (await tx.combatantState.findMany({
      where: { combatId: combat.id },
      include: { statusEffects: true },
      orderBy: { slot: 'asc' },
    })) as CombatantRow[];
    const state: EngineState = {
      combatants: rows.map(toEngineCombatant),
      log: z.array(z.string()).parse(combat.log),
      fleeAttempts: combat.fleeAttempts,
      fleeable: combat.encounter.fleeable,
      fleeModifierBps: combat.encounter.fleeModifierBps,
      outcome: 'ACTIVE',
    };
    // Attach enemy AI from definitions.
    const enemyIds = rows.filter((r) => r.enemyDefinitionId).map((r) => r.enemyDefinitionId!);
    const definitions = await tx.enemyDefinition.findMany({ where: { id: { in: enemyIds } } });
    const byId = new Map(definitions.map((d) => [d.id, d]));
    for (const row of rows) {
      if (!row.enemyDefinitionId) continue;
      const definition = byId.get(row.enemyDefinitionId);
      if (!definition) continue;
      const combatant = state.combatants.find((c) => c.id === row.id)!;
      combatant.aiActions = aiConfigSchema.parse(definition.aiConfig).actions;
    }
    return { state, rows };
  }

  async function persistEngineState(tx: Tx, combatId: string, state: EngineState): Promise<void> {
    for (const c of state.combatants) {
      await tx.combatantState.update({
        where: { id: c.id },
        data: { currentHp: c.hp, currentMp: c.mp, gauge: c.gauge },
      });
    }
    // Statuses are few; replace wholesale for simplicity and correctness.
    await tx.combatStatusEffect.deleteMany({
      where: { combatant: { combatId } },
    });
    for (const c of state.combatants) {
      for (const status of c.statuses) {
        await tx.combatStatusEffect.create({
          data: {
            combatantId: c.id,
            type: status.type,
            magnitude: status.magnitude,
            remainingTurns: status.remainingTurns,
          },
        });
      }
    }
  }

  async function buildView(
    tx: Tx,
    combat: Combat & { encounter: EncounterDefinition },
    characterClassSlug: string,
  ): Promise<CombatView> {
    const rows = (await tx.combatantState.findMany({
      where: { combatId: combat.id },
      include: { statusEffects: true },
      orderBy: { slot: 'asc' },
    })) as CombatantRow[];
    const playerRow = rows.find((r) => r.kind === 'PLAYER')!;
    const enemies = rows.filter((r) => r.kind === 'ENEMY');

    const toView = (row: CombatantRow) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      row: row.row,
      hp: row.currentHp,
      maxHp: row.maxHp,
      mp: row.currentMp,
      maxMp: row.maxMp,
      gauge: Math.min(100, Math.floor(row.gauge / (GAUGE_MAX / 100))),
      statuses: row.statusEffects.map((s) => ({
        type: s.type as CombatView['player']['statuses'][number]['type'],
        magnitude: s.magnitude,
        remainingTurns: s.remainingTurns,
      })),
      defeated: row.currentHp <= 0,
    });

    // Command menus and usable items only matter while a command is awaited.
    let abilities: CombatView['abilities'] = [];
    let usableItems: CombatView['usableItems'] = [];
    if (combat.status === 'ACTIVE') {
      // The battle offers exactly the snapshotted loadout (Phase 23), with live
      // cooldown counters. Combats from before builds fall back to the full
      // class book.
      const snapshot = readBuildSnapshot(combat.buildSnapshot);
      const equipped =
        snapshot.loadout.length > 0
          ? snapshot.loadout
              .map((slug) => findAbility(characterClassSlug, slug))
              .filter((a): a is NonNullable<typeof a> => Boolean(a))
          : abilitiesForClass(characterClassSlug);
      abilities = equipped.map((a) => ({
        slug: a.slug,
        name: a.name,
        description: a.description,
        kind: a.kind,
        mpCost: a.mpCost,
        element: a.element ?? null,
        targeting: a.targeting,
        cooldownTurns: a.cooldownTurns,
        cooldownRemaining: snapshot.cooldowns[a.slug] ?? 0,
      }));
      const stacks = await tx.inventoryStack.findMany({
        where: { characterId: combat.characterId, itemDefinition: { usableInCombat: true } },
        include: { itemDefinition: true },
        orderBy: { itemDefinition: { name: 'asc' } },
      });
      usableItems = stacks
        .filter((s) => s.quantity > 0)
        .map((s) => ({
          slug: s.itemDefinition.slug,
          name: s.itemDefinition.name,
          quantity: s.quantity,
          hpRestore: s.itemDefinition.hpRestore,
          mpRestore: s.itemDefinition.mpRestore,
        }));
    }

    let rewards: CombatRewards | null = null;
    if (combat.status === 'VICTORY') {
      const grant = await tx.combatRewardGrant.findUnique({ where: { combatId: combat.id } });
      if (grant) {
        const drops = z
          .object({
            granted: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
            leftBehind: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
            leveledUp: z.boolean(),
            level: z.number().int(),
          })
          .parse(grant.drops);
        rewards = {
          xp: grant.xp,
          gold: grant.gold.toString(),
          drops: drops.granted,
          leftBehind: drops.leftBehind,
          leveledUp: drops.leveledUp,
          level: drops.level,
        };
      }
    }

    return {
      id: combat.id,
      status: combat.status,
      version: combat.version,
      encounter: {
        slug: combat.encounter.slug,
        name: combat.encounter.name,
        kind: combat.encounter.kind,
        fleeable: combat.encounter.fleeable,
      },
      player: toView(playerRow),
      enemies: enemies.map(toView),
      awaitingCommand: combat.status === 'ACTIVE',
      abilities,
      usableItems,
      log: z.array(z.string()).parse(combat.log),
      rewards,
    };
  }

  async function isEncounterUnlocked(
    tx: Tx,
    characterId: string,
    characterLevel: number,
    encounter: EncounterDefinition,
  ): Promise<{ unlocked: boolean; reason: string | null }> {
    const requirements = unlockRequirementsSchema.parse(encounter.unlockRequirements ?? null);
    if (!requirements) return { unlocked: true, reason: null };
    if (requirements.minCharacterLevel && characterLevel < requirements.minCharacterLevel) {
      return { unlocked: false, reason: `Requires level ${requirements.minCharacterLevel}.` };
    }
    if (requirements.requiresVictoryOverEncounterSlug) {
      const victory = await tx.combat.findFirst({
        where: {
          characterId,
          status: 'VICTORY',
          encounter: { slug: requirements.requiresVictoryOverEncounterSlug },
        },
        include: { encounter: true },
      });
      if (!victory) {
        const required = await tx.encounterDefinition.findUnique({
          where: { slug: requirements.requiresVictoryOverEncounterSlug },
        });
        return {
          unlocked: false,
          reason: `Defeat ${required?.name ?? 'a prior foe'} first.`,
        };
      }
    }
    return { unlocked: true, reason: null };
  }

  /** Victory settlement inside the command transaction. Exactly once. */
  async function settleVictory(
    tx: Tx,
    combat: Combat & { encounter: EncounterDefinition },
    state: EngineState,
    rng: ReturnType<typeof createCombatRng>,
  ): Promise<void> {
    const enemyRows = await tx.combatantState.findMany({
      where: { combatId: combat.id, kind: 'ENEMY' },
    });
    const definitionIds = enemyRows.map((r) => r.enemyDefinitionId!).filter(Boolean);
    const definitions = await tx.enemyDefinition.findMany({ where: { id: { in: definitionIds } } });
    const byId = new Map(definitions.map((d) => [d.id, d]));

    let xp = 0;
    let gold = 0n;
    const rolledDrops: Array<{ itemSlug: string; quantity: number }> = [];
    for (const row of enemyRows) {
      const definition = byId.get(row.enemyDefinitionId!);
      if (!definition) continue;
      const reward = rewardConfigSchema.parse(definition.rewardConfig);
      xp += reward.xp;
      gold += BigInt(rng.nextInt(reward.goldMin, reward.goldMax));
      for (const drop of reward.drops) {
        if (rng.chance(drop.chanceBps)) {
          rolledDrops.push({
            itemSlug: drop.itemSlug,
            quantity: rng.nextInt(drop.minQuantity, drop.maxQuantity),
          });
        }
      }
    }

    // Write back surviving HP/MP first; a level-up below may fully restore.
    const playerState = state.combatants.find((c) => c.kind === 'PLAYER')!;
    await tx.character.update({
      where: { id: combat.characterId },
      data: { currentHp: Math.max(1, playerState.hp), currentMp: playerState.mp },
    });
    const progression = await characterService.addExperience(tx, combat.characterId, xp);

    if (gold > 0n) {
      await currencyService.credit(tx, {
        characterId: combat.characterId,
        amount: gold,
        type: CURRENCY_TYPES.COMBAT_REWARD,
        operationNamespace: 'combat-victory',
        idempotencyKey: combat.id,
        relatedType: 'Combat',
        relatedId: combat.id,
      });
    }

    // Drops are granted where they fit; anything that cannot fit is recorded
    // as left behind (never duplicated, never blocking the victory).
    const granted: Array<{ name: string; quantity: number }> = [];
    const leftBehind: Array<{ name: string; quantity: number }> = [];
    for (const drop of rolledDrops) {
      const definition = await tx.itemDefinition.findUnique({ where: { slug: drop.itemSlug } });
      if (!definition || !definition.stackable) continue;
      const existing = await tx.inventoryStack.findUnique({
        where: {
          characterId_itemDefinitionId: {
            characterId: combat.characterId,
            itemDefinitionId: definition.id,
          },
        },
      });
      const stackRoom = existing ? definition.maxStackQuantity - existing.quantity : 0;
      let fits = 0;
      if (existing) {
        fits = Math.min(drop.quantity, Math.max(0, stackRoom));
      } else {
        const usage = await inventoryService.countUsedSlots(tx, combat.characterId);
        if (usage.used < gameConfig.inventoryCapacity) {
          fits = Math.min(drop.quantity, definition.maxStackQuantity);
        }
      }
      if (fits > 0) {
        await inventoryService.addToStack(tx, {
          characterId: combat.characterId,
          itemDefinitionId: definition.id,
          quantity: fits,
          reason: COMBAT_TRANSFER_REASON,
        });
        granted.push({ name: definition.name, quantity: fits });
      }
      if (fits < drop.quantity) {
        leftBehind.push({ name: definition.name, quantity: drop.quantity - fits });
      }
    }

    // The exactly-once marker (unique combatId) in the same transaction.
    await tx.combatRewardGrant.create({
      data: {
        combatId: combat.id,
        characterId: combat.characterId,
        xp,
        gold,
        drops: { granted, leftBehind, leveledUp: progression.leveledUp, level: progression.level },
      },
    });

    // Typed domain event in the same transaction as the victory settlement.
    await questEvents.handle(tx, combat.characterId, {
      type: 'COMBAT_VICTORY',
      encounterSlug: combat.encounter.slug,
      defeatedEnemySlugs: enemyRows
        .map((row) => byId.get(row.enemyDefinitionId!)?.slug)
        .filter((slug): slug is string => Boolean(slug)),
    });

    state.log.push(`You gain ${xp} XP and ${gold} Gold.`);
    for (const drop of granted) state.log.push(`Spoils: ${drop.name} ×${drop.quantity}.`);
    for (const drop of leftBehind) {
      state.log.push(`Your pack is full — ${drop.name} ×${drop.quantity} is left behind.`);
    }
    if (progression.leveledUp) state.log.push(`Level up! You are now level ${progression.level}.`);
  }

  /** Defeat settlement: return home, partial restore, capped recovery fee. */
  async function settleDefeat(
    tx: Tx,
    combat: Combat & { encounter: EncounterDefinition },
    state: EngineState,
  ): Promise<void> {
    const character = await tx.character.findUniqueOrThrow({
      where: { id: combat.characterId },
      include: { class: true },
    });
    const derived = computeDerivedStats(character.class, character.level);
    const restoredHp = Math.ceil((derived.maxHp * combatConfig.defeatRestoreBps) / 10_000);
    const restoredMp = Math.ceil((derived.maxMp * combatConfig.defeatRestoreBps) / 10_000);
    const home = await tx.location.findUnique({ where: { slug: 'crownfall-city' } });
    await tx.character.update({
      where: { id: combat.characterId },
      data: {
        currentHp: restoredHp,
        currentMp: restoredMp,
        ...(home ? { currentLocationId: home.id } : {}),
      },
    });

    const account = await tx.currencyAccount.findUnique({
      where: { characterId: combat.characterId },
    });
    const balance = account?.balance ?? 0n;
    const uncappedFee =
      combatConfig.defeatFeeBase + combatConfig.defeatFeePerLevel * BigInt(character.level);
    const cappedFee =
      uncappedFee > combatConfig.defeatFeeCap ? combatConfig.defeatFeeCap : uncappedFee;
    const fee = cappedFee > balance ? balance : cappedFee;
    if (fee > 0n) {
      await currencyService.debit(tx, {
        characterId: combat.characterId,
        amount: fee,
        type: CURRENCY_TYPES.COMBAT_RECOVERY,
        operationNamespace: 'combat-defeat',
        idempotencyKey: combat.id,
        relatedType: 'Combat',
        relatedId: combat.id,
      });
    }
    state.log.push(
      `Kind hands carry you back to Crownfall City. You wake with ${restoredHp} HP` +
        (fee > 0n ? ` — the healers take ${fee} Gold for their trouble.` : '.'),
    );
  }

  return {
    async getEncounters(userId) {
      const character = await characterService.requireCharacter(userId);
      const active = await prisma.combat.findFirst({
        where: { characterId: character.id, status: 'ACTIVE' },
        select: { id: true },
      });
      const locationId = await locationService.requireCurrentLocationId(userId);
      const encounters = await prisma.encounterDefinition.findMany({
        where: { locationId },
        orderBy: { sortOrder: 'asc' },
      });
      const enemySlugs = new Set<string>();
      for (const encounter of encounters) {
        for (const member of compositionSchema.parse(encounter.composition)) {
          enemySlugs.add(member.enemySlug);
        }
      }
      const enemies = await prisma.enemyDefinition.findMany({
        where: { slug: { in: [...enemySlugs] } },
      });
      const nameBySlug = new Map(enemies.map((e) => [e.slug, e.name]));

      return {
        encounters: await Promise.all(
          encounters.map(async (encounter) => {
            const composition = compositionSchema.parse(encounter.composition);
            const counts = new Map<string, number>();
            for (const member of composition) {
              counts.set(member.enemySlug, (counts.get(member.enemySlug) ?? 0) + 1);
            }
            const lock = await isEncounterUnlocked(
              prisma,
              character.id,
              character.level,
              encounter,
            );
            return {
              slug: encounter.slug,
              name: encounter.name,
              description: encounter.description,
              kind: encounter.kind,
              fleeable: encounter.fleeable,
              enemies: [...counts.entries()].map(([slug, count]) => ({
                name: nameBySlug.get(slug) ?? slug,
                count,
              })),
              unlocked: lock.unlocked,
              lockedReason: lock.reason,
            };
          }),
        ),
        activeCombatId: active?.id ?? null,
      };
    },

    async start(userId, input) {
      const character = await characterService.requireCharacter(userId);

      // Stale replay: the same idempotency key returns the original combat.
      const existingByKey = await prisma.combat.findUnique({
        where: {
          characterId_idempotencyKey: {
            characterId: character.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: { encounter: true },
      });
      if (existingByKey) {
        metrics.increment('idempotency_replay');
        return buildView(prisma, existingByKey, character.classSlug);
      }

      const active = await prisma.combat.findFirst({
        where: { characterId: character.id, status: 'ACTIVE' },
      });
      if (active) {
        throw conflict('COMBAT_ACTIVE', 'You are already locked in battle.');
      }

      // A character cannot fight while a timed gathering run is still underway.
      const gathering = await prisma.gatheringRun.findFirst({
        where: {
          characterId: character.id,
          status: 'IN_PROGRESS',
          completesAt: { gt: new Date() },
        },
      });
      if (gathering) {
        throw conflict('BUSY_GATHERING', 'You are busy gathering — finish that first.');
      }

      const encounter = await prisma.encounterDefinition.findUnique({
        where: { slug: input.encounterSlug },
      });
      if (!encounter) throw new DomainError(404, 'UNKNOWN_ENCOUNTER', 'No such encounter exists.');

      const locationId = await locationService.requireCurrentLocationId(userId);
      if (encounter.locationId !== locationId) {
        throw conflict('NOT_HERE', 'That foe prowls elsewhere.');
      }

      const lock = await isEncounterUnlocked(prisma, character.id, character.level, encounter);
      if (!lock.unlocked) {
        throw new DomainError(403, 'ENCOUNTER_LOCKED', lock.reason ?? 'You are not ready.');
      }

      const composition = compositionSchema.parse(encounter.composition);
      const enemyDefinitions = await prisma.enemyDefinition.findMany({
        where: { slug: { in: composition.map((m) => m.enemySlug) } },
      });
      const bySlug = new Map(enemyDefinitions.map((d) => [d.slug, d]));

      const equipment = await prisma.equipmentAssignment.findMany({
        where: { characterId: character.id },
        include: { itemInstance: { include: { itemDefinition: true } } },
      });
      const derived = computeDerivedStats(
        character.class,
        character.level,
        equipment.map((a) => a.itemInstance.itemDefinition),
      );

      try {
        const combat = await prisma.$transaction(async (tx) => {
          // Snapshot the equipped loadout + talents at battle start (Phase 23),
          // so a later respec or content publish never alters this combat. The
          // player's stats bake in the chosen talents here.
          const build = buildService
            ? await buildService.snapshotFor(tx, character.id, character.classSlug, character.level)
            : { loadout: [], talents: [] };
          const playerStats = buildService
            ? buildService.applyTalents(derived, character.classSlug, build.talents)
            : derived;

          const created = await tx.combat.create({
            data: {
              characterId: character.id,
              encounterId: encounter.id,
              rngSeed: newCombatSeed(),
              log: [`${encounter.name} — battle is joined!`],
              idempotencyKey: input.idempotencyKey,
              buildSnapshot: { loadout: build.loadout, talents: build.talents, cooldowns: {} },
            },
            include: { encounter: true },
          });

          await tx.combatantState.create({
            data: {
              combatId: created.id,
              kind: 'PLAYER',
              slot: 0,
              name: character.name,
              row: 'FRONT',
              ranged: false,
              currentHp: Math.max(1, Math.min(character.currentHp, playerStats.maxHp)),
              currentMp: Math.min(character.currentMp, playerStats.maxMp),
              maxHp: playerStats.maxHp,
              maxMp: playerStats.maxMp,
              strength: playerStats.strength,
              agility: playerStats.agility,
              magic: playerStats.magic,
              defense: playerStats.defense,
              magicDefense: playerStats.magicDefense,
              luck: playerStats.luck,
              affinities: {},
            },
          });

          const dupCounts = new Map<string, number>();
          for (const member of composition) dupCounts.set(member.enemySlug, 0);
          let slot = 1;
          for (const member of composition) {
            const definition = bySlug.get(member.enemySlug);
            if (!definition) throw new Error(`combat: unknown enemy ${member.enemySlug}`);
            const total = composition.filter((m) => m.enemySlug === member.enemySlug).length;
            const seen = dupCounts.get(member.enemySlug)!;
            dupCounts.set(member.enemySlug, seen + 1);
            const suffix = total > 1 ? ` ${String.fromCharCode(65 + seen)}` : '';
            await tx.combatantState.create({
              data: {
                combatId: created.id,
                kind: 'ENEMY',
                slot,
                name: `${definition.name}${suffix}`,
                enemyDefinitionId: definition.id,
                row: member.row,
                ranged: definition.ranged,
                currentHp: definition.maxHp,
                currentMp: definition.maxMp,
                maxHp: definition.maxHp,
                maxMp: definition.maxMp,
                strength: definition.strength,
                agility: definition.agility,
                magic: definition.magic,
                defense: definition.defense,
                magicDefense: definition.magicDefense,
                luck: definition.luck,
                affinities: definition.affinities as Prisma.InputJsonValue,
              },
            });
            slot += 1;
          }

          // Fast foes may act before the first command: advance to the
          // player's first command phase (or an immediate outcome).
          const { state } = await loadEngineState(tx, created);
          const rng = createCombatRng(created.rngSeed, created.rngCounter);
          runUntilPlayerCommand(state, rng);
          await persistEngineState(tx, created.id, state);
          if (state.outcome === 'DEFEAT') {
            await settleDefeat(tx, created, state);
          }
          const updated = await tx.combat.update({
            where: { id: created.id },
            data: {
              rngCounter: rng.counter,
              log: state.log,
              status: state.outcome === 'ACTIVE' ? 'ACTIVE' : state.outcome,
              ...(state.outcome !== 'ACTIVE' ? { completedAt: new Date() } : {}),
            },
            include: { encounter: true },
          });
          return updated;
        });
        return await buildView(prisma, combat, character.classSlug);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          metrics.increment('concurrency_conflict');
          const replay = await prisma.combat.findUnique({
            where: {
              characterId_idempotencyKey: {
                characterId: character.id,
                idempotencyKey: input.idempotencyKey,
              },
            },
            include: { encounter: true },
          });
          if (replay) return buildView(prisma, replay, character.classSlug);
          throw conflict('COMBAT_ACTIVE', 'You are already locked in battle.');
        }
        throw error;
      }
    },

    async getCombat(userId, combatId) {
      const character = await characterService.requireCharacter(userId);
      const combat = await prisma.combat.findUnique({
        where: { id: combatId },
        include: { encounter: true },
      });
      if (!combat || combat.characterId !== character.id) {
        throw new DomainError(404, 'UNKNOWN_COMBAT', 'No such battle.');
      }
      return buildView(prisma, combat, character.classSlug);
    },

    async command(userId, combatId, input) {
      const character = await characterService.requireCharacter(userId);

      return prisma.$transaction(async (tx) => {
        // Lock the combat row: commands for one combat fully serialize.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Combat" WHERE "id" = ${combatId} FOR UPDATE`;
        if (locked.length === 0) throw new DomainError(404, 'UNKNOWN_COMBAT', 'No such battle.');
        const combat = await tx.combat.findUniqueOrThrow({
          where: { id: combatId },
          include: { encounter: true },
        });
        if (combat.characterId !== character.id) {
          throw new DomainError(404, 'UNKNOWN_COMBAT', 'No such battle.');
        }
        if (combat.status !== 'ACTIVE') {
          throw conflict('COMBAT_OVER', 'This battle is already decided.');
        }
        // Optimistic concurrency: a stale or replayed command never resolves.
        if (input.expectedVersion !== combat.version) {
          metrics.increment('combat_command_conflict');
          throw conflict('STALE_COMBAT_VERSION', 'The battle has moved on — refresh and retry.');
        }

        const { state } = await loadEngineState(tx, combat);
        const rng = createCombatRng(combat.rngSeed, combat.rngCounter);
        const snapshot = readBuildSnapshot(combat.buildSnapshot);
        let usedAbility: { slug: string; cooldownTurns: number } | null = null;

        // Build the engine command, validating inputs that touch the world.
        let engineCommand: PlayerCommand;
        switch (input.action) {
          case 'ATTACK': {
            if (!input.targetCombatantId) {
              throw new DomainError(400, 'TARGET_REQUIRED', 'Choose a target.');
            }
            engineCommand = { action: 'ATTACK', targetId: input.targetCombatantId };
            break;
          }
          case 'ABILITY':
          case 'MAGIC': {
            if (!input.abilitySlug) {
              throw new DomainError(400, 'ABILITY_REQUIRED', 'Choose an ability.');
            }
            const ability = findAbility(character.classSlug, input.abilitySlug);
            if (!ability) {
              throw new DomainError(400, 'UNKNOWN_ABILITY', 'You do not know that technique.');
            }
            // Only the snapshotted loadout is usable, and not while on cooldown
            // (Phase 23). Legacy combats (empty loadout) accept the full book.
            if (snapshot.loadout.length > 0 && !snapshot.loadout.includes(ability.slug)) {
              throw new DomainError(
                400,
                'ABILITY_NOT_EQUIPPED',
                'That ability is not in your loadout.',
              );
            }
            if ((snapshot.cooldowns[ability.slug] ?? 0) > 0) {
              throw conflict('ABILITY_ON_COOLDOWN', 'That ability is still on cooldown.');
            }
            if (ability.cooldownTurns > 0) {
              usedAbility = { slug: ability.slug, cooldownTurns: ability.cooldownTurns };
            }
            const isMagic = ability.kind === 'MAGICAL';
            if ((input.action === 'MAGIC') !== isMagic) {
              throw new DomainError(
                400,
                'WRONG_COMMAND',
                'That technique belongs to another command.',
              );
            }
            engineCommand = {
              action: input.action,
              ability,
              ...(input.targetCombatantId ? { targetId: input.targetCombatantId } : {}),
            };
            break;
          }
          case 'ITEM': {
            if (!input.itemSlug) throw new DomainError(400, 'ITEM_REQUIRED', 'Choose an item.');
            const definition = await tx.itemDefinition.findUnique({
              where: { slug: input.itemSlug },
            });
            if (!definition || !definition.usableInCombat) {
              throw new DomainError(400, 'ITEM_NOT_USABLE', 'That cannot be used in battle.');
            }
            // Ownership validated and decremented in this same transaction;
            // any later failure rolls the consumption back with everything else.
            await inventoryService.removeFromStack(tx, {
              characterId: character.id,
              itemDefinitionId: definition.id,
              quantity: 1,
              reason: 'COMBAT_ITEM_USE',
            });
            engineCommand = {
              action: 'ITEM',
              itemName: definition.name,
              hpRestore: definition.hpRestore,
              mpRestore: definition.mpRestore,
            };
            break;
          }
          case 'DEFEND':
            engineCommand = { action: 'DEFEND' };
            break;
          case 'FLEE':
            engineCommand = { action: 'FLEE' };
            break;
        }

        try {
          resolvePlayerCommand(state, rng, engineCommand);
        } catch (error) {
          if (error instanceof EngineRuleError) {
            throw new DomainError(400, error.code, error.message);
          }
          throw error;
        }
        if (state.outcome === 'ACTIVE') {
          runUntilPlayerCommand(state, rng);
        }

        await persistEngineState(tx, combat.id, state);

        if (state.outcome === 'VICTORY') {
          await settleVictory(tx, combat, state, rng);
        } else if (state.outcome === 'DEFEAT') {
          await settleDefeat(tx, combat, state);
        } else if (state.outcome === 'FLED') {
          const playerState = state.combatants.find((c) => c.kind === 'PLAYER')!;
          await tx.character.update({
            where: { id: character.id },
            data: { currentHp: Math.max(1, playerState.hp), currentMp: playerState.mp },
          });
        }

        // Advance cooldowns one turn: every counter ticks down, then the ability
        // used this turn is put on its full cooldown (Phase 23).
        const nextCooldowns: Record<string, number> = {};
        for (const [slug, turns] of Object.entries(snapshot.cooldowns)) {
          if (turns - 1 > 0) nextCooldowns[slug] = turns - 1;
        }
        if (usedAbility) nextCooldowns[usedAbility.slug] = usedAbility.cooldownTurns;

        const updated = await tx.combat.update({
          where: { id: combat.id },
          data: {
            version: combat.version + 1,
            rngCounter: rng.counter,
            fleeAttempts: state.fleeAttempts,
            log: state.log,
            status: state.outcome === 'ACTIVE' ? 'ACTIVE' : state.outcome,
            buildSnapshot: { ...snapshot, cooldowns: nextCooldowns },
            ...(state.outcome !== 'ACTIVE' ? { completedAt: new Date() } : {}),
          },
          include: { encounter: true },
        });
        return buildView(tx, updated, character.classSlug);
      });
    },
  };
}
