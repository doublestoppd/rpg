import { Route, Routes } from 'react-router-dom';

import { AppShell } from './components/layout/AppShell';
import { RequireAuth } from './features/auth/RequireAuth';
import { AccountSettingsPage } from './pages/AccountSettingsPage';
import { CharacterCreatePage } from './pages/CharacterCreatePage';
import { CharacterPage } from './pages/CharacterPage';
import { CollectionPage } from './pages/CollectionPage';
import { CombatPage } from './pages/CombatPage';
import { InventoryPage } from './pages/InventoryPage';
import { LandingPage } from './pages/LandingPage';
import { LocationPage } from './pages/LocationPage';
import { LoginPage } from './pages/LoginPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { NotificationsPage } from './pages/NotificationsPage';
import { QuestsPage } from './pages/QuestsPage';
import { RegisterPage } from './pages/RegisterPage';
import { ShopPage } from './pages/ShopPage';
import { TravelPage } from './pages/TravelPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LandingPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route
          path="location"
          element={
            <RequireAuth>
              <LocationPage />
            </RequireAuth>
          }
        />
        <Route
          path="travel"
          element={
            <RequireAuth>
              <TravelPage />
            </RequireAuth>
          }
        />
        <Route
          path="character"
          element={
            <RequireAuth>
              <CharacterPage />
            </RequireAuth>
          }
        />
        <Route
          path="character/new"
          element={
            <RequireAuth>
              <CharacterCreatePage />
            </RequireAuth>
          }
        />
        <Route
          path="marketplace"
          element={
            <RequireAuth>
              <MarketplacePage />
            </RequireAuth>
          }
        />
        <Route
          path="shops/:shopId"
          element={
            <RequireAuth>
              <ShopPage />
            </RequireAuth>
          }
        />
        <Route
          path="notifications"
          element={
            <RequireAuth>
              <NotificationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="collection"
          element={
            <RequireAuth>
              <CollectionPage />
            </RequireAuth>
          }
        />
        <Route
          path="quests"
          element={
            <RequireAuth>
              <QuestsPage />
            </RequireAuth>
          }
        />
        <Route
          path="combat/:combatId"
          element={
            <RequireAuth>
              <CombatPage />
            </RequireAuth>
          }
        />
        <Route
          path="inventory"
          element={
            <RequireAuth>
              <InventoryPage />
            </RequireAuth>
          }
        />
        <Route
          path="settings"
          element={
            <RequireAuth>
              <AccountSettingsPage />
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  );
}
