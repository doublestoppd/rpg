import { z } from 'zod';

import { idempotencyKeySchema } from './travel.js';
import { worldTimeSegmentSchema } from './world-sim.js';

/**
 * Authored dialogue trees and the typed condition/effect registry (Phase 26,
 * increment 3). Choices carry only declarative, exhaustively-typed conditions
 * and effects — never arbitrary code, SQL, or free expressions. Effects call
 * the owning domain service inside one transaction; dialogue never mutates
 * gold, inventory, quests, or stats directly.
 */

const goldString = z.string().regex(/^\d+$/);

// --- conditions (approved read models only) --------------------------------

export const dialogueConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('LEVEL_AT_LEAST'), minLevel: z.number().int().min(1).max(100) }),
  z.object({ type: z.literal('CLASS_IS'), classSlug: z.string().min(1) }),
  z.object({
    type: z.literal('QUEST_STATUS'),
    questSlug: z.string().min(1),
    status: z.enum(['ACTIVE', 'COMPLETED']),
  }),
  z.object({
    type: z.literal('HAS_ITEM'),
    itemSlug: z.string().min(1),
    quantity: z.number().int().min(1),
  }),
  z.object({ type: z.literal('FLAG_EQUALS'), flagKey: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal('WORLD_SEGMENT'), segment: worldTimeSegmentSchema }),
]);
export type DialogueCondition = z.infer<typeof dialogueConditionSchema>;

// --- effects (each dispatches to an owning domain service) ------------------

export const dialogueEffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SET_FLAG'), flagKey: z.string().min(1), value: z.string() }),
  z.object({
    type: z.literal('INCREMENT_FAMILIARITY'),
    amount: z.number().int().min(1).max(100),
  }),
  // Emits a verified NPC-interaction quest event through the quest sink (the
  // only way dialogue touches quest progress), inside the interaction's
  // transaction. Progresses any TALK_TO_NPC objective targeting this NPC.
  z.object({ type: z.literal('EMIT_QUEST_EVENT') }),
  z.object({ type: z.literal('GRANT_GOLD'), amount: goldString }),
  z.object({ type: z.literal('RECORD_ONE_TIME'), key: z.string().min(1) }),
]);
export type DialogueEffect = z.infer<typeof dialogueEffectSchema>;

// --- nodes and choices ------------------------------------------------------

export const dialogueSpeakerSchema = z.enum(['NPC', 'PLAYER', 'NARRATION']);

export const dialogueChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  conditions: z.array(dialogueConditionSchema).default([]),
  effects: z.array(dialogueEffectSchema).default([]),
  /** Next node; null closes the interaction after this choice. */
  to: z.string().min(1).nullable(),
});
export type DialogueChoice = z.infer<typeof dialogueChoiceSchema>;

export const dialogueNodeSchema = z.object({
  id: z.string().min(1),
  speaker: dialogueSpeakerSchema,
  text: z.string().min(1),
  choices: z.array(dialogueChoiceSchema).default([]),
});
export type DialogueNode = z.infer<typeof dialogueNodeSchema>;

export const dialogueDefinitionPayloadSchema = z.object({
  key: z.string().min(1),
  entryNodeId: z.string().min(1),
  nodes: z.array(dialogueNodeSchema).min(1),
});
export type DialogueDefinitionPayload = z.infer<typeof dialogueDefinitionPayloadSchema>;

// --- runtime read models ----------------------------------------------------

export const interactionStatusSchema = z.enum(['ACTIVE', 'CLOSED']);

/** A choice as shown to the player: condition-passing choices only, no rules. */
export const interactionChoiceViewSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const interactionTurnSchema = z.object({
  speaker: dialogueSpeakerSchema,
  text: z.string(),
  /** For history entries that record the player's chosen label. */
  choiceLabel: z.string().nullable(),
});

export const npcInteractionResponseSchema = z.object({
  interactionId: z.string(),
  npcKey: z.string(),
  npcName: z.string(),
  dialogueKey: z.string(),
  status: interactionStatusSchema,
  version: z.number().int(),
  nodeId: z.string(),
  speaker: dialogueSpeakerSchema,
  text: z.string(),
  choices: z.array(interactionChoiceViewSchema),
  history: z.array(interactionTurnSchema),
});
export type NpcInteractionResponse = z.infer<typeof npcInteractionResponseSchema>;

export const startInteractionRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});

export const chooseRequestSchema = z.object({
  choiceId: z.string().min(1),
  expectedVersion: z.number().int().min(0),
  idempotencyKey: idempotencyKeySchema,
});
export type ChooseRequest = z.infer<typeof chooseRequestSchema>;

// --- narrative flags (declared, typed) --------------------------------------

export const narrativeFlagPayloadSchema = z.object({
  key: z.string().min(1),
  namespace: z.string().min(1),
  valueType: z.enum(['BOOLEAN', 'ENUM']),
  allowedValues: z.array(z.string().min(1)).min(1),
  defaultValue: z.string().min(1),
});
export type NarrativeFlagPayload = z.infer<typeof narrativeFlagPayloadSchema>;
