import type { AtmosphereResponse, WorldEventInfo, WorldTimeSegment } from '@rpg/shared';

import { Card } from '../../components/ui/Card';

const SEGMENT_LABELS: Record<WorldTimeSegment, string> = {
  DAWN: 'Dawn',
  DAY: 'Day',
  DUSK: 'Dusk',
  NIGHT: 'Night',
};

const SEGMENT_ICONS: Record<WorldTimeSegment, string> = {
  DAWN: '🌅',
  DAY: '☀️',
  DUSK: '🌆',
  NIGHT: '🌙',
};

const WEATHER_LABELS: Record<AtmosphereResponse['weather'], string> = {
  CLEAR: 'Clear',
  CLOUDY: 'Cloudy',
  RAIN: 'Rain',
  FOG: 'Fog',
  STORM: 'Storm',
  SNOW: 'Snow',
};

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/**
 * The scene's ambient banner: the current world-time segment plus a summary of
 * the region's atmosphere and any active world events. Presentation-only — the
 * atmosphere never silently changes a gameplay outcome.
 */
export function SceneAtmosphere({
  segment,
  atmosphere,
  events,
}: {
  segment: WorldTimeSegment;
  atmosphere: AtmosphereResponse;
  events: WorldEventInfo[];
}) {
  const chips = [
    WEATHER_LABELS[atmosphere.weather],
    titleCase(atmosphere.temperature),
    `${titleCase(atmosphere.wind)} wind`,
    `${titleCase(atmosphere.crowdLevel)} streets`,
    atmosphere.visibility !== 'CLEAR' ? `${titleCase(atmosphere.visibility)} visibility` : null,
  ].filter((chip): chip is string => chip !== null);

  return (
    <Card className="bg-gradient-to-br from-stone-50 to-amber-50/40 dark:from-stone-900 dark:to-stone-900">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-lg">
          {SEGMENT_ICONS[segment]}
        </span>
        <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">
          {SEGMENT_LABELS[segment]}
        </span>
        <span className="text-stone-300 dark:text-stone-600">·</span>
        <span className="text-sm text-stone-600 dark:text-stone-400">
          {WEATHER_LABELS[atmosphere.weather]}
        </span>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Atmosphere">
        {chips.map((chip) => (
          <li
            key={chip}
            className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300"
          >
            {chip}
          </li>
        ))}
      </ul>

      {events.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-stone-200 pt-3 dark:border-stone-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-400">
            Happening now
          </h3>
          <ul className="space-y-1.5">
            {events.map((event) => (
              <li key={event.key} className="text-sm">
                <span className="font-medium text-stone-900 dark:text-stone-100">{event.name}</span>
                <span className="text-stone-500 dark:text-stone-400"> — {event.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
