import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';

import { ThemeApplier } from '../../features/account/ThemeApplier';
import { useSession } from '../../features/auth/useSession';
import { ChatDock } from '../../features/chat/ChatDock';
import { DevHealthIndicator } from '../../features/health/DevHealthIndicator';
import { NotificationsNavLink } from '../../features/notifications/NotificationsNavLink';
import { useNotificationToasts } from '../../features/notifications/useNotificationToasts';
import { useTravelArrivalWatcher } from '../../features/travel/useTravelArrivalWatcher';
import { StatusBar } from './StatusBar';

const SIDEBAR_KEY = 'rpg.sidebar.collapsed';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive
      ? 'bg-amber-100 text-amber-900 dark:bg-stone-700 dark:text-amber-200'
      : 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
  }`;

/**
 * Application shell: a sticky top bar (logo + collapse toggle + always-visible
 * status strip) over a collapsible left navigation sidebar and the routed
 * content. The sidebar starts expanded; its collapsed state persists.
 */
export function AppShell() {
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // App-wide side effects that must run on every page.
  useNotificationToasts();
  useTravelArrivalWatcher();

  const toggleSidebar = () => {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? 'true' : 'false');
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

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
          <NavLink to="/map" className={linkClass}>
            Map
          </NavLink>
          <NavLink to="/character" end className={linkClass}>
            Character
          </NavLink>
          <NavLink to="/character/build" className={linkClass}>
            Build
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
          <NavLink to="/activities" className={linkClass}>
            Bounties
          </NavLink>
          <NavLink to="/collection" className={linkClass}>
            Collection
          </NavLink>
          <NavLink to="/chat" className={linkClass}>
            Chat
          </NavLink>
          <NotificationsNavLink linkClass={linkClass} />
          {session.user.role === 'ADMIN' && (
            <NavLink to="/admin" className={linkClass}>
              Admin
            </NavLink>
          )}
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
    <div className="flex min-h-full flex-col bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <ThemeApplier />

      {/* Sticky top bar: logo + sidebar toggle + always-visible status. */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-stone-200 bg-white/90 px-3 py-2 backdrop-blur md:px-4 dark:border-stone-800 dark:bg-stone-900/90">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed}
          className="rounded-md p-2 text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          <span aria-hidden className="block text-lg leading-none">
            ☰
          </span>
        </button>
        <Link
          to="/"
          className="shrink-0 text-base font-bold tracking-tight text-amber-800 dark:text-amber-400"
        >
          Fantasy Economy RPG
        </Link>
        {session && (
          <div className="min-w-0 flex-1">
            <StatusBar />
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Collapsible left navigation. */}
        {!collapsed && (
          <aside className="flex w-56 shrink-0 flex-col border-r border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
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
        )}

        <main className="min-w-0 flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>

      <ChatDock />
    </div>
  );
}
