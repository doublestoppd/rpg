import { useState } from 'react';
import { Navigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/Toast';
import {
  useAdminCharacterSearch,
  useAdminEconomyMetrics,
  useAdminGoldAdjust,
  useAdminItemGrant,
  useAdminOverview,
  useAdminReauth,
  useAdminRedactMessage,
  useAdminReports,
  useAdminResolveReport,
  useAdminRestrict,
  useAdminSession,
} from '../features/admin/useAdmin';
import { useSession } from '../features/auth/useSession';

export function AdminPage() {
  const { data: session, isPending } = useSession();
  const isAdmin = session?.user.role === 'ADMIN';
  const adminSession = useAdminSession(isAdmin);

  if (isPending) return <LoadingState label="Checking credentials…" />;
  if (!session) return <Navigate to="/login" replace />;
  // Server-side authorization is always enforced; this guard is convenience.
  if (!isAdmin) return <Navigate to="/" replace />;

  const reauthValid = Boolean(adminSession.data?.reauthValidUntil);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Administration
        </h1>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Every action here is authorized server-side and recorded in an append-only audit log.
        </p>
      </div>

      <ReauthPanel reauthValid={reauthValid} />

      {reauthValid ? (
        <>
          <PlayerInvestigation />
          <EconomySection />
          <ModerationSection />
        </>
      ) : (
        <EmptyState
          title="Re-authentication required"
          description="Confirm your password above to unlock player detail, economy operations, and moderation."
        />
      )}
    </div>
  );
}

function ReauthPanel({ reauthValid }: { reauthValid: boolean }) {
  const reauth = useAdminReauth();
  const { showToast } = useToast();
  const [password, setPassword] = useState('');

  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex-1">
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            Recent authentication
          </h2>
          <p className="text-sm text-stone-500 dark:text-stone-400" aria-live="polite">
            {reauthValid ? 'Active — mutations are unlocked.' : 'Expired — confirm your password.'}
          </p>
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            reauth.mutate(password, {
              onSuccess: () => {
                setPassword('');
                showToast('Re-authenticated.', 'success');
              },
              onError: () => showToast('Re-authentication failed.', 'error'),
            });
          }}
        >
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button type="submit" disabled={reauth.isPending || !password}>
            Confirm
          </Button>
        </form>
      </div>
    </Card>
  );
}

function PlayerInvestigation() {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const search = useAdminCharacterSearch(query);
  const overview = useAdminOverview(selectedId);

  return (
    <Card>
      <h2 className="mb-2 text-base font-semibold text-stone-900 dark:text-stone-100">
        Player investigation
      </h2>
      <TextField
        label="Search by character name"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Start typing a name…"
      />
      <ul className="mt-2 divide-y divide-stone-200 dark:divide-stone-800">
        {(search.data?.characters ?? []).map((character) => (
          <li key={character.characterId} className="flex items-center justify-between py-1.5">
            <span className="text-sm">
              {character.name} <span className="text-xs text-stone-400">Lv {character.level}</span>{' '}
              <span className="text-xs text-stone-400">{character.accountEmailMasked}</span>
            </span>
            <Button variant="secondary" onClick={() => setSelectedId(character.characterId)}>
              Inspect
            </Button>
          </li>
        ))}
      </ul>

      {selectedId && overview.data && (
        <div className="mt-4 rounded-md border border-stone-200 p-3 dark:border-stone-800">
          <h3 className="text-sm font-semibold">{overview.data.name}</h3>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Level {overview.data.level} · Gold {overview.data.gold} ·{' '}
            {overview.data.currentLocationSlug ?? 'traveling'}
          </p>
          <PlayerActions characterId={selectedId} />
        </div>
      )}
    </Card>
  );
}

function PlayerActions({ characterId }: { characterId: string }) {
  const { showToast } = useToast();
  const gold = useAdminGoldAdjust(characterId);
  const grant = useAdminItemGrant(characterId);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [itemSlug, setItemSlug] = useState('');
  const [quantity, setQuantity] = useState('1');

  return (
    <div className="mt-3 grid gap-4 md:grid-cols-2">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          gold.mutate(
            { amount, reason },
            {
              onSuccess: (result) => {
                showToast(`Balance is now ${result.gold} Gold.`, 'success');
                setAmount('');
                setReason('');
              },
              onError: (error) => showToast(error.message, 'error'),
            },
          );
        }}
      >
        <p className="text-xs font-semibold uppercase text-stone-500">Gold adjustment</p>
        <TextField
          label="Amount (signed)"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="e.g. 500 or -100"
        />
        <TextField
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button type="submit" disabled={gold.isPending || !amount || reason.length < 3}>
          Apply
        </Button>
      </form>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          grant.mutate(
            { itemSlug, quantity: Number(quantity), reason },
            {
              onSuccess: () => {
                showToast('Item granted.', 'success');
                setItemSlug('');
              },
              onError: (error) => showToast(error.message, 'error'),
            },
          );
        }}
      >
        <p className="text-xs font-semibold uppercase text-stone-500">Grant item</p>
        <TextField
          label="Item slug"
          value={itemSlug}
          onChange={(event) => setItemSlug(event.target.value)}
          placeholder="e.g. copper-ore"
        />
        <TextField
          label="Quantity"
          type="number"
          min={1}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <Button type="submit" disabled={grant.isPending || !itemSlug || reason.length < 3}>
          Grant
        </Button>
      </form>
    </div>
  );
}

