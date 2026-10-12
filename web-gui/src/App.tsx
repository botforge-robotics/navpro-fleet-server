import type { ReactElement } from 'react';
import { useSyncExternalStore } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated, subscribeAuth } from './api/auth';
import { DashboardRoot } from './DashboardRoot';
import { LoginPage } from './pages/LoginPage';

/**
 * App root. The Open-RMF dashboard shell (rmf-dashboard-framework) is the base
 * UI; NavPro platform pages are mounted as additional tabs inside it (see
 * DashboardRoot). Auth is handled here with the Platform JWT so the RMF shell
 * only mounts once authenticated (it runs with `disableRouter`, using this
 * ambient BrowserRouter).
 */
export function App(): ReactElement {
  const authed = useSyncExternalStore(subscribeAuth, isAuthenticated);
  const location = useLocation();

  if (location.pathname === '/login') {
    return <LoginPage />;
  }
  if (!authed) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  // Legacy bookmarks.
  if (location.pathname === '/robots' || location.pathname.startsWith('/robots/')) {
    return <Navigate to="/overview" replace />;
  }
  if (location.pathname === '/commissioning' || location.pathname.startsWith('/commissioning/')) {
    return <Navigate to="/devices" replace />;
  }
  return <DashboardRoot />;
}
