import { createEquipmentService } from '../domain/inventory/equipment-service.js';
import { inventoryRoutes } from '../routes/inventory.js';
import { type GameModule, requireService } from './types.js';

/** Inventory views, item use/discard, and equipment. */
export const inventoryModule: GameModule = {
  name: 'inventory',
  async register(ctx) {
    const characterService = requireService(ctx.services, 'characterService');
    const inventoryService = requireService(ctx.services, 'inventoryService');
    const equipmentService = createEquipmentService(ctx.prisma, characterService, inventoryService);
    ctx.services.equipmentService = equipmentService;
    await ctx.app.register(inventoryRoutes, {
      prefix: '/api/v1',
      characterService,
      inventoryService,
      equipmentService,
      timedStateRunner: ctx.timedStateRunner,
    });
  },
};
