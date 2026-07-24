/**
 * Hand-authored type declarations for the plain-JS seed data module.
 *
 * `seed-data.mjs` is authored as ESM JavaScript so the Prisma seed scripts can
 * import it without a build step. The living-world seed-integrity test
 * (`apps/api/src/seed-living-world.test.ts`) is the only TypeScript consumer, so
 * these declarations cover the exports that test reads and describe their shape
 * accurately enough to keep the invariants type-checked. Other exports used only
 * by the JS seed scripts are declared with permissive shapes.
 */

export interface SeedLocation {
  slug: string;
  name: string;
  region: string;
  artworkKey: string;
  isSafe: boolean;
  mapX: number;
  mapY: number;
  [key: string]: unknown;
}

export interface SeedNpcDefinition {
  key: string;
  name: string;
  pronouns: string;
  shortDescription: string;
  longDescription: string;
  roles: string[];
  tags: string[];
  portraitAssetKey: string;
  sceneAssetKey: string | null;
  homeRegion: string;
  serviceType: string | null;
  dialogueKey: string | null;
  [key: string]: unknown;
}

export interface SeedNpcPlacement {
  npcKey: string;
  locationSlug: string;
  segments: string[];
  priority: number;
  visibility: string;
  [key: string]: unknown;
}

export interface SeedNarrativeFlag {
  key: string;
  namespace: string;
  valueType: string;
  allowedValues: string[];
  defaultValue: string;
  [key: string]: unknown;
}

export interface SeedDialogueRule {
  type: string;
  flagKey?: string;
  [key: string]: unknown;
}

export interface SeedDialogueChoice {
  id: string;
  label: string;
  conditions: SeedDialogueRule[];
  effects: SeedDialogueRule[];
  to: string | null;
  [key: string]: unknown;
}

export interface SeedDialogueNode {
  id: string;
  speaker: string;
  text: string;
  choices: SeedDialogueChoice[];
  [key: string]: unknown;
}

export interface SeedDialogue {
  key: string;
  entryNodeId: string;
  npcKey: string;
  nodes: SeedDialogueNode[];
  [key: string]: unknown;
}

export const LOCATIONS: SeedLocation[];
export const NPC_DEFINITIONS: SeedNpcDefinition[];
export const NPC_PLACEMENTS: SeedNpcPlacement[];
export const NARRATIVE_FLAGS: SeedNarrativeFlag[];
export const DIALOGUES: SeedDialogue[];

/* Exports consumed only by the JS seed scripts. */
export const CHARACTER_CLASSES: Array<Record<string, unknown>>;
export const LOCATION_FEATURES: Array<Record<string, unknown>>;
export const TRAVEL_ROUTES: Array<Record<string, unknown>>;
export const STARTING_LOCATION_SLUG: string;
export const ITEM_DEFINITIONS: Array<Record<string, unknown>>;
export const REGIONAL_PRICE_MODIFIERS: Array<Record<string, unknown>>;
export const NPC_SHOPS: Array<Record<string, unknown>>;
export const LEVEL_PROGRESSION: Array<Record<string, unknown>>;
export const GATHERING_ACTIONS: Array<Record<string, unknown>>;
export const CRAFTING_RECIPES: Array<Record<string, unknown>>;
export const ENEMY_DEFINITIONS: Array<Record<string, unknown>>;
export const ENCOUNTER_DEFINITIONS: Array<Record<string, unknown>>;
export const QUEST_DEFINITIONS: Array<Record<string, unknown>>;
export const COLLECTION_DEFINITIONS: Array<Record<string, unknown>>;
export const WORLD_EVENTS: Array<Record<string, unknown>>;
export const SCENE_VARIANTS: Array<Record<string, unknown>>;
