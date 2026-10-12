import type { ReactElement, ReactNode } from "react";
import {
  InitialWindow,
  LocallyPersistentWorkspace,
  RmfDashboard,
  Workspace,
} from "rmf-dashboard-framework/components";
import {
  createMapApp,
  doorsApp,
  liftsApp,
  robotMutexGroupsApp,
  robotsApp,
  tasksApp,
} from "rmf-dashboard-framework/micro-apps";
import { MapRobotDriveDock } from "./components/MapRobotDriveDock";
import { OpsWorkspaceShell, PlatformShell } from "./components/PlatformShell";
import { HelpGuideButton } from "./help/HelpGuideButton";
import { DevicesPage } from "./pages/DevicesPage";
import { MapTab } from "./pages/MapTab";
import { MissionsPage } from "./pages/MissionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SiteSetupPage } from "./pages/SiteSetupPage";
import { WorkflowsPage } from "./pages/WorkflowsPage";
import { JwtAuthenticator } from "./rmf/JwtAuthenticator";

const authenticator = new JwtAuthenticator();

const renderRobotOverlay = (
  robot: { name: string; fleet: string },
  onClose: () => void,
  location: [number, number, number, string] | null,
): ReactNode => (
  <MapRobotDriveDock
    robotName={robot.name}
    fleet={robot.fleet}
    location={location}
    onClose={onClose}
  />
);

const mapConfig = {
  attributionPrefix: "",
  defaultMapLevel: "L1",
  defaultRobotZoom: 20,
  // Match upstream rmf-web: overview zoom-out; robot focus uses defaultRobotZoom.
  defaultZoom: 6,
  renderRobotOverlay,
} as const;

const mapApp = createMapApp({ ...mapConfig });

const appRegistry = [
  mapApp,
  doorsApp,
  liftsApp,
  robotsApp,
  robotMutexGroupsApp,
  tasksApp,
];

/** Live fleet ops: robots + map + doors/lifts — 12-row grid fits one viewport with dynamic rowHeight. */
const overviewWorkspace: InitialWindow[] = [
  { layout: { x: 0, y: 0, w: 7, h: 4 }, microApp: robotsApp },
  { layout: { x: 7, y: 0, w: 5, h: 8 }, microApp: mapApp },
  { layout: { x: 0, y: 4, w: 7, h: 4 }, microApp: doorsApp },
  { layout: { x: 0, y: 8, w: 7, h: 4 }, microApp: liftsApp },
  { layout: { x: 7, y: 8, w: 5, h: 4 }, microApp: robotMutexGroupsApp },
];

const tasksWorkspace: InitialWindow[] = [
  { layout: { x: 0, y: 0, w: 7, h: 8 }, microApp: tasksApp },
  { layout: { x: 7, y: 0, w: 5, h: 8 }, microApp: mapApp },
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
    { taskDefinitionId: "patrol" as const },
    { taskDefinitionId: "delivery" as const },
    { taskDefinitionId: "compose-clean" as const },
    { taskDefinitionId: "custom_compose" as const },
  ],
  pickupZones: [],
  cartIds: [],
};

export function DashboardRoot(): ReactElement {
  const platformUrl = window.location.origin;
  const trajectoryServerUrl =
    import.meta.env.VITE_TRAJECTORY_SERVER_URL ??
    `${platformUrl.replace(/^http/, "ws")}/rmf/trajectory`;

  return (
    <RmfDashboard
      disableRouter
      apiServerUrl={`${platformUrl}/rmf`}
      trajectoryServerUrl={trajectoryServerUrl}
      authenticator={authenticator}
      resources={{
        fleets: {
          navpromini: {
            default: {
              // Force small circle markers (no large icon overlays).
              scale: 0.002,
            },
          },
        },
        logos: { header: "/vite.svg" },
      }}
      tasks={TASKS}
      extraAppbarItems={<HelpGuideButton />}
      tabs={[
        {
          name: "Map",
          route: "",
          element: <MapTab />,
        },
        {
          name: "Overview",
          route: "overview",
          element: opsTab(<Workspace initialWindows={overviewWorkspace} />),
        },
        {
          name: "Tasks",
          route: "tasks",
          element: opsTab(<Workspace initialWindows={tasksWorkspace} />),
        },
        {
          name: "Custom",
          route: "custom",
          element: opsTab(
            <LocallyPersistentWorkspace
              defaultWindows={[]}
              allowDesignMode
              appRegistry={appRegistry}
              storageKey="navpro-rmf-custom-workspace"
            />,
          ),
        },
        {
          name: "Missions",
          route: "missions",
          element: platformTab(<MissionsPage />),
        },
        {
          name: "Workflows",
          route: "workflows",
          element: platformTab(<WorkflowsPage />),
        },
        {
          name: "Building",
          route: "building",
          element: platformTab(<SiteSetupPage />, true, true, true),
        },
        {
          name: "Devices",
          route: "devices",
          element: platformTab(<DevicesPage />, true),
        },
        {
          name: "Settings",
          route: "settings",
          element: platformTab(<SettingsPage />),
        },
      ]}
    />
  );
}
