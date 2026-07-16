import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import type { CharacterClassSlug } from '@rpg/shared';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { LoadingState } from '../components/ui/LoadingState';
import { TextField } from '../components/ui/TextField';
import {
  useCharacter,
  useCharacterClasses,
  useCreateCharacter,
} from '../features/character/useCharacter';
import { ApiRequestError } from '../lib/api';

export function CharacterCreatePage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const { data: classes, isPending: classesPending } = useCharacterClasses();
  const createCharacter = useCreateCharacter();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [classSlug, setClassSlug] = useState<CharacterClassSlug | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (characterPending || classesPending)
    return <LoadingState label="Preparing the guild ledger…" />;
  if (character) return <Navigate to="/character" replace />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!classSlug) {
      setError('Choose a class first.');
      return;
    }
    setError(null);
    createCharacter.mutate(
      { name, classSlug },
      {
        onSuccess: () => navigate('/character', { replace: true }),
        onError: (err) =>
          setError(err instanceof ApiRequestError ? err.message : 'Character creation failed.'),
      },
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
        Create your character
      </h1>
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3" role="radiogroup" aria-label="Class">
          {(classes ?? []).map((cls) => (
            <button
              key={cls.slug}
              type="button"
              role="radio"
              aria-checked={classSlug === cls.slug}
              onClick={() => setClassSlug(cls.slug)}
              className={`rounded-lg border p-4 text-left transition-colors ${
                classSlug === cls.slug
                  ? 'border-amber-700 bg-amber-50 dark:border-amber-500 dark:bg-stone-800'
                  : 'border-stone-200 bg-white hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900'
              }`}
            >
              <p className="font-semibold text-stone-900 dark:text-stone-100">{cls.name}</p>
              <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-stone-400">
                {cls.description}
              </p>
            </button>
          ))}
        </div>

        <Card>
          <TextField
            label="Character name"
            required
            minLength={3}
            maxLength={24}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <Button type="submit" disabled={createCharacter.isPending} className="mt-4">
            {createCharacter.isPending ? 'Creating…' : 'Begin your journey'}
          </Button>
        </Card>
      </form>
    </div>
  );
}
