import { Link, NavLink, Outlet } from 'react-router-dom';

import { ThemeApplier } from '../../features/account/ThemeApplier';
import { useSession } from '../../features/auth/useSession';
import { DevHealthIndicator } from '../../features/health/DevHealthIndicator';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive
      ? 'bg-amber-100 text-amber-900 dark:bg-stone-700 dark:text-amber-200'
      : 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
  }`;

/**
 * Responsive application shell: desktop sidebar area and a mobile navigation
 * container. Navigation intentionally shows only implemented destinations —
 * links appear as their features are built in later phases.
 */
export function AppShell() {
  const { data: session } = useSession();

  const navLinks = (
    <>
      <NavLink to="/" end className={linkClass}>
        Home
      </NavLink>
      {session ? (
        <>
          <NavLink to="/location" className={linkClass}>
            Location
          </NavLink>
          <NavLink to="/travel" className={linkClass}>
            Travel
          </NavLink>
          <NavLink to="/character" className={linkClass}>
            Character
          </NavLink>
          <NavLink to="/inventory" className={linkClass}>
            Inventory
          </NavLink>
          <NavLink to="/marketplace" className={linkClass}>
            Marketplace
          </NavLink>
          <NavLink to="/quests" className={linkClass}>
            Quests
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            Settings
          </NavLink>
        </>
      ) : (
        <>
          <NavLink to="/login" className={linkClass}>
            Log in
          </NavLink>
          <NavLink to="/register" className={linkClass}>
            Register
          </NavLink>
        </>
      )}
    </>
  );

  return (
    <div className="flex min-h-full flex-col bg-stone-100 text-stone-900 md:flex-row dark:bg-stone-950 dark:text-stone-100">
      <ThemeApplier />

      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-stone-200 bg-white p-4 md:flex dark:border-stone-800 dark:bg-stone-900">
        <Link
          to="/"
          className="mb-6 block text-lg font-bold tracking-tight text-amber-800 dark:text-amber-400"
        >
          Fantasy Economy RPG
        </Link>
        <nav aria-label="Main navigation" className="flex flex-col gap-1">
          {navLinks}
        </nav>
        <div className="mt-auto space-y-2 pt-4">
          {session && (
            <p className="truncate px-1 text-xs text-stone-500 dark:text-stone-400">
              Signed in as <span className="font-medium">{session.user.displayName}</span>
            </p>
          )}
          <DevHealthIndicator />
        </div>
      </aside>

      {/* Mobile top bar / navigation container */}
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3 md:hidden dark:border-stone-800 dark:bg-stone-900">
        <Link
          to="/"
          className="text-base font-bold tracking-tight text-amber-800 dark:text-amber-400"
        >
          Fantasy Economy RPG
        </Link>
        <nav aria-label="Mobile navigation" className="flex items-center gap-1">
          {navLinks}
        </nav>
      </header>

      <main className="flex-1 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
