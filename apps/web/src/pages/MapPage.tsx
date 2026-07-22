import type { WorldMapResponse } from '@rpg/shared';
import { Navigate } from 'react-router-dom';

import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useCharacter } from '../features/character/useCharacter';
import { useWorldMap } from '../features/location/useLocation';

const COL_W = 240;
const ROW_H = 110;
const PAD = 60;
const NODE_R = 10;

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSeconds(total: number): string {
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

interface Placed {
  slug: string;
  name: string;
  region: string;
  isSafe: boolean;
  x: number;
  y: number;
}

/**
 * Lays locations out in one column per region (in first-seen order), stacked by
 * first-seen order within the region. It needs no stored coordinates — the
 * topology alone gives a stable, readable schematic.
 */
function layout(map: WorldMapResponse): { placed: Placed[]; width: number; height: number } {
  const regions: string[] = [];
  const rowByRegion = new Map<string, number>();
  const placed: Placed[] = [];

  for (const loc of map.locations) {
    if (!regions.includes(loc.region)) regions.push(loc.region);
    const col = regions.indexOf(loc.region);
    const row = rowByRegion.get(loc.region) ?? 0;
    rowByRegion.set(loc.region, row + 1);
    placed.push({
      slug: loc.slug,
      name: loc.name,
      region: loc.region,
      isSafe: loc.isSafe,
      x: PAD + col * COL_W,
      y: PAD + row * ROW_H,
    });
  }

  const maxRow = Math.max(1, ...[...rowByRegion.values()]);
  return {
    placed,
    width: PAD * 2 + Math.max(0, regions.length - 1) * COL_W + 40,
    height: PAD * 2 + (maxRow - 1) * ROW_H,
  };
}

function WorldMapDiagram({ map }: { map: WorldMapResponse }) {
  const { placed, width, height } = layout(map);
  const pos = new Map(placed.map((p) => [p.slug, p]));

  // Dedupe the directed edges into undirected road segments.
  const seen = new Set<string>();
  const segments: { a: Placed; b: Placed }[] = [];
  for (const edge of map.edges) {
    const key = [edge.fromSlug, edge.toSlug].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const a = pos.get(edge.fromSlug);
    const b = pos.get(edge.toSlug);
    if (a && b) segments.push({ a, b });
  }

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label="World map showing locations and the roads between them"
        className="max-w-full"
      >
        {segments.map(({ a, b }) => (
          <line
            key={`${a.slug}-${b.slug}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className="stroke-stone-300 dark:stroke-stone-700"
            strokeWidth={2}
          />
        ))}
        {placed.map((node) => {
          const here = node.slug === map.currentLocationSlug;
          return (
            <g key={node.slug}>
              {here && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={NODE_R + 6}
                  className="fill-none stroke-amber-500"
                  strokeWidth={3}
                />
              )}
              <circle
                cx={node.x}
                cy={node.y}
                r={NODE_R}
                className={
                  node.isSafe
                    ? 'fill-green-600 stroke-white dark:stroke-stone-900'
                    : 'fill-red-600 stroke-white dark:stroke-stone-900'
                }
                strokeWidth={2}
              />
              <text
                x={node.x}
                y={node.y - NODE_R - 8}
                textAnchor="middle"
                className="fill-stone-800 text-[13px] font-medium dark:fill-stone-100"
              >
                {node.name}
              </text>
              {here && (
                <text
                  x={node.x}
                  y={node.y + NODE_R + 18}
                  textAnchor="middle"
                  className="fill-amber-700 text-[11px] font-semibold dark:fill-amber-400"
                >
                  You are here
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Region-grouped adjacency list: the accessible, text equivalent of the diagram. */
function AdjacencyList({ map }: { map: WorldMapResponse }) {
  const neighbors = new Map<string, { name: string; seconds: number }[]>();
  const nameBySlug = new Map(map.locations.map((l) => [l.slug, l.name]));
  for (const edge of map.edges) {
    const list = neighbors.get(edge.fromSlug) ?? [];
    list.push({ name: nameBySlug.get(edge.toSlug) ?? edge.toSlug, seconds: edge.travelSeconds });
    neighbors.set(edge.fromSlug, list);
  }

  const regions: string[] = [];
  for (const loc of map.locations) if (!regions.includes(loc.region)) regions.push(loc.region);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {regions.map((region) => (
        <Card key={region} title={titleCase(region)}>
          <ul className="space-y-3">
            {map.locations
              .filter((l) => l.region === region)
              .map((loc) => (
                <li key={loc.slug}>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={`inline-block size-2 rounded-full ${loc.isSafe ? 'bg-green-600' : 'bg-red-600'}`}
                    />
                    <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
                      {loc.name}
                    </span>
                    {loc.slug === map.currentLocationSlug && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        You are here
                      </span>
                    )}
                  </div>
                  <ul className="mt-1 ml-4 text-xs text-stone-500 dark:text-stone-400">
                    {(neighbors.get(loc.slug) ?? []).map((n) => (
                      <li key={n.name}>
                        → {n.name} ({formatSeconds(n.seconds)})
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

export function MapPage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const map = useWorldMap(Boolean(character));

  if (characterPending) return <LoadingState label="Unfolding the map…" />;
  if (!character) return <Navigate to="/character/new" replace />;
  if (map.isPending) return <LoadingState label="Unfolding the map…" />;
  if (map.isError || !map.data) return <ErrorState onRetry={() => void map.refetch()} />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          World map
        </h1>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          Every known place and the roads between them. Green marks a safe haven; red marks
          dangerous ground. You can only set out for a directly connected place from where you
          stand.
        </p>
      </div>

      <Card>
        <WorldMapDiagram map={map.data} />
      </Card>

      <AdjacencyList map={map.data} />
    </div>
  );
}
