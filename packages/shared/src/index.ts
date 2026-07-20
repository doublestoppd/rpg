/**
 * @rpg/shared — API contract package.
 *
 * Shared Zod request/response schemas, enums, and public types live here.
 * Internal database types must never be exported from this package; it
 * defines only the public API contract between apps/api and apps/web.
 */

export const SHARED_PACKAGE_NAME = '@rpg/shared';

export * from './activities.js';
export * from './admin.js';
export * from './admin-content.js';
export * from './asset-manifest.generated.js';
export * from './assets.js';
export * from './auth.js';
export * from './builds.js';
export * from './character.js';
export * from './chat.js';
export * from './combat.js';
export * from './content.js';
export * from './crafting.js';
export * from './currency.js';
export * from './dialogue.js';
export * from './errors.js';
export * from './gathering.js';
export * from './health.js';
export * from './items.js';
export * from './location.js';
export * from './marketplace.js';
export * from './museum.js';
export * from './notifications.js';
export * from './npc-shops.js';
export * from './npcs-world.js';
export * from './quests.js';
export * from './settings.js';
export * from './travel.js';
export * from './world-sim.js';
