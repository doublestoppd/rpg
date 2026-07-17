import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import type { CombatAbilityInfo, CombatantView, CombatView } from '@rpg/shared';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useCombatCommand, useCombatView } from '../features/combat/useCombat';
import { ApiRequestError } from '../lib/api';

const STATUS_LABELS: Record<string, string> = {
  POISON: 'Poison',
  BLIND: 'Blind',
  SILENCE: 'Silence',
  SLOW: 'Slow',
  HASTE: 'Haste',
  GUARD: 'Guard',
  STUN: 'Stun',
  ARMOR_BREAK: 'Armor Break',
};

function Bar({
  value,
  max,
  tone,
  label,
}: {
  value: number;
  max: number;
  tone: 'hp' | 'mp' | 'gauge';
  label?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tones = {
    hp: 'bg-green-600',
    mp: 'bg-blue-600',
    gauge: 'bg-amber-500',
  } as const;
  return (
    <div>
      {label && (
        <div className="flex justify-between text-xs text-stone-600 dark:text-stone-400">
          <span>{label}</span>
          {tone !== 'gauge' && (
            <span>
              {value}/{max}
            </span>
          )}
        </div>
      )}
      <div
        className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
        role={tone === 'gauge' ? 'progressbar' : undefined}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full ${tones[tone]}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function StatusChips({ combatant }: { combatant: CombatantView }) {
  if (combatant.statuses.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {combatant.statuses.map((status) => (
        <span
          key={status.type}
          className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-800 dark:bg-purple-950 dark:text-purple-300"
        >
          {STATUS_LABELS[status.type] ?? status.type}
        </span>
      ))}
    </div>
  );
}

type Menu =
  | { mode: 'MAIN' }
  | { mode: 'ABILITY' | 'MAGIC' | 'ITEM' }
  | { mode: 'TARGET'; action: 'ATTACK' | 'ABILITY' | 'MAGIC'; abilitySlug?: string };

export function CombatPage() {
  const { combatId } = useParams<{ combatId: string }>();
  const view = useCombatView(combatId ?? null);
  const sendCommand = useCombatCommand(combatId ?? '');
  const [menu, setMenu] = useState<Menu>({ mode: 'MAIN' });
  const [error, setError] = useState<string | null>(null);

  if (!combatId) return <Navigate to="/location" replace />;
  if (view.isPending) return <LoadingState label="Reading the field…" />;
  if (view.isError || !view.data) return <ErrorState onRetry={() => void view.refetch()} />;

  const combat: CombatView = view.data;
  const busy = sendCommand.isPending;

  const issue = (payload: {
    action: 'ATTACK' | 'ABILITY' | 'MAGIC' | 'ITEM' | 'DEFEND' | 'FLEE';
    targetCombatantId?: string;
    abilitySlug?: string;
    itemSlug?: string;
  }) => {
    setError(null);
    sendCommand.mutate(
      {
        ...payload,
        idempotencyKey: crypto.randomUUID().replaceAll('-', ''),
        expectedVersion: combat.version,
      },
      {
        onSuccess: () => setMenu({ mode: 'MAIN' }),
        onError: (err) => {
          setMenu({ mode: 'MAIN' });
          if (err instanceof ApiRequestError && err.code === 'STALE_COMBAT_VERSION') {
            void view.refetch();
            setError('The battle moved on — state refreshed, try again.');
          } else {
            setError(err instanceof ApiRequestError ? err.message : 'The command failed.');
          }
        },
      },
    );
  };

  const pickTarget = (enemy: CombatantView) => {
    if (menu.mode !== 'TARGET' || enemy.defeated) return;
    if (menu.action === 'ATTACK') issue({ action: 'ATTACK', targetCombatantId: enemy.id });
    else
      issue({ action: menu.action, abilitySlug: menu.abilitySlug!, targetCombatantId: enemy.id });
  };

  const useAbility = (kind: 'ABILITY' | 'MAGIC', ability: CombatAbilityInfo) => {
    if (ability.targeting === 'ENEMY') {
      setMenu({ mode: 'TARGET', action: kind, abilitySlug: ability.slug });
    } else {
      issue({ action: kind, abilitySlug: ability.slug });
    }
  };

  const abilityMenu = (kind: 'ABILITY' | 'MAGIC') => {
    const wanted = kind === 'MAGIC' ? ['MAGICAL'] : ['PHYSICAL', 'SUPPORT'];
    const entries = combat.abilities.filter((a) => wanted.includes(a.kind));
    if (entries.length === 0)
      return (
        <p className="text-sm text-stone-600 dark:text-stone-400">You know no such techniques.</p>
      );
    return (
      <ul className="space-y-1">
        {entries.map((ability) => (
          <li key={ability.slug}>
            <button
              type="button"
              disabled={busy || ability.mpCost > combat.player.mp}
              onClick={() => useAbility(kind, ability)}
              className="w-full rounded border border-stone-200 px-2 py-1.5 text-left text-sm hover:bg-stone-50 disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-800"
            >
              <span className="font-medium text-stone-900 dark:text-stone-100">{ability.name}</span>
              <span className="float-right text-xs text-stone-500">{ability.mpCost} MP</span>
              <span className="block text-xs text-stone-600 dark:text-stone-400">
                {ability.description}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          {combat.encounter.name}
        </h1>
        <span className="text-xs uppercase tracking-wide text-stone-500">
          {combat.encounter.kind.toLowerCase()}
        </span>
      </div>

      {/* Enemies */}
      <section aria-label="Enemies" className="grid gap-2 sm:grid-cols-2">
        {combat.enemies.map((enemy) => {
          const targetable = menu.mode === 'TARGET' && !enemy.defeated;
          return (
            <button
              key={enemy.id}
              type="button"
              disabled={!targetable || busy}
              onClick={() => pickTarget(enemy)}
              className={`rounded-lg border p-3 text-left ${
                enemy.defeated
                  ? 'border-stone-200 opacity-40 dark:border-stone-800'
                  : targetable
                    ? 'border-red-400 ring-2 ring-red-300 hover:bg-red-50 dark:border-red-700 dark:ring-red-900 dark:hover:bg-red-950'
                    : 'border-stone-200 dark:border-stone-800'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {enemy.name}
                </p>
                <span className="text-[10px] uppercase text-stone-500">
                  {enemy.row === 'BACK' ? 'back row' : 'front'}
                </span>
              </div>
              {enemy.defeated ? (
                <p className="mt-1 text-xs font-medium text-stone-500">Defeated</p>
              ) : (
                <div className="mt-1 space-y-1">
                  <Bar value={enemy.hp} max={enemy.maxHp} tone="hp" />
                  <Bar value={enemy.gauge} max={100} tone="gauge" />
                  <StatusChips combatant={enemy} />
                </div>
              )}
            </button>
          );
        })}
      </section>

      {/* Player */}
      <Card>
        <div className="flex items-baseline justify-between">
          <p className="font-semibold text-stone-900 dark:text-stone-100">{combat.player.name}</p>
          {combat.awaitingCommand && (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Your move
            </span>
          )}
        </div>
        <div className="mt-2 space-y-1.5">
          <Bar value={combat.player.hp} max={combat.player.maxHp} tone="hp" label="HP" />
          <Bar value={combat.player.mp} max={combat.player.maxMp} tone="mp" label="MP" />
          <StatusChips combatant={combat.player} />
        </div>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Commands / outcome */}
      {combat.status === 'ACTIVE' ? (
        <Card title={menu.mode === 'TARGET' ? 'Choose a target' : 'Commands'}>
          {menu.mode === 'MAIN' && (
            <div className="grid grid-cols-3 gap-2">
              <Button disabled={busy} onClick={() => setMenu({ mode: 'TARGET', action: 'ATTACK' })}>
                Attack
              </Button>
              <Button disabled={busy} onClick={() => setMenu({ mode: 'ABILITY' })}>
                Ability
              </Button>
              <Button disabled={busy} onClick={() => setMenu({ mode: 'MAGIC' })}>
                Magic
              </Button>
              <Button disabled={busy} onClick={() => setMenu({ mode: 'ITEM' })}>
                Item
              </Button>
              <Button disabled={busy} onClick={() => issue({ action: 'DEFEND' })}>
                Defend
              </Button>
              <Button
                disabled={busy || !combat.encounter.fleeable}
                onClick={() => issue({ action: 'FLEE' })}
              >
                Flee
              </Button>
            </div>
          )}
          {menu.mode === 'ABILITY' && abilityMenu('ABILITY')}
          {menu.mode === 'MAGIC' && abilityMenu('MAGIC')}
          {menu.mode === 'ITEM' &&
            (combat.usableItems.length === 0 ? (
              <p className="text-sm text-stone-600 dark:text-stone-400">
                Nothing in your pack can help here.
              </p>
            ) : (
              <ul className="space-y-1">
                {combat.usableItems.map((item) => (
                  <li key={item.slug}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => issue({ action: 'ITEM', itemSlug: item.slug })}
                      className="w-full rounded border border-stone-200 px-2 py-1.5 text-left text-sm hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800"
                    >
                      <span className="font-medium text-stone-900 dark:text-stone-100">
                        {item.name}
                      </span>
                      <span className="float-right text-xs text-stone-500">×{item.quantity}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          {menu.mode !== 'MAIN' && (
            <Button className="mt-3" disabled={busy} onClick={() => setMenu({ mode: 'MAIN' })}>
              Back
            </Button>
          )}
        </Card>
      ) : (
        <Card
          title={
            combat.status === 'VICTORY'
              ? 'Victory!'
              : combat.status === 'DEFEAT'
                ? 'Defeat…'
                : 'You escaped'
          }
        >
          {combat.status === 'VICTORY' && combat.rewards && (
            <div className="space-y-1 text-sm text-stone-900 dark:text-stone-100">
              <p>
                You gained <strong>{combat.rewards.xp} XP</strong> and{' '}
                <strong>{combat.rewards.gold} Gold</strong>.
              </p>
              {combat.rewards.drops.map((drop) => (
                <p key={drop.name}>
                  Spoils: {drop.name} ×{drop.quantity}
                </p>
              ))}
              {combat.rewards.leftBehind.map((drop) => (
                <p key={drop.name} className="text-stone-500">
                  Left behind (pack full): {drop.name} ×{drop.quantity}
                </p>
              ))}
              {combat.rewards.leveledUp && (
                <p className="font-semibold text-amber-700 dark:text-amber-400">
                  Level up! You are now level {combat.rewards.level}.
                </p>
              )}
            </div>
          )}
          {combat.status === 'DEFEAT' && (
            <p className="text-sm text-stone-600 dark:text-stone-400">
              Kind hands carried you back to Crownfall City.
            </p>
          )}
          <Link
            to="/location"
            className="mt-3 inline-block text-sm font-medium text-amber-800 hover:underline dark:text-amber-400"
          >
            Return to your surroundings →
          </Link>
        </Card>
      )}

      {/* Log */}
      <Card title="Battle log">
        <ul className="max-h-56 space-y-0.5 overflow-y-auto text-xs leading-5 text-stone-700 dark:text-stone-300">
          {[...combat.log].reverse().map((line, index) => (
            <li key={`${combat.log.length - index}-${line}`}>{line}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
