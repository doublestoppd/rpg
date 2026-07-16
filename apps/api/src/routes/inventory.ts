import {
  equipRequestSchema,
  inventoryResponseSchema,
  itemDefinitionSchema,
  okResponseSchema,
  unequipRequestSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { CharacterService } from '../domain/character/character-service.js';
import type { EquipmentService } from '../domain/inventory/equipment-service.js';
import type { InventoryService } from '../domain/inventory/inventory-service.js';
import type { TimedStateRunner } from '../lib/timed-state.js';

interface InventoryRouteOptions {
  characterService: CharacterService;
  inventoryService: InventoryService;
  equipmentService: EquipmentService;
  timedStateRunner?: TimedStateRunner;
}

export async function inventoryRoutes(
  app: FastifyInstance,
  opts: InventoryRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { characterService, inventoryService, equipmentService } = opts;

  typed.get(
    '/inventory',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['inventory'],
        summary: 'Inventory: slot usage, stacks, and unique items',
        response: { 200: inventoryResponseSchema },
      },
    },
    async (request) => {
      const character = await characterService.requireCharacter(request.currentUser!.id);
      // Lazily finalize arrived deliveries and expired listings first.
      await opts.timedStateRunner?.finalizeAll(character.id);
      return inventoryService.getInventoryResponse(character.id);
    },
  );

  typed.get(
    '/items/:slug',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['inventory'],
        summary: 'Public item definition',
        params: z.object({ slug: z.string().min(1) }),
        response: { 200: itemDefinitionSchema },
      },
    },
    async (request) => inventoryService.getItemBySlug(request.params.slug),
  );

  typed.post(
    '/equipment/equip',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['inventory'],
        summary: 'Equip an owned, unlocked item instance',
        body: equipRequestSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (request) => {
      await equipmentService.equip(request.currentUser!.id, request.body);
      return { ok: true as const };
    },
  );

  typed.post(
    '/equipment/unequip',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['inventory'],
        summary: 'Unequip a slot back into inventory (requires a free slot)',
        body: unequipRequestSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (request) => {
      await equipmentService.unequip(request.currentUser!.id, request.body);
      return { ok: true as const };
    },
  );
}
