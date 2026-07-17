import { accountModule } from './account.js';
import { authModule } from './auth.js';
import { charactersModule } from './characters.js';
import { combatModule } from './combat.js';
import { craftingModule } from './crafting.js';
import { currencyModule } from './currency.js';
import { economyCoreModule } from './economy-core.js';
import { gatheringModule } from './gathering.js';
import { inventoryModule } from './inventory.js';
import { marketplaceModule } from './marketplace.js';
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
  economyCoreModule,
  charactersModule,
  questsModule,
  travelModule,
  worldModule,
  inventoryModule,
  currencyModule,
  npcShopsModule,
  marketplaceModule,
  gatheringModule,
  craftingModule,
  combatModule,
];
