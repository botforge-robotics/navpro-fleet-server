import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { radii } from '../theme/appTheme';

interface BrandMarkProps {
  size?: number;
}

/** Compact NavPro mark — CSS only, token colors. */
export function BrandMark({ size = 32 }: BrandMarkProps): ReactElement {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: `${radii.control}px`,
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        background: (theme) =>
          `linear-gradient(145deg, ${theme.palette.primary.light} 0%, ${theme.palette.primary.main} 50%, ${theme.palette.primary.dark} 100%)`,
        boxShadow: (theme) =>
          `0 0 0 1px ${alpha(theme.palette.primary.light, 0.25)}, 0 4px 14px ${alpha(theme.palette.primary.main, 0.35)}`,
        '&::before': {
          content: '""',
          position: 'absolute',
          left: '22%',
          top: '28%',
          width: '56%',
          height: '12%',
          borderRadius: `${radii.pill}px`,
          backgroundColor: (theme) => alpha(theme.palette.primary.contrastText, 0.95),
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          left: '22%',
          top: '48%',
          width: '34%',
          height: '12%',
          borderRadius: `${radii.pill}px`,
          backgroundColor: (theme) => alpha(theme.palette.primary.contrastText, 0.5),
        },
      }}
    />
  );
}
