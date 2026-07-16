import { Route, Routes } from 'react-router-dom';

import { AppShell } from './components/layout/AppShell';
import { LandingPage } from './pages/LandingPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LandingPage />} />
      </Route>
    </Routes>
  );
}
