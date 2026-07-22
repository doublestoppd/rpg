import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/layout/AppShell';
import { RequireAuth } from './features/auth/RequireAuth';
import { AccountSettingsPage } from './pages/AccountSettingsPage';
import { ActivitiesPage } from './pages/ActivitiesPage';
import { AdminPage } from './pages/AdminPage';
import { BuildsPage } from './pages/BuildsPage';
import { CharacterCreatePage } from './pages/CharacterCreatePage';
import { CharacterPage } from './pages/CharacterPage';
import { ChatPage } from './pages/ChatPage';
import { CollectionPage } from './pages/CollectionPage';
import { CombatPage } from './pages/CombatPage';
import { InventoryPage } from './pages/InventoryPage';
import { LandingPage } from './pages/LandingPage';
import { LocationPage } from './pages/LocationPage';
import { LoginPage } from './pages/LoginPage';
import { MapPage } from './pages/MapPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { NotificationsPage } from './pages/NotificationsPage';
import { QuestsPage } from './pages/QuestsPage';
import { RegisterPage } from './pages/RegisterPage';
import { ShopPage } from './pages/ShopPage';

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
          path="map"
          element={
            <RequireAuth>
              <MapPage />
            </RequireAuth>
          }
        />
        {/* Travel merged into the location hub; keep the old path working. */}
        <Route path="travel" element={<Navigate to="/location" replace />} />
        <Route
          path="character"
          element={
            <RequireAuth>
              <CharacterPage />
            </RequireAuth>
          }
        />
        <Route
          path="character/build"
          element={
            <RequireAuth>
              <BuildsPage />
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
          path="chat"
          element={
            <RequireAuth>
              <ChatPage />
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
          path="activities"
          element={
            <RequireAuth>
              <ActivitiesPage />
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
        <Route
          path="admin"
          element={
            <RequireAuth>
              <AdminPage />
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  );
}
