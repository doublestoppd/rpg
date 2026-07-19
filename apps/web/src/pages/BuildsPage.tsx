import { Navigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';
import { useToast } from '../components/ui/Toast';
import { useBuild, useChooseTalent, useRespec, useSetLoadout } from '../features/builds/useBuilds';
import { useCharacter } from '../features/character/useCharacter';

export function BuildsPage() {
  const { data: character, isPending: charPending } = useCharacter();
  const build = useBuild(Boolean(character));
  const setLoadout = useSetLoadout();
  const chooseTalent = useChooseTalent();
  const respec = useRespec();
  const { showToast } = useToast();

  if (charPending) return <LoadingState label="Loading…" />;
  if (!character) return <Navigate to="/character/new" replace />;
  if (build.isPending) return <LoadingState label="Loading your build…" />;
  if (!build.data) return <EmptyState title="No build" description="Nothing to show." />;

  const b = build.data;
  const equippedCount = b.abilities.filter((a) => a.equipped).length;

  const toggleAbility = (slug: string, equipped: boolean) => {
    const current = b.abilities.filter((a) => a.equipped).map((a) => a.slug);
    const next = equipped ? current.filter((s) => s !== slug) : [...current, slug];
    setLoadout.mutate(next, { onError: (e) => showToast(e.message, 'error') });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Build
        </h1>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Level {b.level} {b.classSlug}. Equip up to {b.loadoutCapacity} abilities and choose a
          talent per unlocked tier. Changes never affect a battle already underway.
        </p>
      </div>

      <Card>
        <h2 className="mb-2 text-base font-semibold text-stone-900 dark:text-stone-100">
          Abilities
          <span className="ml-2 text-xs font-normal text-stone-400">
            {equippedCount} / {b.loadoutCapacity} equipped
          </span>
        </h2>
        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
          {b.abilities.map((a) => {
            const atCap = !a.equipped && equippedCount >= b.loadoutCapacity;
            return (
              <li key={a.slug} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    {a.name}
                    <span className="ml-2 text-xs text-stone-400">
                      {a.mpCost} MP{a.cooldownTurns > 0 ? ` · ${a.cooldownTurns}t cooldown` : ''}
                    </span>
                  </p>
                  <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                    {a.description}
                  </p>
                </div>
                {a.unlocked ? (
                  <Button
                    variant={a.equipped ? 'secondary' : 'primary'}
                    className="shrink-0 px-2 py-1 text-xs"
                    disabled={setLoadout.isPending || atCap}
                    onClick={() => toggleAbility(a.slug, a.equipped)}
                  >
                    {a.equipped ? 'Unequip' : 'Equip'}
                  </Button>
                ) : (
                  <span className="shrink-0 text-xs text-stone-400">Lv {a.unlockLevel}</span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold text-stone-900 dark:text-stone-100">Talents</h2>
        <div className="space-y-4">
          {b.talents.map((tier) => (
            <div key={tier.tier}>
              <p className="mb-1 text-xs font-semibold uppercase text-stone-500">
                Tier {tier.tier}
                {!tier.unlocked && (
                  <span className="ml-1 font-normal text-stone-400">
                    (unlocks Lv {tier.unlockLevel})
                  </span>
                )}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {tier.options.map((opt) => (
                  <button
                    key={opt.slug}
                    type="button"
                    disabled={!tier.unlocked || chooseTalent.isPending}
                    onClick={() =>
                      chooseTalent.mutate(
                        { tier: tier.tier, talentSlug: opt.chosen ? null : opt.slug },
                        { onError: (e) => showToast(e.message, 'error') },
                      )
                    }
                    className={`rounded-md border p-2 text-left text-sm disabled:opacity-50 ${
                      opt.chosen
                        ? 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950'
                        : 'border-stone-200 dark:border-stone-800'
                    }`}
                  >
                    <span className="font-medium text-stone-900 dark:text-stone-100">
                      {opt.name}
                    </span>
                    <span className="block text-xs text-stone-500 dark:text-stone-400">
                      {opt.effect}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              Respec at a trainer
            </h2>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              Reset your loadout and talents for {b.respecFeeGold} Gold. Your level and XP are
              untouched.
            </p>
          </div>
          <Button
            variant="danger"
            disabled={respec.isPending}
            onClick={() =>
              respec.mutate(undefined, {
                onSuccess: () => showToast('Respec complete.', 'success'),
                onError: (e) => showToast(e.message, 'error'),
              })
            }
          >
            Respec ({b.respecFeeGold}g)
          </Button>
        </div>
      </Card>
    </div>
  );
}
