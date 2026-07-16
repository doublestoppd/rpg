/**
 * Original static artwork placeholders, referenced by asset key. Each key maps
 * to a simple scene rendered with gradients and shapes — swapped for real art
 * later without touching API data.
 */

interface ArtworkSpec {
  sky: string;
  ground: string;
  accent: string;
  label: string;
}

const ARTWORK: Record<string, ArtworkSpec> = {
  'crownfall-city': {
    sky: 'from-amber-200 to-orange-300 dark:from-amber-900 dark:to-stone-900',
    ground: 'bg-stone-400 dark:bg-stone-700',
    accent: 'bg-stone-600 dark:bg-stone-500',
    label: 'Pale walls and the Fallen Keep',
  },
  'crownfall-market-district': {
    sky: 'from-rose-200 to-amber-200 dark:from-rose-950 dark:to-stone-900',
    ground: 'bg-amber-700/60 dark:bg-amber-950',
    accent: 'bg-rose-700 dark:bg-rose-800',
    label: 'Awnings, stalls, and forge smoke',
  },
  'crownfall-harbor': {
    sky: 'from-sky-200 to-blue-300 dark:from-sky-950 dark:to-stone-900',
    ground: 'bg-blue-500/60 dark:bg-blue-950',
    accent: 'bg-stone-500 dark:bg-stone-600',
    label: 'Piers and tall ships',
  },
  'north-road': {
    sky: 'from-stone-200 to-stone-300 dark:from-stone-800 dark:to-stone-950',
    ground: 'bg-lime-700/50 dark:bg-lime-950',
    accent: 'bg-stone-500 dark:bg-stone-600',
    label: 'A rutted road between hedgerows',
  },
  'greenmeadow-village': {
    sky: 'from-lime-100 to-emerald-200 dark:from-emerald-950 dark:to-stone-900',
    ground: 'bg-emerald-600/60 dark:bg-emerald-950',
    accent: 'bg-yellow-700 dark:bg-yellow-900',
    label: 'Thatched roofs and pastures',
  },
  'ironroot-mine': {
    sky: 'from-stone-300 to-stone-400 dark:from-stone-800 dark:to-stone-950',
    ground: 'bg-stone-700 dark:bg-stone-800',
    accent: 'bg-amber-800 dark:bg-amber-900',
    label: 'Timber-braced shafts in the hills',
  },
  'silvermere-lake': {
    sky: 'from-cyan-100 to-sky-200 dark:from-cyan-950 dark:to-stone-900',
    ground: 'bg-cyan-500/50 dark:bg-cyan-950',
    accent: 'bg-slate-400 dark:bg-slate-600',
    label: 'A mirror-still silver lake',
  },
  'blackwood-forest': {
    sky: 'from-emerald-900/40 to-stone-400 dark:from-emerald-950 dark:to-stone-950',
    ground: 'bg-emerald-950/70 dark:bg-emerald-950',
    accent: 'bg-emerald-800 dark:bg-emerald-900',
    label: 'Old-growth dark as night',
  },
};

const FALLBACK: ArtworkSpec = {
  sky: 'from-stone-200 to-stone-300 dark:from-stone-800 dark:to-stone-950',
  ground: 'bg-stone-400 dark:bg-stone-700',
  accent: 'bg-stone-500 dark:bg-stone-600',
  label: 'Uncharted territory',
};

export function LocationArtwork({ artworkKey, name }: { artworkKey: string; name: string }) {
  const art = ARTWORK[artworkKey] ?? FALLBACK;
  return (
    <div
      role="img"
      aria-label={`${name} — ${art.label}`}
      data-artwork-key={artworkKey}
      className={`relative h-40 overflow-hidden rounded-lg bg-gradient-to-b ${art.sky}`}
    >
      <div className={`absolute bottom-0 h-12 w-full ${art.ground}`} />
      <div className={`absolute bottom-8 left-8 h-16 w-10 rounded-t-md ${art.accent}`} />
      <div
        className={`absolute bottom-10 left-24 h-10 w-14 rounded-t-full ${art.accent} opacity-70`}
      />
      <div className="absolute right-6 top-4 size-8 rounded-full bg-white/70 dark:bg-stone-300/30" />
      <p className="absolute bottom-2 right-3 text-xs font-medium text-stone-800/70 dark:text-stone-200/60">
        {art.label}
      </p>
    </div>
  );
}
