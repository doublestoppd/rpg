import { NavLink } from 'react-router-dom';

import { useCharacter } from '../character/useCharacter';
import { useNotifications, useNotificationSocket } from './useNotifications';

/**
 * Nav entry with the unread indicator. Also owns the app-wide live socket:
 * mounted whenever the user is signed in, so sync nudges arrive on any page
 * (with 15s polling as the always-on fallback).
 */
export function NotificationsNavLink({
  linkClass,
}: {
  linkClass: (props: { isActive: boolean }) => string;
}) {
  // No character yet (fresh account): nothing to poll, no socket to open.
  const { data: character } = useCharacter();
  const notifications = useNotifications(Boolean(character));
  useNotificationSocket(Boolean(character));
  const unread = notifications.data?.unreadCount ?? 0;

  return (
    <NavLink to="/notifications" className={linkClass} aria-label="Notifications">
      Notifications
      {unread > 0 && (
        <span
          aria-label={`${unread} unread`}
          className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </NavLink>
  );
}
