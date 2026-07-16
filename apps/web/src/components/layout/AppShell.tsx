import { Link, Outlet } from 'react-router-dom';

import { DevHealthIndicator } from '../../features/health/DevHealthIndicator';

/**
 * Responsive application shell: desktop sidebar area and a mobile navigation
 * container. Navigation intentionally shows only implemented destinations —
 * links appear as their features are built in later phases.
 */
export function AppShell() {
  return (
    <div className="flex min-h-full flex-col bg-stone-100 text-stone-900 md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-stone-200 bg-white p-4 md:flex">
        <Link to="/" className="mb-6 block text-lg font-bold tracking-tight text-amber-800">
          Fantasy Economy RPG
        </Link>
        <nav aria-label="Main navigation" className="flex flex-col gap-1">
          <Link
            to="/"
            className="rounded-md px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
          >
            Home
          </Link>
        </nav>
        <div className="mt-auto pt-4">
          <DevHealthIndicator />
        </div>
      </aside>

      {/* Mobile top bar / navigation container */}
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3 md:hidden">
        <Link to="/" className="text-base font-bold tracking-tight text-amber-800">
          Fantasy Economy RPG
        </Link>
        <nav aria-label="Mobile navigation" className="flex items-center gap-2">
          <Link
            to="/"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
          >
            Home
          </Link>
        </nav>
      </header>

      <main className="flex-1 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
