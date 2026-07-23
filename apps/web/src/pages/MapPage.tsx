import type { WorldMapResponse } from '@rpg/shared';
import { useCallback, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useCharacter } from '../features/character/useCharacter';
import { useWorldMap } from '../features/location/useLocation';

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSeconds(total: number): string {
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 3;
const NODE_R = 9;

interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * A pan/zoom world map rendered to a <canvas>. Locations are drawn at their
 * authored coordinates (so a road between two places is a straight line that
 * never implies a third place sits between them), and the caller's current
 * location is ringed. The canvas is the groundwork for real map art later — a
 * background image would simply be drawn under the same transform. An
 * equivalent accessible adjacency list lives below for keyboard/screen-reader
 * users.
 */
function WorldMapCanvas({ map }: { map: WorldMapResponse }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ scale: 1, offsetX: 0, offsetY: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const fitted = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
    }

    const dark =
      document.documentElement.classList.contains('dark') ||
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    const edgeColor = dark ? '#44403c' : '#d6d3d1';
    const labelColor = dark ? '#e7e5e4' : '#292524';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const { scale, offsetX, offsetY } = view.current;
    const tx = (x: number) => x * scale + offsetX;
    const ty = (y: number) => y * scale + offsetY;
    const byslug = new Map(map.locations.map((n) => [n.slug, n]));

    // Edges (dedupe undirected).
    const seen = new Set<string>();
    ctx.lineWidth = 2;
    ctx.strokeStyle = edgeColor;
    for (const edge of map.edges) {
      const key = [edge.fromSlug, edge.toSlug].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const a = byslug.get(edge.fromSlug);
      const b = byslug.get(edge.toSlug);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(tx(a.x), ty(a.y));
      ctx.lineTo(tx(b.x), ty(b.y));
      ctx.stroke();
    }

    // Nodes.
    ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const node of map.locations) {
      const cx = tx(node.x);
      const cy = ty(node.y);
      const here = node.slug === map.currentLocationSlug;
      if (here) {
        ctx.beginPath();
        ctx.arc(cx, cy, NODE_R + 5, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#f59e0b';
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = node.isSafe ? '#16a34a' : '#dc2626';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = dark ? '#1c1917' : '#ffffff';
      ctx.stroke();

      ctx.fillStyle = labelColor;
      ctx.fillText(node.name, cx, cy - NODE_R - 8);
      if (here) {
        ctx.fillStyle = '#d97706';
        ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText('You are here', cx, cy + NODE_R + 16);
        ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      }
    }
  }, [map]);

  const fitToView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || map.locations.length === 0) return;
    const xs = map.locations.map((n) => n.x);
    const ys = map.locations.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 70;
    const w = canvas.clientWidth - pad * 2;
    const h = canvas.clientHeight - pad * 2;
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1))),
    );
    view.current = {
      scale,
      offsetX: pad + (w - (maxX - minX) * scale) / 2 - minX * scale,
      offsetY: pad + (h - (maxY - minY) * scale) / 2 - minY * scale,
    };
    draw();
  }, [map, draw]);

  useEffect(() => {
    if (!fitted.current) {
      fitToView();
      fitted.current = true;
    } else {
      draw();
    }
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitToView, draw]);

  const zoomAt = (factor: number, px: number, py: number) => {
    const v = view.current;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
    const ratio = next / v.scale;
    // Keep the point under the cursor stationary.
    view.current = {
      scale: next,
      offsetX: px - (px - v.offsetX) * ratio,
      offsetY: py - (py - v.offsetY) * ratio,
    };
    draw();
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="World map showing locations and the roads between them; drag to pan, scroll to zoom"
        className="h-[26rem] w-full touch-none rounded-md bg-stone-50 dark:bg-stone-950"
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          view.current.offsetX += e.clientX - drag.current.x;
          view.current.offsetY += e.clientY - drag.current.y;
          drag.current = { x: e.clientX, y: e.clientY };
          draw();
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
        onWheel={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
        }}
      />
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <Button
          variant="secondary"
          className="px-2 py-1"
          aria-label="Zoom in"
          onClick={() => {
            const c = canvasRef.current;
            if (c) zoomAt(1.2, c.clientWidth / 2, c.clientHeight / 2);
          }}
        >
          +
        </Button>
        <Button
          variant="secondary"
          className="px-2 py-1"
          aria-label="Zoom out"
          onClick={() => {
            const c = canvasRef.current;
            if (c) zoomAt(1 / 1.2, c.clientWidth / 2, c.clientHeight / 2);
          }}
        >
          −
        </Button>
        <Button
          variant="secondary"
          className="px-2 py-1 text-xs"
          aria-label="Reset view"
          onClick={fitToView}
        >
          ⟲
        </Button>
      </div>
    </div>
  );
}

/** Region-grouped adjacency list: the accessible, text equivalent of the map. */
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
                  <ul className="ml-4 mt-1 text-xs text-stone-500 dark:text-stone-400">
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
          dangerous ground. Drag to pan and scroll to zoom. You can only set out for a directly
          connected place from where you stand.
        </p>
      </div>

      <Card className="p-2">
        <WorldMapCanvas map={map.data} />
      </Card>

      <AdjacencyList map={map.data} />
    </div>
  );
}
