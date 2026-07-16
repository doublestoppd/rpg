import { Card } from '../components/ui/Card';

export function LandingPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Welcome, traveler</h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          A persistent fantasy world of connected places, honest ledgers, and hard-won goods awaits.
          Gather, craft, trade, and fight your way through the Crownfall region.
        </p>
      </div>
      <Card title="The world is being forged">
        <p className="text-sm leading-6 text-stone-600">
          The realm opens in stages. Accounts, characters, travel, and the regional economy arrive
          with each new phase of construction — check back as the gates open.
        </p>
      </Card>
    </div>
  );
}
