import { createCurrencyService } from '../domain/currency/currency-service.js';
import { createInventoryService } from '../domain/inventory/inventory-service.js';
import type { GameModule } from './types.js';

/**
 * The economy kernel: inventory and the Gold ledger. Construction only —
 * nearly every later module depends on these two services, so they register
 * first; their routes live in the inventory and currency modules.
 */
export const economyCoreModule: GameModule = {
  name: 'economy-core',
  async register(ctx) {
    ctx.services.inventoryService = createInventoryService(ctx.prisma);
    ctx.services.currencyService = createCurrencyService(ctx.prisma);
  },
};
