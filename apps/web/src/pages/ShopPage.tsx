import type { InventoryStackInfo, NpcShopStockEntryInfo, StockLevel } from '@rpg/shared';
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useToast } from '../components/ui/Toast';
import { useSellback } from '../features/activities/useActivities';
import { useCharacter } from '../features/character/useCharacter';
import { useCurrency } from '../features/currency/useCurrency';
import { useInventory } from '../features/inventory/useInventory';
import { usePurchase, useShopDetail } from '../features/npc-shops/useNpcShops';
import { ApiRequestError } from '../lib/api';

const STOCK_BADGES: Record<StockLevel, { label: string; className: string }> = {
  PLENTY: {
    label: 'In stock',
    className: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  },
  SOME: {
    label: 'Limited',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  LOW: {
    label: 'Almost gone',
    className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  },
  SOLD_OUT: {
    label: 'Sold out',
    className: 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
  },
};

export function ShopPage() {
  const { shopId } = useParams<{ shopId: string }>();
  const { data: character, isPending: characterPending } = useCharacter();
  const shop = useShopDetail(shopId);
  const purchase = usePurchase(shopId ?? '');
  const sellback = useSellback(shopId ?? '');
  const inventory = useInventory(Boolean(character));
  const { data: wallet } = useCurrency(Boolean(character));
  const { showToast } = useToast();
  const [selected, setSelected] = useState<NpcShopStockEntryInfo | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [sellSelected, setSellSelected] = useState<InventoryStackInfo | null>(null);
  const [sellQuantity, setSellQuantity] = useState(1);

  if (characterPending) return <LoadingState label="Pushing open the shop door…" />;
  if (!character) return <Navigate to="/character/new" replace />;
  if (shop.isPending) return <LoadingState label="Pushing open the shop door…" />;
  if (shop.isError || !shop.data) {
    const message =
      shop.error instanceof ApiRequestError && shop.error.status === 409
        ? 'This shop is not at your current location.'
        : undefined;
    return <ErrorState {...(message ? { message } : {})} onRetry={() => void shop.refetch()} />;
  }

  const maxBuyable = (entry: NpcShopStockEntryInfo) =>
    Math.max(0, entry.perCharacterLimit - entry.purchasedByYou);

  const confirmPurchase = () => {
    if (!selected) return;
    purchase.mutate(
      {
        stockEntryId: selected.id,
        quantity,
        idempotencyKey: crypto.randomUUID().replaceAll('-', ''),
      },
      {
        onSuccess: (result) => {
          setSelected(null);
          showToast(
            `Bought ${result.quantity} × ${selected.item.name} for ${result.totalPrice} Gold.`,
            'success',
          );
        },
        onError: (err) =>
          showToast(
            err instanceof ApiRequestError ? err.message : 'The shopkeeper shakes their head.',
            'error',
          ),
      },
    );
  };

  const confirmSell = () => {
    if (!sellSelected) return;
    sellback.mutate(
      { itemSlug: sellSelected.item.slug, quantity: sellQuantity },
      {
        onSuccess: (result) => {
          setSellSelected(null);
          showToast(
            `Sold ${result.quantity} × ${sellSelected.item.name} for ${result.goldReceived} Gold.`,
            'success',
          );
        },
        onError: (err) =>
          showToast(
            err instanceof ApiRequestError ? err.message : 'The shopkeeper will not buy that.',
            'error',
          ),
      },
    );
  };

  const sellableStacks = inventory.data?.stacks ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
            {shop.data.shop.name}
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
            {shop.data.shop.description}
          </p>
        </div>
        <p className="shrink-0 text-sm text-stone-600 dark:text-stone-400">
          Your Gold:{' '}
          <span className="font-semibold text-amber-800 dark:text-amber-400">
            {wallet?.gold ?? '…'}
          </span>
        </p>
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400">
        <Link
          to="/location"
          className="font-medium text-amber-800 hover:underline dark:text-amber-400"
        >
          ← Back to the district
        </Link>
      </p>

      {shop.data.stock.length === 0 ? (
        <EmptyState
          title="The shelves are bare"
          description="The shopkeeper mutters about a delayed shipment. Check back later."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-200 dark:divide-stone-800">
            {shop.data.stock.map((entry) => {
              const badge = STOCK_BADGES[entry.stockLevel];
              const remainingAllowance = maxBuyable(entry);
              return (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium text-stone-900 dark:text-stone-100">
                      {entry.item.name}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      {entry.unitPrice} Gold · limit {entry.perCharacterLimit} per restock
                      {entry.purchasedByYou > 0 ? ` (you bought ${entry.purchasedByYou})` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                    <Button
                      variant="secondary"
                      className="px-3 py-1 text-xs"
                      disabled={entry.stockLevel === 'SOLD_OUT' || remainingAllowance === 0}
                      onClick={() => {
                        setSelected(entry);
                        setQuantity(1);
                      }}
                    >
                      Buy
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
          Sell to the shop
        </h2>
        {sellableStacks.length === 0 ? (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            You have no stackable goods to sell here. The shop pays below its own asking price.
          </p>
        ) : (
          <Card>
            <ul className="divide-y divide-stone-200 dark:divide-stone-800">
              {sellableStacks.map((stack) => (
                <li
                  key={stack.item.slug}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-stone-900 dark:text-stone-100">
                      {stack.item.name}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      You hold {stack.quantity}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    className="px-3 py-1 text-xs"
                    onClick={() => {
                      setSellSelected(stack);
                      setSellQuantity(1);
                    }}
                  >
                    Sell
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Dialog
        open={sellSelected !== null}
        title={sellSelected ? `Sell ${sellSelected.item.name}` : ''}
        onClose={() => setSellSelected(null)}
        footer={
          sellSelected ? (
            <>
              <Button variant="ghost" onClick={() => setSellSelected(null)}>
                Cancel
              </Button>
              <Button onClick={confirmSell} disabled={sellback.isPending}>
                Sell {sellQuantity}
              </Button>
            </>
          ) : undefined
        }
      >
        {sellSelected && (
          <div className="space-y-3">
            <p className="text-sm text-stone-600 dark:text-stone-400">
              The shop buys goods below its asking price — selling is a Gold sink, not an arbitrage.
            </p>
            <div className="flex items-center gap-3">
              <span className="text-sm">Quantity</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  className="px-2 py-0.5"
                  onClick={() => setSellQuantity((q) => Math.max(1, q - 1))}
                >
                  −
                </Button>
                <span className="w-8 text-center font-medium" data-testid="sell-quantity">
                  {sellQuantity}
                </span>
                <Button
                  variant="secondary"
                  className="px-2 py-0.5"
                  onClick={() => setSellQuantity((q) => Math.min(sellSelected.quantity, q + 1))}
                >
                  +
                </Button>
              </div>
              <span className="text-xs text-stone-500">of {sellSelected.quantity}</span>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={selected !== null}
        title={selected ? `Buy ${selected.item.name}` : ''}
        onClose={() => setSelected(null)}
        footer={
          selected ? (
            <>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Cancel
              </Button>
              <Button onClick={confirmPurchase} disabled={purchase.isPending}>
                Pay {(BigInt(selected.unitPrice) * BigInt(quantity)).toString()} Gold
              </Button>
            </>
          ) : undefined
        }
      >
        {selected && (
          <div className="space-y-3">
            <p>{selected.item.description}</p>
            <div className="flex items-center gap-3">
              <span className="text-sm">Quantity</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  className="px-2 py-0.5"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                >
                  −
                </Button>
                <span className="w-8 text-center font-medium" data-testid="buy-quantity">
                  {quantity}
                </span>
                <Button
                  variant="secondary"
                  className="px-2 py-0.5"
                  onClick={() => setQuantity((q) => Math.min(maxBuyable(selected), q + 1))}
                >
                  +
                </Button>
              </div>
              <span className="text-xs text-stone-500">
                up to {maxBuyable(selected)} this restock
              </span>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
