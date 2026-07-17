import type { MarketplaceListingInfo } from '@rpg/shared';
import { type FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingState } from '../components/ui/LoadingState';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/Toast';
import { useCharacter } from '../features/character/useCharacter';
import { useCurrency } from '../features/currency/useCurrency';
import {
  useCancelListing,
  useCreateShop,
  useDeliveries,
  useListings,
  useMarketSummary,
  useMyShop,
  usePurchaseListing,
  useRegions,
  useUpdateShop,
} from '../features/marketplace/useMarketplace';
import { ApiRequestError } from '../lib/api';

function newKey() {
  return crypto.randomUUID().replaceAll('-', '');
}

function MyShopCard() {
  const shop = useMyShop();
  const regions = useRegions();
  const createShop = useCreateShop();
  const updateShop = useUpdateShop();
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [region, setRegion] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState(false);

  if (shop.isPending) return <LoadingState label="Checking the trade registry…" />;

  if (!shop.data) {
    const onCreate = (event: FormEvent) => {
      event.preventDefault();
      if (!region) {
        showToast('Pick a region for your shop.', 'error');
        return;
      }
      createShop.mutate(
        { name, description, region },
        {
          onSuccess: () => showToast('Your shop is registered.', 'success'),
          onError: (err) =>
            showToast(
              err instanceof ApiRequestError ? err.message : 'Could not open shop.',
              'error',
            ),
        },
      );
    };
    return (
      <Card title="Open your shop">
        <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
          Register a shop to a region to start selling. Listings are created at a marketplace;
          buyers in other regions pay shipping and wait for delivery.
        </p>
        <form onSubmit={onCreate} className="space-y-3">
          <TextField
            label="Shop name"
            required
            minLength={3}
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div>
            <p className="mb-1 text-sm font-medium text-stone-700 dark:text-stone-300">Region</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Region">
              {(regions.data?.regions ?? []).map((r) => (
                <Button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={region === r}
                  variant={region === r ? 'primary' : 'secondary'}
                  onClick={() => setRegion(r)}
                >
                  {r}
                </Button>
              ))}
            </div>
          </div>
          <TextField
            label="Description (optional)"
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button type="submit" disabled={createShop.isPending}>
            Open shop
          </Button>
        </form>
      </Card>
    );
  }

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    updateShop.mutate(
      { name: name || undefined, description },
      {
        onSuccess: () => {
          setEditing(false);
          showToast('Shop updated.', 'success');
        },
        onError: (err) =>
          showToast(err instanceof ApiRequestError ? err.message : 'Update failed.', 'error'),
      },
    );
  };

  return (
    <Card
      title={`${shop.data.name}`}
      actions={
        <Button
          variant="ghost"
          className="px-2 py-1 text-xs"
          onClick={() => {
            setEditing((v) => !v);
            setName(shop.data!.name);
            setDescription(shop.data!.description);
          }}
        >
          {editing ? 'Close' : 'Edit'}
        </Button>
      }
    >
      <p className="text-xs text-stone-500 dark:text-stone-400">
        Registered to <span className="font-medium">{shop.data.region}</span>
      </p>
      {shop.data.description && (
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{shop.data.description}</p>
      )}
      {editing && (
        <form onSubmit={onSave} className="mt-3 space-y-3">
          <TextField
            label="Shop name"
            minLength={3}
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Description"
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button type="submit" disabled={updateShop.isPending}>
            Save
          </Button>
        </form>
      )}
    </Card>
  );
}

