import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  BuildTalentTier,
  CharacterBuildResponse,
  ChooseTalentRequest,
  SetLoadoutRequest,
} from '@rpg/shared';
import { z } from 'zod';

import {
  abilitiesForClass,
  applyTalentModifiers,
  CLASS_TALENTS,
  defaultLoadout,
  findAbility,
  findTalent,
  LOADOUT_CAPACITY,
  type StatModifier,
  TALENT_TIER_LEVELS,
  talentsForClass,
} from '../../config/combat.js';
import { DomainError } from '../../lib/http-errors.js';
import { CURRENCY_TYPES, type CurrencyService } from '../currency/currency-service.js';
import type { CharacterService } from './character-service.js';

const RESPEC_FEE_BASE = 100n;
const RESPEC_FEE_PER_LEVEL = 15n;
const respecFee = (level: number): bigint => RESPEC_FEE_BASE + BigInt(level) * RESPEC_FEE_PER_LEVEL;

const slugListSchema = z.array(z.string());

/** The equipped loadout + chosen talents used by combat at start. */
export interface BuildSnapshotInput {
  loadout: string[];
  talents: string[];
}

const MOD_LABELS: Record<keyof StatModifier, string> = {
  maxHpBps: 'Max HP',
  maxMpBps: 'Max MP',
  strengthBps: 'Strength',
  agilityBps: 'Agility',
  magicBps: 'Magic',
  defenseBps: 'Defense',
  magicDefenseBps: 'Magic Defense',
  luckBps: 'Luck',
};

function talentEffect(modifiers: StatModifier): string {
  const parts: string[] = [];
  for (const key of Object.keys(MOD_LABELS) as Array<keyof StatModifier>) {
    const bps = modifiers[key];
    if (bps) parts.push(`+${bps / 100}% ${MOD_LABELS[key]}`);
  }
  return parts.join(', ');
}

export interface BuildService {
  getBuild(userId: string): Promise<CharacterBuildResponse>;
  setLoadout(userId: string, input: SetLoadoutRequest): Promise<CharacterBuildResponse>;
  chooseTalent(userId: string, input: ChooseTalentRequest): Promise<CharacterBuildResponse>;
  respec(userId: string, idempotencyKey: string): Promise<CharacterBuildResponse>;
  /** The equipped loadout + talents for combat's start-of-battle snapshot. */
  snapshotFor(
    tx: Prisma.TransactionClient,
    characterId: string,
    classSlug: string,
    level: number,
  ): Promise<BuildSnapshotInput>;
  /** Applies a snapshot's talents to a derived stat block (Phase 23). */
  applyTalents: typeof applyTalentModifiers;
}

