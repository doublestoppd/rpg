import type { Character, CharacterClassDefinition, Prisma, PrismaClient } from '@prisma/client';
import type { CharacterClassInfo, CharacterResponse, CharacterStatsResponse } from '@rpg/shared';

import { gameConfig } from '../../config/game.js';
import { conflict, DomainError } from '../../lib/http-errors.js';
import {
  computeDerivedStats,
  effectiveStamina,
  levelForXp,
  xpForNextLevel,
} from './progression.js';

type Tx = Prisma.TransactionClient | PrismaClient;

export const noCharacter = () =>
  new DomainError(404, 'NO_CHARACTER', 'You have not created a character yet.');

export interface CharacterService {
  createCharacter(
    userId: string,
    input: { name: string; classSlug: string },
  ): Promise<CharacterResponse>;
  getCharacterResponse(userId: string): Promise<CharacterResponse>;
  getStatsResponse(userId: string): Promise<CharacterStatsResponse>;
  /** Loads the character row for a user or throws NO_CHARACTER. */
  requireCharacter(
    userId: string,
    tx?: Tx,
  ): Promise<Character & { class: CharacterClassDefinition }>;
  /**
   * Grants XP inside the caller's transaction. Applies multi-level gains from
   * the seeded progression table, caps at the highest seeded level, and fully
   * restores HP/MP on level-up.
   */
  addExperience(
    tx: Tx,
    characterId: string,
    amount: number,
  ): Promise<{ level: number; leveledUp: boolean; xp: number }>;
  /**
   * Spends stamina atomically: lazily regenerates by timestamp, verifies the
   * cost, and persists the new stored value + timestamp. Throws on shortfall.
   */
  spendStamina(tx: Tx, characterId: string, cost: number): Promise<number>;
  listClasses(): Promise<CharacterClassInfo[]>;
}

