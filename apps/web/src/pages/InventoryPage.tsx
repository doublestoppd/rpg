import type {
  InventoryInstanceInfo,
  InventoryStackInfo,
  ItemCategory,
  ItemDefinitionInfo,
} from '@rpg/shared';
import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { Asset } from '../components/ui/Asset';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/Toast';
import { useCharacter } from '../features/character/useCharacter';
import { useEquip, useInventory } from '../features/inventory/useInventory';
import { useCreateListing, useMyShop } from '../features/marketplace/useMarketplace';
import { ApiRequestError } from '../lib/api';

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  RESOURCE: 'Resources',
  CONSUMABLE: 'Consumables',
  EQUIPMENT: 'Equipment',
  CRAFTING_COMPONENT: 'Components',
  COLLECTIBLE: 'Collectibles',
  QUEST_ITEM: 'Quest items',
  SPECIALTY: 'Specialty',
};

const LOCK_LABELS = { NONE: null, LISTED: 'Listed', IN_TRANSIT: 'In transit' } as const;

type Selected =
  | { kind: 'stack'; stack: InventoryStackInfo }
  | { kind: 'instance'; instance: InventoryInstanceInfo };

function BonusList({ item }: { item: ItemDefinitionInfo }) {
  const entries = Object.entries(item.bonuses).filter(([, v]) => v !== 0);
  if (entries.length === 0 && item.hpRestore === 0 && item.mpRestore === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-stone-600 dark:text-stone-400">
      {entries.map(([key, value]) => (
        <li key={key}>
          {key === 'maxHp' ? 'Max HP' : key === 'maxMp' ? 'Max MP' : key} +{value}
        </li>
      ))}
      {item.hpRestore > 0 && <li>Restores {item.hpRestore} HP</li>}
      {item.mpRestore > 0 && <li>Restores {item.mpRestore} MP</li>}
    </ul>
  );
}

