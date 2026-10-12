import {
  Alert,
  AlertProps,
  Box,
  Button,
  Container,
  CssBaseline,
  Snackbar,
  Tab,
  ThemeProvider,
  Typography,
} from '@mui/material';
import React, { useTransition } from 'react';
import { matchPath, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { HashRouter } from 'react-router-dom';

import {
  AppController,
  AppControllerProvider,
  AuthenticatorProvider,
  Resources,
  ResourcesProvider,
  RmfApiProvider,
  SettingsProvider,
  TaskRegistry,
  TaskRegistryProvider,
  UserProfileProvider,
} from '../hooks';
import { LoginPage } from '../pages';
import {
  Authenticator,
  DefaultRmfApi,
  loadSettings,
  saveSettings,
  Settings,
  UserProfile,
} from '../services';
import { AlertManager } from './alert-manager';
import AppBar, { APP_BAR_HEIGHT } from './appbar';
import LocalizationProvider from './locale';
import { getDefaultTaskDefinition } from './tasks/types';
import { DashboardThemes } from './theme';
import { SimClockSync } from '../hooks/use-sim-clock-sync';

const DefaultAlertDuration = 2000;

export interface DashboardTab {
  name: string;
  route: string;
  element: React.ReactNode;
}

export interface AllowedTask {
  /**
   * The task definition to configure.
   */
  taskDefinitionId: 'patrol' | 'delivery' | 'compose-clean' | 'custom_compose';

  /**
   * Configure the display name for the task definition.
   */
  displayName?: string;

  /**
   * The color of the event when rendered on the task scheduler in the form of a CSS color string.
   */
  scheduleEventColor?: string;
}

export interface TaskRegistryInput extends Omit<TaskRegistry, 'taskDefinitions'> {
  allowedTasks: AllowedTask[];
}

export interface RmfDashboardProps {
  /**
   * Url of the RMF api server.
   */
  apiServerUrl: string;

  /**
   * Url of the RMF trajectory server.
   */
  trajectoryServerUrl: string;

  authenticator: Authenticator;

  /**
   * Url to be linked for the "help" button.
   * @deprecated Unused; help button removed from the app bar.
   */
  helpLink?: string;

  /**
   * Url to be linked for the "report issue" button.
   * @deprecated Unused; report-issue button removed from the app bar.
   */
  reportIssueLink?: string;

  themes?: DashboardThemes;

  /**
   * Set various resources (icons, logo etc) used. Different resource can be used based on the theme, `default` is always required.
   */
  resources: Resources;

  /**
   * List of allowed tasks that can be requested
   */
  tasks: TaskRegistryInput;

  /**
   * List of tabs on the app bar.
   */
  tabs: DashboardTab[];

  /**
   * Prefix where other routes will be based on, defaults to `import.meta.env.BASE_URL`.
   * Must end with a slash
   */
  baseUrl?: string;

  /**
   * Url to a file to be played when an alert occurs on the dashboard.
   */
  alertAudioPath?: string;

  /**
   * Render framework content inside an existing application shell.
   * When provided, the dashboard does not create a router, login page, or app bar.
   */
  embeddedContent?: React.ReactNode;

  /**
   * Use the ambient router and auth gate from the host app instead of creating
   * an internal router + login page. The host is responsible for only mounting
   * the dashboard once the user is authenticated. The RMF app bar and tab
   * routes are still rendered (unlike `embeddedContent`).
   */
  disableRouter?: boolean;

  /**
   * Always-visible items rendered in the app bar before the profile icon
   * (merged with any temporary items set via AppController).
   */
  extraAppbarItems?: React.ReactNode;
}

export function RmfDashboard(props: RmfDashboardProps) {
  const {
    apiServerUrl,
    trajectoryServerUrl,
    authenticator,
    themes,
    resources,
    tasks,
    baseUrl = import.meta.env.BASE_URL,
    alertAudioPath,
  } = props;

  const rmfApi = React.useMemo(
    () => new DefaultRmfApi(apiServerUrl, trajectoryServerUrl, authenticator),
    [apiServerUrl, trajectoryServerUrl, authenticator],
  );

  // FIXME(koonepng): This should be fully definition in tasks resources when the dashboard actually
  // supports configuring all the fields.
  const taskRegistry = React.useMemo<TaskRegistry>(
    () => ({
      taskDefinitions: tasks.allowedTasks.map((t) => {
        const defaultTaskDefinition = getDefaultTaskDefinition(t.taskDefinitionId);
        if (!defaultTaskDefinition) {
          throw Error(`Invalid tasks configured for dashboard: [${t.taskDefinitionId}]`);
        }
        const taskDefinition = { ...defaultTaskDefinition };
        if (t.displayName !== undefined) {
          taskDefinition.taskDisplayName = t.displayName;
        }
        if (t.scheduleEventColor !== undefined) {
          taskDefinition.scheduleEventColor = t.scheduleEventColor;
        }
        return taskDefinition;
      }),
      pickupZones: tasks.pickupZones,
      cartIds: tasks.cartIds,
    }),
    [tasks.allowedTasks, tasks.pickupZones, tasks.cartIds],
  );

  const [userProfile, setUserProfile] = React.useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await authenticator.init();
      if (!authenticator.user) {
        if (cancelled) return;
        setUserProfile(null);
        setAuthReady(true);
        // Platform App.tsx owns /login when disableRouter is set.
        return;
      }
      const loadProfile = async (attempt: number): Promise<void> => {
        try {
          const user = (await rmfApi.defaultApi.getUserUserGet()).data;
          const perm = (await rmfApi.defaultApi.getEffectivePermissionsPermissionsGet()).data;
          if (cancelled) return;
          setUserProfile({ user, permissions: perm });
          setAuthError(null);
        } catch (e) {
          const status = (e as { response?: { status?: number } })?.response?.status;
          console.error(e);
          if (cancelled) return;
          // Only force re-login on real auth failures. 5xx/network means the
          // RMF api-server is down — logging out causes a login↔black loop.
          if (status === 401 || status === 403) {
            setUserProfile(null);
            try {
              await authenticator.logout();
            } catch {
              window.location.assign('/login');
            }
            return;
          }
          if (attempt < 8) {
            setAuthError(`RMF API not ready (retry ${attempt + 1}/8)…`);
            await new Promise((r) => window.setTimeout(r, 1500));
            return loadProfile(attempt + 1);
          }
          setAuthError(
            'RMF API unreachable. Check rmf-api-server / rmf-core, then refresh.',
          );
          setUserProfile(null);
        }
      };
      await loadProfile(0);
      if (!cancelled) setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticator, rmfApi, props.disableRouter]);

  const [settings, setSettings] = React.useState(() => loadSettings());
  const updateSettings = React.useCallback((newSettings: Settings) => {
    saveSettings(newSettings);
    setSettings(newSettings);
  }, []);

  const [showAlert, setShowAlert] = React.useState(false);
  const [alertSeverity, setAlertSeverity] = React.useState<AlertProps['severity']>('error');
  const [alertMessage, setAlertMessage] = React.useState('');
  const [alertDuration, setAlertDuration] = React.useState(DefaultAlertDuration);
  const [extraAppbarItems, setExtraAppbarItems] = React.useState<React.ReactNode>(null);
  const appController = React.useMemo<AppController>(
    () => ({
      updateSettings,
      showAlert: (severity, message, autoHideDuration) => {
        setAlertSeverity(severity);
        setAlertMessage(message);
        setShowAlert(true);
        setAlertDuration(autoHideDuration || DefaultAlertDuration);
      },
      setExtraAppbarItems,
    }),
    [updateSettings],
  );

  const theme = React.useMemo(() => {
    if (!themes) {
      return null;
    }
    return themes[settings.themeMode] || themes.default;
  }, [themes, settings.themeMode]);

  const dashboardContent = userProfile && (
    <LocalizationProvider>
      <CssBaseline />
      <AuthenticatorProvider value={authenticator}>
        <UserProfileProvider value={userProfile}>
          <ResourcesProvider value={resources}>
            <TaskRegistryProvider value={taskRegistry}>
              <RmfApiProvider value={rmfApi}>
                <SettingsProvider value={settings}>
                  <AppControllerProvider value={appController}>
                    <SimClockSync />
                    <AlertManager alertAudioPath={alertAudioPath} />
                    {props.embeddedContent ?? (
                      <DashboardContents
                        {...props}
                        extraAppbarItems={
                          <>
                            {props.extraAppbarItems}
                            {extraAppbarItems}
                          </>
                        }
                      />
                    )}
                    {/* TODO: Support stacking of alerts */}
                    <Snackbar
                      open={showAlert}
                      message={alertMessage}
                      onClose={() => setShowAlert(false)}
                      autoHideDuration={alertDuration}
                    >
                      <Alert
                        onClose={() => setShowAlert(false)}
                        severity={alertSeverity}
                        sx={{ width: '100%' }}
                      >
                        {alertMessage}
                      </Alert>
                    </Snackbar>
                  </AppControllerProvider>
                </SettingsProvider>
              </RmfApiProvider>
            </TaskRegistryProvider>
          </ResourcesProvider>
        </UserProfileProvider>
      </AuthenticatorProvider>
    </LocalizationProvider>
  );

  const providers =
    authReady &&
    (props.disableRouter || props.embeddedContent ? (
      dashboardContent || (
        <LocalizationProvider>
          <CssBaseline />
          <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
            <Typography variant="h5" gutterBottom>
              {authError ? 'Cannot reach RMF API' : 'Loading dashboard…'}
            </Typography>
            <Typography variant="body1" color="textSecondary" gutterBottom>
              {authError || 'Fetching user profile from the fleet API server.'}
            </Typography>
            {authError && (
              <Button
                variant="contained"
                sx={{ mt: 2 }}
                onClick={() => window.location.reload()}
              >
                Retry
              </Button>
            )}
          </Container>
        </LocalizationProvider>
      )
    ) : (
      <HashRouter>
        <Routes>
          <Route
            path={`${baseUrl}login`}
            element={
              userProfile ? (
                <Navigate to={baseUrl} />
              ) : (
                <LoginPage
                  title="Dashboard"
                  logo={resources.logos.header}
                  onLoginClick={() => authenticator.login(`${window.location.origin}${baseUrl}`)}
                />
              )
            }
          />
          <Route
            path="*"
            element={userProfile ? <Outlet /> : <Navigate to={`${baseUrl}login`} />}
          ></Route>
        </Routes>
        {dashboardContent}
      </HashRouter>
    ));

  return theme ? <ThemeProvider theme={theme}>{providers}</ThemeProvider> : providers;
}

