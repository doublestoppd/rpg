import { z } from 'zod';

export const itemCategorySchema = z.enum([
  'RESOURCE',
  'CONSUMABLE',
  'EQUIPMENT',
  'CRAFTING_COMPONENT',
  'COLLECTIBLE',
  'QUEST_ITEM',
  'SPECIALTY',
]);
export type ItemCategory = z.infer<typeof itemCategorySchema>;

export const equipmentSlotSchema = z.enum([
  'MAIN_HAND',
  'OFF_HAND',
  'HEAD',
  'BODY',
  'HANDS',
  'LEGS',
  'FEET',
  'ACCESSORY_1',
  'ACCESSORY_2',
]);
export type EquipmentSlotName = z.infer<typeof equipmentSlotSchema>;

export const itemBonusesSchema = z.object({
  strength: z.number().int(),
  agility: z.number().int(),
  magic: z.number().int(),
  defense: z.number().int(),
  magicDefense: z.number().int(),
  luck: z.number().int(),
  maxHp: z.number().int(),
  maxMp: z.number().int(),
});
export type ItemBonuses = z.infer<typeof itemBonusesSchema>;

export const itemDefinitionSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  category: itemCategorySchema,
  stackable: z.boolean(),
  maxStackQuantity: z.number().int().min(1),
  equipmentSlot: equipmentSlotSchema.nullable(),
  levelRequirement: z.number().int().min(1),
  bonuses: itemBonusesSchema,
  hpRestore: z.number().int().min(0),
  mpRestore: z.number().int().min(0),
  usableInCombat: z.boolean(),
  /** Reference value in Gold as a decimal string. */
  baseValue: z.string().regex(/^\d+$/),
});
export type ItemDefinitionInfo = z.infer<typeof itemDefinitionSchema>;

export const itemInstanceLockSchema = z.enum(['NONE', 'LISTED', 'IN_TRANSIT']);
export type ItemInstanceLockState = z.infer<typeof itemInstanceLockSchema>;

export const inventoryStackSchema = z.object({
  item: itemDefinitionSchema,
  quantity: z.number().int().min(1),
});
export type InventoryStackInfo = z.infer<typeof inventoryStackSchema>;

export const inventoryInstanceSchema = z.object({
  id: z.uuid(),
  item: itemDefinitionSchema,
  lockState: itemInstanceLockSchema,
  /** Set when the instance is currently equipped (consumes no slot). */
  equippedSlot: equipmentSlotSchema.nullable(),
});
export type InventoryInstanceInfo = z.infer<typeof inventoryInstanceSchema>;

export const inventoryResponseSchema = z.object({
  slots: z.object({
    used: z.number().int().min(0),
    capacity: z.number().int().min(1),
    reserved: z.number().int().min(0),
  }),
  stacks: z.array(inventoryStackSchema),
  instances: z.array(inventoryInstanceSchema),
});
export type InventoryResponse = z.infer<typeof inventoryResponseSchema>;

export const equipRequestSchema = z.object({
  itemInstanceId: z.uuid(),
  /** Required for accessories (two possible slots); inferred otherwise. */
  slot: equipmentSlotSchema.optional(),
});
export type EquipRequest = z.infer<typeof equipRequestSchema>;

export const unequipRequestSchema = z.object({
  slot: equipmentSlotSchema,
});
export type UnequipRequest = z.infer<typeof unequipRequestSchema>;