export function createCharacterService(prisma: PrismaClient): CharacterService {
  async function loadCharacter(userId: string, tx: Tx = prisma) {
    const character = await tx.character.findUnique({
      where: { userId },
      include: { class: true },
    });
    if (!character) throw noCharacter();
    return character;
  }

  async function toResponse(
    character: Character & { class: CharacterClassDefinition },
  ): Promise<CharacterResponse> {
    const progression = await prisma.levelProgression.findMany({ orderBy: { level: 'asc' } });
    const derived = computeDerivedStats(character.class, character.level);
    const stamina = effectiveStamina({
      stored: character.stamina,
      storedAt: character.staminaUpdatedAt,
      now: new Date(),
      maxStamina: derived.maxStamina,
      regenPerInterval: gameConfig.staminaRegenPerInterval,
      intervalMs: gameConfig.staminaRegenIntervalMs,
    });
    return {
      id: character.id,
      name: character.name,
      class: {
        slug: character.class.slug as CharacterResponse['class']['slug'],
        name: character.class.name,
        description: character.class.description,
      },
      level: character.level,
      xp: character.xp,
      xpForNextLevel: xpForNextLevel(progression, character.level),
      gold: character.gold.toString(),
      resources: {
        hp: character.currentHp,
        maxHp: derived.maxHp,
        mp: character.currentMp,
        maxMp: derived.maxMp,
        stamina,
        maxStamina: derived.maxStamina,
      },
      createdAt: character.createdAt.toISOString(),
    };
  }

  return {
    async createCharacter(userId, input) {
      const classDef = await prisma.characterClassDefinition.findUnique({
        where: { slug: input.classSlug },
      });
      if (!classDef) throw conflict('UNKNOWN_CLASS', 'That class does not exist.');

      const existing = await prisma.character.findUnique({ where: { userId } });
      if (existing) throw conflict('CHARACTER_EXISTS', 'You already have a character.');
      const nameTaken = await prisma.character.findUnique({ where: { name: input.name } });
      if (nameTaken) throw conflict('NAME_TAKEN', 'That character name is taken.');

      try {
        const character = await prisma.character.create({
          data: {
            userId,
            name: input.name,
            classSlug: classDef.slug,
            gold: gameConfig.startingGold,
            currentHp: classDef.baseHp,
            currentMp: classDef.baseMp,
            stamina: classDef.baseStamina,
          },
          include: { class: true },
        });
        return await toResponse(character);
      } catch (error) {
        // Unique-constraint race (concurrent create): surface as conflict.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          throw conflict('CHARACTER_EXISTS', 'You already have a character.');
        }
        throw error;
      }
    },

    async getCharacterResponse(userId) {
      return toResponse(await loadCharacter(userId));
    },

    async getStatsResponse(userId) {
      const character = await loadCharacter(userId);
      const derived = computeDerivedStats(character.class, character.level);
      const stamina = effectiveStamina({
        stored: character.stamina,
        storedAt: character.staminaUpdatedAt,
        now: new Date(),
        maxStamina: derived.maxStamina,
        regenPerInterval: gameConfig.staminaRegenPerInterval,
        intervalMs: gameConfig.staminaRegenIntervalMs,
      });
      return {
        level: character.level,
        attributes: {
          strength: derived.strength,
          agility: derived.agility,
          magic: derived.magic,
          defense: derived.defense,
          magicDefense: derived.magicDefense,
          luck: derived.luck,
        },
        resources: {
          hp: character.currentHp,
          maxHp: derived.maxHp,
          mp: character.currentMp,
          maxMp: derived.maxMp,
          stamina,
          maxStamina: derived.maxStamina,
        },
      };
    },

    requireCharacter: (userId, tx) => loadCharacter(userId, tx),

    async addExperience(tx, characterId, amount) {
      if (!Number.isInteger(amount) || amount < 0) {
        throw new DomainError(400, 'INVALID_XP', 'XP amount must be a non-negative integer.');
      }
      const character = await tx.character.findUniqueOrThrow({
        where: { id: characterId },
        include: { class: true },
      });
      const progression = await tx.levelProgression.findMany({ orderBy: { level: 'asc' } });

      const newXp = character.xp + amount;
      const newLevel = levelForXp(progression, newXp);
      const leveledUp = newLevel > character.level;

      const data: Prisma.CharacterUpdateInput = { xp: newXp };
      if (leveledUp) {
        // Data-driven growth is derived from class + level; level-up persists
        // the new level and fully restores HP and MP.
        const derived = computeDerivedStats(character.class, newLevel);
        data.level = newLevel;
        data.currentHp = derived.maxHp;
        data.currentMp = derived.maxMp;
      }
      await tx.character.update({ where: { id: characterId }, data });
      return { level: leveledUp ? newLevel : character.level, leveledUp, xp: newXp };
    },

    async spendStamina(tx, characterId, cost) {
      if (!Number.isInteger(cost) || cost <= 0) {
        throw new DomainError(400, 'INVALID_COST', 'Stamina cost must be a positive integer.');
      }
      const character = await tx.character.findUniqueOrThrow({
        where: { id: characterId },
        include: { class: true },
      });
      const derived = computeDerivedStats(character.class, character.level);
      const now = new Date();
      const available = effectiveStamina({
        stored: character.stamina,
        storedAt: character.staminaUpdatedAt,
        now,
        maxStamina: derived.maxStamina,
        regenPerInterval: gameConfig.staminaRegenPerInterval,
        intervalMs: gameConfig.staminaRegenIntervalMs,
      });
      if (available < cost) {
        throw new DomainError(400, 'INSUFFICIENT_STAMINA', 'Not enough stamina.');
      }
      const remaining = available - cost;
      await tx.character.update({
        where: { id: characterId },
        data: { stamina: remaining, staminaUpdatedAt: now },
      });
      return remaining;
    },

    async listClasses() {
      const classes = await prisma.characterClassDefinition.findMany({ orderBy: { slug: 'asc' } });
      return classes.map((c) => ({
        slug: c.slug as CharacterClassInfo['slug'],
        name: c.name,
        description: c.description,
      }));
    },
  };
}
