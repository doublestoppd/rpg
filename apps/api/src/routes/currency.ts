import {
  currencyBalanceResponseSchema,
  currencyTransactionsResponseSchema,
  innRestRequestSchema,
  innRestResponseSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { CharacterService } from '../domain/character/character-service.js';
import type { CurrencyService } from '../domain/currency/currency-service.js';
import type { InnService } from '../domain/inn/inn-service.js';

interface CurrencyRouteOptions {
  characterService: CharacterService;
  currencyService: CurrencyService;
  innService: InnService;
}

export async function currencyRoutes(
  app: FastifyInstance,
  opts: CurrencyRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { characterService, currencyService, innService } = opts;

  typed.get(
    '/currency',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['currency'],
        summary: 'Current Gold balance (decimal string)',
        response: { 200: currencyBalanceResponseSchema },
      },
    },
    async (request) => {
      const character = await characterService.requireCharacter(request.currentUser!.id);
      return currencyService.getBalance(character.id);
    },
  );

  typed.get(
    '/currency/transactions',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['currency'],
        summary: 'Recent immutable ledger entries',
        response: { 200: currencyTransactionsResponseSchema },
      },
    },
    async (request) => {
      const character = await characterService.requireCharacter(request.currentUser!.id);
      return currencyService.getTransactions(character.id);
    },
  );

  typed.post(
    '/locations/current/inn/rest',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['currency'],
        summary: 'Rest at the local inn: full HP/MP for a level-scaled fee',
        body: innRestRequestSchema,
        response: { 200: innRestResponseSchema },
      },
    },
    async (request) => innService.rest(request.currentUser!.id, request.body),
  );
}
