import { useEffect } from 'react';

import { useSession } from '../auth/useSession';
import { useAccountSettings } from './useSettings';

/** Applies the persisted theme setting to the document root. */
export function ThemeApplier() {
  const { data: session } = useSession();
  const { data: settings } = useAccountSettings(Boolean(session));

  useEffect(() => {
    const root = document.documentElement;
    const theme = settings?.theme ?? 'SYSTEM';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = theme === 'DARK' || (theme === 'SYSTEM' && prefersDark);
    root.classList.toggle('dark', dark);
  }, [settings?.theme]);

  return null;
}
