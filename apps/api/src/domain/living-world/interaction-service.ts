import type { Prisma, PrismaClient } from '@prisma/client';
import {
  type ChooseRequest,
  type DialogueChoice,
  type DialogueCondition,
  dialogueDefinitionPayloadSchema,
  type DialogueEffect,
  type DialogueNode,
  type NpcInteractionResponse,
  type WorldTimeSegment,
} from '@rpg/shared';

import { conflict, DomainError } from '../../lib/http-errors.js';
import { metrics } from '../../lib/metrics.js';
import type { CharacterService } from '../character/character-service.js';
import { CURRENCY_TYPES, type CurrencyService } from '../currency/currency-service.js';
import type { InventoryService } from '../inventory/inventory-service.js';
import type { QuestEventSink } from '../quest/quest-events.js';
import type { WorldClockService } from '../world-sim/world-clock.js';
import type { NpcService } from './npc-service.js';

/** Familiarity is bounded so an NPC's memory of a player never runs away. */
export const FAMILIARITY_CAP = 1000;

interface DialogueSnapshot {
  entryNodeId: string;
  nodes: DialogueNode[];
}

interface InteractionDeps {
  characterService: CharacterService;
  inventoryService: InventoryService;
  currencyService: CurrencyService;
  questEvents: QuestEventSink;
  worldClock: WorldClockService;
  npcService: NpcService;
}

function parseSnapshot(value: unknown): DialogueSnapshot {
  const v = (value ?? {}) as { entryNodeId?: unknown; nodes?: unknown };
  return {
    entryNodeId: String(v.entryNodeId),
    nodes: (Array.isArray(v.nodes) ? v.nodes : []) as DialogueNode[],
  };
}

export interface InteractionService {
  start(userId: string, npcKey: string, idempotencyKey: string): Promise<NpcInteractionResponse>;
  get(userId: string, interactionId: string): Promise<NpcInteractionResponse>;
  choose(
    userId: string,
    interactionId: string,
    input: ChooseRequest,
  ): Promise<NpcInteractionResponse>;
  close(userId: string, interactionId: string): Promise<NpcInteractionResponse>;
}

