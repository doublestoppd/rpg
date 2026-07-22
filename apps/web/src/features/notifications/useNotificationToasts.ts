import { useEffect, useRef } from 'react';

import { useToast } from '../../components/ui/Toast';
import { useCharacter } from '../character/useCharacter';
import { useMarkNotificationRead, useNotifications } from './useNotifications';

/**
 * Surfaces newly-arrived notifications as transient toasts, in addition to the
 * persisted Notifications tab. The first load seeds the "already seen" set
 * without toasting, so a backlog on sign-in stays quiet — only notifications
 * that appear while the app is open pop up. The notification rows remain the
 * source of truth; this is a presentation nicety layered on the existing query.
 */
export function useNotificationToasts() {
  const { data: character } = useCharacter();
  const notifications = useNotifications(Boolean(character));
  const markRead = useMarkNotificationRead();
  const { showToast } = useToast();

  const seenIds = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  // Hold the latest mutation in a ref so the announce effect depends only on the
  // notification rows; the ref is synced after render, never read during it.
  const markReadRef = useRef(markRead);
  useEffect(() => {
    markReadRef.current = markRead;
  });

  const rows = notifications.data?.notifications;

  useEffect(() => {
    if (!rows) return;

    // First successful load: remember everything without announcing it.
    if (!seeded.current) {
      for (const row of rows) seenIds.current.add(row.id);
      seeded.current = true;
      return;
    }

    // Announce anything new since the last load, oldest first so the most
    // recent ends up on top of the toast stack. Clicking the toast marks the
    // notification read (and dismisses it, handled by the toast layer).
    const fresh = rows.filter((row) => !seenIds.current.has(row.id));
    for (const row of [...fresh].reverse()) {
      seenIds.current.add(row.id);
      const id = row.id;
      showToast(row.title, 'info', { onClick: () => markReadRef.current.mutate(id) });
    }
    for (const row of fresh) seenIds.current.add(row.id);
  }, [rows, showToast]);
}
