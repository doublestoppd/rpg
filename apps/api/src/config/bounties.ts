import { z } from 'zod';

/**
 * Bounty board (Phase 24). A fixed server-defined pool rotates on a
 * timestamp-authoritative cycle: which bounties are active is a pure function of
 * the current UTC day/week, so eligibility is correct with the worker stopped
 * and no rotation state is stored. Each bounty is a turn-in (an item sink) that
 * pays Gold and bounded regional reputation; a claim is unique per character +
 * cycle + bounty, so a rotation can never duplicate a reward.
 */

const bountyDefinitionSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  cadence: z.enum(['DAILY', 'WEEKLY']),
  region: z.string().min(1),
  /** Turn-in requirement: consumed from the player's pack on claim. */
  requirement: z.object({ itemSlug: z.string().min(1), quantity: z.number().int().min(1) }),
  rewardGold: z.bigint().min(0n),
  rewardReputation: z.number().int().min(0),
});
export type BountyDefinition = z.infer<typeof bountyDefinitionSchema>;

/** How many bounties of each cadence are active per cycle. */
export const ACTIVE_PER_CADENCE: Record<BountyDefinition['cadence'], number> = {
  DAILY: 3,
  WEEKLY: 2,
};

/** Reputation is a bounded, non-spendable counter. */
export const REPUTATION_CAP = 1000;

export const BOUNTY_POOL: BountyDefinition[] = z.array(bountyDefinitionSchema).parse([
  {
    slug: 'daily-ore-haul',
    name: 'Ore Haul',
    description: 'The forges always want more copper. Bring a load.',
    cadence: 'DAILY',
    region: 'crownfall',
    requirement: { itemSlug: 'copper-ore', quantity: 5 },
    rewardGold: 60n,
    rewardReputation: 10,
  },
  {
    slug: 'daily-iron-quota',
    name: 'Iron Quota',
    description: 'Deliver iron ore to meet the district quota.',
    cadence: 'DAILY',
    region: 'crownfall',
    requirement: { itemSlug: 'iron-ore', quantity: 3 },
    rewardGold: 70n,
    rewardReputation: 10,
  },
  {
    slug: 'daily-herb-gathering',
    name: 'Herb Gathering',
    description: 'The apothecaries need fresh meadow herb.',
    cadence: 'DAILY',
    region: 'northmarch',
    requirement: { itemSlug: 'meadow-herb', quantity: 6 },
    rewardGold: 50n,
    rewardReputation: 8,
  },
  {
    slug: 'daily-forge-fuel',
    name: 'Forge Fuel',
    description: 'Keep the forges burning with a load of coal.',
    cadence: 'DAILY',
    region: 'crownfall',
    requirement: { itemSlug: 'forge-coal', quantity: 4 },
    rewardGold: 65n,
    rewardReputation: 10,
  },
  {
    slug: 'daily-trail-rations',
    name: 'Trail Rations',
    description: 'Stock the wardens with travelers rations.',
    cadence: 'DAILY',
    region: 'northmarch',
    requirement: { itemSlug: 'traveler-ration', quantity: 8 },
    rewardGold: 45n,
    rewardReputation: 8,
  },
  {
    slug: 'weekly-great-smelt',
    name: 'The Great Smelt',
    description: 'A weeks worth of iron for the great smelt.',
    cadence: 'WEEKLY',
    region: 'crownfall',
    requirement: { itemSlug: 'iron-ore', quantity: 12 },
    rewardGold: 320n,
    rewardReputation: 40,
  },
  {
    slug: 'weekly-herbalists-order',
    name: "Herbalist's Standing Order",
    description: 'A large standing order of meadow herb.',
    cadence: 'WEEKLY',
    region: 'northmarch',
    requirement: { itemSlug: 'meadow-herb', quantity: 20 },
    rewardGold: 280n,
    rewardReputation: 40,
  },
  {
    slug: 'weekly-coal-contract',
    name: 'Coal Contract',
    description: 'A weekly contract to keep the forges fed.',
    cadence: 'WEEKLY',
    region: 'crownfall',
    requirement: { itemSlug: 'forge-coal', quantity: 15 },
    rewardGold: 300n,
    rewardReputation: 40,
  },
]);

const BOUNTY_BY_SLUG = new Map(BOUNTY_POOL.map((b) => [b.slug, b]));
export const findBounty = (slug: string): BountyDefinition | undefined => BOUNTY_BY_SLUG.get(slug);

/** Deterministic 32-bit string hash (FNV-1a) for stable rotation ordering. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** ISO-8601 week number (UTC) for a date. */
function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** The timestamp-authoritative cycle id for a cadence at a moment. */
export function cycleId(cadence: BountyDefinition['cadence'], now: Date): string {
  if (cadence === 'DAILY') {
    return `DAILY:${now.toISOString().slice(0, 10)}`;
  }
  const { year, week } = isoWeek(now);
  return `WEEKLY:${year}-W${String(week).padStart(2, '0')}`;
}

/** The active bounties for the current cycle — a pure function of `now`. */
export function activeBounties(now: Date): Array<{ bounty: BountyDefinition; cycleId: string }> {
  const out: Array<{ bounty: BountyDefinition; cycleId: string }> = [];
  for (const cadence of ['DAILY', 'WEEKLY'] as const) {
    const id = cycleId(cadence, now);
    const ranked = BOUNTY_POOL.filter((b) => b.cadence === cadence).sort(
      (a, b) => hash(id + a.slug) - hash(id + b.slug),
    );
    for (const bounty of ranked.slice(0, ACTIVE_PER_CADENCE[cadence])) {
      out.push({ bounty, cycleId: id });
    }
  }
  return out;
}
