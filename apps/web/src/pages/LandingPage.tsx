import { Navigate } from 'react-router-dom';

import { Card } from '../components/ui/Card';
import { LoadingState } from '../components/ui/LoadingState';
import { useSession } from '../features/auth/useSession';
import { useCharacter } from '../features/character/useCharacter';

export function LandingPage() {
  const { data: session, isPending: sessionPending } = useSession();
  const { data: character, isPending: characterPending } = useCharacter(Boolean(session));

  // A signed-in account with no character has only one thing to do — send them
  // straight to character creation rather than a dead-end welcome page.
  if (session) {
    if (characterPending) return <LoadingState label="Waking the world…" />;
    if (!character) return <Navigate to="/character/new" replace />;
    return <Navigate to="/location" replace />;
  }

  if (sessionPending) return <LoadingState label="Waking the world…" />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Welcome, traveler
        </h1>
        <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
          A persistent fantasy world of connected places, honest ledgers, and hard-won goods awaits.
          Gather, craft, trade, and fight your way through the Crownfall region.
        </p>
      </div>
      <Card title="Begin your journey">
        <p className="text-sm leading-6 text-stone-600 dark:text-stone-400">
          Create an account to forge a character and step into the realm. Log in to pick up where
          you left off.
        </p>
      </Card>
    </div>
  );
}
