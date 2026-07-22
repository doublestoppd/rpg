import type { ActivityEntry } from '@rpg/shared';

import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

/**
 * The privacy-safe local activity feed. Each entry is a typed template rendered
 * client-side from anonymous parameters — item, shop, and collection names only.
 * It never carries a player or account identifier, so nothing here can identify
 * who did anything.
 */
function describe(entry: ActivityEntry): string {
  switch (entry.type) {
    case 'WORLD_EVENT_STARTED':
      return `${entry.name} began.`;
    case 'MARKETPLACE_SALE':
      return `${entry.quantity}× ${entry.itemName} changed hands at the marketplace.`;
    case 'MUSEUM_DONATION':
      return `${entry.itemName} was donated to the ${entry.collectionName} collection.`;
    case 'SHOP_RESTOCKED':
      return `${entry.shopName} restocked its shelves.`;
  }
}

const ICONS: Record<ActivityEntry['type'], string> = {
  WORLD_EVENT_STARTED: '✨',
  MARKETPLACE_SALE: '💰',
  MUSEUM_DONATION: '🏛️',
  SHOP_RESTOCKED: '📦',
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return <EmptyState title="Quiet for now" description="No recent goings-on around here." />;
  }

  return (
    <Card>
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {entries.map((entry, index) => (
          <li key={index} className="flex items-start gap-2 py-2 text-sm">
            <span aria-hidden className="mt-0.5">
              {ICONS[entry.type]}
            </span>
            <span className="flex-1 text-stone-700 dark:text-stone-300">{describe(entry)}</span>
            <span className="shrink-0 text-xs text-stone-400 dark:text-stone-500">
              {relativeTime(entry.at)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