function NotFound() {
  return (
    <Container maxWidth="md" sx={{ textAlign: 'center', py: 8 }}>
      <Typography variant="h3" gutterBottom>
        404 - Not Found
      </Typography>
      <Typography variant="body1" color="textSecondary" gutterBottom>
        The page you're looking for doesn't exist.
      </Typography>
    </Container>
  );
}

interface DashboardContentsProps extends RmfDashboardProps {
  extraAppbarItems: React.ReactNode;
}

function DashboardContents({
  themes,
  tabs,
  baseUrl = import.meta.env.BASE_URL,
  extraAppbarItems,
}: DashboardContentsProps) {
  const location = useLocation();
  const currentTab =
    tabs.find((t) => matchPath({ path: `${baseUrl}${t.route}`, end: true }, location.pathname)) ??
    tabs[0];

  const [pendingTransition, startTransition] = useTransition();
  const navigate = useNavigate();

  // TODO(koonpeng): enable admin tab when authz is implemented.
  const allTabs = tabs;
  // const allTabs = React.useMemo<DashboardTab[]>(
  //   () => [...tabs, { name: 'Admin', route: 'admin', element: <AdminDrawer /> }],
  //   [tabs],
  // );

  if (!currentTab) {
    return <NotFound />;
  }

  return (
    <Routes>
      <Route path={baseUrl}>
        <Route
          element={
            <Box
              sx={{
                minHeight: '100vh',
                bgcolor: 'background.default',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <AppBar
                tabs={allTabs.map((t) => (
                  <Tab
                    key={t.name}
                    sx={{ height: APP_BAR_HEIGHT }}
                    label={
                      <Typography variant="body2" sx={{ fontWeight: 600, letterSpacing: '0.01em' }}>
                        {t.name}
                      </Typography>
                    }
                    value={t.name}
                    onClick={() => {
                      startTransition(() => {
                        navigate(`${baseUrl}${t.route}`);
                      });
                    }}
                  />
                ))}
                tabValue={currentTab.name}
                themes={themes}
                extraToolbarItems={extraAppbarItems}
              />
              {!pendingTransition && <Outlet />}
            </Box>
          }
        >
          {allTabs.map((t) => (
            <Route key={t.name} path={t.route} element={t.element} />
          ))}
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
