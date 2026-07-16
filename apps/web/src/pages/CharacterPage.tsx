import { Navigate } from 'react-router-dom';

import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useCharacter, useCharacterStats } from '../features/character/useCharacter';

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

      <Card title="Class">
        <p className="text-sm leading-6 text-stone-600 dark:text-stone-400">
          {character.class.description}
        </p>
      </Card>
    </div>
  );
}
