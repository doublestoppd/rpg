import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Theme } from '@rpg/shared';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/Toast';
import { useAccountSettings, useUpdateSettings } from '../features/account/useSettings';
import {
  useChangePassword,
  useLogout,
  useRevokeOtherSessions,
  useSession,
} from '../features/auth/useSession';
import { ApiRequestError } from '../lib/api';

const THEMES: Array<{ value: Theme; label: string }> = [
  { value: 'SYSTEM', label: 'Match system' },
  { value: 'LIGHT', label: 'Light' },
  { value: 'DARK', label: 'Dark' },
];

export function AccountSettingsPage() {
  const { data: session } = useSession();
  const { data: settings } = useAccountSettings(Boolean(session));
  const updateSettings = useUpdateSettings();
  const changePassword = useChangePassword();
  const revokeOthers = useRevokeOtherSessions();
  const logout = useLogout();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const onChangePassword = (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
          showToast('Password changed. Your session was renewed.', 'success');
        },
        onError: (err) =>
          setPasswordError(
            err instanceof ApiRequestError ? err.message : 'Password change failed.',
          ),
      },
    );
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
        Account settings
      </h1>

      <Card title="Profile">
        <dl className="space-y-1 text-sm text-stone-700 dark:text-stone-300">
          <div className="flex justify-between">
            <dt className="text-stone-500">Display name</dt>
            <dd className="font-medium">{session?.user.displayName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">Email</dt>
            <dd className="font-medium">{session?.user.email}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Appearance">
        <div className="flex gap-2">
          {THEMES.map((theme) => (
            <Button
              key={theme.value}
              variant={settings?.theme === theme.value ? 'primary' : 'secondary'}
              onClick={() => updateSettings.mutate({ theme: theme.value })}
              disabled={updateSettings.isPending}
            >
              {theme.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card title="Change password">
        <form onSubmit={onChangePassword} className="space-y-4">
          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          {passwordError && (
            <p role="alert" className="text-sm text-red-700">
              {passwordError}
            </p>
          )}
          <Button type="submit" disabled={changePassword.isPending}>
            Change password
          </Button>
        </form>
      </Card>

      <Card title="Sessions">
        <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
          Active sessions: <span className="font-medium">{session?.activeSessionCount ?? 1}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              revokeOthers.mutate(undefined, {
                onSuccess: (result) =>
                  showToast(`Signed out ${result.revokedCount} other session(s).`, 'success'),
              })
            }
            disabled={revokeOthers.isPending}
          >
            Sign out other sessions
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              logout.mutate(undefined, { onSuccess: () => navigate('/', { replace: true }) })
            }
            disabled={logout.isPending}
          >
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