function EconomySection() {
  const metrics = useAdminEconomyMetrics(24, true);

  return (
    <Card>
      <h2 className="mb-2 text-base font-semibold text-stone-900 dark:text-stone-100">
        Economy metrics
        <span className="ml-2 text-xs font-normal text-stone-400">
          database-derived · last 24h · UTC
        </span>
      </h2>
      {metrics.isPending ? (
        <LoadingState label="Computing metrics…" />
      ) : metrics.data ? (
        <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
          <Metric label="Total Gold" value={metrics.data.totalGold} />
          <Metric label="Gold sources" value={metrics.data.goldSources} />
          <Metric label="Gold sinks" value={metrics.data.goldSinks} />
          <Metric label="Market gross" value={metrics.data.marketplaceGross} />
          <Metric label="Market tax" value={metrics.data.marketplaceTax} />
          <Metric label="Sales volume" value={String(metrics.data.marketplaceVolume)} />
          <Metric label="Items generated" value={String(metrics.data.itemsGenerated)} />
          <Metric label="Items destroyed" value={String(metrics.data.itemsDestroyed)} />
          <Metric label="Active listings" value={String(metrics.data.activeListings)} />
        </dl>
      ) : (
        <EmptyState title="No metrics" description="Nothing to show for this window." />
      )}
      <p className="mt-2 text-xs text-stone-400">
        These are authoritative, ledger-derived figures — distinct from resettable process
        telemetry, which is operational only.
      </p>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-stone-50 p-2 dark:bg-stone-800/50">
      <dt className="text-xs text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="font-mono text-sm text-stone-900 dark:text-stone-100">{value}</dd>
    </div>
  );
}

function ModerationSection() {
  const { showToast } = useToast();
  const reports = useAdminReports('OPEN');
  const redact = useAdminRedactMessage();
  const resolve = useAdminResolveReport();
  const restrict = useAdminRestrict();

  return (
    <Card>
      <h2 className="mb-2 text-base font-semibold text-stone-900 dark:text-stone-100">
        Chat moderation
      </h2>
      {reports.isPending ? (
        <LoadingState label="Loading reports…" />
      ) : (reports.data?.reports.length ?? 0) === 0 ? (
        <EmptyState title="No open reports" description="The moderation queue is clear." />
      ) : (
        <ul className="space-y-3">
          {reports.data!.reports.map((report) => (
            <li
              key={report.id}
              className="rounded-md border border-stone-200 p-3 text-sm dark:border-stone-800"
            >
              <p className="text-xs text-stone-400">
                {report.reason} · {report.channelSlug} ·{' '}
                {report.messageRedactedAt ? 'redacted' : 'visible'}
              </p>
              {/* Evidence rendered strictly as text. Reporter identity is
                  never present in the payload. */}
              <p className="mt-1 whitespace-pre-wrap break-words text-stone-700 dark:text-stone-300">
                {report.snapshotBody}
              </p>
              <p className="text-xs text-stone-400">by {report.snapshotAuthorName}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  disabled={redact.isPending || Boolean(report.messageRedactedAt)}
                  onClick={() =>
                    redact.mutate(
                      { messageId: report.messageId, reason: `report ${report.reason}` },
                      { onSuccess: () => showToast('Message redacted.', 'success') },
                    )
                  }
                >
                  Redact
                </Button>
                <Button
                  variant="secondary"
                  disabled={restrict.isPending}
                  onClick={() =>
                    restrict.mutate(
                      {
                        characterId: report.snapshotAuthorCharacterId,
                        reason: `report ${report.reason}`,
                      },
                      { onSuccess: () => showToast('Author restricted.', 'success') },
                    )
                  }
                >
                  Restrict author
                </Button>
                <Button
                  variant="ghost"
                  disabled={resolve.isPending}
                  onClick={() =>
                    resolve.mutate(
                      { reportId: report.id, resolution: 'RESOLVED', reason: 'handled' },
                      { onSuccess: () => showToast('Report resolved.', 'success') },
                    )
                  }
                >
                  Resolve
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
