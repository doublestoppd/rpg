import {
  type AccountSettings,
  accountSettingsSchema,
  type UpdateAccountSettings,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';

const SETTINGS_KEY = ['account', 'settings'] as const;

export function useAccountSettings(enabled: boolean) {
  return useQuery<AccountSettings>({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiGet('/api/v1/account/settings', (raw) => accountSettingsSchema.parse(raw)),
    enabled,
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: UpdateAccountSettings) =>
      apiSend('PATCH', '/api/v1/account/settings', update, (raw) =>
        accountSettingsSchema.parse(raw),
      ),
    onSuccess: (settings) => {
      queryClient.setQueryData(SETTINGS_KEY, settings);
    },
  });
}
