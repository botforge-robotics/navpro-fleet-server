import Box from '@mui/material/Box';
import type { ReactElement, ReactNode } from 'react';
import { canvasBackground } from '../theme/appTheme';

interface PlatformShellProps {
  children: ReactNode;
  /** Wider content for dense ops pages. */
  wide?: boolean;
}

/** Consistent ambient frame for NavPro platform tabs (missions, devices, …). */
export function PlatformShell({ children, wide = false }: PlatformShellProps): ReactElement {
  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 'calc(100vh - 3.5rem)',
        overflow: 'auto',
        bgcolor: 'background.default',
        backgroundImage: canvasBackground,
      }}
    >
      <Box
        sx={{
          p: { xs: 2.5, md: 4 },
          maxWidth: wide ? 1600 : 1280,
          mx: 'auto',
          minHeight: '100%',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

/** Ambient padding around RMF map/table workspaces. */
export function OpsWorkspaceShell({ children }: { children: ReactNode }): ReactElement {
  return (
    <Box
      sx={{
        height: 'calc(100vh - 3.5rem)',
        overflow: 'auto',
        bgcolor: 'background.default',
        backgroundImage: canvasBackground,
        p: 1,
        boxSizing: 'border-box',
      }}
    >
      {children}
    </Box>
  );
}