export function createInteractionService(
  prisma: PrismaClient,
  deps: InteractionDeps,
): InteractionService {
  const {
    characterService,
    inventoryService,
    currencyService,
    questEvents,
    worldClock,
    npcService,
  } = deps;

  async function view(interactionId: string, npcName: string): Promise<NpcInteractionResponse> {
    const interaction = await prisma.npcInteraction.findUniqueOrThrow({
      where: { id: interactionId },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });
    const snapshot = parseSnapshot(interaction.dialogueSnapshot);
    const node = snapshot.nodes.find((n) => n.id === interaction.currentNodeId);

    // History: each resolved step's NPC line + the player's chosen label.
    const history: NpcInteractionResponse['history'] = [];
    for (const step of interaction.steps) {
      const from = snapshot.nodes.find((n) => n.id === step.fromNodeId);
      if (from) history.push({ speaker: from.speaker, text: from.text, choiceLabel: null });
      const choice = from?.choices.find((c) => c.id === step.choiceId);
      if (choice)
        history.push({ speaker: 'PLAYER', text: choice.label, choiceLabel: choice.label });
    }

    const segment = (await worldClock.currentTime()).segment;
    const choices =
      interaction.status === 'ACTIVE' && node
        ? await filterChoices(prisma, interaction.characterId, node.choices, segment)
        : [];

    return {
      interactionId: interaction.id,
      npcKey: interaction.npcKey,
      npcName,
      dialogueKey: interaction.dialogueKey,
      status: interaction.status as 'ACTIVE' | 'CLOSED',
      version: interaction.version,
      nodeId: interaction.currentNodeId,
      speaker: node?.speaker ?? 'NARRATION',
      text: node?.text ?? '',
      choices: choices.map((c) => ({ id: c.id, label: c.label })),
      history,
    };
  }

  /** Condition evaluation over approved read models only. Exhaustive. */
  async function evaluate(
    tx: Prisma.TransactionClient | PrismaClient,
    characterId: string,
    condition: DialogueCondition,
    segment: WorldTimeSegment,
  ): Promise<boolean> {
    switch (condition.type) {
      case 'WORLD_SEGMENT':
        return segment === condition.segment;
      case 'LEVEL_AT_LEAST': {
        const c = await tx.character.findUniqueOrThrow({ where: { id: characterId } });
        return c.level >= condition.minLevel;
      }
      case 'CLASS_IS': {
        const c = await tx.character.findUniqueOrThrow({ where: { id: characterId } });
        return c.classSlug === condition.classSlug;
      }
      case 'QUEST_STATUS': {
        const statuses =
          condition.status === 'ACTIVE'
            ? (['ACCEPTED', 'ACTIVE'] as const)
            : (['COMPLETED_UNCLAIMED', 'CLAIMED'] as const);
        const row = await tx.characterQuest.findFirst({
          where: {
            characterId,
            quest: { slug: condition.questSlug },
            status: { in: [...statuses] },
          },
        });
        return row !== null;
      }
      case 'HAS_ITEM': {
        const stack = await tx.inventoryStack.findFirst({
          where: { characterId, itemDefinition: { slug: condition.itemSlug } },
        });
        return (stack?.quantity ?? 0) >= condition.quantity;
      }
      case 'FLAG_EQUALS': {
        const flag = await tx.characterNpcFlag.findUnique({
          where: { characterId_flagKey: { characterId, flagKey: condition.flagKey } },
        });
        if (flag) return flag.value === condition.value;
        // An unset flag reads as its declared default.
        const def = await tx.narrativeFlagDefinition.findUnique({
          where: { key: condition.flagKey },
        });
        return (def?.defaultValue ?? null) === condition.value;
      }
    }
  }

  async function filterChoices(
    tx: Prisma.TransactionClient | PrismaClient,
    characterId: string,
    choices: DialogueChoice[],
    segment: WorldTimeSegment,
  ): Promise<DialogueChoice[]> {
    const visible: DialogueChoice[] = [];
    for (const choice of choices) {
      let ok = true;
      for (const cond of choice.conditions ?? []) {
        if (!(await evaluate(tx, characterId, cond, segment))) {
          ok = false;
          break;
        }
      }
      if (ok) visible.push(choice);
    }
    return visible;
  }

  /** Applies one typed effect through its owning domain service, inside `tx`. */
  async function applyEffect(
    tx: Prisma.TransactionClient,
    characterId: string,
    npcKey: string,
    interactionId: string,
    stepKey: string,
    effect: DialogueEffect,
  ): Promise<void> {
    switch (effect.type) {
      case 'SET_FLAG': {
        const flag = await tx.narrativeFlagDefinition.findUnique({
          where: { key: effect.flagKey },
        });
        if (!flag || !flag.allowedValues.includes(effect.value)) {
          throw new DomainError(422, 'INVALID_FLAG', 'Dialogue set an undeclared flag value.');
        }
        await tx.characterNpcFlag.upsert({
          where: { characterId_flagKey: { characterId, flagKey: effect.flagKey } },
          create: { characterId, flagKey: effect.flagKey, value: effect.value },
          update: { value: effect.value },
        });
        return;
      }
      case 'INCREMENT_FAMILIARITY': {
        const state = await tx.characterNpcState.findUniqueOrThrow({
          where: { characterId_npcKey: { characterId, npcKey } },
        });
        const next = Math.min(FAMILIARITY_CAP, state.familiarity + effect.amount);
        await tx.characterNpcState.update({
          where: { characterId_npcKey: { characterId, npcKey } },
          data: { familiarity: next },
        });
        return;
      }
      case 'EMIT_QUEST_EVENT':
        await questEvents.handle(tx, characterId, { type: 'NPC_INTERACTION', npcKey });
        return;
      case 'GRANT_GOLD':
        await currencyService.credit(tx, {
          characterId,
          amount: BigInt(effect.amount),
          type: CURRENCY_TYPES.DIALOGUE_REWARD,
          operationNamespace: 'dialogue-reward',
          idempotencyKey: `${interactionId}:${stepKey}`,
          relatedType: 'NpcInteraction',
          relatedId: interactionId,
        });
        return;
      case 'RECORD_ONE_TIME': {
        const flagKey = `once:${effect.key}`;
        await tx.characterNpcFlag.upsert({
          where: { characterId_flagKey: { characterId, flagKey } },
          create: { characterId, flagKey, value: 'true' },
          update: {},
        });
        return;
      }
    }
  }

  return {
    async start(userId, npcKey, idempotencyKey) {
      const character = await characterService.requireCharacter(userId);

      // Idempotent start: a replay returns the same interaction.
      const existing = await prisma.npcInteraction.findUnique({
        where: {
          characterId_startIdempotencyKey: {
            characterId: character.id,
            startIdempotencyKey: idempotencyKey,
          },
        },
      });
      if (existing) {
        const npc = await prisma.npcDefinition.findUnique({ where: { key: existing.npcKey } });
        return view(existing.id, npc?.name ?? existing.npcKey);
      }

      // The NPC must be present at the character's current location + segment
      // (server-authoritative), and must have a published dialogue entry point.
      const detail = await npcService.getNpc(userId, npcKey);
      if (detail.availability !== 'PRESENT') {
        throw conflict('NPC_UNAVAILABLE', 'That NPC is not here right now.');
      }
      const npc = await prisma.npcDefinition.findUniqueOrThrow({ where: { key: npcKey } });
      if (!npc.dialogueKey) {
        throw conflict('NO_DIALOGUE', 'That NPC has nothing to discuss.');
      }
      const dialogue = await prisma.dialogueDefinition.findUnique({
        where: { key: npc.dialogueKey },
      });
      if (!dialogue || dialogue.status !== 'PUBLISHED') {
        throw new DomainError(404, 'UNKNOWN_DIALOGUE', 'That conversation is unavailable.');
      }
      // Freeze the dialogue graph now; later publishes never alter this chat.
      const snapshot = dialogueDefinitionPayloadSchema.parse({
        key: dialogue.key,
        entryNodeId: dialogue.entryNodeId,
        nodes: dialogue.nodes,
      });

      try {
        const created = await prisma.$transaction(async (tx) => {
          await inventoryService.lockCharacter(tx, character.id);
          const interaction = await tx.npcInteraction.create({
            data: {
              characterId: character.id,
              npcKey,
              npcRevision: npc.revision,
              dialogueKey: dialogue.key,
              dialogueRevision: dialogue.revision,
              dialogueSnapshot: { entryNodeId: snapshot.entryNodeId, nodes: snapshot.nodes },
              currentNodeId: snapshot.entryNodeId,
              status: 'ACTIVE',
              version: 0,
              startIdempotencyKey: idempotencyKey,
            },
          });
          // First-met vs returning: bounded, typed per-character memory.
          await tx.characterNpcState.upsert({
            where: { characterId_npcKey: { characterId: character.id, npcKey } },
            create: {
              characterId: character.id,
              npcKey,
              interactionCount: 1,
              lastInteractedAt: new Date(),
            },
            update: { interactionCount: { increment: 1 }, lastInteractedAt: new Date() },
          });
          return interaction;
        });
        metrics.increment('npc_interaction_started');
        return view(created.id, npc.name);
      } catch (error) {
        if (isUniqueViolation(error)) {
          const replay = await prisma.npcInteraction.findUniqueOrThrow({
            where: {
              characterId_startIdempotencyKey: {
                characterId: character.id,
                startIdempotencyKey: idempotencyKey,
              },
            },
          });
          return view(replay.id, npc.name);
        }
        throw error;
      }
    },

    async get(userId, interactionId) {
      const character = await characterService.requireCharacter(userId);
      const interaction = await prisma.npcInteraction.findUnique({ where: { id: interactionId } });
      if (!interaction || interaction.characterId !== character.id) {
        throw new DomainError(404, 'UNKNOWN_INTERACTION', 'No such interaction.');
      }
      const npc = await prisma.npcDefinition.findUnique({ where: { key: interaction.npcKey } });
      return view(interaction.id, npc?.name ?? interaction.npcKey);
    },

    async choose(userId, interactionId, input) {
      const character = await characterService.requireCharacter(userId);
      const interaction = await prisma.npcInteraction.findUnique({ where: { id: interactionId } });
      if (!interaction || interaction.characterId !== character.id) {
        throw new DomainError(404, 'UNKNOWN_INTERACTION', 'No such interaction.');
      }
      const npc = await prisma.npcDefinition.findUnique({ where: { key: interaction.npcKey } });
      const npcName = npc?.name ?? interaction.npcKey;

      // Replay: a completed choice under this key returns the original outcome,
      // BEFORE the version check (a stale replay carries the old version).
      const priorStep = await prisma.npcInteractionStep.findUnique({
        where: {
          interactionId_idempotencyKey: { interactionId, idempotencyKey: input.idempotencyKey },
        },
      });
      if (priorStep) {
        metrics.increment('dialogue_idempotent_replay');
        return view(interactionId, npcName);
      }

      if (interaction.status !== 'ACTIVE') {
        throw conflict('INTERACTION_CLOSED', 'That conversation has ended.');
      }
      if (interaction.version !== input.expectedVersion) {
        metrics.increment('dialogue_choice_conflict');
        throw conflict('STALE_INTERACTION', 'The conversation moved on; refresh and retry.');
      }

      const snapshot = parseSnapshot(interaction.dialogueSnapshot);
      const node = snapshot.nodes.find((n) => n.id === interaction.currentNodeId);
      const choice = node?.choices.find((c) => c.id === input.choiceId);
      if (!node || !choice) {
        throw new DomainError(400, 'UNKNOWN_CHOICE', 'That choice is not available.');
      }
      const segment = (await worldClock.currentTime()).segment;

      try {
        await prisma.$transaction(async (tx) => {
          await inventoryService.lockCharacter(tx, character.id);
          // Claim the turn: one winner among concurrent choices.
          const claimed = await tx.npcInteraction.updateMany({
            where: { id: interactionId, version: input.expectedVersion, status: 'ACTIVE' },
            data: { version: input.expectedVersion + 1 },
          });
          if (claimed.count === 0) {
            throw conflict('STALE_INTERACTION', 'The conversation moved on; refresh and retry.');
          }

          // Conditions are re-checked authoritatively; a failing choice rolls
          // the whole turn back (including the version bump).
          for (const cond of choice.conditions ?? []) {
            if (!(await evaluate(tx, character.id, cond, segment))) {
              metrics.increment('dialogue_condition_failure');
              throw conflict('CHOICE_UNAVAILABLE', 'You cannot choose that.');
            }
          }

          const committed: string[] = [];
          for (const effect of choice.effects ?? []) {
            await applyEffect(
              tx,
              character.id,
              interaction.npcKey,
              interactionId,
              input.idempotencyKey,
              effect,
            );
            committed.push(effect.type);
          }

          const closing = choice.to === null;
          await tx.npcInteraction.update({
            where: { id: interactionId },
            data: {
              currentNodeId: choice.to ?? interaction.currentNodeId,
              status: closing ? 'CLOSED' : 'ACTIVE',
              completedAt: closing ? new Date() : null,
            },
          });
          await tx.characterNpcState.update({
            where: {
              characterId_npcKey: { characterId: character.id, npcKey: interaction.npcKey },
            },
            data: {
              lastInteractedAt: new Date(),
              ...(closing
                ? {
                    lastDialogueKey: interaction.dialogueKey,
                    lastDialogueRevision: interaction.dialogueRevision,
                  }
                : {}),
            },
          });
          await tx.npcInteractionStep.create({
            data: {
              interactionId,
              sequence: input.expectedVersion + 1,
              fromNodeId: node.id,
              choiceId: choice.id,
              toNodeId: choice.to,
              conditionsPassed: true,
              effectsAttempted: choice.effects ?? [],
              effectsCommitted: committed,
              idempotencyKey: input.idempotencyKey,
            },
          });
          metrics.increment('dialogue_choice_accepted');
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Concurrent duplicate of the same key: return the winner's outcome.
          metrics.increment('dialogue_idempotent_replay');
          return view(interactionId, npcName);
        }
        throw error;
      }
      return view(interactionId, npcName);
    },

    async close(userId, interactionId) {
      const character = await characterService.requireCharacter(userId);
      const interaction = await prisma.npcInteraction.findUnique({ where: { id: interactionId } });
      if (!interaction || interaction.characterId !== character.id) {
        throw new DomainError(404, 'UNKNOWN_INTERACTION', 'No such interaction.');
      }
      const npc = await prisma.npcDefinition.findUnique({ where: { key: interaction.npcKey } });
      if (interaction.status === 'ACTIVE') {
        await prisma.npcInteraction.update({
          where: { id: interactionId },
          data: { status: 'CLOSED', completedAt: new Date() },
        });
      }
      return view(interactionId, npc?.name ?? interaction.npcKey);
    },
  };
}

/** True when a Prisma error is a unique-constraint violation (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