function DeliveriesCard() {
  const deliveries = useDeliveries();
  const rows = deliveries.data?.deliveries ?? [];
  if (rows.length === 0) return null;
  return (
    <Card title="Deliveries">
      <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">
        {rows.slice(0, 6).map((delivery) => (
          <li key={delivery.id} className="flex items-center justify-between gap-2 py-1.5">
            <span className="text-stone-700 dark:text-stone-300">
              {delivery.lines.map((line) => `${line.quantity} × ${line.itemName}`).join(', ')}
            </span>
            {delivery.status === 'DELIVERED' ? (
              <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
                Delivered
              </span>
            ) : (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {delivery.remainingSeconds > 0
                  ? `Arrives in ${delivery.remainingSeconds}s`
                  : 'Arriving…'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SummaryCard({ itemSlug }: { itemSlug: string }) {
  const summary = useMarketSummary(itemSlug);
  if (!summary.data) return null;
  const s = summary.data;
  return (
    <Card title="Market summary">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-stone-500 dark:text-stone-400">Active listings</dt>
          <dd className="font-semibold text-stone-900 dark:text-stone-100">{s.activeListings}</dd>
        </div>
        <div>
          <dt className="text-stone-500 dark:text-stone-400">Cheapest</dt>
          <dd className="font-semibold text-stone-900 dark:text-stone-100">
            {s.cheapestPrice ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500 dark:text-stone-400">Recent sales</dt>
          <dd className="font-semibold text-stone-900 dark:text-stone-100">{s.recentSales}</dd>
        </div>
        <div>
          <dt className="text-stone-500 dark:text-stone-400">Median / volume</dt>
          <dd className="font-semibold text-stone-900 dark:text-stone-100">
            {s.insufficientHistory
              ? 'Insufficient market history'
              : `${s.medianUnitPrice} · ${s.volume}`}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

export function MarketplacePage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const { data: wallet } = useCurrency(Boolean(character));
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const listingsQuery = {
    ...(search ? { itemSlug: search } : {}),
    ...(mine ? { mine: true } : {}),
  };
  const listings = useListings(listingsQuery, Boolean(character));
  const purchase = usePurchaseListing();
  const cancel = useCancelListing();
  const { showToast } = useToast();
  const [buying, setBuying] = useState<MarketplaceListingInfo | null>(null);

  if (characterPending) return <LoadingState label="Reading the trade boards…" />;
  if (!character) return <Navigate to="/character/new" replace />;

  const unavailable =
    listings.isError && listings.error instanceof ApiRequestError && listings.error.status === 409;

  const confirmPurchase = () => {
    if (!buying) return;
    purchase.mutate(
      { listingId: buying.id, idempotencyKey: newKey() },
      {
        onSuccess: (result) => {
          setBuying(null);
          showToast(
            result.remote
              ? `Purchase complete — shipping ${result.shippingFee} Gold; delivery on the way.`
              : `Purchase complete for ${result.totalCharged} Gold.`,
            'success',
          );
        },
        onError: (err) =>
          showToast(err instanceof ApiRequestError ? err.message : 'Purchase failed.', 'error'),
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Marketplace
        </h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Gold:{' '}
          <span className="font-semibold text-amber-800 dark:text-amber-400">
            {wallet?.gold ?? '…'}
          </span>
        </p>
      </div>

      <MyShopCard />
      <DeliveriesCard />

      {unavailable ? (
        <Card title="The boards are out of reach">
          <p className="text-sm text-stone-600 dark:text-stone-400">
            {(listings.error as ApiRequestError).message}
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <TextField
                label="Filter by item slug"
                placeholder="e.g. copper-ore"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant={mine ? 'primary' : 'secondary'} onClick={() => setMine((v) => !v)}>
              {mine ? 'Showing my listings' : 'Show my listings'}
            </Button>
          </div>

          {search && <SummaryCard itemSlug={search} />}

          {listings.data && listings.data.listings.length === 0 ? (
            <EmptyState
              title="No listings match"
              description="Nothing is on the boards right now. List something from your inventory at a marketplace."
            />
          ) : (
            <Card>
              <ul className="divide-y divide-stone-200 dark:divide-stone-800">
                {(listings.data?.listings ?? []).map((listing) => (
                  <li key={listing.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-medium text-stone-900 dark:text-stone-100">
                        {listing.quantity > 1 ? `${listing.quantity} × ` : ''}
                        {listing.item.name}
                      </p>
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        {listing.shopName} · {listing.shopRegion}
                        {listing.local ? ' · local' : ' · ships to you'}
                        {mine ? ` · ${listing.status}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-semibold text-amber-800 dark:text-amber-400">
                        {listing.price} Gold
                      </span>
                      {listing.isYours ? (
                        listing.status === 'ACTIVE' ? (
                          <Button
                            variant="ghost"
                            className="px-2 py-1 text-xs"
                            disabled={cancel.isPending}
                            onClick={() =>
                              cancel.mutate(listing.id, {
                                onSuccess: () =>
                                  showToast('Listing canceled and returned.', 'success'),
                                onError: (err) =>
                                  showToast(
                                    err instanceof ApiRequestError ? err.message : 'Cancel failed.',
                                    'error',
                                  ),
                              })
                            }
                          >
                            Cancel
                          </Button>
                        ) : null
                      ) : (
                        <Button
                          variant="secondary"
                          className="px-3 py-1 text-xs"
                          onClick={() => setBuying(listing)}
                        >
                          Buy
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <Dialog
        open={buying !== null}
        title={buying ? `Buy ${buying.item.name}` : ''}
        onClose={() => setBuying(null)}
        footer={
          buying ? (
            <>
              <Button variant="ghost" onClick={() => setBuying(null)}>
                Cancel
              </Button>
              <Button onClick={confirmPurchase} disabled={purchase.isPending}>
                Pay {buying.price} Gold{buying.local ? '' : ' + shipping'}
              </Button>
            </>
          ) : undefined
        }
      >
        {buying && (
          <div className="space-y-2 text-sm">
            <p>
              {buying.quantity > 1 ? `${buying.quantity} × ` : ''}
              {buying.item.name} from {buying.shopName} ({buying.shopRegion}).
            </p>
            {!buying.local && (
              <p className="text-stone-500">
                This shop trades from another region: shipping is charged and the goods arrive by
                timed delivery. You own them the moment you pay.
              </p>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