export function InventoryPage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const inventory = useInventory(Boolean(character));
  const equipMutation = useEquip();
  const createListing = useCreateListing();
  const myShop = useMyShop(Boolean(character));
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ItemCategory | 'ALL'>('ALL');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [listPrice, setListPrice] = useState('');
  const [listQuantity, setListQuantity] = useState(1);

  const onList = () => {
    if (!selected || !/^\d+$/.test(listPrice)) {
      showToast('Enter a whole-Gold price.', 'error');
      return;
    }
    const input =
      selected.kind === 'stack'
        ? {
            itemSlug: selected.stack.item.slug,
            quantity: listQuantity,
            price: listPrice,
            idempotencyKey: crypto.randomUUID().replaceAll('-', ''),
          }
        : {
            itemInstanceId: selected.instance.id,
            price: listPrice,
            idempotencyKey: crypto.randomUUID().replaceAll('-', ''),
          };
    createListing.mutate(input, {
      onSuccess: () => {
        setSelected(null);
        setListPrice('');
        setListQuantity(1);
        showToast('Listed on the marketplace.', 'success');
      },
      onError: (err) =>
        showToast(err instanceof ApiRequestError ? err.message : 'Listing failed.', 'error'),
    });
  };

  const filtered = useMemo(() => {
    if (!inventory.data) return { stacks: [], instances: [] };
    const term = search.trim().toLowerCase();
    const matches = (item: ItemDefinitionInfo) =>
      (category === 'ALL' || item.category === category) &&
      (term === '' || item.name.toLowerCase().includes(term));
    return {
      stacks: inventory.data.stacks.filter((s) => matches(s.item)),
      instances: inventory.data.instances.filter((i) => matches(i.item)),
    };
  }, [inventory.data, search, category]);

  if (characterPending) return <LoadingState label="Opening your pack…" />;
  if (!character) return <Navigate to="/character/new" replace />;
  if (inventory.isPending) return <LoadingState label="Opening your pack…" />;
  if (inventory.isError || !inventory.data)
    return <ErrorState onRetry={() => void inventory.refetch()} />;

  const { slots } = inventory.data;
  const isEmpty = inventory.data.stacks.length === 0 && inventory.data.instances.length === 0;

  const onEquip = (instance: InventoryInstanceInfo) => {
    equipMutation.mutate(
      { itemInstanceId: instance.id },
      {
        onSuccess: () => {
          setSelected(null);
          showToast(`${instance.item.name} equipped.`, 'success');
        },
        onError: (err) =>
          showToast(
            err instanceof ApiRequestError ? err.message : 'Could not equip that item.',
            'error',
          ),
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Inventory
        </h1>
        <p className="text-sm text-stone-600 dark:text-stone-400" data-testid="slot-usage">
          {slots.used} / {slots.capacity} slots
          {slots.reserved > 0 ? ` (${slots.reserved} reserved)` : ''}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <TextField
            label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Item name…"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(['ALL', ...Object.keys(CATEGORY_LABELS)] as Array<ItemCategory | 'ALL'>).map((c) => (
            <Button
              key={c}
              variant={category === c ? 'primary' : 'ghost'}
              className="px-2 py-1 text-xs"
              onClick={() => setCategory(c)}
            >
              {c === 'ALL' ? 'All' : CATEGORY_LABELS[c]}
            </Button>
          ))}
        </div>
      </div>

      {isEmpty ? (
        <EmptyState
          title="Your pack is empty"
          description="Gather, buy, or craft goods and they will appear here."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-200 dark:divide-stone-800">
            {filtered.stacks.map((stack) => (
              <li key={stack.item.slug}>
                <button
                  type="button"
                  onClick={() => setSelected({ kind: 'stack', stack })}
                  className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:bg-stone-50 dark:hover:bg-stone-800/50"
                >
                  <span className="flex items-center gap-2">
                    <Asset
                      assetRole="ITEM_ICON"
                      contentKey={stack.item.slug}
                      decorative
                      className="size-8 shrink-0 rounded"
                    />
                    <span className="font-medium text-stone-900 dark:text-stone-100">
                      {stack.item.name}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-stone-500">
                      {CATEGORY_LABELS[stack.item.category]}
                    </span>
                    <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                      ×{stack.quantity}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {filtered.instances.map((instance) => (
              <li key={instance.id}>
                <button
                  type="button"
                  onClick={() => setSelected({ kind: 'instance', instance })}
                  className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:bg-stone-50 dark:hover:bg-stone-800/50"
                >
                  <span className="flex items-center gap-2">
                    <Asset
                      assetRole="ITEM_ICON"
                      contentKey={instance.item.slug}
                      decorative
                      className="size-8 shrink-0 rounded"
                    />
                    <span className="font-medium text-stone-900 dark:text-stone-100">
                      {instance.item.name}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-stone-500">
                      {CATEGORY_LABELS[instance.item.category]}
                    </span>
                    {instance.equippedSlot && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                        Equipped
                      </span>
                    )}
                    {LOCK_LABELS[instance.lockState] && (
                      <span className="rounded bg-stone-200 px-2 py-0.5 font-medium text-stone-700 dark:bg-stone-700 dark:text-stone-300">
                        {LOCK_LABELS[instance.lockState]}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
            {filtered.stacks.length === 0 && filtered.instances.length === 0 && (
              <li className="py-4 text-center text-sm text-stone-500">Nothing matches.</li>
            )}
          </ul>
        </Card>
      )}

      <Dialog
        open={selected !== null}
        title={
          selected?.kind === 'stack'
            ? selected.stack.item.name
            : (selected?.instance.item.name ?? '')
        }
        onClose={() => setSelected(null)}
        footer={
          <>
            {myShop.data &&
              selected &&
              (selected.kind === 'stack' ||
                (!selected.instance.equippedSlot && selected.instance.lockState === 'NONE')) && (
                <Button variant="secondary" onClick={onList} disabled={createListing.isPending}>
                  List for sale
                </Button>
              )}
            {selected?.kind === 'instance' &&
              selected.instance.item.category === 'EQUIPMENT' &&
              !selected.instance.equippedSlot &&
              selected.instance.lockState === 'NONE' && (
                <Button
                  onClick={() => onEquip(selected.instance)}
                  disabled={equipMutation.isPending}
                >
                  Equip
                </Button>
              )}
          </>
        }
      >
        {selected && (
          <div>
            <p>
              {selected.kind === 'stack'
                ? selected.stack.item.description
                : selected.instance.item.description}
            </p>
            <BonusList
              item={selected.kind === 'stack' ? selected.stack.item : selected.instance.item}
            />
            {selected.kind === 'stack' && (
              <p className="mt-2 text-xs text-stone-500">
                Quantity {selected.stack.quantity} / {selected.stack.item.maxStackQuantity} — one
                inventory slot per stack.
              </p>
            )}
            {selected.kind === 'instance' && selected.instance.item.levelRequirement > 1 && (
              <p className="mt-2 text-xs text-stone-500">
                Requires level {selected.instance.item.levelRequirement}.
              </p>
            )}
            {myShop.data &&
              (selected.kind === 'stack' ||
                (!selected.instance.equippedSlot && selected.instance.lockState === 'NONE')) && (
                <div className="mt-3 space-y-2 border-t border-stone-200 pt-3 dark:border-stone-800">
                  <p className="text-xs font-medium text-stone-600 dark:text-stone-400">
                    Sell via {myShop.data.name} (at a marketplace)
                  </p>
                  <div className="flex items-end gap-2">
                    <TextField
                      label="Price (Gold)"
                      value={listPrice}
                      onChange={(e) => setListPrice(e.target.value)}
                      placeholder="e.g. 50"
                    />
                    {selected.kind === 'stack' && (
                      <TextField
                        label="Qty"
                        type="number"
                        min={1}
                        max={selected.stack.quantity}
                        value={listQuantity}
                        onChange={(e) => setListQuantity(Number(e.target.value) || 1)}
                        className="w-20"
                      />
                    )}
                  </div>
                </div>
              )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
