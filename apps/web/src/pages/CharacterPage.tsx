import { Navigate } from 'react-router-dom';

import type { EquipmentSlotName } from '@rpg/shared';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useToast } from '../components/ui/Toast';
import { useCharacter, useCharacterStats } from '../features/character/useCharacter';
import { useCurrencyTransactions } from '../features/currency/useCurrency';
import { useInventory, useUnequip } from '../features/inventory/useInventory';

const EQUIPMENT_SLOTS: Array<{ slot: EquipmentSlotName; label: string }> = [
  { slot: 'MAIN_HAND', label: 'Main hand' },
  { slot: 'OFF_HAND', label: 'Off hand' },
  { slot: 'HEAD', label: 'Head' },
  { slot: 'BODY', label: 'Body' },
  { slot: 'HANDS', label: 'Hands' },
  { slot: 'LEGS', label: 'Legs' },
  { slot: 'FEET', label: 'Feet' },
  { slot: 'ACCESSORY_1', label: 'Accessory 1' },
  { slot: 'ACCESSORY_2', label: 'Accessory 2' },
];

function EquipmentPanel() {
  const inventory = useInventory();
  const unequip = useUnequip();
  const { showToast } = useToast();

  const bySlot = new Map<EquipmentSlotName, string>();
  for (const instance of inventory.data?.instances ?? []) {
    if (instance.equippedSlot) bySlot.set(instance.equippedSlot, instance.item.name);
  }

  return (
    <Card title="Equipment">
      <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">
        {EQUIPMENT_SLOTS.map(({ slot, label }) => {
          const equipped = bySlot.get(slot);
          return (
            <li key={slot} className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-stone-500 dark:text-stone-400">{label}</span>
              <span className="flex items-center gap-2">
                <span
                  className={
                    equipped
                      ? 'font-medium text-stone-900 dark:text-stone-100'
                      : 'text-stone-400 dark:text-stone-600'
                  }
                >
                  {equipped ?? 'Empty'}
                </span>
                {equipped && (
                  <Button
                    variant="ghost"
                    className="px-2 py-0.5 text-xs"
                    onClick={() =>
                      unequip.mutate(
                        { slot },
                        {
                          onError: (err) =>
                            showToast(
                              err instanceof Error ? err.message : 'Could not unequip.',
                              'error',
                            ),
                        },
                      )
                    }
                    disabled={unequip.isPending}
                  >
                    Unequip
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
        Equip gear from your inventory. Equipped items use no inventory slots.
      </p>
    </Card>
  );
}

function ResourceBar({
  label,
  value,
  max,
  barClass,
}: {
  label: string;
  value: number;
  max: number;
  barClass: string;
}) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-stone-600 dark:text-stone-400">
        <span>{label}</span>
        <span>
          {value} / {max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
        <div className={`h-full ${barClass}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

const ATTRIBUTE_LABELS: Array<{ key: keyof AttributeMap; label: string }> = [
  { key: 'strength', label: 'Strength' },
  { key: 'agility', label: 'Agility' },
  { key: 'magic', label: 'Magic' },
  { key: 'defense', label: 'Defense' },
  { key: 'magicDefense', label: 'Magic Defense' },
  { key: 'luck', label: 'Luck' },
];
type AttributeMap = {
  strength: number;
  agility: number;
  magic: number;
  defense: number;
  magicDefense: number;
  luck: number;
};

const LEDGER_TYPE_LABELS: Record<string, string> = {
  STARTING_GRANT: 'Starting grant',
  INN_REST: 'Inn rest',
  NPC_PURCHASE: 'Shop purchase',
  LISTING_FEE: 'Listing fee',
  MARKET_PURCHASE: 'Market purchase',
  MARKET_PROCEEDS: 'Market proceeds',
};

function LedgerPanel() {
  const transactions = useCurrencyTransactions();
  const rows = transactions.data?.transactions ?? [];
  return (
    <Card title="Recent ledger">
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">No Gold has moved yet.</p>
      ) : (
        <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">
          {rows.slice(0, 8).map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-stone-600 dark:text-stone-400">
                {LEDGER_TYPE_LABELS[entry.type] ?? entry.type}
              </span>
              <span className="flex items-baseline gap-3">
                <span
                  className={
                    entry.amount.startsWith('-')
                      ? 'font-medium text-red-700 dark:text-red-400'
                      : 'font-medium text-green-700 dark:text-green-400'
                  }
                >
                  {entry.amount.startsWith('-') ? entry.amount : `+${entry.amount}`}
                </span>
                <span className="text-xs text-stone-400">→ {entry.balanceAfter}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
        Every Gold change is recorded in the immutable ledger.
      </p>
    </Card>
  );
}

export function CharacterPage() {
  const { data: character, isPending, isError, refetch } = useCharacter();
  const { data: stats } = useCharacterStats(Boolean(character));

  if (isPending) return <LoadingState label="Consulting the guild records…" />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;
  if (!character) return <Navigate to="/character/new" replace />;

  const xpProgress =
    character.xpForNextLevel !== null
      ? `${character.xp} / ${character.xpForNextLevel} XP`
      : `${character.xp} XP (level cap reached)`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          {character.name}
        </h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Level {character.level} {character.class.name}
        </p>
      </div>

      <Card title="Vitals">
        <div className="space-y-3">
          <ResourceBar
            label="HP"
            value={character.resources.hp}
            max={character.resources.maxHp}
            barClass="bg-red-600"
          />
          <ResourceBar
            label="MP"
            value={character.resources.mp}
            max={character.resources.maxMp}
            barClass="bg-blue-600"
          />
          <ResourceBar
            label="Stamina"
            value={character.resources.stamina}
            max={character.resources.maxStamina}
            barClass="bg-green-600"
          />
        </div>
        <div className="mt-4 flex justify-between text-sm text-stone-700 dark:text-stone-300">
          <span>
            Gold:{' '}
            <span className="font-semibold text-amber-800 dark:text-amber-400">
              {character.gold}
            </span>
          </span>
          <span>{xpProgress}</span>
        </div>
      </Card>

      <Card title="Attributes">
        {stats ? (
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            {ATTRIBUTE_LABELS.map(({ key, label }) => (
              <div key={key} className="flex justify-between">
                <dt className="text-stone-500 dark:text-stone-400">{label}</dt>
                <dd className="font-medium text-stone-900 dark:text-stone-100">
                  {stats.attributes[key]}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <LoadingState label="Reading the ledger…" />
        )}
      </Card>

      <EquipmentPanel />

      <LedgerPanel />

      <Card title="Class">
        <p className="text-sm leading-6 text-stone-600 dark:text-stone-400">
          {character.class.description}
        </p>
      </Card>
    </div>
  );
}