export function createBuildService(
  prisma: PrismaClient,
  characterService: CharacterService,
  currencyService: CurrencyService,
): BuildService {
  /** Reads the build, creating class defaults on first access. */
  async function ensureBuild(
    tx: Prisma.TransactionClient | PrismaClient,
    characterId: string,
    classSlug: string,
    level: number,
  ): Promise<{ loadout: string[]; talents: string[]; configVersion: number }> {
    const existing = await tx.characterBuild.findUnique({ where: { characterId } });
    if (existing) {
      return {
        loadout: slugListSchema.parse(existing.loadout),
        talents: slugListSchema.parse(existing.talents),
        configVersion: existing.configVersion,
      };
    }
    const loadout = defaultLoadout(classSlug, level);
    const created = await tx.characterBuild.create({
      data: { characterId, loadout, talents: [] },
    });
    return { loadout, talents: [], configVersion: created.configVersion };
  }

  function toResponse(
    classSlug: string,
    level: number,
    loadout: string[],
    talents: string[],
    configVersion: number,
  ): CharacterBuildResponse {
    const abilities = abilitiesForClass(classSlug).map((a) => ({
      slug: a.slug,
      name: a.name,
      description: a.description,
      kind: a.kind,
      mpCost: a.mpCost,
      element: a.element ?? null,
      targeting: a.targeting,
      unlockLevel: a.unlockLevel,
      cooldownTurns: a.cooldownTurns,
      unlocked: level >= a.unlockLevel,
      equipped: loadout.includes(a.slug),
    }));
    const tiers: BuildTalentTier[] = [1, 2, 3].map((tier) => {
      const unlockLevel = TALENT_TIER_LEVELS[tier]!;
      const options = talentsForClass(classSlug)
        .filter((t) => t.tier === tier)
        .map((t) => ({
          slug: t.slug,
          name: t.name,
          description: t.description,
          effect: talentEffect(t.modifiers),
          chosen: talents.includes(t.slug),
        }));
      const chosen = options.find((o) => o.chosen);
      return {
        tier,
        unlockLevel,
        unlocked: level >= unlockLevel,
        chosenSlug: chosen?.slug ?? null,
        options,
      };
    });
    return {
      classSlug,
      level,
      loadoutCapacity: LOADOUT_CAPACITY,
      configVersion,
      respecFeeGold: respecFee(level).toString(),
      abilities,
      talents: tiers,
    };
  }

  return {
    async getBuild(userId) {
      const character = await characterService.requireCharacter(userId);
      const build = await ensureBuild(prisma, character.id, character.classSlug, character.level);
      return toResponse(
        character.classSlug,
        character.level,
        build.loadout,
        build.talents,
        build.configVersion,
      );
    },

    async setLoadout(userId, input) {
      const character = await characterService.requireCharacter(userId);
      const slugs = [...new Set(input.abilitySlugs)];
      if (slugs.length !== input.abilitySlugs.length) {
        throw new DomainError(422, 'DUPLICATE_ABILITY', 'An ability can be equipped only once.');
      }
      if (slugs.length > LOADOUT_CAPACITY) {
        throw new DomainError(
          422,
          'LOADOUT_FULL',
          `You can equip at most ${LOADOUT_CAPACITY} abilities.`,
        );
      }
      for (const slug of slugs) {
        const ability = findAbility(character.classSlug, slug);
        if (!ability) throw new DomainError(422, 'UNKNOWN_ABILITY', `Unknown ability "${slug}".`);
        if (character.level < ability.unlockLevel) {
          throw new DomainError(
            422,
            'ABILITY_LOCKED',
            `${ability.name} unlocks at level ${ability.unlockLevel}.`,
          );
        }
      }
      const updated = await prisma.$transaction(async (tx) => {
        await ensureBuild(tx, character.id, character.classSlug, character.level);
        return tx.characterBuild.update({
          where: { characterId: character.id },
          data: { loadout: slugs, configVersion: { increment: 1 } },
        });
      });
      return toResponse(
        character.classSlug,
        character.level,
        slugs,
        slugListSchema.parse(updated.talents),
        updated.configVersion,
      );
    },

    async chooseTalent(userId, input) {
      const character = await characterService.requireCharacter(userId);
      const unlockLevel = TALENT_TIER_LEVELS[input.tier]!;
      if (character.level < unlockLevel) {
        throw new DomainError(
          422,
          'TIER_LOCKED',
          `Talent tier ${input.tier} unlocks at level ${unlockLevel}.`,
        );
      }
      if (input.talentSlug !== null) {
        const talent = findTalent(character.classSlug, input.talentSlug);
        if (!talent) throw new DomainError(422, 'UNKNOWN_TALENT', 'Unknown talent.');
        if (talent.tier !== input.tier) {
          throw new DomainError(422, 'WRONG_TIER', 'That talent belongs to another tier.');
        }
      }
      const updated = await prisma.$transaction(async (tx) => {
        const build = await ensureBuild(tx, character.id, character.classSlug, character.level);
        // One talent per tier: drop any current pick in this tier, add the new.
        const tierSlugs = new Set(
          CLASS_TALENTS.filter((t) => t.tier === input.tier).map((t) => t.slug),
        );
        const kept = build.talents.filter((s) => !tierSlugs.has(s));
        const next = input.talentSlug ? [...kept, input.talentSlug] : kept;
        return tx.characterBuild.update({
          where: { characterId: character.id },
          data: { talents: next, configVersion: { increment: 1 } },
        });
      });
      return toResponse(
        character.classSlug,
        character.level,
        slugListSchema.parse(updated.loadout),
        slugListSchema.parse(updated.talents),
        updated.configVersion,
      );
    },

    async respec(userId, idempotencyKey) {
      const character = await characterService.requireCharacter(userId);
      const fee = respecFee(character.level);
      const build = await prisma.$transaction(async (tx) => {
        await ensureBuild(tx, character.id, character.classSlug, character.level);
        // The ledger entry is the audit trail; idempotency guards double spend.
        const charge = await currencyService.debit(tx, {
          characterId: character.id,
          amount: fee,
          type: CURRENCY_TYPES.RESPEC_FEE,
          operationNamespace: 'respec',
          idempotencyKey,
          relatedType: 'CharacterBuild',
          relatedId: character.id,
        });
        if (!charge.applied) {
          // Idempotent replay: the reset already happened; return as-is.
          return tx.characterBuild.findUniqueOrThrow({ where: { characterId: character.id } });
        }
        // Exact reset: default loadout, no talents. Level/XP are untouched.
        return tx.characterBuild.update({
          where: { characterId: character.id },
          data: {
            loadout: defaultLoadout(character.classSlug, character.level),
            talents: [],
            configVersion: { increment: 1 },
          },
        });
      });
      return toResponse(
        character.classSlug,
        character.level,
        slugListSchema.parse(build.loadout),
        slugListSchema.parse(build.talents),
        build.configVersion,
      );
    },

    async snapshotFor(tx, characterId, classSlug, level) {
      const build = await ensureBuild(tx, characterId, classSlug, level);
      // Only currently-unlocked equipped abilities enter the battle.
      const loadout = build.loadout.filter((slug) => {
        const ability = findAbility(classSlug, slug);
        return ability && level >= ability.unlockLevel;
      });
      const talents = build.talents.filter((slug) => findTalent(classSlug, slug));
      return { loadout, talents };
    },

    applyTalents: applyTalentModifiers,
  };
}
