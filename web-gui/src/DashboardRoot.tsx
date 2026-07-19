import type { ReactElement, ReactNode } from 'react';
import {
  InitialWindow,
  LocallyPersistentWorkspace,
  RmfDashboard,
  Workspace,
} from 'rmf-dashboard-framework/components';
import {
  createMapApp,
  doorsApp,
  liftsApp,
  robotMutexGroupsApp,
  robotsApp,
  tasksApp,
} from 'rmf-dashboard-framework/micro-apps';
import { OpsWorkspaceShell, PlatformShell } from './components/PlatformShell';
import { HelpGuideButton } from './help/HelpGuideButton';
import { BuildingEditorPage } from './pages/BuildingEditorPage';
import { DevicesPage } from './pages/DevicesPage';
import { MapTab } from './pages/MapTab';
import { MappingPage } from './pages/MappingPage';
import { MissionsPage } from './pages/MissionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { JwtAuthenticator } from './rmf/JwtAuthenticator';

const authenticator = new JwtAuthenticator();

const mapConfig = {
  attributionPrefix: 'NavPro / Open-RMF',
  defaultMapLevel: 'L1',
  defaultRobotZoom: 20,
  defaultZoom: 20,
} as const;

const mapApp = createMapApp({ ...mapConfig });

const appRegistry = [mapApp, doorsApp, liftsApp, robotsApp, robotMutexGroupsApp, tasksApp];

/** Live fleet ops: robots + map + doors/lifts (formerly the Robots tab). */
const overviewWorkspace: InitialWindow[] = [
  { layout: { x: 0, y: 0, w: 7, h: 4 }, microApp: robotsApp },
  { layout: { x: 8, y: 0, w: 5, h: 8 }, microApp: mapApp },
  { layout: { x: 0, y: 4, w: 7, h: 4 }, microApp: doorsApp },
  { layout: { x: 0, y: 8, w: 7, h: 4 }, microApp: liftsApp },
  { layout: { x: 8, y: 8, w: 5, h: 4 }, microApp: robotMutexGroupsApp },
];

const tasksWorkspace: InitialWindow[] = [
  { layout: { x: 0, y: 0, w: 7, h: 8 }, microApp: tasksApp },
  { layout: { x: 8, y: 0, w: 5, h: 8 }, microApp: mapApp },
];

function platformTab(
  element: ReactNode,
  wide = false,
  fill = false,
  bleed = false,
): ReactElement {
  return (
    <PlatformShell wide={wide} fill={fill} bleed={bleed}>
      {element}
    </PlatformShell>
  );
}

function opsTab(element: ReactNode): ReactElement {
  return <OpsWorkspaceShell>{element}</OpsWorkspaceShell>;
}

const TASKS = {
  allowedTasks: [
    { taskDefinitionId: 'patrol' as const },
    { taskDefinitionId: 'delivery' as const },
    { taskDefinitionId: 'compose-clean' as const },
    { taskDefinitionId: 'custom_compose' as const },
  ],
  pickupZones: [],
  cartIds: [],
};

export function DashboardRoot(): ReactElement {
  const platformUrl = window.location.origin;
  const trajectoryServerUrl =
    import.meta.env.VITE_TRAJECTORY_SERVER_URL ??
    `${platformUrl.replace(/^http/, 'ws')}/rmf/trajectory`;

  return (
    <RmfDashboard
      disableRouter
      apiServerUrl={`${platformUrl}/rmf`}
      trajectoryServerUrl={trajectoryServerUrl}
      authenticator={authenticator}
      resources={{ fleets: {}, logos: { header: '/vite.svg' } }}
      tasks={TASKS}
      extraAppbarItems={<HelpGuideButton />}
      tabs={[
        {
          name: 'Map',
          route: '',
          element: <MapTab />,
        },
        {
          name: 'Overview',
          route: 'overview',
          element: opsTab(<Workspace initialWindows={overviewWorkspace} />),
        },
        {
          name: 'Tasks',
          route: 'tasks',
          element: opsTab(<Workspace initialWindows={tasksWorkspace} />),
        },
        {
          name: 'Custom',
          route: 'custom',
          element: opsTab(
            <LocallyPersistentWorkspace
              defaultWindows={[]}
              allowDesignMode
              appRegistry={appRegistry}
              storageKey="navpro-rmf-custom-workspace"
            />,
          ),
        },
        { name: 'Missions', route: 'missions', element: platformTab(<MissionsPage />) },
        { name: 'Workflows', route: 'workflows', element: platformTab(<WorkflowsPage />) },
        { name: 'Mapping', route: 'mapping', element: platformTab(<MappingPage />, true, true, true) },
        {
          name: 'Building',
          route: 'building',
          element: platformTab(<BuildingEditorPage />, true, true),
        },
        { name: 'Devices', route: 'devices', element: platformTab(<DevicesPage />, true) },
        { name: 'Settings', route: 'settings', element: platformTab(<SettingsPage />) },
      ]}
    />
  );
}
