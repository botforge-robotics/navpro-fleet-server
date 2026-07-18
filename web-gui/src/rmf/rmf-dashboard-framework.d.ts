declare module 'rmf-dashboard-framework/components' {
  import type { SxProps, Theme } from '@mui/material/styles';
  import type { ReactNode } from 'react';

  export interface MicroAppManifest {
    name: string;
    displayName: string;
    Component: React.ComponentType<Record<string, unknown>>;
  }

  export interface InitialWindow {
    layout: { x: number; y: number; w: number; h: number };
    microApp: MicroAppManifest;
  }

  export interface WorkspaceProps {
    initialWindows: InitialWindow[];
  }

  export const Workspace: React.ComponentType<WorkspaceProps>;

  export interface LocallyPersistentWorkspaceProps {
    defaultWindows: InitialWindow[];
    allowDesignMode?: boolean;
    appRegistry?: MicroAppManifest[];
    storageKey: string;
  }

  export const LocallyPersistentWorkspace: React.ComponentType<LocallyPersistentWorkspaceProps>;

  export interface RmfDashboardProps {
    apiServerUrl: string;
    trajectoryServerUrl: string;
    authenticator: unknown;
    helpLink?: string;
    reportIssueLink?: string;
    resources: { fleets: Record<string, unknown>; logos: { header: string } };
    tasks: {
      allowedTasks: Array<{
        taskDefinitionId: 'patrol' | 'delivery' | 'compose-clean' | 'custom_compose';
        displayName?: string;
        scheduleEventColor?: string;
      }>;
      pickupZones: string[];
      cartIds: string[];
    };
    tabs: Array<{ name: string; route: string; element: ReactNode }>;
    baseUrl?: string;
    embeddedContent?: ReactNode;
    disableRouter?: boolean;
    /** Always shown in the app bar before the profile icon. */
    extraAppbarItems?: ReactNode;
  }

  export const RmfDashboard: React.ComponentType<RmfDashboardProps>;

  export interface MapProps {
    attributionPrefix: string;
    defaultMapLevel: string;
    defaultRobotZoom: number;
    defaultZoom: number;
    sx?: SxProps<Theme>;
  }

  export const Map: React.ComponentType<MapProps>;
}

declare module 'rmf-dashboard-framework/micro-apps' {
  import type { MicroAppManifest } from 'rmf-dashboard-framework/components';

  export interface MapAppConfig {
    attributionPrefix: string;
    defaultMapLevel: string;
    defaultRobotZoom: number;
    defaultZoom: number;
  }

  export function createMapApp(config: MapAppConfig): MicroAppManifest;
  export const doorsApp: MicroAppManifest;
  export const liftsApp: MicroAppManifest;
  export const robotMutexGroupsApp: MicroAppManifest;
  export const robotsApp: MicroAppManifest;
  export const tasksApp: MicroAppManifest;
}
