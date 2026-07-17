import { Navigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useCharacter } from '../features/character/useCharacter';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '../features/notifications/useNotifications';

export function NotificationsPage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const notifications = useNotifications(Boolean(character));
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  if (characterPending) return <LoadingState label="Checking the courier's bag…" />;
  if (!character) return <Navigate to="/character/new" replace />;
  if (notifications.isPending) return <LoadingState label="Checking the courier's bag…" />;
  if (notifications.isError || !notifications.data)
    return <ErrorState onRetry={() => void notifications.refetch()} />;

  const { notifications: items, unreadCount } = notifications.data;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Notifications
        </h1>
        {unreadCount > 0 && (
          <Button disabled={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
            Mark all read
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="Arrivals, finished work, sales, and completed quests will land here."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((notification) => (
            <li key={notification.id}>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p
                      className={`text-sm font-semibold ${
                        notification.readAt
                          ? 'text-stone-500 dark:text-stone-400'
                          : 'text-stone-900 dark:text-stone-100'
                      }`}
                    >
                      {notification.title}
                      {!notification.readAt && (
                        <span className="ml-2 inline-block h-2 w-2 rounded-full bg-amber-500" />
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-stone-600 dark:text-stone-400">
                      {notification.body}
                    </p>
                    <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
                      {new Date(notification.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {!notification.readAt && (
                    <Button
                      disabled={markRead.isPending}
                      onClick={() => markRead.mutate(notification.id)}
                    >
                      Mark read
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
