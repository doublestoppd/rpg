import { createCharacterService } from '../domain/character/character-service.js';
import { characterRoutes } from '../routes/characters.js';
import { type GameModule, requireService } from './types.js';

/** Characters, classes, progression, stamina. */
export const charactersModule: GameModule = {
  name: 'characters',
  async register(ctx) {
    const characterService = createCharacterService(
      ctx.prisma,
      requireService(ctx.services, 'inventoryService'),
      requireService(ctx.services, 'currencyService'),
    );
    ctx.services.characterService = characterService;
    await ctx.app.register(characterRoutes, { prefix: '/api/v1', characterService });
  },
};
