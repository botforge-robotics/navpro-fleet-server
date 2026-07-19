import Box from '@mui/material/Box';
import type { ReactElement, ReactNode } from 'react';
import { canvasBackground } from '../theme/appTheme';

interface PlatformShellProps {
  children: ReactNode;
  /** Wider content for dense ops pages. */
  wide?: boolean;
  /**
   * Fill the viewport (no page scroll, no max-width).
   * Used for embedded tools like the Building noVNC editor.
   */
  fill?: boolean;
  /** Edge-to-edge content (no shell padding). Only with fill. */
  bleed?: boolean;
}

/** Consistent ambient frame for NavPro platform tabs (missions, devices, …). */
export function PlatformShell({
  children,
  wide = false,
  fill = false,
  bleed = false,
}: PlatformShellProps): ReactElement {
  return (
    <Box
      sx={{
        height: 'calc(100vh - 3.5rem)',
        minHeight: 0,
        overflow: fill ? 'hidden' : 'auto',
        bgcolor: 'background.default',
        backgroundImage: canvasBackground,
        boxSizing: 'border-box',
      }}
    >
      <Box
        sx={{
          p: fill ? (bleed ? 0 : { xs: 1.5, md: 2 }) : { xs: 2.5, md: 4 },
          maxWidth: fill ? 'none' : wide ? 1600 : 1280,
          mx: fill ? 0 : 'auto',
          width: '100%',
          height: fill ? '100%' : 'auto',
          minHeight: fill ? 0 : '100%',
          boxSizing: 'border-box',
          display: fill ? 'flex' : 'block',
          flexDirection: fill ? 'column' : undefined,
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
