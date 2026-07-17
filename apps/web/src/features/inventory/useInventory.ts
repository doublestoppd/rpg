import {
  type EquipRequest,
  type InventoryResponse,
  inventoryResponseSchema,
  okResponseSchema,
  type UnequipRequest,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';

export const INVENTORY_KEY = ['inventory'] as const;
const CHARACTER_KEYS = [['character', 'me'] as const, ['character', 'stats'] as const];

export function useInventory(enabled = true) {
  return useQuery<InventoryResponse>({
    queryKey: INVENTORY_KEY,
    queryFn: () => apiGet('/api/v1/inventory', (raw) => inventoryResponseSchema.parse(raw)),
    enabled,
    staleTime: 5_000,
  });
}

function useEquipmentMutation(path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EquipRequest | UnequipRequest) =>
      apiSend('POST', path, input, (raw) => okResponseSchema.parse(raw)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
      for (const key of CHARACTER_KEYS) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useEquip() {
  return useEquipmentMutation('/api/v1/equipment/equip');
}

export function useUnequip() {
  return useEquipmentMutation('/api/v1/equipment/unequip');
}
