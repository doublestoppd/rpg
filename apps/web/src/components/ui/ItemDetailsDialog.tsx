import type { ItemBonuses, ItemDefinitionInfo } from '@rpg/shared';

import { Asset } from './Asset';
import { Dialog } from './Dialog';

const CATEGORY_LABELS: Record<string, string> = {
  WEAPON: 'Weapon',
  ARMOR: 'Armor',
  ACCESSORY: 'Accessory',
  CONSUMABLE: 'Consumable',
  MATERIAL: 'Material',
  QUEST: 'Quest item',
  ARTIFACT: 'Artifact',
  TOOL: 'Tool',
};

const BONUS_LABELS: Record<keyof ItemBonuses, string> = {
  strength: 'Strength',
  agility: 'Agility',
  magic: 'Magic',
  defense: 'Defense',
  magicDefense: 'Magic Def.',
  luck: 'Luck',
  maxHp: 'Max HP',
  maxMp: 'Max MP',
};

/**
 * The general item-details popup: a reusable read-only view of any item, shown
 * wherever an item is clicked with no more specific action. All data comes from
 * the item definition already carried by the calling view, so it needs no extra
 * request.
 */
export function ItemDetailsDialog({
  item,
  onClose,
  footer,
}: {
  item: ItemDefinitionInfo | null;
  onClose: () => void;
  footer?: React.ReactNode;
}) {
  if (!item) return null;

  const bonuses = (Object.keys(item.bonuses) as (keyof ItemBonuses)[]).filter(
    (k) => item.bonuses[k] !== 0,
  );

  return (
    <Dialog open title={item.name} onClose={onClose} footer={footer}>
      <div className="space-y-3">
        <div className="flex gap-3">
          <Asset
            assetRole="ITEM_ICON"
            contentKey={item.slug}
            alt={item.name}
            className="size-16 shrink-0 rounded-md"
          />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
              {CATEGORY_LABELS[item.category] ?? item.category}
              {item.equipmentSlot ? ` · ${item.equipmentSlot.toLowerCase()}` : ''}
            </p>
            <p className="mt-1 text-sm leading-6 text-stone-700 dark:text-stone-300">
              {item.description}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-500 dark:text-stone-400">Value</dt>
            <dd className="font-medium text-amber-800 dark:text-amber-400">
              {item.baseValue} Gold
            </dd>
          </div>
          {item.levelRequirement > 1 && (
            <div className="flex justify-between">
              <dt className="text-stone-500 dark:text-stone-400">Level req.</dt>
              <dd className="font-medium text-stone-800 dark:text-stone-200">
                {item.levelRequirement}
              </dd>
            </div>
          )}
          {item.stackable && (
            <div className="flex justify-between">
              <dt className="text-stone-500 dark:text-stone-400">Max stack</dt>
              <dd className="font-medium text-stone-800 dark:text-stone-200">
                {item.maxStackQuantity}
              </dd>
            </div>
          )}
          {item.hpRestore > 0 && (
            <div className="flex justify-between">
              <dt className="text-stone-500 dark:text-stone-400">Restores HP</dt>
              <dd className="font-medium text-green-700 dark:text-green-400">+{item.hpRestore}</dd>
            </div>
          )}
          {item.mpRestore > 0 && (
            <div className="flex justify-between">
              <dt className="text-stone-500 dark:text-stone-400">Restores MP</dt>
              <dd className="font-medium text-blue-700 dark:text-blue-400">+{item.mpRestore}</dd>
            </div>
          )}
        </dl>

        {bonuses.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              Equipped bonuses
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {bonuses.map((k) => (
                <li
                  key={k}
                  className="rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                >
                  {BONUS_LABELS[k]} {item.bonuses[k] > 0 ? `+${item.bonuses[k]}` : item.bonuses[k]}
                </li>
              ))}
            </ul>
          </div>
        )}

        {item.usableInCombat && (
          <p className="text-xs italic text-stone-500 dark:text-stone-400">Usable in combat.</p>
        )}
      </div>
    </Dialog>
  );
}
