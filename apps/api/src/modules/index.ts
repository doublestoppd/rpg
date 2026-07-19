import { accountModule } from './account.js';
import { adminModule } from './admin.js';
import { assetsModule } from './assets.js';
import { authModule } from './auth.js';
import { buildsModule } from './builds.js';
import { charactersModule } from './characters.js';
import { chatModule } from './chat.js';
import { combatModule } from './combat.js';
import { craftingModule } from './crafting.js';
import { currencyModule } from './currency.js';
import { economyCoreModule } from './economy-core.js';
import { gatheringModule } from './gathering.js';
import { inventoryModule } from './inventory.js';
import { marketplaceModule } from './marketplace.js';
import { museumModule } from './museum.js';
import { notificationsModule } from './notifications.js';
import { npcShopsModule } from './npc-shops.js';
import { questsModule } from './quests.js';
import { travelModule } from './travel.js';
import type { GameModule } from './types.js';
import { worldModule } from './world.js';

/**
 * Every feature module, in registration order. Order matters and is part
 * of the composition contract: a module may only read services registered
 * by earlier modules (enforced at startup by `requireService`).
 */
export const GAME_MODULES: readonly GameModule[] = [
  authModule,
  accountModule,
  assetsModule,
  economyCoreModule,
  charactersModule,
  notificationsModule,
  questsModule,
  travelModule,
  worldModule,
  inventoryModule,
  currencyModule,
  buildsModule,
  npcShopsModule,
  marketplaceModule,
  gatheringModule,
  craftingModule,
  combatModule,
  museumModule,
  chatModule,
  adminModule,
];
